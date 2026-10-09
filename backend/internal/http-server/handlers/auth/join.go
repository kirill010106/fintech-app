package auth

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
	"github.com/go-playground/validator/v10"

	"github.com/fintech-app/backend/internal/domain"
	resp "github.com/fintech-app/backend/internal/lib/api/response"
	"github.com/fintech-app/backend/internal/lib/sl"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

type JoinFamilyRequest struct {
	InviteCode string `json:"invite_code" validate:"required"`
}

// JoinFamily files a request to join the family identified by an invite code.
// The request stays pending until the owner confirms it, so an invite code alone
// never grants access to somebody else's family: the owner decides who comes in
// and with what authority.
//
// A user who registered without a code and owns a family nobody joined yet is
// simply folded into the target family: there is nothing to protect there.
func JoinFamily(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.auth.JoinFamily"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		user, ok := currentUser(w, r, log, storage)
		if !ok {
			return
		}

		var req JoinFamilyRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			log.Warn("cannot decode join family request", sl.Err(err))
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат запроса"))
			return
		}

		if err := validate.Struct(req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.ValidationError(err.(validator.ValidationErrors)))
			return
		}

		target, err := storage.FamilyByInviteCode(ctx, req.InviteCode)
		if err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				render.Status(r, http.StatusBadRequest)
				render.JSON(w, r, resp.Error("неверный код приглашения"))
				return
			}
			log.Error("failed to look up invite code", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}

		current, _, currentErr := storage.GetFamilyByUserID(ctx, user.ID)
		if currentErr != nil && !errors.Is(currentErr, postgres.ErrNotFound) {
			log.Error("failed to load current family", sl.Err(currentErr))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}

		// Already in the target family: idempotent success. A request that is
		// still pending answers with the same pending contract, never with the
		// family's contents.
		if currentErr == nil && current.ID == target.ID {
			if member, err := storage.MembershipOf(ctx, target.ID, user.ID); err == nil && member.Status == domain.MembershipPending {
				render.JSON(w, r, resp.OKWithData(map[string]any{
					"membership_status": domain.MembershipPending,
					"family_name":       target.Name,
					"message":           "заявка уже отправлена, ожидает подтверждения владельца семьи",
				}))
				return
			}
			render.JSON(w, r, resp.OKWithData(session(ctx, storage, user)))
			return
		}

		// An owner may only walk away from a family nobody else joined. Dropping
		// a family that other people rely on would strand them.
		if currentErr == nil && current.OwnerID == user.ID {
			count, err := storage.FamilyMembersCount(ctx, current.ID)
			if err != nil {
				log.Error("failed to count family members", sl.Err(err))
				render.Status(r, http.StatusInternalServerError)
				render.JSON(w, r, resp.Error("внутренняя ошибка"))
				return
			}

			if count > 1 {
				render.Status(r, http.StatusConflict)
				render.JSON(w, r, resp.Error("сначала передайте управление семейной группой"))
				return
			}

			// Empty family nobody joined: drop it, memberships cascade.
			if err := storage.DeleteFamily(ctx, current.ID); err != nil {
				log.Error("failed to delete empty family", sl.Err(err))
				render.Status(r, http.StatusInternalServerError)
				render.JSON(w, r, resp.Error("не удалось отправить заявку"))
				return
			}
		} else if currentErr == nil {
			if err := storage.LeaveOtherFamilies(ctx, user.ID, target.ID); err != nil {
				log.Error("failed to leave previous family", sl.Err(err))
				render.Status(r, http.StatusInternalServerError)
				render.JSON(w, r, resp.Error("не удалось отправить заявку"))
				return
			}
		}

		// The profile travels with the request as a starting point. The owner
		// may correct the birth date at approval, which recomputes it.
		if err := storage.AddPendingMember(ctx, target.ID, user.ID, user.Name); err != nil {
			log.Error("failed to file join request", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось отправить заявку"))
			return
		}

		if _, _, err := recomputeProfile(ctx, storage, target.ID, user.ID); err != nil {
			log.Error("failed to derive protection profile", sl.Err(err))
		}

		// The caller is told the request is pending rather than being handed the
		// target family's contents.
		render.JSON(w, r, resp.OKWithData(map[string]any{
			"membership_status": domain.MembershipPending,
			"family_name":       target.Name,
			"message":           "заявка отправлена, ожидает подтверждения владельца семьи",
		}))
	}
}

// recomputeProfile derives the protection profile of a member from their birth
// date and authority and stores it on both the membership and the user row.
// It returns the resulting membership and profile.
func recomputeProfile(ctx context.Context, storage *postgres.Storage, familyID, userID int64) (domain.FamilyMember, domain.Role, error) {
	member, err := storage.MembershipOf(ctx, familyID, userID)
	if err != nil {
		return domain.FamilyMember{}, "", err
	}

	user, err := storage.UserByID(ctx, userID)
	if err != nil {
		return domain.FamilyMember{}, "", err
	}

	profile := domain.ProtectionProfile(user.BirthDate, member.Authority, time.Now())
	if member.Role == profile && user.Role == profile {
		return member, profile, nil
	}

	if err := storage.UpdateMemberProfile(ctx, familyID, userID, profile); err != nil {
		return domain.FamilyMember{}, "", err
	}
	if err := storage.UpdateUserRole(ctx, userID, profile); err != nil {
		return domain.FamilyMember{}, "", err
	}

	member.Role = profile
	member.User = &user
	member.User.Role = profile
	return member, profile, nil
}
