import React, { useCallback, useEffect, useState } from 'react';
import { App as AntdApp, Col, Row, Skeleton, Switch } from 'antd';
import {
  LockOutlined,
  PhoneOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UserOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { api, extractErrorMessage } from '../../api';
import { AUTHORITY_LABELS, BANK_LABELS, PROFILE_LABELS } from '../../types';
import type { Account, MemberDashboardInfo, SafetyPolicy, User } from '../../types';
import { EmptyState, ErrorBlock, LoadingBlock } from '../ui/States';

interface Props {
  currentUser: User;
  accounts: Account[];
  onRefresh: () => void;
}

/** The three policy flags this screen is allowed to toggle. */
type PolicyFlag = 'night_lockdown' | 'anti_dropper_shield' | 'trusted_contacts_only';

interface PolicyRule {
  field: PolicyFlag;
  title: string;
  hint: string;
}

const POLICY_RULES: PolicyRule[] = [
  {
    field: 'night_lockdown',
    title: 'Блокировка досрочного закрытия вклада и снятия',
    hint: 'Заявка на досрочное закрытие вклада или крупное снятие приостанавливается до подтверждения.',
  },
  {
    field: 'anti_dropper_shield',
    title: 'Проверка входящих звонков',
    hint: 'Операция приостанавливается, если разговор идёт с номера из баз мошенников.',
  },
  {
    field: 'trusted_contacts_only',
    title: 'Переводы только доверенным получателям',
    hint: 'Исходящий перевод проходит только на контакт из списка доверенных получателей.',
  },
];

const CURRENCY_SYMBOLS: Record<string, string> = {
  RUB: '₽',
  USD: '$',
  EUR: '€',
  KZT: '₸',
};

const currencySymbol = (currency: string): string => CURRENCY_SYMBOLS[currency] ?? currency;

const formatAmount = (amount: number, currency: string): string =>
  `${amount.toLocaleString('ru-RU')} ${currencySymbol(currency)}`;

const maskCard = (cardNumber: string): string => {
  const digits = cardNumber.replace(/\s+/g, '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : digits;
};

const formatMoment = (value: string): string => {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
};

const readPolicyFlag = (policy: SafetyPolicy, field: PolicyFlag): boolean => {
  if (field === 'night_lockdown') return Boolean(policy.night_lockdown);
  if (field === 'anti_dropper_shield') return Boolean(policy.anti_dropper_shield);
  return Boolean(policy.trusted_contacts_only);
};

const withPolicyFlag = (policy: SafetyPolicy, field: PolicyFlag, value: boolean): SafetyPolicy => {
  if (field === 'night_lockdown') return { ...policy, night_lockdown: value };
  if (field === 'anti_dropper_shield') return { ...policy, anti_dropper_shield: value };
  return { ...policy, trusted_contacts_only: value };
};

const iconBadge = (background: string, color: string): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 38,
  height: 38,
  borderRadius: 'var(--radius-sm)',
  background,
  color,
  fontSize: 18,
  flex: '0 0 auto',
});

const InfoRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    className="divider-top"
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '11px 0',
    }}
  >
    <span className="text-muted" style={{ fontSize: 12 }}>
      {label}
    </span>
    <span className="text-primary tnum" style={{ fontSize: 13, fontWeight: 700 }}>
      {value}
    </span>
  </div>
);

