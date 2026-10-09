package family

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
	"github.com/go-playground/validator/v10"

	"github.com/fintech-app/backend/internal/domain"
	mid "github.com/fintech-app/backend/internal/http-server/middleware"
	resp "github.com/fintech-app/backend/internal/lib/api/response"
	"github.com/fintech-app/backend/internal/lib/sl"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

var validate = validator.New()

type MemberDashboardInfo struct {
	Member       domain.FamilyMember  `json:"member"`
	Accounts     []domain.Account     `json:"accounts"`
	TotalBalance float64              `json:"total_balance"`
	SafetyPolicy *domain.SafetyPolicy `json:"safety_policy,omitempty"`
}

type DashboardResponse struct {
	Family               domain.Family                  `json:"family"`
	Caller               domain.FamilyMember            `json:"caller"`
	TotalFamilyNetWorth  float64                        `json:"total_family_net_worth"`
	Members              []MemberDashboardInfo          `json:"members"`
	PendingRequests      []domain.JoinRequest           `json:"pending_requests"`
	PendingRequestsCount int                            `json:"pending_requests_count"`
	RecentTransactions   []domain.Transaction           `json:"recent_transactions"`
	CategoryExpenses     []domain.CategoryExpense       `json:"category_expenses"`
	SpendingSummaries    []domain.MemberSpendingSummary `json:"spending_summaries"`
}

// Dashboard returns the family overview. What it contains depends on who asks:
// a supervisor sees every member, while a supervised member sees only
// themselves. Nobody sees somebody else's balance without the authority to
// supervise them.
func Dashboard(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.Dashboard"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		caller, family, ok := membership(w, r, storage)
		if !ok {
			return
		}
		if caller.Status != domain.MembershipActive {
			render.Status(r, http.StatusForbidden)
			render.JSON(w, r, resp.Error("заявка ещё не подтверждена владельцем семьи"))
			return
		}

		// A supervised member has no business reading the whole family ledger:
		// they get their own numbers only. A supervisor sees every active member.
		members := []domain.FamilyMember{caller}
		if caller.Authority.CanSupervise() {
			all, err := storage.ActiveMembers(ctx, family.ID)
			if err != nil {
				log.Error("failed to list members", sl.Err(err))
				render.Status(r, http.StatusInternalServerError)
				render.JSON(w, r, resp.Error("не удалось загрузить семью"))
				return
			}
			if all != nil {
				members = all
			}
		}

		var totalNetWorth float64
		memberInfos := make([]MemberDashboardInfo, 0, len(members))

		for _, m := range members {
			accs, _ := storage.GetAccountsByUserID(ctx, m.UserID)
			if accs == nil {
				accs = []domain.Account{}
			}
			var sum float64
			for _, a := range accs {
				sum += a.Balance
			}
			totalNetWorth += sum

			policy, _ := storage.GetSafetyPolicy(ctx, m.UserID)

			memberInfos = append(memberInfos, MemberDashboardInfo{
				Member:       m,
				Accounts:     accs,
				TotalBalance: sum,
				SafetyPolicy: &policy,
			})
		}

		recentTxs, _ := storage.GetTransactionsByFamily(ctx, family.ID, 15)
		if recentTxs == nil {
			recentTxs = []domain.Transaction{}
		}
		catExpenses, _ := storage.GetCategoryExpenses(ctx, family.ID)
		if catExpenses == nil {
			catExpenses = make([]domain.CategoryExpense, 0)
		}

		spendingSummaries := make([]domain.MemberSpendingSummary, 0, len(members))
		for _, m := range members {
			if !m.Role.RequiresSupervision() {
				continue
			}
			summary, err := storage.GetMemberSpendingSummary(ctx, m.UserID)
			if err == nil {
				spendingSummaries = append(spendingSummaries, summary)
			}
		}

		// Only the owner decides on join requests, so only the owner sees them.
		requests := []domain.JoinRequest{}
		if family.OwnerID == caller.UserID {
			requests, _ = storage.PendingJoinRequests(ctx, family.ID)
			if requests == nil {
				requests = []domain.JoinRequest{}
			}
		}

		render.JSON(w, r, resp.OKWithData(DashboardResponse{
			Family:               family,
			Caller:               caller,
			TotalFamilyNetWorth:  totalNetWorth,
			Members:              memberInfos,
			PendingRequests:      requests,
			PendingRequestsCount: len(requests),
			RecentTransactions:   recentTxs,
			CategoryExpenses:     catExpenses,
			SpendingSummaries:    spendingSummaries,
		}))
	}
}

