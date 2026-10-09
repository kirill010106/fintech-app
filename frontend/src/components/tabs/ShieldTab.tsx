import { useCallback, useEffect, useState } from 'react';
import type { FC } from 'react';
import { App as AntdApp, Button, Col, Row } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  HistoryOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import type { CoSignRequest } from '../../types';
import { PROFILE_LABELS } from '../../types';
import { api, extractErrorMessage } from '../../api';
import { EmptyState, ErrorBlock, LoadingBlock } from '../ui/States';

interface Props {
  pendingRequests: CoSignRequest[];
  onRefresh: () => void;
  /** True when the signed-in person may approve operations. */
  canSupervise?: boolean;
}

export const ShieldTab: FC<Props> = ({
  pendingRequests = [],
  onRefresh,
  canSupervise = false,
}) => {
  const { message } = AntdApp.useApp();
  const [history, setHistory] = useState<CoSignRequest[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [decidingId, setDecidingId] = useState<number | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const isParent = canSupervise;

  const loadHistory = useCallback(async () => {
    try {
      const hist = await api.getGuardianHistory();
      setHistory(Array.isArray(hist) ? hist : []);
      setHistoryError(null);
    } catch (e) {
      setHistoryError(extractErrorMessage(e, 'Не удалось загрузить историю решений'));
    } finally {
      setHistoryLoaded(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getGuardianHistory()
      .then((hist) => {
        if (cancelled) return;
        setHistory(Array.isArray(hist) ? hist : []);
        setHistoryError(null);
        setHistoryLoaded(true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setHistoryError(extractErrorMessage(e, 'Не удалось загрузить историю решений'));
        setHistoryLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [pendingRequests.length]);

  const handleDecision = async (requestId: number, action: 'approve' | 'reject') => {
    setDecidingId(requestId);
    try {
      await api.decideRequest(requestId, action);
      if (action === 'approve') {
        message.success('Перевод подтверждён и исполнен');
      } else {
        message.warning('Перевод отклонён. Средства остались на счёте.');
      }
      await loadHistory();
      onRefresh();
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось обработать запрос'));
    } finally {
      setDecidingId(null);
    }
  };

  const rejected = history.filter((h) => h.status === 'rejected');
  const preventedAmount = rejected.reduce((acc, h) => acc + h.amount, 0);

  return (
    <div className="page">
      {/* Metrics */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <div className="app-card" style={{ padding: 20, height: '100%' }}>
            <div className="muted-label">Статус защиты</div>
            <div style={{ marginTop: 8 }}>
              <span className="status-tag status-tag-success">Включена</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              Получатель проверяется по базе рисков
            </div>
          </div>
        </Col>

        <Col xs={24} sm={8}>
          <div className="app-card" style={{ padding: 20, height: '100%' }}>
            <div className="muted-label">Отклонённые переводы</div>
            <div
              className="tnum"
              style={{
                fontSize: 22,
                fontWeight: 800,
                marginTop: 8,
                color: rejected.length > 0 ? 'var(--danger-text)' : 'var(--text-primary)',
              }}
            >
              {rejected.length}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {preventedAmount > 0
                ? `Сумма: ${preventedAmount.toLocaleString('ru-RU')} ₽`
                : 'Отклонённых переводов нет'}
            </div>
          </div>
        </Col>

        <Col xs={24} sm={8}>
          <div className="app-card" style={{ padding: 20, height: '100%' }}>
            <div className="muted-label">Запросы на подтверждение</div>
            <div
              className="tnum"
              style={{
                fontSize: 22,
                fontWeight: 800,
                marginTop: 8,
                color:
                  pendingRequests.length > 0 ? 'var(--warning-text)' : 'var(--text-primary)',
              }}
            >
              {pendingRequests.length}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
              {pendingRequests.length > 0
                ? 'Требует решения родственника'
                : 'Все операции подтверждены'}
            </div>
          </div>
        </Col>
      </Row>

      {/* Pending requests */}
      <div style={{ marginBottom: 28 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SafetyCertificateOutlined style={{ color: 'var(--warning-text)', fontSize: 18 }} />
            <span className="section-title">Запросы на подтверждение</span>
          </div>
          {pendingRequests.length > 0 && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--danger-text)',
                background: 'var(--danger-soft)',
                borderRadius: 999,
                padding: '3px 10px',
              }}
            >
              {pendingRequests.length}
            </span>
          )}
        </div>

        {pendingRequests.length === 0 ? (
          <EmptyState
            icon={<CheckCircleOutlined />}
            title="Все операции проверены"
            text="Сейчас нет переводов, требующих подтверждения. Если участник превысит лимит или отправит деньги незнакомому получателю, запрос появится здесь."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {pendingRequests.map((req) => (
              <div
                key={req.id}
                className="app-card app-card-hover"
                style={{ padding: 24, borderLeft: '3px solid var(--warning)' }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: 12,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
                          color: 'var(--warning-text)',
                          background: 'var(--warning-soft)',
                          borderRadius: 999,
                          padding: '3px 10px',
                        }}
                      >
                        Требует подтверждения
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        №{req.id} •{' '}
                        {new Date(req.created_at).toLocaleTimeString('ru-RU', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <div
                      style={{
                        fontSize: 17,
                        fontWeight: 800,
                        color: 'var(--text-primary)',
                        marginTop: 12,
                      }}
                    >
                      Запрос на перевод
                    </div>

                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6 }}>
                      Отправитель:{' '}
                      <span style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                        {req.user_name}
                      </span>{' '}
                      • {PROFILE_LABELS[req.user_role]}
                    </div>

                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                      Получатель:{' '}
                      <span style={{ color: 'var(--accent-text)', fontWeight: 700 }}>
                        {req.recipient}
                      </span>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div
                      className="tnum"
                      style={{ fontSize: 26, fontWeight: 800, color: 'var(--warning-text)' }}
                    >
                      {req.amount.toLocaleString('ru-RU')} ₽
                    </div>
                    <div
                      style={{ fontSize: 11, color: 'var(--danger-text)', fontWeight: 600, marginTop: 2 }}
                    >
                      Повышенный риск
                    </div>
                  </div>
                </div>

                {/* Why the transfer was held */}
                <div
                  className="app-panel"
                  style={{
                    margin: '16px 0',
                    padding: '12px 16px',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                    gap: 12,
                  }}
                >
                  <div>
                    <div className="muted-label">Причина проверки</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--danger-text)',
                        fontWeight: 600,
                        marginTop: 4,
                      }}
                    >
                      {req.risk_reason || 'Перевод нетипичному получателю'}
                    </div>
                  </div>
                  <div>
                    <div className="muted-label">Проверка операций</div>
                    <div
                      style={{
                        fontSize: 12,
                        color: 'var(--info-text)',
                        fontWeight: 600,
                        marginTop: 4,
                      }}
                    >
                      в реальном времени
                    </div>
                  </div>
                </div>

                {isParent ? (
                  <div
                    style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}
                  >
                    <Button
                      danger
                      icon={<CloseCircleOutlined />}
                      loading={decidingId === req.id}
                      onClick={() => handleDecision(req.id, 'reject')}
                      style={{ height: 40, fontWeight: 700 }}
                    >
                      Отклонить
                    </Button>
                    <Button
                      type="primary"
                      icon={<CheckCircleOutlined />}
                      loading={decidingId === req.id}
                      onClick={() => handleDecision(req.id, 'approve')}
                      style={{ height: 40, fontWeight: 700 }}
                    >
                      Подтвердить
                    </Button>
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                    Запрос ожидает решения родственника.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Decision history */}
      <div className="app-card" style={{ padding: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <HistoryOutlined style={{ color: 'var(--accent-text)', fontSize: 16 }} />
          <span className="section-title">История решений</span>
        </div>

        {historyError ? (
          <ErrorBlock text={historyError} onRetry={() => void loadHistory()} height={140} />
        ) : !historyLoaded ? (
          <LoadingBlock label="Загрузка истории" height={140} />
        ) : history.length === 0 ? (
          <EmptyState
            title="История решений пока пуста"
            text="Здесь появятся подтверждённые и отклонённые переводы."
            height={140}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {history.map((item) => {
              const isApproved = item.status === 'approved';
              return (
                <div
                  key={item.id}
                  className="app-panel"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    flexWrap: 'wrap',
                    padding: '12px 16px',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                      {item.user_name} получателю {item.recipient}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {new Date(item.created_at).toLocaleDateString('ru-RU')} • {item.risk_reason}
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div
                      className="tnum"
                      style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}
                    >
                      {item.amount.toLocaleString('ru-RU')} ₽
                    </div>
                    <span
                      style={{
                        display: 'inline-block',
                        marginTop: 2,
                        fontSize: 11,
                        fontWeight: 700,
                        borderRadius: 999,
                        padding: '2px 10px',
                        color: isApproved ? 'var(--success-text)' : 'var(--danger-text)',
                        background: isApproved ? 'var(--success-soft)' : 'var(--danger-soft)',
                      }}
                    >
                      {isApproved ? 'Одобрено' : 'Отклонено'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
