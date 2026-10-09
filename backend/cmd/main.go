package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/pressly/goose/v3"
	"github.com/fintech-app/backend"
	"github.com/fintech-app/backend/internal/config"
	"github.com/fintech-app/backend/internal/http-server/router"
	"github.com/fintech-app/backend/internal/lib/handlers"
	"github.com/fintech-app/backend/internal/lib/sl"
	"github.com/fintech-app/backend/internal/services"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

const (
	envLocal = "local"
	envDev   = "dev"
	envProd  = "prod"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("info: .env file not found, loading from environment variables")
	}

	cfg := config.MustLoad()

	appLog := setupLogger(cfg.Env)
	appLog.Info("starting Family Bank API", slog.String("env", cfg.Env), slog.String("addr", cfg.HTTPServer.Address))

	storage, err := postgres.New(cfg.StoragePath)
	if err != nil {
		appLog.Error("failed to init storage", sl.Err(err))
		os.Exit(1)
	}
	defer storage.Close()

	// Apply database migrations
	goose.SetBaseFS(backend.MigrationsFS)
	if err := goose.SetDialect("postgres"); err != nil {
		appLog.Error("failed to set goose dialect", sl.Err(err))
		os.Exit(1)
	}

	appLog.Info("applying database migrations...")
	if err := goose.Up(storage.DB, "migrations"); err != nil {
		appLog.Error("failed to run migrations", sl.Err(err))
		os.Exit(1)
	}
	appLog.Info("database migrations applied successfully")

	// Initialize Services & Real-time Event Broker
	eventBroker := services.NewEventBroker()
	antifraudSvc := services.NewAntifraudService(storage)
	transferSvc := services.NewTransferService(storage, antifraudSvc, eventBroker)

	// Build HTTP router
	appRouter := router.New(router.Config{
		Log:         appLog,
		Storage:     storage,
		AppConfig:   cfg,
		TransferSvc: transferSvc,
		EventBroker: eventBroker,
	})


	srv := &http.Server{
		Addr:        cfg.HTTPServer.Address,
		Handler:     appRouter,
		ReadTimeout: cfg.HTTPServer.Timeout,
		IdleTimeout: cfg.HTTPServer.IdleTimeout,
	}

	go func() {
		appLog.Info("HTTP server listening", slog.String("address", cfg.HTTPServer.Address))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			appLog.Error("server crashed", sl.Err(err))
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	sig := <-quit

	appLog.Info("shutdown signal received", slog.String("signal", sig.String()))

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		appLog.Error("failed to gracefully shutdown server", sl.Err(err))
	}

	appLog.Info("server stopped gracefully")
}

func setupLogger(env string) *slog.Logger {
	var handler slog.Handler

	switch env {
	case envLocal:
		handler = slogpretty.PrettyHandlerOptions{
			SlogOpts: &slog.HandlerOptions{Level: slog.LevelDebug},
		}.NewPrettyHandler(os.Stdout)
	case envDev:
		handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})
	case envProd:
		handler = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	default:
		handler = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	}

	return slog.New(handler)
}
