package domain

import (
	"errors"
	"fmt"
	"time"
)

// Role is the protection profile: how much supervision a person needs.
// It is derived from age and authority — never chosen by the user.
type Role string

const (
	RoleTeen     Role = "teen"
	RoleStandard Role = "standard"
	RoleSenior   Role = "senior"
)

// Authority is what a family member is allowed to do. It is assigned by the
// family owner and is a separate axis from the protection profile.
type Authority string

const (
	AuthorityOwner    Authority = "owner"
	AuthorityGuardian Authority = "guardian"
	AuthorityMember   Authority = "member"
)

// Membership status of a family member.
const (
	MembershipPending = "pending"
	MembershipActive  = "active"
)

// Age thresholds that map a birth date onto a protection profile.
const (
	TeenMaxAge   = 18
	SeniorMinAge = 65
)

// Age limits of a person who may hold an account here.
const (
	MinRegistrationAge = 14
	MaxHumanAge        = 120
)

// dateLayout is the wire format for a birth date.
const dateLayout = "2006-01-02"

// ParseBirthDate reads a birth date in the wire format and rejects values that
// cannot belong to a person allowed to hold an account. It is the single place
// where a self-declared or owner-corrected birth date is checked.
func ParseBirthDate(value string, now time.Time) (time.Time, error) {
	birthDate, err := time.Parse(dateLayout, value)
	if err != nil {
		return time.Time{}, errors.New("укажите дату рождения в формате ГГГГ-ММ-ДД")
	}

	if birthDate.After(now) {
		return time.Time{}, errors.New("дата рождения не может быть в будущем")
	}

	if age := Age(birthDate, now); age < MinRegistrationAge {
		return time.Time{}, fmt.Errorf("возраст не может быть меньше %d лет", MinRegistrationAge)
	} else if age > MaxHumanAge {
		return time.Time{}, errors.New("проверьте дату рождения")
	}

	return birthDate, nil
}

// Age returns the number of complete years between birthDate and now.
func Age(birthDate, now time.Time) int {
	years := now.Year() - birthDate.Year()
	// Step back a year while this year's birthday has not happened yet.
	if now.Month() < birthDate.Month() ||
		(now.Month() == birthDate.Month() && now.Day() < birthDate.Day()) {
		years--
	}
	return years
}

// ProtectionProfile derives the protection profile from a birth date and the
// member's authority. The owner is always unprotected: there is nobody left to
// approve the owner's operations, so supervision cannot work for them.
func ProtectionProfile(birthDate time.Time, authority Authority, now time.Time) Role {
	if authority == AuthorityOwner {
		return RoleStandard
	}

	switch age := Age(birthDate, now); {
	case age < TeenMaxAge:
		return RoleTeen
	case age >= SeniorMinAge:
		return RoleSenior
	default:
		return RoleStandard
	}
}

// RequiresSupervision reports whether this profile needs a guardian to approve
// limit-breaking operations.
func (r Role) RequiresSupervision() bool {
	return r == RoleTeen || r == RoleSenior
}

// CanSupervise reports whether this authority may approve operations and manage
// the rules of other family members.
func (a Authority) CanSupervise() bool {
	return a == AuthorityOwner || a == AuthorityGuardian
}

type User struct {
	ID          int64     `json:"id"`
	Email       string    `json:"email"`
	Name        string    `json:"name"`
	Phone       string    `json:"phone"`
	Role        Role      `json:"role"`
	BirthDate   time.Time `json:"birth_date"`
	PassHash    []byte    `json:"-"`
	Avatar      string    `json:"avatar"`
	SafetyScore int       `json:"safety_score"`
	CreatedAt   time.Time `json:"created_at"`
}

type Family struct {
	ID         int64     `json:"id"`
	Name       string    `json:"name"`
	OwnerID    int64     `json:"owner_id"`
	InviteCode string    `json:"invite_code"`
	CreatedAt  time.Time `json:"created_at"`
}

// FamilyMember is a person's membership in a family group: what they may do
// (Authority), what supervision they need (Role) and whether they are confirmed.
type FamilyMember struct {
	ID          int64      `json:"id"`
	FamilyID    int64      `json:"family_id"`
	UserID      int64      `json:"user_id"`
	Role        Role       `json:"role"`
	Authority   Authority  `json:"authority"`
	Status      string     `json:"status"`
	RequestedAt *time.Time `json:"requested_at,omitempty"`
	Nickname    string     `json:"nickname"`
	User        *User      `json:"user,omitempty"`
}

// JoinRequest is a pending request to join a family, as shown to the owner.
type JoinRequest struct {
	ID          int64      `json:"id"`
	User        User       `json:"user"`
	RequestedAt *time.Time `json:"requested_at,omitempty"`
}

