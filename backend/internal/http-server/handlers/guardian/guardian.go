package guardian

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
	"github.com/go-playground/validator/v10"
	mid "github.com/fintech-app/backend/internal/http-server/middleware"
	resp "github.com/fintech-app/backend/internal/lib/api/response"
	"github.com/fintech-app/backend/internal/lib/sl"
	"github.com/fintech-app/backend/internal/services"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

var validate = validator.New()

type DecisionRequest struct {
	RequestID int64  `json:"request_id" validate:"required"`
	Action    string `json:"action" validate:"required,oneof=approve reject"`
}

func ListPending(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		reqs, err := storage.GetPendingCoSignRequests(r.Context(), userID)
		if err != nil {
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка получения запросов на подтверждение"))
			return
		}

		render.JSON(w, r, resp.OKWithData(reqs))
	}
}

func Decide(log *slog.Logger, storage *postgres.Storage, transferSvc *services.TransferService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.guardian.Decide"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		guardianUser, err := storage.UserByID(r.Context(), userID)
		if err != nil {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, resp.Error("пользователь не найден"))
			return
		}

		var req DecisionRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат тела запроса"))
			return
		}

		if err := validate.Struct(req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.ValidationError(err.(validator.ValidationErrors)))
			return
		}

		// Only the guardian the request was addressed to may decide on it.
		coSign, err := storage.GetCoSignRequestByID(r.Context(), req.RequestID)
		if err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				render.Status(r, http.StatusNotFound)
				render.JSON(w, r, resp.Error("запрос на подтверждение не найден"))
				return
			}
			log.Error("failed to load co-sign request", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}

		if coSign.GuardianID != userID {
			render.Status(r, http.StatusForbidden)
			render.JSON(w, r, resp.Error("доступ запрещён"))
			return
		}

		if req.Action == "approve" {
			if err := transferSvc.ApproveTransfer(r.Context(), guardianUser, req.RequestID); err != nil {
				log.Error("failed to approve transfer", sl.Err(err))
				render.Status(r, http.StatusBadRequest)
				render.JSON(w, r, resp.Error(err.Error()))
				return
			}
		} else {
			if err := transferSvc.RejectTransfer(r.Context(), guardianUser, req.RequestID); err != nil {
				log.Error("failed to reject transfer", sl.Err(err))
				render.Status(r, http.StatusBadRequest)
				render.JSON(w, r, resp.Error(err.Error()))
				return
			}
		}

		statusStr := "approved"
		if req.Action == "reject" {
			statusStr = "rejected"
		}
		render.JSON(w, r, resp.OKWithData(map[string]any{
			"request_id": req.RequestID,
			"status":     statusStr,
		}))
	}
}

func ListHistory(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		history, err := storage.GetCoSignRequestsHistory(r.Context(), userID, 50)
		if err != nil {
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка получения журнала безопасности"))
			return
		}

		render.JSON(w, r, resp.OKWithData(history))
	}
}

