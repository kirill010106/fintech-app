import React, { useState } from 'react';
import {
  Row,
  Col,
  Button,
  Tag,
  Input,
  InputNumber,
  Modal,
  Alert,
  App as AntdApp,
} from 'antd';
import { SendOutlined } from '@ant-design/icons';
import type { FamilyDashboardData, User, Account } from '../../types';
import { api, extractErrorMessage } from '../../api';
import { InteractiveBankCard } from '../ui/InteractiveBankCard';
import { CategoryDonutChart } from '../ui/CategoryDonutChart';
import { MerchantIcon } from '../ui/MerchantIcon';
import { EmptyState, LoadingBlock } from '../ui/States';

type Tone = 'accent' | 'success' | 'warning' | 'danger';

/** Status tag styled from the theme contract; readable in both colour modes. */
const statusTagStyle = (tone: Tone): React.CSSProperties => ({
  margin: 0,
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  color: `var(--${tone}-text)`,
  background: `var(--${tone}-soft)`,
  borderColor: `var(--${tone})`,
});

interface Props {
  currentUser: User;
  accounts: Account[];
  dashboardData: FamilyDashboardData | null;
  onRefresh: () => void;
  onNavigateToTab: (tabKey: string) => void;
  /** True when the signed-in person may supervise other family members. */
  canSupervise?: boolean;
}

