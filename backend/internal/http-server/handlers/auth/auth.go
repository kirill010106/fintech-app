package auth

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/render"
	"github.com/go-playground/validator/v10"
	"golang.org/x/crypto/bcrypt"

	"github.com/fintech-app/backend/internal/domain"
	mid "github.com/fintech-app/backend/internal/http-server/middleware"
	resp "github.com/fintech-app/backend/internal/lib/api/response"
	"github.com/fintech-app/backend/internal/lib/invitecode"
	j "github.com/fintech-app/backend/internal/lib/jwt"
	"github.com/fintech-app/backend/internal/lib/sl"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

const (
	defaultFamilyName  = "Моя семья"
	defaultSafetyScore = 70
	minPasswordLength  = 8
	inviteCodeAttempts = 5

	// minRegistrationAge is the youngest person who may hold an account here.
	minRegistrationAge = 14
	// maxRegistrationAge rejects obviously mistyped birth dates.
	maxRegistrationAge = 120
)

// dateLayout is the wire format for birth dates.
const dateLayout = "2006-01-02"

var validate = validator.New()

type RegisterRequest struct {
	Email      string `json:"email" validate:"required,email"`
	Password   string `json:"password" validate:"required"`
	Name       string `json:"name" validate:"required"`
	Phone      string `json:"phone" validate:"required"`
	BirthDate  string `json:"birth_date" validate:"required"`
	InviteCode string `json:"invite_code"`
	FamilyName string `json:"family_name"`
}

type LoginRequest struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required"`
}

type ProfileRequest struct {
	Name  string `json:"name" validate:"required"`
	Phone string `json:"phone" validate:"required"`
	// BirthDate is accepted as a field only so that attempts to set it can be
	// rejected explicitly: a person must not be able to choose how much
	// supervision they receive. The family owner corrects it instead.
	BirthDate *string `json:"birth_date"`
}

type PasswordRequest struct {
	CurrentPassword string `json:"current_password" validate:"required"`
	NewPassword     string `json:"new_password" validate:"required"`
}

// SessionFamily is the family context of the current session.
// The response field is null when the user belongs to no family group.
type SessionFamily struct {
	ID     int64  `json:"id"`
	Name   string `json:"name"`
	// InviteCode is only disclosed to the owner, who is the one who hands it out.
	InviteCode string `json:"invite_code,omitempty"`
	// Role is the protection profile currently in force for this person.
	Role domain.Role `json:"role"`
	// Authority is what this person may do in the family.
	Authority domain.Authority `json:"authority"`
	// MembershipStatus is "active" or "pending".
	MembershipStatus string `json:"membership_status"`
	IsOwner          bool   `json:"is_owner"`
}

// SessionResponse describes the authenticated user, its accounts and its family.
type SessionResponse struct {
	User     domain.User      `json:"user"`
	Accounts []domain.Account `json:"accounts"`
	Family   *SessionFamily   `json:"family"`
}

// AuthResponse is the session payload returned after registration or login.
type AuthResponse struct {
	User        domain.User      `json:"user"`
	Accounts    []domain.Account `json:"accounts"`
	AccessToken string           `json:"access_token"`
	Family      *SessionFamily   `json:"family"`
}

