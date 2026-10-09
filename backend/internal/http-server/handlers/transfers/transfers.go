package transfers

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

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

type InitiateRequest struct {
	AccountID      int64   `json:"account_id" validate:"required"`
	RecipientPhone string  `json:"recipient_phone" validate:"required"`
	RecipientName  string  `json:"recipient_name"`
	Amount         float64 `json:"amount" validate:"required,gt=0"`
	Description    string  `json:"description"`
}

func Transfer(log *slog.Logger, storage *postgres.Storage, transferSvc *services.TransferService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.transfers.Transfer"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		user, err := storage.UserByID(r.Context(), userID)
		if err != nil {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, resp.Error("пользователь не найден"))
			return
		}

		var req InitiateRequest
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

		// A user may only send money from a bank account it owns.
		account, err := storage.GetAccountByID(r.Context(), req.AccountID)
		if err != nil {
			if errors.Is(err, postgres.ErrNotFound) {
				render.Status(r, http.StatusNotFound)
				render.JSON(w, r, resp.Error("банковский счёт не найден"))
				return
			}
			log.Error("failed to load account", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}

		if account.UserID != userID {
			render.Status(r, http.StatusForbidden)
			render.JSON(w, r, resp.Error("доступ запрещён"))
			return
		}

		res, err := transferSvc.InitiateTransfer(r.Context(), user, services.TransferRequest{
			AccountID:      req.AccountID,
			RecipientPhone: req.RecipientPhone,
			RecipientName:  req.RecipientName,
			Amount:         req.Amount,
			Description:    req.Description,
		})
		if err != nil {
			log.Warn("transfer failed", sl.Err(err))
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error(err.Error()))
			return
		}

		render.JSON(w, r, resp.OKWithData(res))
	}
}

func History(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		limitStr := r.URL.Query().Get("limit")
		limit := 30
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 {
			limit = l
		}

		user, _ := storage.UserByID(r.Context(), userID)
		var list []any
		_ = user

		txs, err := storage.GetTransactionsByUserID(r.Context(), userID, limit)
		if err != nil {
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка получения истории операций"))
			return
		}
		_ = list

		render.JSON(w, r, resp.OKWithData(txs))
	}
}
