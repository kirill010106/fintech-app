import { useState } from 'react';
import type { FC } from 'react';
import { App as AntdApp, Button, Col, Input, Row, Slider, Switch } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import type { FamilyDashboardData, SafetyPolicy, User } from '../../types';
import { AUTHORITY_LABELS, PROFILE_LABELS } from '../../types';
import { api, extractErrorMessage } from '../../api';
import { EmptyState, LoadingBlock } from '../ui/States';

interface Props {
  currentUser: User;
  dashboardData: FamilyDashboardData | null;
  onRefresh: () => void;
  /** True when the signed-in person may change another member's rules. */
  canSupervise?: boolean;
}

export const TrustLimitsTab: FC<Props> = ({
  currentUser,
  dashboardData,
  onRefresh,
  canSupervise = false,
}) => {
  const { message } = AntdApp.useApp();

  const members = dashboardData?.members ?? [];
  const ownMember = members.find((m) => m.member.user_id === currentUser.id);

  /**
   * A guardian edits a member under supervision (teen or senior). When there is
   * nobody to supervise, they edit their own rules.
   */
  const supervised = members.filter((m) => m.member.user_id !== currentUser.id);
  const target = canSupervise
    ? (supervised.find((m) => m.member.role === 'teen') ??
      supervised.find((m) => m.member.role === 'senior') ??
      ownMember)
    : ownMember;

  const policy = target?.safety_policy;
  const targetUserId = target?.member.user_id;

  const [maxTransfer, setMaxTransfer] = useState<number>(policy?.max_instant_transfer ?? 1000);
  const [gamingLimit, setGamingLimit] = useState<number>(policy?.gaming_limit_month ?? 1500);
  const [nightLockdown, setNightLockdown] = useState<boolean>(policy?.night_lockdown ?? true);
  const [fraudShield, setFraudShield] = useState<boolean>(policy?.anti_dropper_shield ?? true);
  const [trustedWhitelist, setTrustedWhitelist] = useState<string[]>(
    policy?.trusted_whitelist ?? [],
  );
  const [newContactInput, setNewContactInput] = useState('');
  const [saving, setSaving] = useState(false);

  /**
   * Re-seed the form when the member or their stored policy changes (React's
   * "adjust state during render" pattern) so no stale values are ever shown.
   */
  const [syncedFrom, setSyncedFrom] = useState<{
    userId: number | undefined;
    policy: SafetyPolicy | undefined;
  }>({ userId: targetUserId, policy });

  if (syncedFrom.userId !== targetUserId || syncedFrom.policy !== policy) {
    setSyncedFrom({ userId: targetUserId, policy });
    setMaxTransfer(policy?.max_instant_transfer ?? 1000);
    setGamingLimit(policy?.gaming_limit_month ?? 1500);
    setNightLockdown(policy?.night_lockdown ?? true);
    setFraudShield(policy?.anti_dropper_shield ?? true);
    setTrustedWhitelist(policy?.trusted_whitelist ?? []);
  }

  const handleAddContact = () => {
    const val = newContactInput.trim();
    if (!val) return;
    if (trustedWhitelist.includes(val)) {
      message.info('Этот получатель уже в списке');
      return;
    }
    setTrustedWhitelist([...trustedWhitelist, val]);
    setNewContactInput('');
  };

  const handleRemoveContact = (contact: string) => {
    setTrustedWhitelist(trustedWhitelist.filter((c) => c !== contact));
  };

  const handleSavePolicy = async () => {
    if (!target) return;
    setSaving(true);
    try {
      await api.updatePolicy(target.member.user_id, {
        max_instant_transfer: maxTransfer,
        gaming_limit_month: gamingLimit,
        night_lockdown: nightLockdown,
        anti_dropper_shield: fraudShield,
        trusted_whitelist: trustedWhitelist,
      });
      message.success('Правила и лимиты сохранены');
      onRefresh();
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось обновить правила'));
    } finally {
      setSaving(false);
    }
  };

  if (!target) {
    return (
      <div className="page">
        {dashboardData ? (
          <EmptyState
            title="Правила недоступны"
            text="В этой семье пока нет участника, чьи лимиты можно настроить."
            action={
              <Button style={{ marginTop: 12 }} onClick={onRefresh}>
                Обновить
              </Button>
            }
            height={220}
          />
        ) : (
          <LoadingBlock label="Загрузка правил" height={220} />
        )}
      </div>
    );
  }

  const targetMember = target.member;
  const targetName = targetMember.user?.name ?? targetMember.nickname ?? 'участник';
  const isSelf = targetMember.user_id === currentUser.id;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="muted-label">{isSelf ? 'Мои правила' : 'Правила участника'}</div>
          <h1 className="page-title">{isSelf ? 'Лимиты и защита' : `Лимиты: ${targetName}`}</h1>
          <p className="page-subtitle">
            {isSelf
              ? 'Эти правила применяются к вашим операциям. Проверьте их перед сохранением.'
              : 'Переводы сверх лимита и переводы незнакомым получателям потребуют вашего подтверждения.'}
          </p>
          <div className="tag-row">
            <span className="status-tag status-tag-neutral">
              {AUTHORITY_LABELS[targetMember.authority]}
            </span>
            <span className="status-tag status-tag-neutral">
              {PROFILE_LABELS[targetMember.role]}
            </span>
          </div>
        </div>

        <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSavePolicy}>
          Сохранить правила
        </Button>
      </div>

      <Row gutter={[20, 20]}>
        {/* Limits */}
        <Col xs={24} md={12}>
          <div className="app-card" style={{ padding: 24, height: '100%' }}>
            <div className="section-title" style={{ marginBottom: 16 }}>
              Лимиты по суммам
            </div>

            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 12,
                  marginBottom: 4,
                }}
              >
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
                  Перевод без подтверждения до:
                </span>
                <span
                  className="tnum"
                  style={{ color: 'var(--accent-text)', fontWeight: 800, fontSize: 15 }}
                >
                  {maxTransfer.toLocaleString('ru-RU')} ₽
                </span>
              </div>
              <Slider
                min={500}
                max={5000}
                step={500}
                value={maxTransfer}
                onChange={setMaxTransfer}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Любой перевод свыше {maxTransfer.toLocaleString('ru-RU')} ₽ потребует подтверждения
                родственника в приложении.
              </span>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 12,
                  marginBottom: 4,
                }}
              >
                <span style={{ color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>
                  Лимит на игры и подписки в месяц:
                </span>
                <span
                  className="tnum"
                  style={{ color: 'var(--info-text)', fontWeight: 800, fontSize: 15 }}
                >
                  {gamingLimit.toLocaleString('ru-RU')} ₽
                </span>
              </div>
              <Slider
                min={500}
                max={5000}
                step={500}
                value={gamingLimit}
                onChange={setGamingLimit}
              />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Ограничение импульсивных игровых покупок и подписок.
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
              <div
                className="app-panel"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Запрет переводов ночью (23:00 до 07:00)
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Исходящие переводы в ночное время недоступны
                  </div>
                </div>
                <Switch checked={nightLockdown} onChange={setNightLockdown} />
              </div>

              <div
                className="app-panel"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                    Защита от переводов мошенникам
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Получатель проверяется по базе рисков перед отправкой
                  </div>
                </div>
                <Switch checked={fraudShield} onChange={setFraudShield} />
              </div>
            </div>
          </div>
        </Col>

        {/* Trusted recipients */}
        <Col xs={24} md={12}>
          <div className="app-card" style={{ padding: 24, height: '100%' }}>
            <div className="section-title">Доверенные получатели</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, marginBottom: 16 }}>
              Переводы этим получателям проходят без дополнительного подтверждения
            </div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <Input
                placeholder="Имя или номер телефона"
                value={newContactInput}
                onChange={(e) => setNewContactInput(e.target.value)}
                onPressEnter={handleAddContact}
                style={{ flex: '1 1 200px' }}
              />
              <Button type="primary" icon={<PlusOutlined />} onClick={handleAddContact}>
                Добавить
              </Button>
            </div>

            {trustedWhitelist.length === 0 ? (
              <EmptyState
                title="Список пока пуст"
                text="Добавьте номер или имя получателя, которому вы доверяете."
                height={140}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {trustedWhitelist.map((contact) => (
                  <div
                    key={contact}
                    className="app-panel"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 14px',
                    }}
                  >
                    <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
                      {contact}
                    </span>
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      aria-label={`Удалить получателя ${contact}`}
                      onClick={() => handleRemoveContact(contact)}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </Col>
      </Row>
    </div>
  );
};