// Register creates a user, opens one starter account and either claims a place
// in an existing family (by invite code, subject to the owner's approval) or
// creates a brand new family owned by this user.
//
// The person does not pick a role: what they may do is decided by the family
// owner, and how much supervision they get follows from their birth date.
func Register(log *slog.Logger, storage *postgres.Storage, secret string, ttl time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.auth.Register"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		var req RegisterRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			log.Warn("cannot decode register request", sl.Err(err))
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат запроса"))
			return
		}

		if err := validate.Struct(req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.ValidationError(err.(validator.ValidationErrors)))
			return
		}

		if len(req.Password) < minPasswordLength {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("пароль должен содержать не менее 8 символов"))
			return
		}

		birthDate, err := parseBirthDate(req.BirthDate)
		if err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error(err.Error()))
			return
		}

		// The invite code is resolved before anything is written, so an unknown
		// code leaves no half-created user behind.
		var joined *domain.Family
		if req.InviteCode != "" {
			family, err := storage.FamilyByInviteCode(ctx, req.InviteCode)
			if err != nil {
				if errors.Is(err, postgres.ErrNotFound) {
					render.Status(r, http.StatusBadRequest)
					render.JSON(w, r, resp.Error("неверный код приглашения"))
					return
				}
				log.Error("failed to look up invite code", sl.Err(err))
				render.Status(r, http.StatusInternalServerError)
				render.JSON(w, r, resp.Error("внутренняя ошибка"))
				return
			}
			joined = &family
		}

		passHash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}

		// The founder of a family has nobody above them, so they are never
		// supervised. Someone asking to join is an unconfirmed member: their
		// real authority arrives with the owner's approval.
		authority := domain.AuthorityOwner
		if joined != nil {
			authority = domain.AuthorityMember
		}
		profile := domain.ProtectionProfile(birthDate, authority, time.Now())

		userID, err := storage.CreateUser(ctx, domain.User{
			Email:       req.Email,
			Name:        req.Name,
			Phone:       req.Phone,
			Role:        profile,
			BirthDate:   birthDate,
			PassHash:    passHash,
			Avatar:      "",
			SafetyScore: defaultSafetyScore,
		})
		if err != nil {
			if errors.Is(err, postgres.ErrEmailTaken) {
				render.Status(r, http.StatusBadRequest)
				render.JSON(w, r, resp.Error("пользователь с таким email уже существует"))
				return
			}
			log.Error("failed to create user", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}

		if _, err := attachFamily(ctx, storage, userID, profile, req.Name, req.FamilyName, joined); err != nil {
			log.Error("failed to attach family", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось создать семейную группу"))
			return
		}

		account, err := starterAccount(userID, profile)
		if err != nil {
			log.Error("failed to build starter account", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось открыть счёт"))
			return
		}
		if _, err := storage.CreateAccount(ctx, account); err != nil {
			log.Error("failed to create starter account", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось открыть счёт"))
			return
		}

		user, err := storage.UserByID(ctx, userID)
		if err != nil {
			log.Error("failed to reload created user", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}

		token, err := j.NewAccessToken(user, secret, ttl)
		if err != nil {
			log.Error("failed to create access token", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка генерации токена"))
			return
		}

		render.Status(r, http.StatusCreated)
		render.JSON(w, r, resp.OKWithData(AuthResponse{
			User:        user,
			Accounts:    accountsOf(ctx, storage, user.ID),
			AccessToken: token,
			Family:      familyOf(ctx, storage, user),
		}))
	}
}

// Login authenticates a user by email and password.
func Login(log *slog.Logger, storage *postgres.Storage, secret string, ttl time.Duration) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.auth.Login"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		var req LoginRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			log.Warn("cannot decode login request", sl.Err(err))
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат запроса"))
			return
		}

		if err := validate.Struct(req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.ValidationError(err.(validator.ValidationErrors)))
			return
		}

		user, err := storage.UserByEmail(r.Context(), req.Email)
		if err != nil {
			log.Info("user not found", slog.String("email", req.Email))
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("неверный логин или пароль"))
			return
		}

		if err := bcrypt.CompareHashAndPassword(user.PassHash, []byte(req.Password)); err != nil {
			log.Info("invalid password", slog.String("email", req.Email))
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("неверный логин или пароль"))
			return
		}

		token, err := j.NewAccessToken(user, secret, ttl)
		if err != nil {
			log.Error("failed to create access token", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("ошибка генерации токена"))
			return
		}

		render.JSON(w, r, resp.OKWithData(AuthResponse{
			User:        user,
			Accounts:    accountsOf(r.Context(), storage, user.ID),
			AccessToken: token,
			Family:      familyOf(r.Context(), storage, user),
		}))
	}
}

// Logout is stateless: the access token is simply discarded by the client.
func Logout(log *slog.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.auth.Logout"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		if userID, ok := mid.GetUserID(r.Context()); ok {
			log.Info("user logged out", slog.Int64("user_id", userID))
		}

		render.JSON(w, r, resp.OKWithData(map[string]string{
			"message": "выход выполнен",
		}))
	}
}

// Me returns the current session payload.
func Me(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.auth.Me"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))

		user, ok := currentUser(w, r, log, storage)
		if !ok {
			return
		}

		render.JSON(w, r, resp.OKWithData(session(r.Context(), storage, user)))
	}
}