type Account struct {
	ID            int64     `json:"id"`
	UserID        int64     `json:"user_id"`
	BankProvider  string    `json:"bank_provider"`
	AccountNumber string    `json:"account_number"`
	CardNumber    string    `json:"card_number"`
	CardType      string    `json:"card_type"`
	Balance       float64   `json:"balance"`
	Currency      string    `json:"currency"`
	CreatedAt     time.Time `json:"created_at"`
}

const (
	TxStatusCompleted       = "completed"
	TxStatusPendingApproval = "pending_approval"
	TxStatusRejected        = "rejected"
	TxStatusBlocked         = "blocked"
)

const (
	RiskLow      = "low"
	RiskMedium   = "medium"
	RiskHigh     = "high"
	RiskCritical = "critical"
)

type Transaction struct {
	ID             int64     `json:"id"`
	AccountID      int64     `json:"account_id"`
	UserID         int64     `json:"user_id"`
	Amount         float64   `json:"amount"`
	Currency       string    `json:"currency"`
	Category       string    `json:"category"`
	MCC            string    `json:"mcc"`
	Description    string    `json:"description"`
	RecipientPhone string    `json:"recipient_phone,omitempty"`
	RecipientName  string    `json:"recipient_name,omitempty"`
	Status         string    `json:"status"`
	RiskLevel      string    `json:"risk_level"`
	RiskReason     string    `json:"risk_reason,omitempty"`
	CreatedAt      time.Time `json:"created_at"`
}

type CoSignRequest struct {
	ID            int64      `json:"id"`
	TransactionID int64      `json:"transaction_id"`
	UserID        int64      `json:"user_id"`
	UserName      string     `json:"user_name"`
	UserRole      Role       `json:"user_role"`
	GuardianID    int64      `json:"guardian_id"`
	Amount        float64    `json:"amount"`
	Recipient     string     `json:"recipient"`
	RiskReason    string     `json:"risk_reason"`
	Status        string     `json:"status"` // pending, approved, rejected
	CreatedAt     time.Time  `json:"created_at"`
	DecidedAt     *time.Time `json:"decided_at,omitempty"`
}

type SafetyPolicy struct {
	ID                  int64     `json:"id"`
	UserID              int64     `json:"user_id"`
	MaxInstantTransfer  float64   `json:"max_instant_transfer"`
	FastFoodLimitMonth  float64   `json:"fast_food_limit_month"`
	GamingLimitMonth    float64   `json:"gaming_limit_month"`
	RequireCoSigning    bool      `json:"require_co_signing"`
	TrustedContactsOnly bool      `json:"trusted_contacts_only"`
	NightLockdown       bool      `json:"night_lockdown"`
	AntiDropperShield   bool      `json:"anti_dropper_shield"`
	ParentMatchPercent  int       `json:"parent_match_percent"`
	TrustedWhitelist    []string  `json:"trusted_whitelist"`
	UpdatedAt           time.Time `json:"updated_at"`
}

type Goal struct {
	ID              int64     `json:"id"`
	UserID          int64     `json:"user_id"`
	Title           string    `json:"title"`
	TargetAmount    float64   `json:"target_amount"`
	CurrentAmount   float64   `json:"current_amount"`
	BoostMultiplier float64   `json:"boost_multiplier"` // e.g. 0.5 (папа добавляет 50%)
	SponsorID       int64     `json:"sponsor_id"`
	Status          string    `json:"status"` // active, completed
	CreatedAt       time.Time `json:"created_at"`
}

type Quest struct {
	ID                int64    `json:"id"`
	Title             string   `json:"title"`
	Description       string   `json:"description"`
	Category          string   `json:"category"` // anti_drop, anti_phishing, budget
	RewardRub         float64  `json:"reward_rub"`
	SafetyScoreReward int      `json:"safety_score_reward"`
	Scenario          string   `json:"scenario"`
	Options           []string `json:"options"`
	CorrectOption     int      `json:"correct_option"`
	Explanation       string   `json:"explanation"`
	IsCompleted       bool     `json:"is_completed"`
}

type CategoryExpense struct {
	Category string  `json:"category"`
	MCC      string  `json:"mcc"`
	Total    float64 `json:"total"`
	Count    int     `json:"count"`
}

type MemberSpendingSummary struct {
	UserID        int64   `json:"user_id"`
	UserName      string  `json:"user_name"`
	MonthTotal    float64 `json:"month_total"`
	GamingSpend   float64 `json:"gaming_spend"`
	GamingLimit   float64 `json:"gaming_limit"`
	FastFoodSpend float64 `json:"fast_food_spend"`
	FastFoodLimit float64 `json:"fast_food_limit"`
}

type CreateGoalRequest struct {
	Title        string  `json:"title" validate:"required"`
	TargetAmount float64 `json:"target_amount" validate:"required,gt=0"`
}

