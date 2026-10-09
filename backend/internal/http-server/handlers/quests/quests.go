package quests

import (
	"errors"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
	mid "github.com/fintech-app/backend/internal/http-server/middleware"
	resp "github.com/fintech-app/backend/internal/lib/api/response"
	"github.com/fintech-app/backend/internal/lib/sl"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

type AnswerRequest struct {
	OptionIndex int `json:"option_index"`
}

type AnswerResponse struct {
	IsCorrect         bool    `json:"is_correct"`
	Explanation       string  `json:"explanation"`
	SafetyScoreReward int     `json:"safety_score_reward"`
	RewardRub         float64 `json:"reward_rub"`
	NewSafetyScore    int     `json:"new_safety_score"`
	AlreadyCompleted  bool    `json:"already_completed"`
}

func List(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		quests, err := storage.GetQuests(r.Context(), userID)
		if err != nil {
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка загрузки квестов"))
			return
		}

		render.JSON(w, r, resp.OKWithData(quests))
	}
}

func Answer(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.quests.Answer"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("не авторизован"))
			return
		}

		questIDStr := chi.URLParam(r, "id")
		questID, err := strconv.ParseInt(questIDStr, 10, 64)
		if err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный id квеста"))
			return
		}

		var req AnswerRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат запроса"))
			return
		}

		quests, err := storage.GetQuests(r.Context(), userID)
		if err != nil {
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка базы данных"))
			return
		}

		var found bool
		var isCorrect bool
		var alreadyCompleted bool
		var expl string
		var safetyReward int
		var rubReward float64

		for _, q := range quests {
			if q.ID == questID {
				found = true
				isCorrect = (req.OptionIndex == q.CorrectOption)
				expl = q.Explanation
				safetyReward = q.SafetyScoreReward
				rubReward = q.RewardRub
				break
			}
		}

		if !found {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, resp.Error("квест не найден"))
			return
		}

		if isCorrect {
			if err := storage.CompleteQuest(r.Context(), userID, questID, safetyReward, rubReward); err != nil {
				if !errors.Is(err, postgres.ErrAlreadyCompleted) {
					log.Error("failed to complete quest", sl.Err(err))
					render.Status(r, http.StatusInternalServerError)
					render.JSON(w, r, resp.Error("не удалось зачислить награду"))
					return
				}
				// The quest was answered correctly before: nothing is credited again.
				alreadyCompleted = true
				safetyReward = 0
				rubReward = 0
			}
		}

		user, _ := storage.UserByID(r.Context(), userID)

		render.JSON(w, r, resp.OKWithData(AnswerResponse{
			IsCorrect:         isCorrect,
			Explanation:       expl,
			SafetyScoreReward: safetyReward,
			RewardRub:         rubReward,
			NewSafetyScore:    user.SafetyScore,
			AlreadyCompleted:  alreadyCompleted,
		}))
	}
}