// UpdateProfile persists the editable profile fields and returns the refreshed
// session payload. The birth date is deliberately not editable here: it decides
// how much supervision the person receives, so only the family owner may
// correct it, through the family management endpoint.
func UpdateProfile(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.auth.UpdateProfile"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		user, ok := currentUser(w, r, log, storage)
		if !ok {
			return
		}

		var req ProfileRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			log.Warn("cannot decode profile request", sl.Err(err))
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат запроса"))
			return
		}

		if err := validate.Struct(req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.ValidationError(err.(validator.ValidationErrors)))
			return
		}

		if req.BirthDate != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("дату рождения изменяет владелец семьи"))
			return
		}

		if err := storage.UpdateUserProfile(ctx, user.ID, req.Name, req.Phone, user.Avatar); err != nil {
			log.Error("failed to update profile", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось сохранить профиль"))
			return
		}

		updated, err := storage.UserByID(ctx, user.ID)
		if err != nil {
			log.Error("failed to reload user", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}

		render.JSON(w, r, resp.OKWithData(session(ctx, storage, updated)))
	}
}

// ChangePassword rotates the bcrypt hash of the current user.
func ChangePassword(log *slog.Logger, storage *postgres.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		const op = "handlers.auth.ChangePassword"
		log := log.With(slog.String("op", op), slog.String("req_id", middleware.GetReqID(r.Context())))
		ctx := r.Context()

		user, ok := currentUser(w, r, log, storage)
		if !ok {
			return
		}

		var req PasswordRequest
		if err := render.DecodeJSON(r.Body, &req); err != nil {
			log.Warn("cannot decode password request", sl.Err(err))
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("неверный формат запроса"))
			return
		}

		if err := validate.Struct(req); err != nil {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.ValidationError(err.(validator.ValidationErrors)))
			return
		}

		if err := bcrypt.CompareHashAndPassword(user.PassHash, []byte(req.CurrentPassword)); err != nil {
			log.Info("invalid current password", slog.Int64("user_id", user.ID))
			render.Status(r, http.StatusUnauthorized)
			render.JSON(w, r, resp.Error("неверный текущий пароль"))
			return
		}

		if len(req.NewPassword) < minPasswordLength {
			render.Status(r, http.StatusBadRequest)
			render.JSON(w, r, resp.Error("пароль должен содержать минимум 8 символов"))
			return
		}

		passHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			log.Error("failed to hash password", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("внутренняя ошибка"))
			return
		}

		if err := storage.UpdateUserPassword(ctx, user.ID, passHash); err != nil {
			log.Error("failed to update password", sl.Err(err))
			render.Status(r, http.StatusInternalServerError)
			render.JSON(w, r, resp.Error("не удалось изменить пароль"))
			return
		}

		render.JSON(w, r, resp.OKWithData(map[string]string{
			"message": "пароль изменён",
		}))
	}
}

// currentUser resolves the authenticated user from the request context.
// On failure it writes the error response and reports ok = false.
func currentUser(w http.ResponseWriter, r *http.Request, log *slog.Logger, storage *postgres.Storage) (domain.User, bool) {
	userID, ok := mid.GetUserID(r.Context())
	if !ok {
		render.Status(r, http.StatusUnauthorized)
		render.JSON(w, r, resp.Error("не авторизован"))
		return domain.User{}, false
	}

	user, err := storage.UserByID(r.Context(), userID)
	if err != nil {
		if errors.Is(err, postgres.ErrNotFound) {
			render.Status(r, http.StatusNotFound)
			render.JSON(w, r, resp.Error("пользователь не найден"))
			return domain.User{}, false
		}
		log.Error("failed to load user", sl.Err(err))
		render.Status(r, http.StatusInternalServerError)
		render.JSON(w, r, resp.Error("внутренняя ошибка"))
		return domain.User{}, false
	}

	return user, true
}

// session builds the shared session payload (user + accounts + family).
func session(ctx context.Context, storage *postgres.Storage, user domain.User) SessionResponse {
	return SessionResponse{
		User:     user,
		Accounts: accountsOf(ctx, storage, user.ID),
		Family:   familyOf(ctx, storage, user),
	}
}

// accountsOf never returns nil so the JSON field stays an array.
func accountsOf(ctx context.Context, storage *postgres.Storage, userID int64) []domain.Account {
	accounts, err := storage.GetAccountsByUserID(ctx, userID)
	if err != nil || accounts == nil {
		return []domain.Account{}
	}
	return accounts
}