// GetPolicy returns the safety policy of a family member. A person may always
// read their own; a supervisor may read the policy of somebody who needs
// supervision. Another adult's policy is private.
func GetPolicy(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		caller, target, ok := policyAccess(w, r, storage)
		if !ok {
			return
		}

		if !mayReadPolicy(caller, target) {
			render.Status(r, http.StatusForbidden)
			render.JSON(w, r, resp.Error("доступ запрещён"))
			return
		}

		policy, err := storage.GetSafetyPolicy(r.Context(), target.UserID)
		if err != nil {
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка получения настроек безопасности"))
			return
		}

		render.JSON(w, r, resp.OKWithData(policy))
	}
}

// UpdatePolicy changes the safety policy of a family member.
//
// Two rules keep the model honest:
//   - a supervised member may only tighten their own policy, never loosen it,
//     so nobody can switch off their own supervision;
//   - a supervisor may only touch the policy of somebody who needs supervision.
func UpdatePolicy(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.UpdatePolicy"
		ctx := r.Context()

		caller, target, ok := policyAccess(w, r, storage)
		if !ok {
			return
		}

		if !mayReadPolicy(caller, target) {
			render.Status(r, http.StatusForbidden)
			render.JSON(w, r, resp.Error("доступ запрещён"))
			return
		}

		var p domain.SafetyPolicy
		if err := render.DecodeJSON(r.Body, &p); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат тела запроса"))
			return
		}
		p.UserID = target.UserID

		current, err := storage.GetSafetyPolicy(ctx, target.UserID)
		if err != nil {
			log.Error("failed to load current policy", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось сохранить настройки безопасности"))
			return
		}

		// Managing somebody else's policy is a supervision act: the caller must
		// be allowed to supervise and the target must actually need it.
		if caller.UserID != target.UserID {
			if !caller.Authority.CanSupervise() || !target.Role.RequiresSupervision() {
				render.Status(r, http.StatusForbidden)
				render.JSON(w, r, resp.Error("доступ запрещён"))
				return
			}
		} else if !caller.Authority.CanSupervise() {
			// Tightening only: a member cannot lift their own supervision.
			if loosened := loosenedFields(current, p); len(loosened) > 0 {
				render.Status(r, http.StatusForbidden)
				render.JSON(w, r, resp.Error(
					"эти настройки меняет только владелец семьи: "+joinFields(loosened)))
				return
			}
		}

		if err := storage.UpdateSafetyPolicy(ctx, p); err != nil {
			log.Error("failed to update policy", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось сохранить настройки безопасности"))
			return
		}

		render.JSON(w, r, resp.OKWithData(p))
	}
}

// mayReadPolicy reports whether caller may read target's safety policy.
func mayReadPolicy(caller, target domain.FamilyMember) bool {
	if caller.UserID == target.UserID {
		return true
	}
	return caller.Authority.CanSupervise() && target.Role.RequiresSupervision()
}

// loosenedFields lists the fields of the request that would weaken supervision
// compared with the stored policy. An empty result means "same or stricter".
func loosenedFields(current, next domain.SafetyPolicy) []string {
	var fields []string

	// Booleans that protect only get stronger: true -> false is a loosening.
	if current.RequireCoSigning && !next.RequireCoSigning {
		fields = append(fields, "require_co_signing")
	}
	if current.TrustedContactsOnly && !next.TrustedContactsOnly {
		fields = append(fields, "trusted_contacts_only")
	}
	if current.NightLockdown && !next.NightLockdown {
		fields = append(fields, "night_lockdown")
	}
	if current.AntiDropperShield && !next.AntiDropperShield {
		fields = append(fields, "anti_dropper_shield")
	}

	// Limits may only go down.
	if next.MaxInstantTransfer > current.MaxInstantTransfer {
		fields = append(fields, "max_instant_transfer")
	}
	if next.FastFoodLimitMonth > current.FastFoodLimitMonth {
		fields = append(fields, "fast_food_limit_month")
	}
	if next.GamingLimitMonth > current.GamingLimitMonth {
		fields = append(fields, "gaming_limit_month")
	}
	if next.ParentMatchPercent > current.ParentMatchPercent {
		fields = append(fields, "parent_match_percent")
	}

	// A supervised member cannot edit the shared whitelist through this route.
	if !sameStrings(current.TrustedWhitelist, next.TrustedWhitelist) {
		fields = append(fields, "trusted_whitelist")
	}

	return fields
}

func sameStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func joinFields(fields []string) string {
	out := ""
	for i, f := range fields {
		if i > 0 {
			out += ", "
		}
		out += f
	}
	return out
}

// policyAccess resolves the caller's membership and the target's membership,
// both of which must belong to the same family and be active.
func policyAccess(w http.ResponseWriter, r *http.Request, storage *postgres.Storage) (domain.FamilyMember, domain.FamilyMember, bool) {
	targetUserID, err := strconv.ParseInt(chi.URLParam(r, "userId"), 10, 64)
	if err != nil {
		render.Status(r, http.StatusBadRequest)
		render.JSON(w, r, resp.Error("неверный userId"))
		return domain.FamilyMember{}, domain.FamilyMember{}, false
	}

	caller, family, ok := membership(w, r, storage)
	if !ok {
		return domain.FamilyMember{}, domain.FamilyMember{}, false
	}

	target, err := storage.MembershipOf(r.Context(), family.ID, targetUserID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, resp.Error("участник не найден"))
			return domain.FamilyMember{}, domain.FamilyMember{}, false
		}
		render.Status(r, http.StatusInternalServerError)
		render.JSON(w, r, resp.Error("внутренняя ошибка"))
		return domain.FamilyMember{}, domain.FamilyMember{}, false
	}

	return caller, target, true
}

// membership resolves the authenticated caller's membership and family.
func membership(w http.ResponseWriter, r *http.Request, storage *postgres.Storage) (domain.FamilyMember, domain.Family, bool) {
	userID, ok := mid.GetUserID(r.Context())
	if !ok {
		render.Status(r, http.StatusUnauthorized)
		render.JSON(w, r, resp.Error("не авторизован"))
		return domain.FamilyMember{}, domain.Family{}, false
	}

	caller, family, err := storage.MembershipByUserID(r.Context(), userID)
	if err != nil {
		render.Status(r, http.StatusForbidden)
		render.JSON(w, r, resp.Error("семейная группа не найдена"))
		return domain.FamilyMember{}, domain.Family{}, false
	}

	return caller, family, true
}

// ownerFamily authorises the caller as the family owner and returns their
// membership together with the family. Anything the owner alone may do goes
// through here.
func ownerFamily(w http.ResponseWriter, r *http.Request, storage *postgres.Storage) (domain.FamilyMember, domain.Family, bool) {
	caller, family, ok := membership(w, r, storage)
	if !ok {
		return domain.FamilyMember{}, domain.Family{}, false
	}

	if family.OwnerID != caller.UserID {
		render.Status(r, http.StatusForbidden)
		render.JSON(w, r, resp.Error("доступ запрещён"))
		return domain.FamilyMember{}, domain.Family{}, false
	}

	return caller, family, true
}

// confirmRequest is the owner's decision on a pending join request.
type confirmRequest struct {
	UserID    int64            `json:"user_id" validate:"required"`
	Authority domain.Authority `json:"authority" validate:"required,oneof=guardian member"`
	BirthDate string           `json:"birth_date"`
	Nickname  string           `json:"nickname"`
}

// ListMembers returns the active members of the caller's family. A supervisor
// sees everyone; a supervised member sees only themselves.
func ListMembers(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.ListMembers"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		caller, family, ok := membership(w, r, storage)
		if !ok {
			return
		}
		if caller.Status != domain.MembershipActive {
			render.Status(r, http.StatusForbidden)
			render.JSON(w, r, resp.Error("заявка ещё не подтверждена владельцем семьи"))
			return
		}
		if !caller.Authority.CanSupervise() {
			render.Status(r, http.StatusForbidden)
			render.JSON(w, r, resp.Error("доступ запрещён"))
			return
		}

		members, err := storage.ActiveMembers(ctx, family.ID)
		if err != nil {
			log.Error("failed to list members", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось загрузить участников"))
			return
		}
		if members == nil {
			members = []domain.FamilyMember{}
		}

		render.JSON(w, r, resp.OKWithData(members))
	}
}

// ListRequests returns the join requests awaiting the owner's decision.
func ListRequests(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.ListRequests"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		_, family, ok := ownerFamily(w, r, storage)
		if !ok {
			return
		}

		requests, err := storage.PendingJoinRequests(r.Context(), family.ID)
		if err != nil {
			log.Error("failed to list join requests", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось загрузить заявки"))
			return
		}
		if requests == nil {
			requests = []domain.JoinRequest{}
		}

		render.JSON(w, r, resp.OKWithData(requests))
	}
}

