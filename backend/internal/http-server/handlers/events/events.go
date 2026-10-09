package events

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	mid "github.com/fintech-app/backend/internal/http-server/middleware"
	"github.com/fintech-app/backend/internal/services"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

func Stream(log *slog.Logger, storage *postgres.Storage, broker *services.EventBroker) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := mid.GetUserID(r.Context())
		if !ok {
			http.Error(w, "не авторизован", http.StatusUnauthorized)
			return
		}

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "стриминг не поддерживается", http.StatusInternalServerError)
			return
		}

		// Find family ID
		var familyID int64
		family, _, err := storage.GetFamilyByUserID(r.Context(), userID)
		if err == nil {
			familyID = family.ID
		}

		// Set SSE headers
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.Header().Set("Access-Control-Allow-Origin", "*")

		client := broker.Subscribe(userID, familyID)
		defer broker.Unsubscribe(client)

		log.Info("SSE client connected", slog.Int64("user_id", userID), slog.Int64("family_id", familyID))

		// Send initial connected handshake
		fmt.Fprintf(w, "event: connected\ndata: {\"status\":\"connected\",\"user_id\":%d}\n\n", userID)
		flusher.Flush()

		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				log.Info("SSE client disconnected", slog.Int64("user_id", userID))
				return

			case <-ticker.C:
				// Keepalive heartbeat
				fmt.Fprintf(w, ": heartbeat\n\n")
				flusher.Flush()

			case ev, ok := <-client.SendChan:
				if !ok {
					return
				}
				envelope := map[string]any{
					"type":       ev.Type,
					"user_id":    ev.UserID,
					"family_id":  ev.FamilyID,
					"payload":    ev.Payload,
					"created_at": ev.CreatedAt,
				}
				dataBytes, err := json.Marshal(envelope)
				if err != nil {
					continue
				}
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Type, string(dataBytes))
				flusher.Flush()
			}
		}
	}
}