// familyOf returns the family context of the user, or nil when it belongs to no
// family group. The membership is read from the database on every call instead
// of from the token, so an owner's decision takes effect immediately rather than
// waiting for the token to expire.
func familyOf(ctx context.Context, storage *postgres.Storage, user domain.User) *SessionFamily {
	family, members, err := storage.GetFamilyByUserID(ctx, user.ID)
	if err != nil {
		return nil
	}

	sf := &SessionFamily{
		ID:               family.ID,
		Name:             family.Name,
		Role:             user.Role,
		Authority:        domain.AuthorityMember,
		MembershipStatus: domain.MembershipActive,
		IsOwner:          family.OwnerID == user.ID,
	}

	for _, m := range members {
		if m.UserID != user.ID {
			continue
		}
		if m.Role != "" {
			sf.Role = m.Role
		}
		if m.Authority != "" {
			sf.Authority = m.Authority
		}
		if m.Status != "" {
			sf.MembershipStatus = m.Status
		}
		break
	}

	// The owner is the one who hands out invitations.
	if sf.IsOwner {
		sf.InviteCode = family.InviteCode
	}

	return sf
}

// attachFamily either records a pending request to join the family resolved from
// the invite code, or creates a brand new family group owned by the user when no
// code was supplied.
func attachFamily(
	ctx context.Context,
	storage *postgres.Storage,
	userID int64,
	profile domain.Role,
	nickname, familyName string,
	joined *domain.Family,
) (domain.Family, error) {
	const op = "handlers.auth.attachFamily"

	if joined != nil {
		// Joining is a request, not a fact: the owner confirms it. Until then
		// the membership is pending and grants no access to the family.
		if err := storage.AddPendingMember(ctx, joined.ID, userID, nickname); err != nil {
			return domain.Family{}, fmt.Errorf("%s: add member: %w", op, err)
		}
		return *joined, nil
	}

	name := familyName
	if name == "" {
		name = defaultFamilyName
	}

	for attempt := 0; attempt < inviteCodeAttempts; attempt++ {
		code, err := invitecode.Generate()
		if err != nil {
			return domain.Family{}, fmt.Errorf("%s: generate invite code: %w", op, err)
		}

		familyID, err := storage.CreateFamily(ctx, name, userID, code)
		if err != nil {
			if postgres.IsUniqueViolation(err) {
				continue // invite code collision, retry with a fresh one
			}
			return domain.Family{}, fmt.Errorf("%s: create family: %w", op, err)
		}

		// The founder is the owner: active from the start, never supervised.
		if err := storage.AddFamilyMember(ctx, familyID, userID, profile, nickname); err != nil {
			return domain.Family{}, fmt.Errorf("%s: add owner: %w", op, err)
		}

		return domain.Family{ID: familyID, Name: name, OwnerID: userID, InviteCode: code}, nil
	}

	return domain.Family{}, fmt.Errorf("%s: no unique invite code after %d attempts", op, inviteCodeAttempts)
}

// parseBirthDate reads a birth date supplied at registration, delegating the
// validation rules to the domain so registration and owner corrections agree.
func parseBirthDate(value string) (time.Time, error) {
	birthDate, err := domain.ParseBirthDate(value, time.Now())
	if err != nil {
		return time.Time{}, err
	}
	if domain.Age(birthDate, time.Now()) < minRegistrationAge {
		return time.Time{}, fmt.Errorf("регистрация доступна с %d лет", minRegistrationAge)
	}
	return birthDate, nil
}

// starterAccount builds the opening VTB account of a freshly registered user.
func starterAccount(userID int64, role domain.Role) (domain.Account, error) {
	accountNumber, err := randomDigits(20)
	if err != nil {
		return domain.Account{}, err
	}

	cardSuffix, err := randomDigits(4)
	if err != nil {
		return domain.Account{}, err
	}

	return domain.Account{
		UserID:        userID,
		BankProvider:  "familybank",
		AccountNumber: accountNumber,
		CardNumber:    "*" + cardSuffix,
		CardType:      cardTypeForRole(role),
		Balance:       0,
		Currency:      "RUB",
	}, nil
}

func cardTypeForRole(role domain.Role) string {
	switch role {
	case domain.RoleTeen:
		return "Юниор Digital"
	case domain.RoleSenior:
		return "Пенсионная карта"
	default:
		return "Мультикарта"
	}
}

// randomDigits returns n cryptographically random decimal digits.
func randomDigits(n int) (string, error) {
	const digits = "0123456789"

	max := big.NewInt(int64(len(digits)))
	out := make([]byte, n)
	for i := range out {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			return "", fmt.Errorf("cannot generate random digits: %w", err)
		}
		out[i] = digits[idx.Int64()]
	}
	return string(out), nil
}