export const OverviewTab: React.FC<Props> = ({
  currentUser,
  accounts,
  dashboardData,
  onRefresh,
  onNavigateToTab,
  canSupervise = false,
}) => {
  const { message } = AntdApp.useApp();

  const members = dashboardData?.members || [];
  const transactions = dashboardData?.recent_transactions || [];
  const categoryExpenses = dashboardData?.category_expenses || [];
  const totalNetWorth = dashboardData?.total_family_net_worth || 0;
  const pendingRequestsCount = dashboardData?.pending_requests_count || 0;
  const familyName = dashboardData?.family?.name;
  const isFamilyOwner = dashboardData?.caller.authority === 'owner';

  // Selected member card to preview
  const [selectedMemberIndex, setSelectedMemberIndex] = useState<number>(0);
  const activeMember = members[selectedMemberIndex] || members[0];
  const activeMemberAccount = activeMember?.accounts?.[0] || accounts[0];
  const activeMemberRole = activeMember?.member.role || currentUser.role;
  const instantTransferLimit = activeMember?.safety_policy?.max_instant_transfer;
  const canSwitchMember = canSupervise && members.length > 1;

  // Quick transfer modal
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [recipientPhone, setRecipientPhone] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [transferAmount, setTransferAmount] = useState<number | null>(null);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferWarning, setTransferWarning] = useState<string | null>(null);

  const closeTransferModal = () => {
    setIsTransferModalOpen(false);
    setTransferWarning(null);
  };

  const handleSendTransfer = async () => {
    if (!accounts[0]) {
      message.error('Счёт списания не найден');
      return;
    }
    if (!recipientPhone.trim() || !recipientName.trim()) {
      message.error('Укажите имя и номер телефона получателя');
      return;
    }
    if (!transferAmount || transferAmount <= 0) {
      message.error('Укажите сумму перевода');
      return;
    }

    setTransferLoading(true);
    setTransferWarning(null);
    try {
      const res = await api.transfer({
        account_id: accounts[0].id,
        recipient_phone: recipientPhone.trim(),
        recipient_name: recipientName.trim(),
        amount: transferAmount,
        description: 'Перевод',
      });

      if (res.requires_co_sign) {
        setTransferWarning(res.warning_message || 'Перевод требует подтверждения члена семьи.');
        message.warning('Перевод отправлен на подтверждение члену семьи');
        onRefresh();
      } else {
        message.success('Перевод выполнен');
        closeTransferModal();
        onRefresh();
      }
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось выполнить перевод'));
    } finally {
      setTransferLoading(false);
    }
  };

  if (!dashboardData) {
    return (
      <div className="page">
        <LoadingBlock label="Загрузка кабинета" height={280} />
      </div>
    );
  }

  return (
    <div className="page">
      {/* Family summary and the two actions that matter from here. */}
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="muted-label">{isFamilyOwner ? 'Капитал семьи' : 'Капитал'}</div>
          <h1 className="page-title tnum" style={{ fontSize: 28, marginTop: 4 }}>
            {totalNetWorth.toLocaleString('ru-RU')} ₽
          </h1>
          <div className="tag-row">
            <span className="status-tag status-tag-success">Под защитой</span>
            <span className="status-tag status-tag-neutral">Участников: {members.length}</span>
            {pendingRequestsCount > 0 ? (
              <span className="status-tag status-tag-warning">
                Ждут подтверждения: {pendingRequestsCount}
              </span>
            ) : null}
          </div>
          <p className="page-subtitle">
            {familyName
              ? `${familyName}: суммарный остаток по счетам семьи`
              : 'Суммарный остаток по счетам семьи'}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            type="primary"
            icon={<SendOutlined />}
            onClick={() => {
              setTransferWarning(null);
              setIsTransferModalOpen(true);
            }}
          >
            Перевести
          </Button>
          <Button onClick={() => onNavigateToTab('shield')}>Запросы на подтверждение</Button>
        </div>
      </div>

      {/* Main grid: family cards & spending analytics */}
      <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={10}>
          <div className="app-card" style={{ padding: 24, height: '100%' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginBottom: 18,
              }}
            >
              <div className="section-title">{canSupervise ? 'Карты семьи' : 'Моя карта'}</div>
            </div>

            <div style={{ marginBottom: canSwitchMember ? 20 : 0 }}>
              <InteractiveBankCard
                role={activeMemberRole}
                balance={activeMember?.total_balance || accounts[0]?.balance || 0}
                cardNumber={activeMemberAccount?.card_number}
                cardType={activeMemberAccount?.card_type}
                holderName={activeMember?.member.user?.name || currentUser.name}
              />
            </div>

            {/* Only someone who supervises the family needs to switch cards. */}
            {canSwitchMember ? (
              <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 }}>
                {members.map((m, idx) => {
                  const isSelected = idx === selectedMemberIndex;
                  return (
                    <button
                      key={m.member.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedMemberIndex(idx)}
                      className={isSelected ? 'app-panel' : 'app-panel app-panel-hover'}
                      style={{
                        flex: 1,
                        minWidth: 100,
                        padding: '10px 12px',
                        background: isSelected ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                        borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                        color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)',
                        cursor: 'pointer',
                        textAlign: 'left',
                        font: 'inherit',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 700,
                          color: isSelected ? 'var(--accent-text)' : 'var(--text-secondary)',
                        }}
                      >
                        {m.member.nickname || m.member.user?.name.split(' ')[0] || 'Участник'}
                      </div>
                      <div className="tnum" style={{ fontSize: 11, marginTop: 2 }}>
                        {m.total_balance.toLocaleString('ru-RU')} ₽
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </Col>

        <Col xs={24} lg={14}>
          <div className="app-card" style={{ padding: 24, height: '100%' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 8,
                marginBottom: 16,
              }}
            >
              <div>
                <div className="section-title">Структура расходов</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  Расходы семьи за текущий месяц
                </div>
              </div>
              <Tag style={statusTagStyle('accent')}>За месяц</Tag>
            </div>

            <Row gutter={[16, 16]} align="middle">
              <Col xs={24} md={12}>
                <CategoryDonutChart expenses={categoryExpenses} />
              </Col>
              <Col xs={24} md={12}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {categoryExpenses.length === 0 ? (
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Расходов за текущий месяц пока нет
                    </div>
                  ) : (
                    categoryExpenses.slice(0, 5).map((cat) => (
                      <div
                        key={cat.category}
                        className="app-panel"
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 12px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <MerchantIcon category={cat.category} mcc={cat.mcc} size={22} />
                          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontWeight: 500 }}>
                            {cat.category}
                          </span>
                        </div>
                        <span className="tnum" style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {cat.total.toLocaleString('ru-RU')} ₽
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </Col>
            </Row>
          </div>
        </Col>
      </Row>

      {/* Recent transactions */}
      <div className="app-card" style={{ padding: 24 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 16,
          }}
        >
          <div>
            <div className="section-title">История операций</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              Последние операции по счетам семьи
            </div>
          </div>
          <Button type="link" onClick={() => onNavigateToTab('shield')} style={{ padding: 0 }}>
            Запросы на подтверждение
          </Button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {transactions.length === 0 ? (
            <EmptyState
              title="Операций пока нет"
              text="Как только по счетам семьи пройдут переводы, они появятся здесь."
              height={140}
            />
          ) : (
            transactions.slice(0, 6).map((tx) => {
              const needsReview = tx.risk_level === 'high' || tx.risk_level === 'critical';
              return (
                <div
                  key={tx.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-sm)',
                    background: needsReview ? 'var(--danger-soft)' : 'var(--bg-subtle)',
                    border: `1px solid ${needsReview ? 'var(--danger)' : 'var(--border)'}`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <MerchantIcon
                      category={tx.category}
                      description={tx.description}
                      mcc={tx.mcc}
                      size={32}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {tx.description || tx.recipient_name || 'Перевод'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {new Date(tx.created_at).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        • {tx.category}
                        {tx.recipient_phone ? ` • ${tx.recipient_phone}` : ''}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div className="tnum" style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>
                      -{tx.amount.toLocaleString('ru-RU')} ₽
                    </div>
                    <div style={{ marginTop: 4 }}>
                      {tx.status === 'pending_approval' ? (
                        <Tag style={statusTagStyle('warning')}>Требует подтверждения</Tag>
                      ) : tx.status === 'blocked' ? (
                        <Tag style={statusTagStyle('danger')}>Заблокирован</Tag>
                      ) : tx.status === 'rejected' ? (
                        <Tag style={statusTagStyle('danger')}>Отклонён</Tag>
                      ) : (
                        <Tag style={statusTagStyle('success')}>Исполнено</Tag>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Transfer modal */}
      <Modal
        title={<span style={{ fontWeight: 700 }}>Перевод</span>}
        open={isTransferModalOpen}
        onCancel={closeTransferModal}
        footer={null}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
          {transferWarning && (
            <Alert
              type="warning"
              showIcon
              message="Операция приостановлена"
              description={transferWarning}
            />
          )}

          <div>
            <div className="muted-label" style={{ marginBottom: 6 }}>
              Номер телефона получателя
            </div>
            <Input
              value={recipientPhone}
              onChange={(e) => setRecipientPhone(e.target.value)}
              placeholder="+7 (999) 000-00-00"
            />
          </div>

          <div>
            <div className="muted-label" style={{ marginBottom: 6 }}>
              Имя получателя
            </div>
            <Input
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Получатель"
            />
          </div>

          <div>
            <div className="muted-label" style={{ marginBottom: 6 }}>
              Сумма перевода (₽)
            </div>
            <InputNumber
              value={transferAmount}
              onChange={(val) => setTransferAmount(val ?? null)}
              style={{ width: '100%' }}
              min={1}
            />
            {instantTransferLimit !== undefined && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, display: 'block' }}>
                Лимит перевода без подтверждения: {instantTransferLimit.toLocaleString('ru-RU')} ₽. Свыше
                лимита потребуется подтверждение члена семьи.
              </span>
            )}
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button onClick={closeTransferModal}>Отмена</Button>
            <Button type="primary" loading={transferLoading} onClick={handleSendTransfer}>
              Перевести
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
