package services

import (
	"context"
	"errors"
	"fmt"

	"github.com/fintech-app/backend/internal/domain"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

var (
	ErrInsufficientFunds = errors.New("недостаточно средств на счёте")
	ErrAccountNotFound   = errors.New("банковский счёт не найден")
	ErrUnauthorized      = errors.New("недостаточно прав для выполнения действия")
)

type TransferService struct {
	storage   *postgres.Storage
	antifraud *AntifraudService
	broker    *EventBroker
}

func NewTransferService(storage *postgres.Storage, antifraud *AntifraudService, broker *EventBroker) *TransferService {
	return &TransferService{
		storage:   storage,
		antifraud: antifraud,
		broker:    broker,
	}
}


type TransferRequest struct {
	AccountID      int64   `json:"account_id"`
	RecipientPhone string  `json:"recipient_phone"`
	RecipientName  string  `json:"recipient_name"`
	Amount         float64 `json:"amount"`
	Description    string  `json:"description"`
}

type TransferResponse struct {
	Transaction     domain.Transaction `json:"transaction"`
	RequiresCoSign  bool               `json:"requires_co_sign"`
	CoSignRequestID int64              `json:"co_sign_request_id,omitempty"`
	WarningMessage  string             `json:"warning_message,omitempty"`
	Tips            []string           `json:"tips,omitempty"`
}

// InitiateTransfer initiates transfer with antifraud interception
func (s *TransferService) InitiateTransfer(ctx context.Context, user domain.User, req TransferRequest) (TransferResponse, error) {
	const op = "services.TransferService.InitiateTransfer"

	account, err := s.storage.GetAccountByID(ctx, req.AccountID)
	if err != nil {
		return TransferResponse{}, ErrAccountNotFound
	}
	if account.UserID != user.ID {
		return TransferResponse{}, ErrUnauthorized
	}
	if account.Balance < req.Amount {
		return TransferResponse{}, ErrInsufficientFunds
	}

	// Antifraud check
	eval, err := s.antifraud.EvaluateTransfer(ctx, user, req.Amount, req.RecipientPhone, req.RecipientName)
	if err != nil {
		return TransferResponse{}, fmt.Errorf("%s: antifraud eval: %w", op, err)
	}

	status := domain.TxStatusCompleted
	if eval.RequiresCoSign {
		status = domain.TxStatusPendingApproval
	}

	tx := domain.Transaction{
		AccountID:      account.ID,
		UserID:         user.ID,
		Amount:         req.Amount,
		Currency:       account.Currency,
		Category:       "Переводы по СБП",
		MCC:            "6538",
		Description:    req.Description,
		RecipientPhone: req.RecipientPhone,
		RecipientName:  req.RecipientName,
		Status:         status,
		RiskLevel:      eval.RiskLevel,
		RiskReason:     eval.RiskReason,
	}

	txID, err := s.storage.CreateTransaction(ctx, tx)
	if err != nil {
		return TransferResponse{}, fmt.Errorf("%s: create tx: %w", op, err)
	}
	tx.ID = txID

	var coSignID int64
	if eval.RequiresCoSign {
		// Find someone who is allowed to supervise: the owner first, then any
		// confirmed guardian. Pending members are never approvers.
		family, members, err := s.storage.GetFamilyByUserID(ctx, user.ID)
		if err == nil {
			var guardianID int64 = family.OwnerID
			for _, m := range members {
				if m.Status != domain.MembershipActive {
					continue
				}
				if m.UserID != family.OwnerID && m.Authority.CanSupervise() {
					guardianID = m.UserID
					break
				}
			}

			coSignReq := domain.CoSignRequest{
				TransactionID: txID,
				UserID:        user.ID,
				GuardianID:    guardianID,
				Amount:        req.Amount,
				Recipient:     fmt.Sprintf("%s (%s)", req.RecipientPhone, req.RecipientName),
				RiskReason:    eval.RiskReason,
			}
			coSignID, _ = s.storage.CreateCoSignRequest(ctx, coSignReq)
			coSignReq.ID = coSignID

			// Publish real-time event to guardian
			if s.broker != nil {
				s.broker.Publish(AppEvent{
					Type:     EventCoSignCreated,
					UserID:   guardianID,
					FamilyID: family.ID,
					Payload: map[string]any{
						"request_id":  coSignID,
						"user_id":     user.ID,
						"user_name":   user.Name,
						"amount":      req.Amount,
						"recipient":   coSignReq.Recipient,
						"risk_reason": eval.RiskReason,
					},
				})
			}
		}
	} else {
		// Deduct balance immediately
		_ = s.storage.UpdateAccountBalance(ctx, account.ID, account.Balance-req.Amount)
		if s.broker != nil {
			s.broker.Publish(AppEvent{
				Type:   EventBalanceUpdated,
				UserID: user.ID,
				Payload: map[string]any{
					"amount": -req.Amount,
				},
			})
		}
	}

	return TransferResponse{
		Transaction:     tx,
		RequiresCoSign:  eval.RequiresCoSign,
		CoSignRequestID: coSignID,
		WarningMessage:  eval.RiskReason,
		Tips:            eval.RecommendedTips,
	}, nil
}

// ApproveTransfer by Guardian
func (s *TransferService) ApproveTransfer(ctx context.Context, guardian domain.User, requestID int64) error {
	req, err := s.storage.GetCoSignRequestByID(ctx, requestID)
	if err != nil {
		return err
	}
	if req.GuardianID != guardian.ID {
		return ErrUnauthorized
	}

	// Update CoSign request
	if err := s.storage.ResolveCoSignRequest(ctx, requestID, "approved"); err != nil {
		return err
	}

	// Update transaction
	if err := s.storage.UpdateTransactionStatus(ctx, req.TransactionID, domain.TxStatusCompleted, domain.RiskLow, "Одобрено родителем"); err != nil {
		return err
	}

	// Deduct balance from sender
	accounts, err := s.storage.GetAccountsByUserID(ctx, req.UserID)
	if err == nil && len(accounts) > 0 {
		acc := accounts[0]
		_ = s.storage.UpdateAccountBalance(ctx, acc.ID, acc.Balance-req.Amount)
	}

	// Publish real-time event to sender and family
	if s.broker != nil {
		s.broker.Publish(AppEvent{
			Type:   EventCoSignResolved,
			UserID: req.UserID,
			Payload: map[string]any{
				"request_id": requestID,
				"status":     "approved",
				"amount":     req.Amount,
			},
		})
		s.broker.Publish(AppEvent{
			Type:   EventBalanceUpdated,
			UserID: req.UserID,
			Payload: map[string]any{
				"amount": -req.Amount,
			},
		})
	}

	return nil
}

// RejectTransfer by Guardian
func (s *TransferService) RejectTransfer(ctx context.Context, guardian domain.User, requestID int64) error {
	req, err := s.storage.GetCoSignRequestByID(ctx, requestID)
	if err != nil {
		return err
	}
	if req.GuardianID != guardian.ID {
		return ErrUnauthorized
	}

	// Update CoSign request
	if err := s.storage.ResolveCoSignRequest(ctx, requestID, "rejected"); err != nil {
		return err
	}

	// Update transaction
	if err := s.storage.UpdateTransactionStatus(ctx, req.TransactionID, domain.TxStatusRejected, domain.RiskHigh, "Отклонено родителем (угроза мошенничества)"); err != nil {
		return err
	}

	// Publish real-time event to sender
	if s.broker != nil {
		s.broker.Publish(AppEvent{
			Type:   EventCoSignResolved,
			UserID: req.UserID,
			Payload: map[string]any{
				"request_id": requestID,
				"status":     "rejected",
				"amount":     req.Amount,
			},
		})
	}

	return nil
}