export const SeniorCareTab: React.FC<Props> = ({ currentUser, accounts, onRefresh }) => {
  const { message } = AntdApp.useApp();

  const [policyState, setPolicyState] = useState<{
    data: SafetyPolicy | null;
    error: string | null;
    loading: boolean;
  }>({ data: null, error: null, loading: true });
  const { data: policy, error: policyError, loading: policyLoading } = policyState;

  const [savingField, setSavingField] = useState<PolicyFlag | null>(null);

  const [familyState, setFamilyState] = useState<{
    person: MemberDashboardInfo | null;
    error: string | null;
    loading: boolean;
  }>({ person: null, error: null, loading: true });
  const { person: trustedMember, error: familyError, loading: familyLoading } = familyState;
  /** The account details are only rendered when the backend sent them along. */
  const trustedPerson =
    trustedMember && trustedMember.member.user
      ? { member: trustedMember.member, user: trustedMember.member.user }
      : null;

  const mainAccount: Account | null = accounts.length > 0 ? accounts[0] : null;
  const trustedWhitelist = policy?.trusted_whitelist ?? [];

  /** Pure fetch: it never writes state, so the effects below stay free of sync setState. */
  const fetchPolicy = useCallback(async (): Promise<{
    data: SafetyPolicy | null;
    error: string | null;
  }> => {
    try {
      const loaded = await api.getPolicy(currentUser.id);
      return { data: loaded ?? null, error: null };
    } catch (e) {
      return { data: null, error: extractErrorMessage(e, 'Не удалось загрузить правила защиты') };
    }
  }, [currentUser.id]);

  useEffect(() => {
    let active = true;
    void fetchPolicy().then((result) => {
      if (active) setPolicyState({ ...result, loading: false });
    });
    return () => {
      active = false;
    };
  }, [fetchPolicy]);

  const reloadPolicy = () => {
    setPolicyState((previous) => ({ ...previous, loading: true, error: null }));
    void fetchPolicy().then((result) => setPolicyState({ ...result, loading: false }));
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const dashboard = await api.getFamilyDashboard();
        const members = dashboard?.members ?? [];
        if (!active) return;
        setFamilyState({
          person:
            members.find((entry) => entry.member.authority === 'guardian') ??
            members.find((entry) => entry.member.authority === 'owner') ??
            null,
          error: null,
          loading: false,
        });
      } catch (e) {
        if (!active) return;
        setFamilyState({
          person: null,
          error: extractErrorMessage(e, 'Не удалось загрузить данные семьи'),
          loading: false,
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [currentUser.id]);

  const handlePolicyToggle = async (field: PolicyFlag, value: boolean) => {
    if (!policy) return;

    const previous = policy;
    const next = withPolicyFlag(previous, field, value);
    setPolicyState((state) => ({ ...state, data: next }));
    setSavingField(field);
    try {
      const updated = await api.updatePolicy(currentUser.id, next);
      setPolicyState((state) => ({ ...state, data: updated ?? next }));
      onRefresh();
    } catch (e) {
      setPolicyState((state) => ({ ...state, data: previous }));
      message.error(extractErrorMessage(e, 'Не удалось сохранить правило'));
    } finally {
      setSavingField(null);
    }
  };

  const renderDepositProtection = () => {
    if (policyLoading) return <Skeleton active paragraph={{ rows: 5 }} title={false} />;
    if (policyError) {
      return <ErrorBlock text={policyError} onRetry={reloadPolicy} height={140} />;
    }
    if (!policy) return <EmptyState title="Правила защиты недоступны" height={140} />;

    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <InfoRow
          label="Лимит мгновенного перевода"
          value={
            mainAccount
              ? formatAmount(policy.max_instant_transfer, mainAccount.currency)
              : policy.max_instant_transfer.toLocaleString('ru-RU')
          }
        />
        <InfoRow
          label="Совместное подтверждение операций"
          value={policy.require_co_signing ? 'Включено' : 'Выключено'}
        />
        <InfoRow
          label="Блокировка досрочного закрытия вклада"
          value={
            policy.night_lockdown === undefined
              ? 'Не настроено'
              : policy.night_lockdown
                ? 'Включена'
                : 'Выключена'
          }
        />
        <InfoRow
          label="Проверка входящих звонков"
          value={
            policy.anti_dropper_shield === undefined
              ? 'Не настроено'
              : policy.anti_dropper_shield
                ? 'Включена'
                : 'Выключена'
          }
        />
        {policy.parent_match_percent !== undefined ? (
          <InfoRow
            label="Совпадение с доверенным лицом"
            value={`${policy.parent_match_percent.toLocaleString('ru-RU')}%`}
          />
        ) : null}
        <InfoRow label="Правила обновлены" value={formatMoment(policy.updated_at)} />
      </div>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: '1 1 420px', minWidth: 260 }}>
          <div className="muted-label">Защита сбережений</div>
          <h1 className="page-title">{currentUser.name}</h1>
          <p className="page-subtitle">
            Правила, которые снижают риск потерять деньги из-за мошенников. Изменения сохраняются
            сразу и применяются к вашим операциям.
          </p>
          <div className="tag-row">
            <span className="status-tag status-tag-neutral">
              {PROFILE_LABELS[currentUser.role]}
            </span>
          </div>
        </div>

        <div
          className="app-panel"
          style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 18px' }}
        >
          <SafetyCertificateOutlined style={{ fontSize: 22, color: 'var(--accent-text)' }} />
          <div>
            <div className="muted-label">Индекс защищённости</div>
            <div
              className="tnum"
              style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}
            >
              {currentUser.safety_score}
            </div>
          </div>
        </div>
      </div>

      <Row gutter={[20, 20]} align="stretch" style={{ marginBottom: 20 }}>
        {/* Account */}
        <Col xs={24} md={12}>
          <div
            className="app-card"
            style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <span style={iconBadge('var(--accent-soft)', 'var(--accent-text)')}>
                <WalletOutlined />
              </span>
              <div>
                <div className="section-title">Ваш счёт</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Баланс и карта по вашему договору
                </div>
              </div>
            </div>

            {mainAccount ? (
              <>
                <div className="muted-label">{mainAccount.card_type}</div>
                <div
                  className="tnum"
                  style={{
                    fontSize: 32,
                    fontWeight: 900,
                    color: 'var(--text-primary)',
                    margin: '6px 0 4px',
                  }}
                >
                  {formatAmount(mainAccount.balance, mainAccount.currency)}
                </div>
                <div className="text-secondary mono" style={{ fontSize: 12 }}>
                  {maskCard(mainAccount.card_number)}
                </div>

                <div
                  className="divider-top"
                  style={{
                    marginTop: 'auto',
                    paddingTop: 14,
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 20,
                  }}
                >
                  <div>
                    <div className="muted-label">Банк</div>
                    <div
                      className="text-secondary"
                      style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}
                    >
                      {BANK_LABELS[mainAccount.bank_provider] ?? mainAccount.bank_provider}
                    </div>
                  </div>
                  <div>
                    <div className="muted-label">Номер счёта</div>
                    <div
                      className="text-secondary mono"
                      style={{ fontSize: 13, marginTop: 2 }}
                    >
                      {mainAccount.account_number}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <EmptyState
                title="Счёт пока не открыт"
                text="Как только счёт появится, здесь будут его баланс и данные карты."
                height={140}
              />
            )}
          </div>
        </Col>

        {/* Trusted person */}
        <Col xs={24} md={12}>
          <div
            className="app-card"
            style={{ padding: 24, height: '100%', display: 'flex', flexDirection: 'column' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <span style={iconBadge('var(--info-soft)', 'var(--info-text)')}>
                <TeamOutlined />
              </span>
              <div>
                <div className="section-title">Доверенное лицо</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Подтверждает спорные операции
                </div>
              </div>
            </div>

            {familyLoading ? (
              <LoadingBlock height={140} />
            ) : familyError ? (
              <ErrorBlock text={familyError} height={140} />
            ) : trustedPerson ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 46,
                      height: 46,
                      borderRadius: '50%',
                      background: 'var(--accent-soft)',
                      color: 'var(--accent-text)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 18,
                      fontWeight: 800,
                      flex: '0 0 auto',
                    }}
                  >
                    {trustedPerson.user.name.trim().charAt(0).toUpperCase() || '?'}
                  </div>
                  <div>
                    <div
                      className="text-primary"
                      style={{ fontSize: 16, fontWeight: 700 }}
                    >
                      {trustedPerson.user.name}
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                      {AUTHORITY_LABELS[trustedPerson.member.authority]} ·{' '}
                      {PROFILE_LABELS[trustedPerson.member.role]}
                      {trustedPerson.member.nickname
                        ? ` · ${trustedPerson.member.nickname}`
                        : ''}
                    </div>
                  </div>
                </div>

                <div
                  className="app-panel"
                  style={{
                    marginTop: 16,
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <PhoneOutlined style={{ color: 'var(--info-text)' }} />
                  <a
                    className="mono"
                    href={`tel:${trustedPerson.user.phone}`}
                    style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}
                  >
                    {trustedPerson.user.phone}
                  </a>
                </div>
              </>
            ) : (
              <EmptyState
                title="Доверенное лицо не назначено"
                text="Владелец семьи ещё не назначил опекуна, который подтверждает спорные операции."
              />
            )}
          </div>
        </Col>
      </Row>

      <Row gutter={[20, 20]} align="stretch" style={{ marginBottom: 20 }}>
        {/* Protection rules */}
        <Col xs={24} lg={14}>
          <div className="app-card" style={{ padding: 24, height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <span style={iconBadge('var(--success-soft)', 'var(--success-text)')}>
                <LockOutlined />
              </span>
              <div>
                <div className="section-title">Правила защиты</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Настройки применяются к вашим операциям
                </div>
              </div>
            </div>

            {policyLoading ? (
              <Skeleton active paragraph={{ rows: 5 }} title={false} />
            ) : policyError ? (
              <ErrorBlock text={policyError} onRetry={reloadPolicy} height={140} />
            ) : policy ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {POLICY_RULES.map((rule) => {
                  const checked = readPolicyFlag(policy, rule.field);
                  return (
                    <div
                      key={rule.field}
                      className="app-panel"
                      style={{
                        padding: '14px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 14,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <span
                          style={iconBadge(
                            'var(--bg-surface-2)',
                            checked ? 'var(--success-text)' : 'var(--text-muted)',
                          )}
                        >
                          {rule.field === 'night_lockdown' ? (
                            <LockOutlined />
                          ) : rule.field === 'anti_dropper_shield' ? (
                            <PhoneOutlined />
                          ) : (
                            <UserOutlined />
                          )}
                        </span>
                        <div>
                          <div
                            className="text-primary"
                            style={{ fontSize: 13, fontWeight: 700 }}
                          >
                            {rule.title}
                          </div>
                          <div className="text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                            {rule.hint}
                          </div>
                        </div>
                      </div>
                      <Switch
                        checked={checked}
                        disabled={savingField !== null}
                        loading={savingField === rule.field}
                        onChange={(value) => {
                          void handlePolicyToggle(rule.field, value);
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Правила защиты недоступны" height={140} />
            )}
          </div>
        </Col>

        {/* Deposit protection: everything derived from the real policy */}
        <Col xs={24} lg={10}>
          <div className="app-card" style={{ padding: 24, height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
              <span style={iconBadge('var(--warning-soft)', 'var(--warning-text)')}>
                <SafetyCertificateOutlined />
              </span>
              <div>
                <div className="section-title">Защита вклада</div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  Действующие параметры контроля
                </div>
              </div>
            </div>
            {renderDepositProtection()}
          </div>
        </Col>
      </Row>

      {/* Trusted recipients */}
      <div className="app-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <span style={iconBadge('var(--accent-soft)', 'var(--accent-text)')}>
            <UserOutlined />
          </span>
          <div>
            <div className="section-title">Доверенные получатели</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              Переводы на эти контакты проходят без дополнительных проверок
            </div>
          </div>
        </div>

        {policyLoading ? (
          <Skeleton active title={false} paragraph={{ rows: 2 }} />
        ) : trustedWhitelist.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {trustedWhitelist.map((contact, index) => (
              <span
                key={`${contact}-${index}`}
                className="app-panel"
                style={{
                  padding: '8px 14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--text-primary)',
                }}
              >
                <UserOutlined style={{ color: 'var(--success-text)' }} />
                {contact}
              </span>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Список пока пуст"
            text="Доверенные получатели появятся здесь, когда вы их добавите."
            height={140}
          />
        )}
      </div>
    </div>
  );
};
