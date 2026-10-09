package postgres

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/fintech-app/backend/internal/domain"
)

var (
	ErrNotFound         = errors.New("entity not found")
	ErrEmailTaken       = errors.New("email already taken")
	ErrAlreadyCompleted = errors.New("quest already completed")
)

// IsUniqueViolation reports whether err is a PostgreSQL unique constraint
// violation (SQLSTATE 23505).
func IsUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "23505"
	}
	return false
}

type Storage struct {
	DB *sql.DB
}

func New(storagePath string) (*Storage, error) {
	const op = "storage.postgres.New"

	db, err := sql.Open("pgx", storagePath)
	if err != nil {
		return nil, fmt.Errorf("%s: open db: %w", op, err)
	}

	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxIdleTime(5 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("%s: ping db: %w", op, err)
	}

	return &Storage{DB: db}, nil
}

func (s *Storage) Close() error {
	if s.DB != nil {
		return s.DB.Close()
	}
	return nil
}

// UserByEmail
func (s *Storage) UserByEmail(ctx context.Context, email string) (domain.User, error) {
	const op = "storage.postgres.UserByEmail"

	row := s.DB.QueryRowContext(ctx, `
		SELECT id, email, name, phone, role, birth_date, pass_hash, avatar, safety_score, created_at
		FROM users
		WHERE email = $1
	`, email)

	var u domain.User
	var passHash string
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Phone, &u.Role, &u.BirthDate, &passHash, &u.Avatar, &u.SafetyScore, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.User{}, ErrNotFound
		}
		return domain.User{}, fmt.Errorf("%s: %w", op, err)
	}
	u.PassHash = []byte(passHash)
	return u, nil
}

// UserByID
func (s *Storage) UserByID(ctx context.Context, id int64) (domain.User, error) {
	const op = "storage.postgres.UserByID"

	row := s.DB.QueryRowContext(ctx, `
		SELECT id, email, name, phone, role, birth_date, pass_hash, avatar, safety_score, created_at
		FROM users
		WHERE id = $1
	`, id)

	var u domain.User
	var passHash string
	if err := row.Scan(&u.ID, &u.Email, &u.Name, &u.Phone, &u.Role, &u.BirthDate, &passHash, &u.Avatar, &u.SafetyScore, &u.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.User{}, ErrNotFound
		}
		return domain.User{}, fmt.Errorf("%s: %w", op, err)
	}
	u.PassHash = []byte(passHash)
	return u, nil
}

// CreateUser inserts a new user and returns its id.
// Returns ErrEmailTaken when the email is already registered.
func (s *Storage) CreateUser(ctx context.Context, u domain.User) (int64, error) {
	const op = "storage.postgres.CreateUser"

	var id int64
	err := s.DB.QueryRowContext(ctx, `
		INSERT INTO users (email, name, phone, role, birth_date, pass_hash, avatar, safety_score)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`, u.Email, u.Name, u.Phone, u.Role, u.BirthDate, string(u.PassHash), u.Avatar, u.SafetyScore).Scan(&id)
	if err != nil {
		if IsUniqueViolation(err) {
			return 0, ErrEmailTaken
		}
		return 0, fmt.Errorf("%s: %w", op, err)
	}
	return id, nil
}

