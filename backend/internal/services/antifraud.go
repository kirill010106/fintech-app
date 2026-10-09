package services

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/fintech-app/backend/internal/domain"
	"github.com/fintech-app/backend/internal/storage/postgres"
)

type AntifraudService struct {
	storage *postgres.Storage
}

func NewAntifraudService(storage *postgres.Storage) *AntifraudService {
	return &AntifraudService{storage: storage}
}

type AntifraudResult struct {
	RiskLevel       string
	RiskReason      string
	RequiresCoSign  bool
	RecommendedTips []string
}

// EvaluateTransfer scores a transfer against the family's safety policy and
// known scam patterns. The risk score is computed for everyone; only members
// whose protection profile requires supervision get their transfer held for
// approval. A person who needs no supervision is never blocked, but is still
// told when a recipient looks dangerous.
func (s *AntifraudService) EvaluateTransfer(ctx context.Context, user domain.User, amount float64, recipientPhone, recipientName string) (AntifraudResult, error) {
	// Fetch the safety policy. Everyone has one, including unsupervised adults.
	policy, err := s.storage.GetSafetyPolicy(ctx, user.ID)
	if err != nil {
		return AntifraudResult{}, err
	}

	recipientLower := strings.ToLower(recipientName)
	phoneClean := strings.ReplaceAll(strings.ReplaceAll(recipientPhone, " ", ""), "-", "")

	// 2.1 Check Trusted Whitelist (parents' pre-approved recipients)
	isWhitelisted := false
	for _, contact := range policy.TrustedWhitelist {
		cLower := strings.ToLower(contact)
		cPhoneClean := strings.ReplaceAll(strings.ReplaceAll(contact, " ", ""), "-", "")
		if (cPhoneClean != "" && strings.Contains(phoneClean, cPhoneClean)) ||
			(cLower != "" && (strings.Contains(recipientLower, cLower) || strings.Contains(cLower, recipientLower))) {
			isWhitelisted = true
			break
		}
	}

	// Keywords typical of money-mule and scam recipient names
	dropperKeywords := []string{"drop", "дроп", "крипто", "crypto", "обмен", "skins", "чит", "cheat", "trader", "p2p"}
	isDropperSuspect := false
	for _, kw := range dropperKeywords {
		if strings.Contains(recipientLower, kw) {
			isDropperSuspect = true
			break
		}
	}

	// Whitelisted contacts bypass limit-based Co-Signing unless suspected of dropper fraud
	if isWhitelisted && !isDropperSuspect {
		return AntifraudResult{
			RiskLevel:       domain.RiskLow,
			RiskReason:      "Получатель находится в доверенном белом списке семьи",
			RequiresCoSign:  false,
			RecommendedTips: []string{"Платеж доверенному контакту семьи разрешен без задержек."},
		}, nil
	}

	var reasons []string
	requiresCoSign := false
	riskLevel := domain.RiskLow

	// Rule 1: shield against money-mule schemes
	if policy.AntiDropperShield && isDropperSuspect {
		riskLevel = domain.RiskCritical
		requiresCoSign = true
		reasons = append(reasons, "Получатель похож на участника мошеннических схем приёма и перевода чужих средств")
	}

	// Rule 2: Night Lockdown (23:00 - 07:00)
	now := time.Now()
	hour := now.Hour()
	if policy.NightLockdown && (hour >= 23 || hour < 7) {
		if riskLevel == domain.RiskLow {
			riskLevel = domain.RiskHigh
		}
		requiresCoSign = true
		reasons = append(reasons, "Переводы с 23:00 до 07:00 приостанавливаются до подтверждения, чтобы исключить ночные импульсивные операции")
	}

	// Rule 3: Instant transfer limit
	if policy.RequireCoSigning && amount > policy.MaxInstantTransfer {
		if riskLevel == domain.RiskLow {
			riskLevel = domain.RiskHigh
		}
		requiresCoSign = true
		reasons = append(reasons, fmt.Sprintf("Сумма перевода %.2f ₽ превышает лимит доверия семьи %.2f ₽", amount, policy.MaxInstantTransfer))
	}

	// Rule 4: Suspicious/Anonymous recipients
	if strings.Contains(recipientLower, "аноним") || recipientName == "" {
		if riskLevel == domain.RiskLow {
			riskLevel = domain.RiskMedium
		}
		reasons = append(reasons, "Получатель не входит в доверенные контакты семьи")
	}

	// Rule 5: Teen safety score penalty
	if user.Role == domain.RoleTeen && user.SafetyScore < 60 {
		requiresCoSign = true
		if riskLevel == domain.RiskLow {
			riskLevel = domain.RiskMedium
		}
		reasons = append(reasons, "Низкий уровень доверия требует подтверждения любых исходящих переводов")
	}

	// Rule 6: senior shield — large transfer from an older relative
	if user.Role == domain.RoleSenior && amount >= 5000 {
		requiresCoSign = true
		riskLevel = domain.RiskHigh
		reasons = append(reasons, "Крупный перевод со счёта старшего родственника требует подтверждения близкими для защиты от телефонных мошенников")
	}

	// A person nobody supervises cannot be held for approval: there is nobody
	// to approve. The risk level still travels with the transaction, so the
	// warning is shown either way.
	if !user.Role.RequiresSupervision() {
		requiresCoSign = false
	}

	reasonStr := strings.Join(reasons, "; ")

	var tips []string
	if requiresCoSign {
		tips = append(tips, "Не переводите деньги по просьбе незнакомцев из мессенджеров или по телефону")
		tips = append(tips, "Предложение принять и перевести средства за вознаграждение это участие в мошеннической схеме, оно уголовно наказуемо")
		if user.Role == domain.RoleSenior {
			tips = append(tips, "Сотрудники банка и полиции никогда не просят перевести деньги на безопасный счёт")
		}
	} else if riskLevel != domain.RiskLow {
		tips = append(tips, "Получатель вызывает сомнения. Проверьте его, прежде чем повторять перевод")
	}

	return AntifraudResult{
		RiskLevel:       riskLevel,
		RiskReason:      reasonStr,
		RequiresCoSign:  requiresCoSign,
		RecommendedTips: tips,
	}, nil
}