// ConfirmRequest approves a join request, setting the authority and correcting
// the birth date before the protection profile is derived from it.
func ConfirmRequest(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.ConfirmRequest"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		owner, family, ok := ownerFamily(w, r, storage)
		if !ok {
			return
		}

		var req confirmRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат запроса"))
			return
		}
		if err := validate.Struct(req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.ValidationError(err.(validator.ValidationErrors)))
			return
		}

		if req.UserID == owner.UserID {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("владелец не может подтвердить сам себя"))
			return
		}

		// A correction to the birth date arrives before the profile is derived
		// from it, so the owner can fix an accidental mistype at approval time.
		if req.BirthDate != "" {
			birthDate, err := domain.ParseBirthDate(req.BirthDate, time.Now())
			if err != nil {
				render.Status(r, http.StatusBadRequest)
				render.JSON(w, r, resp.Error(err.Error()))
				return
			}
			if err := storage.UpdateUserBirthDate(ctx, req.UserID, birthDate); err != nil {
				log.Error("failed to correct birth date", sl.Err(err))
				render.Status(r, http.StatusInternalServerError)
				render.JSON(w, r, resp.Error("не удалось сохранить дату рождения"))
				return
			}
		}

		user, err := storage.UserByID(ctx, req.UserID)
		if err != nil {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, resp.Error("пользователь не найден"))
			return
		}

		profile := domain.ProtectionProfile(user.BirthDate, req.Authority, time.Now())

		nickname := req.Nickname
		if nickname == "" {
			nickname = user.Name
		}

		if err := storage.ConfirmMember(ctx, family.ID, req.UserID, req.Authority, profile, nickname); err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				render.Status(r, http.StatusNotFound)
				render.JSON(w, r, resp.Error("заявка не найдена"))
				return
			}
			log.Error("failed to confirm member", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось подтвердить заявку"))
			return
		}

		if err := storage.UpdateUserRole(ctx, req.UserID, profile); err != nil {
			log.Error("failed to sync protection profile", sl.Err(err))
		}

		render.JSON(w, r, resp.OKWithData(map[string]any{
			"user_id":           req.UserID,
			"authority":         req.Authority,
			"role":              profile,
			"membership_status": domain.MembershipActive,
		}))
	}
}

// RejectRequest declines a join request by removing it.
func RejectRequest(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.RejectRequest"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		_, family, ok := ownerFamily(w, r, storage)
		if !ok {
			return
		}

		targetUserID, ok := targetUser(w, r)
		if !ok {
			return
		}

		member, err := storage.MembershipOf(r.Context(), family.ID, targetUserID)
		if err != nil {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, resp.Error("заявка не найдена"))
			return
		}
		if member.Status != domain.MembershipPending {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("участник уже подтверждён"))
			return
		}

		if err := storage.RemoveMember(r.Context(), family.ID, targetUserID); err != nil {
			log.Error("failed to reject request", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось отклонить заявку"))
			return
		}

		render.JSON(w, r, resp.OKWithData(map[string]any{
			"user_id": targetUserID,
			"message": "заявка отклонена",
		}))
	}
}

// authorityRequest is the owner's change to an active member.
type authorityRequest struct {
	Authority domain.Authority `json:"authority" validate:"required,oneof=guardian member"`
}

// UpdateAuthority changes what an active member may do. Only the owner decides
// this, and the change takes effect on the member's next request.
func UpdateAuthority(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.UpdateAuthority"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		owner, family, ok := ownerFamily(w, r, storage)
		if !ok {
			return
		}

		targetUserID, ok := targetUser(w, r)
		if !ok {
			return
		}

		var req authorityRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат запроса"))
			return
		}
		if err := validate.Struct(req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.ValidationError(err.(validator.ValidationErrors)))
			return
		}

		if targetUserID == owner.UserID {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("владелец не может изменить свою роль"))
			return
		}

		if err := storage.UpdateMemberAuthority(ctx, family.ID, targetUserID, req.Authority); err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				render.Status(r, http.StatusNotFound)
				render.JSON(w, r, resp.Error("участник не найден"))
				return
			}
			log.Error("failed to update authority", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось изменить права"))
			return
		}

		// Authority feeds the protection profile, so the profile is recomputed
		// right away rather than at read time only.
		member, profile, err := recompute(ctx, storage, family.ID, targetUserID)
		if err != nil {
			log.Error("failed to recompute profile", sl.Err(err))
		}

		render.JSON(w, r, resp.OKWithData(map[string]any{
			"user_id":   targetUserID,
			"authority": req.Authority,
			"role":      profile,
			"member":    member,
		}))
	}
}

