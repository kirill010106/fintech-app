package goals

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
	"github.com/fintech-app/backend/internal/domain"
	mid "github.com/fintech-app/backend/internal/http-server/middleware"
	resp "github.com/fintech-app/backend/internal/lib/api/response"
	"github.com/fintech-app/backend/internal/lib/sl"
	"github.com/fintech-app/backend/internal/storage/postgres"
)


type TopUpRequest struct {
	Amount float64 `json:"amount"`
}

func List(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		goals, err := storage.GetGoals(r.Context(), userID)
		if err != nil {
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка загрузки целей"))
			return
		}

		render.JSON(w, r, resp.OKWithData(goals))
	}
}

func TopUp(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.goals.TopUp"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		_ = log

		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		goalIDStr := chi.URLParam(r, "id")
		goalID, err := strconv.ParseInt(goalIDStr, 10, 64)
		if err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный id цели"))
			return
		}

		var req TopUpRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil || req.Amount <= 0 {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("укажите корректную сумму пополнения"))
			return
		}

		// A goal belongs to one person. Money may only be put into your own,
		// otherwise any id would let anyone fund or drain a stranger's goal.
		goal, err := storage.GoalByID(r.Context(), goalID)
		if err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				render.Status(r, http.StatusNotFound)
				render.JSON(w, r, resp.Error("цель не найдена"))
				return
			}
			log.Error("failed to load goal", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}
		if goal.UserID != userID {
			render.Status(r, http.StatusForbidden)
			render.JSON(w, r, resp.Error("это чужая цель"))
			return
		}

		accounts, err := storage.GetAccountsByUserID(r.Context(), userID)
		if err != nil || len(accounts) == 0 {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("счёт не найден"))
			return
		}

		acc := accounts[0]
		if acc.Balance < req.Amount {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("недостаточно средств на карте для пополнения копилки"))
			return
		}

		policy, _ := storage.GetSafetyPolicy(r.Context(), userID)
		totalAdded := req.Amount
		if policy.ParentMatchPercent > 0 {
			matchBonus := req.Amount * (float64(policy.ParentMatchPercent) / 100.0)
			totalAdded += matchBonus
		}

		_ = storage.UpdateAccountBalance(r.Context(), acc.ID, acc.Balance-req.Amount)
		_ = storage.TopUpGoal(r.Context(), goalID, totalAdded)

		goals, _ := storage.GetGoals(r.Context(), userID)
		render.JSON(w, r, resp.OKWithData(goals))
	}
}

func Create(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		var req domain.CreateGoalRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil || req.Title == "" || req.TargetAmount <= 0 {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("укажите название цели и целевую сумму"))
			return
		}

		family, members, err := storage.GetFamilyByUserID(r.Context(), userID)
		var sponsorID int64 = 1
		if err == nil {
			sponsorID = family.OwnerID
			for _, m := range members {
				if m.Status != domain.MembershipActive || m.UserID == family.OwnerID {
					continue
				}
				if m.Authority.CanSupervise() {
					sponsorID = m.UserID
					break
				}
			}
		}

		newGoal := domain.Goal{
			UserID:          userID,
			Title:           req.Title,
			TargetAmount:    req.TargetAmount,
			CurrentAmount:   0,
			BoostMultiplier: 0.50,
			SponsorID:       sponsorID,
		}

		_, err = storage.CreateGoal(r.Context(), newGoal)
		if err != nil {
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка создания цели"))
			return
		}

		goals, _ := storage.GetGoals(r.Context(), userID)
		render.JSON(w, r, resp.OKWithData(goals))
	}
}

