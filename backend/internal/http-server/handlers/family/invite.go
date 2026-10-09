package family

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"

	"github.com/fintech-app/backend/internal/domain"
	mid "github.com/fintech-app/backend/internal/http-server/middleware"
	resp "github.com/fintech-app/backend/internal/lib/api/response"
	"github.com/fintech-app/backend/internal/lib/invitecode"
	"github.com/fintech-app/backend/internal/lib/sl"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

const inviteCodeAttempts = 5

type InviteResponse struct {
	InviteCode string `json:"invite_code"`
	FamilyName string `json:"family_name"`
}

// GetInvite returns the invite code of the caller's family group.
func GetInvite(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.GetInvite"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		family, ok := inviteFamily(w, r, log, storage)
		if !ok {
			return
		}

		render.JSON(w, r, resp.OKWithData(InviteResponse{
			InviteCode: family.InviteCode,
			FamilyName: family.Name,
		}))
	}
}

// RegenerateInvite issues a brand new invite code for the caller's family group.
func RegenerateInvite(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.RegenerateInvite"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		family, ok := inviteFamily(w, r, log, storage)
		if !ok {
			return
		}

		var code string
		for attempt := 0; attempt < inviteCodeAttempts; attempt++ {
			generated, err := invitecode.Generate()
			if err != nil {
				log.Error("failed to generate invite code", sl.Err(err))
				render.Status(r, http.StatusInternalServerError)
				render.JSON(w, r, resp.Error("не удалось обновить код приглашения"))
				return
			}

			if err := storage.RegenerateInviteCode(ctx, family.ID, generated); err != nil {
				if postgres.IsUniqueViolation(err) {
					continue // collision, retry with a fresh code
				}
				log.Error("failed to persist invite code", sl.Err(err))
				render.Status(r, http.StatusInternalServerError)
				render.JSON(w, r, resp.Error("не удалось обновить код приглашения"))
				return
			}

			code = generated
			break
		}

		if code == "" {
			log.Error("no unique invite code allocated")
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось обновить код приглашения"))
			return
		}

		render.JSON(w, r, resp.OKWithData(InviteResponse{
			InviteCode: code,
			FamilyName: family.Name,
		}))
	}
}

// inviteFamily authorises the caller (the family owner) and loads its family.
// On failure it writes the error response and reports ok = false.
func inviteFamily(w http.ResponseWriter, r *http.Request, log *slog.Logger, storage *postgres.Storage) (domain.Family, bool) {
	userID, ok := mid.GetUserID(r.Context())
	if !ok {
		render.Status(r, http.StatusUnauthorized)
		render.JSON(w, r, resp.Error("не авторизован"))
		return domain.Family{}, false
	}

	family, _, famErr := storage.GetFamilyByUserID(r.Context(), userID)
	if famErr != nil {
		if errors.Is(famErr, postgres.ErrNotFound) {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, resp.Error("семейная группа не найдена"))
			return domain.Family{}, false
		}
		log.Error("failed to load family", sl.Err(famErr))
		render.Status(r, http.StatusInternalServerError)
		render.JSON(w, r, resp.Error("внутренняя ошибка"))
		return domain.Family{}, false
	}

	// The invite code is the family's single entry point: the owner hands it
	// out, so only the owner may read or rotate it.
	if family.OwnerID != userID {
		render.Status(r, http.StatusForbidden)
		render.JSON(w, r, resp.Error("доступ запрещён"))
		return domain.Family{}, false
	}

	return family, true
}
