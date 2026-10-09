package router

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/fintech-app/backend/internal/config"
	"github.com/fintech-app/backend/internal/http-server/handlers/auth"
	"github.com/fintech-app/backend/internal/http-server/handlers/events"
	"github.com/fintech-app/backend/internal/http-server/handlers/family"
	"github.com/fintech-app/backend/internal/http-server/handlers/goals"
	"github.com/fintech-app/backend/internal/http-server/handlers/guardian"
	"github.com/fintech-app/backend/internal/http-server/handlers/quests"
	"github.com/fintech-app/backend/internal/http-server/handlers/transfers"
	mid "github.com/fintech-app/backend/internal/http-server/middleware"
	"github.com/fintech-app/backend/internal/services"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

type Config struct {
	Log         *slog.Logger
	Storage     *postgres.Storage
	AppConfig   *config.Config
	TransferSvc *services.TransferService
	EventBroker *services.EventBroker
}


func New(cfg Config) http.Handler {
	r := chi.NewRouter()

	r.Use(chimw.RequestID)
	r.Use(mid.Logger(cfg.Log))
	r.Use(chimw.Recoverer)
	r.Use(chimw.URLFormat)

	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173", "*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Route("/api/v1", func(r chi.Router) {
		// Health check
		r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","service":"family-bank"}`))
		})

		// Auth (Public)
		r.Post("/auth/register", auth.Register(cfg.Log, cfg.Storage, cfg.AppConfig.AppSecret, cfg.AppConfig.AccessTokenTTL))
		r.Post("/auth/login", auth.Login(cfg.Log, cfg.Storage, cfg.AppConfig.AppSecret, cfg.AppConfig.AccessTokenTTL))

		// Protected Routes
		r.Group(func(r chi.Router) {
			r.Use(mid.Auth(cfg.AppConfig.AppSecret))

			// Session
			r.Post("/auth/logout", auth.Logout(cfg.Log))
			r.Get("/auth/me", auth.Me(cfg.Log, cfg.Storage))
			r.Patch("/auth/profile", auth.UpdateProfile(cfg.Log, cfg.Storage))
			r.Post("/auth/password", auth.ChangePassword(cfg.Log, cfg.Storage))

			// Real-time Event Stream (SSE)
			r.Get("/events/stream", events.Stream(cfg.Log, cfg.Storage, cfg.EventBroker))

			// Family
			r.Get("/family/dashboard", family.Dashboard(cfg.Log, cfg.Storage))
			r.Post("/family/join", auth.JoinFamily(cfg.Log, cfg.Storage))
			r.Get("/family/invite", family.GetInvite(cfg.Log, cfg.Storage))
			r.Post("/family/invite/regenerate", family.RegenerateInvite(cfg.Log, cfg.Storage))
			r.Get("/family/policies/{userId}", family.GetPolicy(cfg.Log, cfg.Storage))
			r.Put("/family/policies/{userId}", family.UpdatePolicy(cfg.Log, cfg.Storage))

			// Family management (owner only): join requests, authority, birth date
			r.Get("/family/requests", family.ListRequests(cfg.Log, cfg.Storage))
			r.Post("/family/requests/confirm", family.ConfirmRequest(cfg.Log, cfg.Storage))
			r.Delete("/family/requests/{userId}", family.RejectRequest(cfg.Log, cfg.Storage))
			r.Get("/family/members", family.ListMembers(cfg.Log, cfg.Storage))
			r.Put("/family/members/{userId}/authority", family.UpdateAuthority(cfg.Log, cfg.Storage))
			r.Put("/family/members/{userId}/birth-date", family.UpdateBirthDate(cfg.Log, cfg.Storage))
			r.Delete("/family/members/{userId}", family.RemoveMemberHandler(cfg.Log, cfg.Storage))

			// Transfers & Antifraud
			r.Post("/transfers", transfers.Transfer(cfg.Log, cfg.Storage, cfg.TransferSvc))
			r.Get("/transfers/history", transfers.History(cfg.Log, cfg.Storage))

			// Guardian Co-Signing & Audit
			r.Get("/guardian/pending", guardian.ListPending(cfg.Log, cfg.Storage))
			r.Get("/guardian/history", guardian.ListHistory(cfg.Log, cfg.Storage))
			r.Post("/guardian/decide", guardian.Decide(cfg.Log, cfg.Storage, cfg.TransferSvc))

			// Quests & Gamification
			r.Get("/quests", quests.List(cfg.Log, cfg.Storage))
			r.Post("/quests/{id}/answer", quests.Answer(cfg.Log, cfg.Storage))

			// Goals (Piggy bank)
			r.Get("/goals", goals.List(cfg.Log, cfg.Storage))
			r.Post("/goals", goals.Create(cfg.Log, cfg.Storage))
			r.Post("/goals/{id}/topup", goals.TopUp(cfg.Log, cfg.Storage))
		})
	})

	return r
}