// UpdateUserProfile updates the mutable profile fields of a user.
func (s *Storage) UpdateUserProfile(ctx context.Context, id int64, name, phone, avatar string) error {
	const op = "storage.postgres.UpdateUserProfile"

	res, err := s.DB.ExecContext(ctx, `
		UPDATE users
		SET name = $1, phone = $2, avatar = $3
		WHERE id = $4
	`, name, phone, avatar, id)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateUserPassword replaces the stored bcrypt hash of a user.
func (s *Storage) UpdateUserPassword(ctx context.Context, id int64, passHash []byte) error {
	const op = "storage.postgres.UpdateUserPassword"

	res, err := s.DB.ExecContext(ctx, `
		UPDATE users
		SET pass_hash = $1
		WHERE id = $2
	`, string(passHash), id)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

// GetFamilyByUserID
func (s *Storage) GetFamilyByUserID(ctx context.Context, userID int64) (domain.Family, []domain.FamilyMember, error) {
	const op = "storage.postgres.GetFamilyByUserID"

	var fam domain.Family
	err := s.DB.QueryRowContext(ctx, `
		SELECT f.id, f.name, f.owner_id, f.invite_code, f.created_at
		FROM family_groups f
		JOIN family_members fm ON fm.family_id = f.id
		WHERE fm.user_id = $1
		LIMIT 1
	`, userID).Scan(&fam.ID, &fam.Name, &fam.OwnerID, &fam.InviteCode, &fam.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Family{}, nil, ErrNotFound
		}
		return domain.Family{}, nil, fmt.Errorf("%s: %w", op, err)
	}

	members, err := s.members(ctx, `
		WHERE fm.family_id = $1
		ORDER BY fm.id ASC
	`, fam.ID)
	if err != nil {
		return fam, nil, fmt.Errorf("%s: members: %w", op, err)
	}

	return fam, members, nil
}

// memberColumns is the shared projection for family membership queries. It
// carries both axes (authority, protection profile) plus the confirmation
// status, so callers never have to re-derive them.
const memberColumns = `
	SELECT fm.id, fm.family_id, fm.user_id, fm.role, fm.authority, fm.status, fm.requested_at, fm.nickname,
	       u.id, u.email, u.name, u.phone, u.role, u.birth_date, u.avatar, u.safety_score, u.created_at
	FROM family_members fm
	JOIN users u ON u.id = fm.user_id
`

// members runs a membership query built on memberColumns and scans the rows.
func (s *Storage) members(ctx context.Context, suffix string, args ...any) ([]domain.FamilyMember, error) {
	rows, err := s.DB.QueryContext(ctx, memberColumns+suffix, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []domain.FamilyMember
	for rows.Next() {
		var m domain.FamilyMember
		var u domain.User
		if err := rows.Scan(
			&m.ID, &m.FamilyID, &m.UserID, &m.Role, &m.Authority, &m.Status, &m.RequestedAt, &m.Nickname,
			&u.ID, &u.Email, &u.Name, &u.Phone, &u.Role, &u.BirthDate, &u.Avatar, &u.SafetyScore, &u.CreatedAt,
		); err != nil {
			return nil, err
		}
		m.User = &u
		members = append(members, m)
	}
	return members, rows.Err()
}

// MembershipOf returns a single user's membership in a family group.
func (s *Storage) MembershipOf(ctx context.Context, familyID, userID int64) (domain.FamilyMember, error) {
	const op = "storage.postgres.MembershipOf"

	members, err := s.members(ctx, `WHERE fm.family_id = $1 AND fm.user_id = $2`, familyID, userID)
	if err != nil {
		return domain.FamilyMember{}, fmt.Errorf("%s: %w", op, err)
	}
	if len(members) == 0 {
		return domain.FamilyMember{}, ErrNotFound
	}
	return members[0], nil
}

// MembershipByUserID returns the user's membership in whatever family they
// belong to, regardless of status.
func (s *Storage) MembershipByUserID(ctx context.Context, userID int64) (domain.FamilyMember, domain.Family, error) {
	const op = "storage.postgres.MembershipByUserID"

	fam, _, err := s.GetFamilyByUserID(ctx, userID)
	if err != nil {
		return domain.FamilyMember{}, domain.Family{}, err
	}
	m, err := s.MembershipOf(ctx, fam.ID, userID)
	if err != nil {
		return domain.FamilyMember{}, domain.Family{}, fmt.Errorf("%s: %w", op, err)
	}
	return m, fam, nil
}

// ActiveMembers returns confirmed members of a family group.
func (s *Storage) ActiveMembers(ctx context.Context, familyID int64) ([]domain.FamilyMember, error) {
	const op = "storage.postgres.ActiveMembers"

	members, err := s.members(ctx, `
		WHERE fm.family_id = $1 AND fm.status = 'active'
		ORDER BY fm.id ASC
	`, familyID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	return members, nil
}

// PendingJoinRequests returns the join requests of a family group awaiting the
// owner's decision, oldest first.
func (s *Storage) PendingJoinRequests(ctx context.Context, familyID int64) ([]domain.JoinRequest, error) {
	const op = "storage.postgres.PendingJoinRequests"

	members, err := s.members(ctx, `
		WHERE fm.family_id = $1 AND fm.status = 'pending'
		ORDER BY fm.requested_at ASC NULLS FIRST, fm.id ASC
	`, familyID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}

	requests := make([]domain.JoinRequest, 0, len(members))
	for _, m := range members {
		var u domain.User
		if m.User != nil {
			u = *m.User
		}
		requests = append(requests, domain.JoinRequest{
			ID:          m.ID,
			User:        u,
			RequestedAt: m.RequestedAt,
		})
	}
	return requests, nil
}

// AddPendingMember records a request to join a family group. The membership
// stays inactive until the owner confirms it.
func (s *Storage) AddPendingMember(ctx context.Context, familyID, userID int64, nickname string) error {
	const op = "storage.postgres.AddPendingMember"

	_, err := s.DB.ExecContext(ctx, `
		INSERT INTO family_members (family_id, user_id, role, authority, status, requested_at, nickname)
		VALUES ($1, $2, $3, $4, $5, NOW(), $6)
		ON CONFLICT (family_id, user_id) DO UPDATE
		SET status = 'pending', requested_at = NOW()
		WHERE family_members.status <> 'active'
	`, familyID, userID, domain.RoleStandard, domain.AuthorityMember, domain.MembershipPending, nickname)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// ConfirmMember activates a pending membership, sets the authority and
// protection profile decided by the owner and refreshes the nickname.
func (s *Storage) ConfirmMember(ctx context.Context, familyID, userID int64, authority domain.Authority, role domain.Role, nickname string) error {
	const op = "storage.postgres.ConfirmMember"

	res, err := s.DB.ExecContext(ctx, `
		UPDATE family_members
		SET status = 'active', authority = $3, role = $4, nickname = $5, requested_at = NULL
		WHERE family_id = $1 AND user_id = $2 AND status = 'pending'
	`, familyID, userID, authority, role, nickname)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateMemberAuthority changes what a member may do. Authority is the owner's
// decision alone; the protection profile follows from it plus the birth date.
func (s *Storage) UpdateMemberAuthority(ctx context.Context, familyID, userID int64, authority domain.Authority) error {
	const op = "storage.postgres.UpdateMemberAuthority"

	res, err := s.DB.ExecContext(ctx, `
		UPDATE family_members
		SET authority = $3
		WHERE family_id = $1 AND user_id = $2 AND status = 'active'
	`, familyID, userID, authority)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateMemberProfile stores the protection profile derived on the server.
func (s *Storage) UpdateMemberProfile(ctx context.Context, familyID, userID int64, role domain.Role) error {
	const op = "storage.postgres.UpdateMemberProfile"

	res, err := s.DB.ExecContext(ctx, `
		UPDATE family_members
		SET role = $3
		WHERE family_id = $1 AND user_id = $2
	`, familyID, userID, role)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateUserRole keeps the denormalised protection profile on users in sync.
func (s *Storage) UpdateUserRole(ctx context.Context, userID int64, role domain.Role) error {
	const op = "storage.postgres.UpdateUserRole"

	_, err := s.DB.ExecContext(ctx, `UPDATE users SET role = $1 WHERE id = $2`, role, userID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// UpdateUserBirthDate corrects a user's birth date. Only a family owner may do
// this, and only for someone they supervise.
func (s *Storage) UpdateUserBirthDate(ctx context.Context, userID int64, birthDate time.Time) error {
	const op = "storage.postgres.UpdateUserBirthDate"

	res, err := s.DB.ExecContext(ctx, `UPDATE users SET birth_date = $1 WHERE id = $2`, birthDate, userID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

// RemoveMember deletes a membership. Pending requests are rejected by removing
// them the same way.
func (s *Storage) RemoveMember(ctx context.Context, familyID, userID int64) error {
	const op = "storage.postgres.RemoveMember"

	res, err := s.DB.ExecContext(ctx, `
		DELETE FROM family_members WHERE family_id = $1 AND user_id = $2
	`, familyID, userID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateFamily creates a new family group owned by ownerID.
// Returns a unique-constraint error when inviteCode is already in use.
func (s *Storage) CreateFamily(ctx context.Context, name string, ownerID int64, inviteCode string) (int64, error) {
	const op = "storage.postgres.CreateFamily"

	var id int64
	err := s.DB.QueryRowContext(ctx, `
		INSERT INTO family_groups (name, owner_id, invite_code)
		VALUES ($1, $2, $3)
		RETURNING id
	`, name, ownerID, inviteCode).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", op, err)
	}
	return id, nil
}

// AddFamilyMember links a user to a family group as a confirmed owner. It is
// only used when somebody founds a family: everybody else goes through a
// pending request that the owner confirms.
func (s *Storage) AddFamilyMember(ctx context.Context, familyID, userID int64, role domain.Role, nickname string) error {
	const op = "storage.postgres.AddFamilyMember"

	_, err := s.DB.ExecContext(ctx, `
		INSERT INTO family_members (family_id, user_id, role, authority, status, nickname)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (family_id, user_id) DO NOTHING
	`, familyID, userID, role, domain.AuthorityOwner, domain.MembershipActive, nickname)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// FamilyByInviteCode looks up a family group by its invite code.
func (s *Storage) FamilyByInviteCode(ctx context.Context, code string) (domain.Family, error) {
	const op = "storage.postgres.FamilyByInviteCode"

	row := s.DB.QueryRowContext(ctx, `
		SELECT id, name, owner_id, invite_code, created_at
		FROM family_groups
		WHERE invite_code = $1
	`, code)

	var f domain.Family
	if err := row.Scan(&f.ID, &f.Name, &f.OwnerID, &f.InviteCode, &f.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Family{}, ErrNotFound
		}
		return domain.Family{}, fmt.Errorf("%s: %w", op, err)
	}
	return f, nil
}

// RegenerateInviteCode replaces the invite code of a family group.
func (s *Storage) RegenerateInviteCode(ctx context.Context, familyID int64, code string) error {
	const op = "storage.postgres.RegenerateInviteCode"

	res, err := s.DB.ExecContext(ctx, `
		UPDATE family_groups
		SET invite_code = $1
		WHERE id = $2
	`, code, familyID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return ErrNotFound
	}
	return nil
}

// FamilyMembersCount returns the number of members of a family group.
func (s *Storage) FamilyMembersCount(ctx context.Context, familyID int64) (int, error) {
	const op = "storage.postgres.FamilyMembersCount"

	var count int
	err := s.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM family_members WHERE family_id = $1
	`, familyID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", op, err)
	}
	return count, nil
}

// DeleteFamily removes a family group; its memberships cascade.
func (s *Storage) DeleteFamily(ctx context.Context, familyID int64) error {
	const op = "storage.postgres.DeleteFamily"

	_, err := s.DB.ExecContext(ctx, `DELETE FROM family_groups WHERE id = $1`, familyID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// LeaveOtherFamilies removes the membership of a user in every family but keepFamilyID.
func (s *Storage) LeaveOtherFamilies(ctx context.Context, userID, keepFamilyID int64) error {
	const op = "storage.postgres.LeaveOtherFamilies"

	_, err := s.DB.ExecContext(ctx, `
		DELETE FROM family_members
		WHERE user_id = $1 AND family_id <> $2
	`, userID, keepFamilyID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// GetAccountsByUserID
func (s *Storage) GetAccountsByUserID(ctx context.Context, userID int64) ([]domain.Account, error) {
	const op = "storage.postgres.GetAccountsByUserID"

	rows, err := s.DB.QueryContext(ctx, `
		SELECT id, user_id, bank_provider, account_number, card_number, card_type, balance, currency, created_at
		FROM accounts
		WHERE user_id = $1
		ORDER BY id ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	defer rows.Close()

	var accounts []domain.Account
	for rows.Next() {
		var a domain.Account
		if err := rows.Scan(&a.ID, &a.UserID, &a.BankProvider, &a.AccountNumber, &a.CardNumber, &a.CardType, &a.Balance, &a.Currency, &a.CreatedAt); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", op, err)
		}
		accounts = append(accounts, a)
	}
	return accounts, nil
}

// CreateAccount inserts a new bank account and returns its id.
func (s *Storage) CreateAccount(ctx context.Context, a domain.Account) (int64, error) {
	const op = "storage.postgres.CreateAccount"

	var id int64
	err := s.DB.QueryRowContext(ctx, `
		INSERT INTO accounts (user_id, bank_provider, account_number, card_number, card_type, balance, currency)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`, a.UserID, a.BankProvider, a.AccountNumber, a.CardNumber, a.CardType, a.Balance, a.Currency).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", op, err)
	}
	return id, nil
}

// GetAccountByID
func (s *Storage) GetAccountByID(ctx context.Context, accountID int64) (domain.Account, error) {
	const op = "storage.postgres.GetAccountByID"

	row := s.DB.QueryRowContext(ctx, `
		SELECT id, user_id, bank_provider, account_number, card_number, card_type, balance, currency, created_at
		FROM accounts
		WHERE id = $1
	`, accountID)

	var a domain.Account
	if err := row.Scan(&a.ID, &a.UserID, &a.BankProvider, &a.AccountNumber, &a.CardNumber, &a.CardType, &a.Balance, &a.Currency, &a.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Account{}, ErrNotFound
		}
		return domain.Account{}, fmt.Errorf("%s: %w", op, err)
	}
	return a, nil
}

// UpdateAccountBalance
func (s *Storage) UpdateAccountBalance(ctx context.Context, accountID int64, newBalance float64) error {
	const op = "storage.postgres.UpdateAccountBalance"

	_, err := s.DB.ExecContext(ctx, `UPDATE accounts SET balance = $1 WHERE id = $2`, newBalance, accountID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// GetTransactionsByUserID
func (s *Storage) GetTransactionsByUserID(ctx context.Context, userID int64, limit int) ([]domain.Transaction, error) {
	const op = "storage.postgres.GetTransactionsByUserID"

	if limit <= 0 {
		limit = 50
	}

	rows, err := s.DB.QueryContext(ctx, `
		SELECT id, account_id, user_id, amount, currency, category, mcc, description, recipient_phone, recipient_name, status, risk_level, risk_reason, created_at
		FROM transactions
		WHERE user_id = $1
		ORDER BY created_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	defer rows.Close()

	list := make([]domain.Transaction, 0)
	for rows.Next() {
		var t domain.Transaction
		if err := rows.Scan(
			&t.ID, &t.AccountID, &t.UserID, &t.Amount, &t.Currency, &t.Category, &t.MCC,
			&t.Description, &t.RecipientPhone, &t.RecipientName, &t.Status, &t.RiskLevel, &t.RiskReason, &t.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", op, err)
		}
		list = append(list, t)
	}
	return list, nil
}

// GetTransactionsByFamily
func (s *Storage) GetTransactionsByFamily(ctx context.Context, familyID int64, limit int) ([]domain.Transaction, error) {
	const op = "storage.postgres.GetTransactionsByFamily"

	if limit <= 0 {
		limit = 50
	}

	rows, err := s.DB.QueryContext(ctx, `
		SELECT t.id, t.account_id, t.user_id, t.amount, t.currency, t.category, t.mcc, t.description, t.recipient_phone, t.recipient_name, t.status, t.risk_level, t.risk_reason, t.created_at
		FROM transactions t
		JOIN family_members fm ON fm.user_id = t.user_id
		WHERE fm.family_id = $1
		ORDER BY t.created_at DESC
		LIMIT $2
	`, familyID, limit)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	defer rows.Close()

	list := make([]domain.Transaction, 0)
	for rows.Next() {
		var t domain.Transaction
		if err := rows.Scan(
			&t.ID, &t.AccountID, &t.UserID, &t.Amount, &t.Currency, &t.Category, &t.MCC,
			&t.Description, &t.RecipientPhone, &t.RecipientName, &t.Status, &t.RiskLevel, &t.RiskReason, &t.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", op, err)
		}
		list = append(list, t)
	}
	return list, nil
}

// CreateTransaction
func (s *Storage) CreateTransaction(ctx context.Context, tx domain.Transaction) (int64, error) {
	const op = "storage.postgres.CreateTransaction"

	var id int64
	err := s.DB.QueryRowContext(ctx, `
		INSERT INTO transactions (account_id, user_id, amount, currency, category, mcc, description, recipient_phone, recipient_name, status, risk_level, risk_reason, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
		RETURNING id
	`, tx.AccountID, tx.UserID, tx.Amount, tx.Currency, tx.Category, tx.MCC, tx.Description, tx.RecipientPhone, tx.RecipientName, tx.Status, tx.RiskLevel, tx.RiskReason).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", op, err)
	}
	return id, nil
}

// UpdateTransactionStatus
func (s *Storage) UpdateTransactionStatus(ctx context.Context, txID int64, status, riskLevel, riskReason string) error {
	const op = "storage.postgres.UpdateTransactionStatus"

	_, err := s.DB.ExecContext(ctx, `
		UPDATE transactions
		SET status = $1, risk_level = $2, risk_reason = $3
		WHERE id = $4
	`, status, riskLevel, riskReason, txID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// GetSafetyPolicy
func (s *Storage) GetSafetyPolicy(ctx context.Context, userID int64) (domain.SafetyPolicy, error) {
	const op = "storage.postgres.GetSafetyPolicy"

	row := s.DB.QueryRowContext(ctx, `
		SELECT id, user_id, max_instant_transfer, fast_food_limit_month, gaming_limit_month, 
		       require_co_signing, trusted_contacts_only, 
		       COALESCE(night_lockdown, true), COALESCE(anti_dropper_shield, true),
		       COALESCE(parent_match_percent, 50), COALESCE(trusted_whitelist::text, '[]'),
		       updated_at
		FROM safety_policies
		WHERE user_id = $1
	`, userID)

	var p domain.SafetyPolicy
	var whitelistJSON string
	if err := row.Scan(
		&p.ID, &p.UserID, &p.MaxInstantTransfer, &p.FastFoodLimitMonth, &p.GamingLimitMonth,
		&p.RequireCoSigning, &p.TrustedContactsOnly,
		&p.NightLockdown, &p.AntiDropperShield,
		&p.ParentMatchPercent, &whitelistJSON,
		&p.UpdatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// default policy: a new user starts with no trusted recipients
			return domain.SafetyPolicy{
				UserID:              userID,
				MaxInstantTransfer:  1000.0,
				FastFoodLimitMonth:  3000.0,
				GamingLimitMonth:    1500.0,
				RequireCoSigning:    true,
				TrustedContactsOnly: false,
				NightLockdown:       true,
				AntiDropperShield:   true,
				ParentMatchPercent:  50,
				// A new user starts with no trusted recipients.
				TrustedWhitelist: []string{},
			}, nil
		}
		return domain.SafetyPolicy{}, fmt.Errorf("%s: %w", op, err)
	}
	if whitelistJSON != "" {
		_ = json.Unmarshal([]byte(whitelistJSON), &p.TrustedWhitelist)
	}
	if p.TrustedWhitelist == nil {
		// A new user starts with no trusted recipients.
		p.TrustedWhitelist = []string{}
	}
	return p, nil
}

// UpdateSafetyPolicy
func (s *Storage) UpdateSafetyPolicy(ctx context.Context, p domain.SafetyPolicy) error {
	const op = "storage.postgres.UpdateSafetyPolicy"

	if p.TrustedWhitelist == nil {
		p.TrustedWhitelist = []string{}
	}
	whitelistBytes, err := json.Marshal(p.TrustedWhitelist)
	if err != nil {
		whitelistBytes = []byte("[]")
	}

	_, err = s.DB.ExecContext(ctx, `
		INSERT INTO safety_policies (
			user_id, max_instant_transfer, fast_food_limit_month, gaming_limit_month, 
			require_co_signing, trusted_contacts_only, 
			night_lockdown, anti_dropper_shield, parent_match_percent, trusted_whitelist, 
			updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW())
		ON CONFLICT (user_id) DO UPDATE SET
			max_instant_transfer = EXCLUDED.max_instant_transfer,
			fast_food_limit_month = EXCLUDED.fast_food_limit_month,
			gaming_limit_month = EXCLUDED.gaming_limit_month,
			require_co_signing = EXCLUDED.require_co_signing,
			trusted_contacts_only = EXCLUDED.trusted_contacts_only,
			night_lockdown = EXCLUDED.night_lockdown,
			anti_dropper_shield = EXCLUDED.anti_dropper_shield,
			parent_match_percent = EXCLUDED.parent_match_percent,
			trusted_whitelist = EXCLUDED.trusted_whitelist,
			updated_at = NOW()
	`, p.UserID, p.MaxInstantTransfer, p.FastFoodLimitMonth, p.GamingLimitMonth, 
	   p.RequireCoSigning, p.TrustedContactsOnly, 
	   p.NightLockdown, p.AntiDropperShield, p.ParentMatchPercent, string(whitelistBytes))
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// CreateCoSignRequest
func (s *Storage) CreateCoSignRequest(ctx context.Context, req domain.CoSignRequest) (int64, error) {
	const op = "storage.postgres.CreateCoSignRequest"

	var id int64
	err := s.DB.QueryRowContext(ctx, `
		INSERT INTO co_sign_requests (transaction_id, user_id, guardian_id, amount, recipient, risk_reason, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())
		RETURNING id
	`, req.TransactionID, req.UserID, req.GuardianID, req.Amount, req.Recipient, req.RiskReason).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", op, err)
	}
	return id, nil
}

// GetPendingCoSignRequests
func (s *Storage) GetPendingCoSignRequests(ctx context.Context, guardianID int64) ([]domain.CoSignRequest, error) {
	const op = "storage.postgres.GetPendingCoSignRequests"

	rows, err := s.DB.QueryContext(ctx, `
		SELECT c.id, c.transaction_id, c.user_id, u.name, u.role, c.guardian_id, c.amount, c.recipient, c.risk_reason, c.status, c.created_at, c.decided_at
		FROM co_sign_requests c
		JOIN users u ON u.id = c.user_id
		WHERE c.guardian_id = $1 AND c.status = 'pending'
		ORDER BY c.created_at DESC
	`, guardianID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	defer rows.Close()

	list := make([]domain.CoSignRequest, 0)
	for rows.Next() {
		var r domain.CoSignRequest
		if err := rows.Scan(
			&r.ID, &r.TransactionID, &r.UserID, &r.UserName, &r.UserRole, &r.GuardianID, &r.Amount, &r.Recipient, &r.RiskReason, &r.Status, &r.CreatedAt, &r.DecidedAt,
		); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", op, err)
		}
		list = append(list, r)
	}
	return list, nil
}

// GetCoSignRequestByID
func (s *Storage) GetCoSignRequestByID(ctx context.Context, id int64) (domain.CoSignRequest, error) {
	const op = "storage.postgres.GetCoSignRequestByID"

	row := s.DB.QueryRowContext(ctx, `
		SELECT c.id, c.transaction_id, c.user_id, u.name, u.role, c.guardian_id, c.amount, c.recipient, c.risk_reason, c.status, c.created_at, c.decided_at
		FROM co_sign_requests c
		JOIN users u ON u.id = c.user_id
		WHERE c.id = $1
	`, id)

	var r domain.CoSignRequest
	if err := row.Scan(&r.ID, &r.TransactionID, &r.UserID, &r.UserName, &r.UserRole, &r.GuardianID, &r.Amount, &r.Recipient, &r.RiskReason, &r.Status, &r.CreatedAt, &r.DecidedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.CoSignRequest{}, ErrNotFound
		}
		return domain.CoSignRequest{}, fmt.Errorf("%s: %w", op, err)
	}
	return r, nil
}

// ResolveCoSignRequest
func (s *Storage) ResolveCoSignRequest(ctx context.Context, id int64, status string) error {
	const op = "storage.postgres.ResolveCoSignRequest"

	_, err := s.DB.ExecContext(ctx, `
		UPDATE co_sign_requests
		SET status = $1, decided_at = NOW()
		WHERE id = $2
	`, status, id)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// GetGoals
func (s *Storage) GetGoals(ctx context.Context, userID int64) ([]domain.Goal, error) {
	const op = "storage.postgres.GetGoals"

	rows, err := s.DB.QueryContext(ctx, `
		SELECT id, user_id, title, target_amount, current_amount, boost_multiplier, sponsor_id, status, created_at
		FROM goals
		WHERE user_id = $1
		ORDER BY id ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	defer rows.Close()

	list := make([]domain.Goal, 0)
	for rows.Next() {
		var g domain.Goal
		if err := rows.Scan(&g.ID, &g.UserID, &g.Title, &g.TargetAmount, &g.CurrentAmount, &g.BoostMultiplier, &g.SponsorID, &g.Status, &g.CreatedAt); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", op, err)
		}
		list = append(list, g)
	}
	return list, nil
}

// GoalByID loads a single goal. Callers use it to check ownership before
// letting somebody else's money into it.
func (s *Storage) GoalByID(ctx context.Context, goalID int64) (domain.Goal, error) {
	const op = "storage.postgres.GoalByID"

	var g domain.Goal
	err := s.DB.QueryRowContext(ctx, `
		SELECT id, user_id, title, target_amount, current_amount, boost_multiplier, sponsor_id, status, created_at
		FROM goals
		WHERE id = $1
	`, goalID).Scan(&g.ID, &g.UserID, &g.Title, &g.TargetAmount, &g.CurrentAmount, &g.BoostMultiplier, &g.SponsorID, &g.Status, &g.CreatedAt)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Goal{}, ErrNotFound
		}
		return domain.Goal{}, fmt.Errorf("%s: %w", op, err)
	}
	return g, nil
}

// TopUpGoal
func (s *Storage) TopUpGoal(ctx context.Context, goalID int64, amount float64) error {
	const op = "storage.postgres.TopUpGoal"

	_, err := s.DB.ExecContext(ctx, `
		UPDATE goals
		SET current_amount = current_amount + $1
		WHERE id = $2
	`, amount, goalID)
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}

// GetQuests
func (s *Storage) GetQuests(ctx context.Context, userID int64) ([]domain.Quest, error) {
	const op = "storage.postgres.GetQuests"

	rows, err := s.DB.QueryContext(ctx, `
		SELECT q.id, q.title, q.description, q.category, q.reward_rub, q.safety_score_reward, q.scenario, q.options, q.correct_option, q.explanation,
		       EXISTS(SELECT 1 FROM user_quest_completions uqc WHERE uqc.quest_id = q.id AND uqc.user_id = $1) as is_completed
		FROM quests q
		ORDER BY q.id ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	defer rows.Close()

	list := make([]domain.Quest, 0)
	for rows.Next() {
		var q domain.Quest
		var optionsJSON []byte
		if err := rows.Scan(
			&q.ID, &q.Title, &q.Description, &q.Category, &q.RewardRub, &q.SafetyScoreReward,
			&q.Scenario, &optionsJSON, &q.CorrectOption, &q.Explanation, &q.IsCompleted,
		); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", op, err)
		}
		_ = json.Unmarshal(optionsJSON, &q.Options)
		list = append(list, q)
	}
	return list, nil
}

// CompleteQuest
func (s *Storage) CompleteQuest(ctx context.Context, userID int64, questID int64, safetyReward int, rubReward float64) error {
	const op = "storage.postgres.CompleteQuest"

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("%s: begin tx: %w", op, err)
	}
	defer tx.Rollback()

	// Only the first successful answer counts; a repeat must not pay out again.
	var completionID int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO user_quest_completions (user_id, quest_id, completed_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id, quest_id) DO NOTHING
		RETURNING id
	`, userID, questID).Scan(&completionID)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrAlreadyCompleted
	}
	if err != nil {
		return fmt.Errorf("%s: insert completion: %w", op, err)
	}

	// Update safety score
	_, err = tx.ExecContext(ctx, `
		UPDATE users
		SET safety_score = LEAST(100, safety_score + $1)
		WHERE id = $2
	`, safetyReward, userID)
	if err != nil {
		return fmt.Errorf("%s: update safety score: %w", op, err)
	}

	// Add reward to teen account if rubReward > 0
	if rubReward > 0 {
		// PostgreSQL does not support a row cap on UPDATE, so target the account explicitly.
		_, err = tx.ExecContext(ctx, `
			UPDATE accounts
			SET balance = balance + $1
			WHERE id = (SELECT id FROM accounts WHERE user_id = $2 ORDER BY id ASC LIMIT 1)
		`, rubReward, userID)
		if err != nil {
			return fmt.Errorf("%s: update balance: %w", op, err)
		}

		// Log quest reward transaction
		_, err = tx.ExecContext(ctx, `
			INSERT INTO transactions (account_id, user_id, amount, currency, category, mcc, description, status, risk_level, created_at)
			SELECT id, $2, $1, 'RUB', 'Награда за фин-квест', '0000', 'Бонус за обучение', 'completed', 'low', NOW()
			FROM accounts WHERE user_id = $2 ORDER BY id ASC LIMIT 1
		`, rubReward, userID)
		if err != nil {
			return fmt.Errorf("%s: log reward transaction: %w", op, err)
		}
	}

	return tx.Commit()
}

// GetCoSignRequestsHistory returns all co-sign requests for the guardian (pending, approved, rejected)
func (s *Storage) GetCoSignRequestsHistory(ctx context.Context, guardianID int64, limit int) ([]domain.CoSignRequest, error) {
	const op = "storage.postgres.GetCoSignRequestsHistory"

	if limit <= 0 {
		limit = 50
	}

	rows, err := s.DB.QueryContext(ctx, `
		SELECT c.id, c.transaction_id, c.user_id, u.name, u.role, c.guardian_id, c.amount, c.recipient, c.risk_reason, c.status, c.created_at, c.decided_at
		FROM co_sign_requests c
		JOIN users u ON u.id = c.user_id
		WHERE c.guardian_id = $1
		ORDER BY c.created_at DESC
		LIMIT $2
	`, guardianID, limit)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	defer rows.Close()

	list := make([]domain.CoSignRequest, 0)
	for rows.Next() {
		var r domain.CoSignRequest
		if err := rows.Scan(
			&r.ID, &r.TransactionID, &r.UserID, &r.UserName, &r.UserRole, &r.GuardianID, &r.Amount, &r.Recipient, &r.RiskReason, &r.Status, &r.CreatedAt, &r.DecidedAt,
		); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", op, err)
		}
		list = append(list, r)
	}
	return list, nil
}

// GetCategoryExpenses aggregates completed expenses by category and MCC for a family
func (s *Storage) GetCategoryExpenses(ctx context.Context, familyID int64) ([]domain.CategoryExpense, error) {
	const op = "storage.postgres.GetCategoryExpenses"

	rows, err := s.DB.QueryContext(ctx, `
		SELECT t.category, COALESCE(t.mcc, ''), SUM(t.amount) as total, COUNT(*) as count
		FROM transactions t
		JOIN family_members fm ON fm.user_id = t.user_id
		WHERE fm.family_id = $1 AND t.status = 'completed'
		GROUP BY t.category, t.mcc
		ORDER BY total DESC
	`, familyID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", op, err)
	}
	defer rows.Close()

	list := make([]domain.CategoryExpense, 0)
	for rows.Next() {
		var c domain.CategoryExpense
		if err := rows.Scan(&c.Category, &c.MCC, &c.Total, &c.Count); err != nil {
			return nil, fmt.Errorf("%s: scan: %w", op, err)
		}
		list = append(list, c)
	}
	return list, nil
}

// GetMemberSpendingSummary calculates monthly spending against policy limits
func (s *Storage) GetMemberSpendingSummary(ctx context.Context, userID int64) (domain.MemberSpendingSummary, error) {
	const op = "storage.postgres.GetMemberSpendingSummary"

	u, err := s.UserByID(ctx, userID)
	if err != nil {
		return domain.MemberSpendingSummary{}, fmt.Errorf("%s: user by id: %w", op, err)
	}

	policy, _ := s.GetSafetyPolicy(ctx, userID)

	var monthTotal float64
	var gamingSpend float64
	var fastFoodSpend float64

	rows, err := s.DB.QueryContext(ctx, `
		SELECT category, mcc, amount
		FROM transactions
		WHERE user_id = $1 AND status = 'completed'
	`, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var cat, mcc string
			var amount float64
			if err := rows.Scan(&cat, &mcc, &amount); err == nil {
				monthTotal += amount
				if mcc == "7994" || cat == "Развлечения и игры" {
					gamingSpend += amount
				}
				if mcc == "5814" || cat == "Фастфуд" {
					fastFoodSpend += amount
				}
			}
		}
	}

	return domain.MemberSpendingSummary{
		UserID:        userID,
		UserName:      u.Name,
		MonthTotal:    monthTotal,
		GamingSpend:   gamingSpend,
		GamingLimit:   policy.GamingLimitMonth,
		FastFoodSpend: fastFoodSpend,
		FastFoodLimit: policy.FastFoodLimitMonth,
	}, nil
}

// CreateGoal saves a new savings goal
func (s *Storage) CreateGoal(ctx context.Context, g domain.Goal) (int64, error) {
	const op = "storage.postgres.CreateGoal"

	var id int64
	err := s.DB.QueryRowContext(ctx, `
		INSERT INTO goals (user_id, title, target_amount, current_amount, boost_multiplier, sponsor_id, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
		RETURNING id
	`, g.UserID, g.Title, g.TargetAmount, g.CurrentAmount, g.BoostMultiplier, g.SponsorID).Scan(&id)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", op, err)
	}
	return id, nil
}