// birthDateRequest corrects a member's birth date. It decides the protection
// profile, so only the owner may send it, and only for a person they supervise.
type birthDateRequest struct {
	BirthDate string `json:"birth_date" validate:"required"`
}

// UpdateBirthDate corrects the birth date of a supervised member and applies the
// protection profile that follows from it.
func UpdateBirthDate(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.UpdateBirthDate"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		owner, family, ok := ownerFamily(w, r, storage)
		if !ok {
			return
		}

		targetUserID, ok := targetUser(w, r)
		if !ok {
			return
		}

		var req birthDateRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат запроса"))
			return
		}
		if err := validate.Struct(req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.ValidationError(err.(validator.ValidationErrors)))
			return
		}

		if targetUserID == owner.UserID {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("владелец не может изменить свою дату рождения"))
			return
		}

		member, err := storage.MembershipOf(ctx, family.ID, targetUserID)
		if err != nil {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, resp.Error("участник не найден"))
			return
		}
		if !member.Role.RequiresSupervision() {
			render.Status(r, http.StatusForbidden)
			render.JSON(w, r, resp.Error("доступ запрещён"))
			return
		}

		birthDate, err := domain.ParseBirthDate(req.BirthDate, time.Now())
		if err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error(err.Error()))
			return
		}

		if err := storage.UpdateUserBirthDate(ctx, targetUserID, birthDate); err != nil {
			log.Error("failed to update birth date", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось сохранить дату рождения"))
			return
		}

		updated, profile, err := recompute(ctx, storage, family.ID, targetUserID)
		if err != nil {
			log.Error("failed to recompute profile", sl.Err(err))
		}

		render.JSON(w, r, resp.OKWithData(map[string]any{
			"user_id":    targetUserID,
			"birth_date": birthDate.Format("2006-01-02"),
			"role":       profile,
			"member":     updated,
		}))
	}
}

// RemoveMemberHandler removes an active member from the family.
func RemoveMemberHandler(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.family.RemoveMember"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		owner, family, ok := ownerFamily(w, r, storage)
		if !ok {
			return
		}

		targetUserID, ok := targetUser(w, r)
		if !ok {
			return
		}

		if targetUserID == owner.UserID {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("владелец не может покинуть собственную семью"))
			return
		}

		if err := storage.RemoveMember(r.Context(), family.ID, targetUserID); err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				render.Status(r, http.StatusNotFound)
				render.JSON(w, r, resp.Error("участник не найден"))
				return
			}
			log.Error("failed to remove member", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось исключить участника"))
			return
		}

		render.JSON(w, r, resp.OKWithData(map[string]any{
			"user_id": targetUserID,
			"message": "участник исключён",
		}))
	}
}

// recompute re-derives a member's protection profile from their birth date and
// authority and stores it on both the membership and the user row.
func recompute(ctx context.Context, storage *postgres.Storage, familyID, userID int64) (domain.FamilyMember, domain.Role, error) {
	member, err := storage.MembershipOf(ctx, familyID, userID)
	if err != nil {
		return domain.FamilyMember{}, "", err
	}

	user, err := storage.UserByID(ctx, userID)
	if err != nil {
		return domain.FamilyMember{}, "", err
	}

	profile := domain.ProtectionProfile(user.BirthDate, member.Authority, time.Now())

	if member.Role != profile {
		if err := storage.UpdateMemberProfile(ctx, familyID, userID, profile); err != nil {
			return domain.FamilyMember{}, "", err
		}
		member.Role = profile
	}
	if user.Role != profile {
		if err := storage.UpdateUserRole(ctx, userID, profile); err != nil {
			return domain.FamilyMember{}, "", err
		}
		user.Role = profile
	}

	member.User = &user
	return member, profile, nil
}

// targetUser reads the {userId} path parameter.
func targetUser(w http.ResponseWriter, r *http.Request) (int64, bool) {
	targetUserID, err := strconv.ParseInt(chi.URLParam(r, "userId"), 10, 64)
	if err != nil {
		render.Status(r, http.StatusBadRequest)
		render.JSON(w, r, resp.Error("неверный userId"))
		return 0, false
	}
	return targetUserID, true
}
