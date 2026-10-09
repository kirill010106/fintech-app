package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/render"
	resp "github.com/fintech-app/backend/internal/lib/api/response"
	j "github.com/fintech-app/backend/internal/lib/jwt"
)

type contextKey string

const (
	userIDKey   contextKey = "user_id"
	userEmailKey contextKey = "user_email"
	userRoleKey  contextKey = "user_role"
	userNameKey  contextKey = "user_name"
)

func Auth(secret string) func(next http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tokenStr := ""
			authHeader := r.Header.Get("Authorization")
			if authHeader != "" {
				parts := strings.Split(authHeader, " ")
				if len(parts) == 2 && parts[0] == "Bearer" {
					tokenStr = parts[1]
				}
			}
			if tokenStr == "" {
				tokenStr = r.URL.Query().Get("token")
			}
			if tokenStr == "" {
				render.Status(r, http.StatusUnauthorized)
				render.JSON(w, r, resp.Error("unauthorized: missing authorization token"))
				return
			}

			claims, err := j.ParseAccessToken(tokenStr, secret)
			if err != nil {
				render.Status(r, http.StatusUnauthorized)
				render.JSON(w, r, resp.Error("invalid or expired token"))
				return
			}


			ctx := context.WithValue(r.Context(), userIDKey, claims.UserID)
			ctx = context.WithValue(ctx, userEmailKey, claims.Email)
			ctx = context.WithValue(ctx, userRoleKey, claims.Role)
			ctx = context.WithValue(ctx, userNameKey, claims.Name)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func GetUserID(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(userIDKey).(int64)
	return id, ok
}

func GetUserRole(ctx context.Context) (string, bool) {
	role, ok := ctx.Value(userRoleKey).(string)
	return role, ok
}
