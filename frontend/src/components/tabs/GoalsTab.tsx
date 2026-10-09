import React, { useState, useEffect } from 'react';
import {
  App as AntdApp,
  Row,
  Col,
  Typography,
  Button,
  Progress,
  Input,
  InputNumber,
  Modal,
} from 'antd';
import { PlusOutlined, AimOutlined } from '@ant-design/icons';
import type { Goal, User } from '../../types';
import { api, extractErrorMessage } from '../../api';
import { EmptyState, ErrorBlock, LoadingBlock } from '../ui/States';

const { Text } = Typography;

interface Props {
  currentUser: User;
  onRefresh: () => void;
  /** True when the signed-in person may supervise other family members. */
  canSupervise?: boolean;
}

const formatRub = (value: number) => `${Math.round(value).toLocaleString('ru-RU')} ₽`;

/** Extra money the goal receives from the family sponsor on top of own deposits. */
const sponsorAddition = (goal: Goal) =>
  goal.boost_multiplier > 1 ? Math.round(goal.current_amount * (goal.boost_multiplier - 1)) : 0;

export const GoalsTab: React.FC<Props> = ({ currentUser, onRefresh, canSupervise = false }) => {
  const { message } = AntdApp.useApp();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isNewGoalModalOpen, setIsNewGoalModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newAmount, setNewAmount] = useState<number>(10000);
  const [loading, setLoading] = useState(false);
  const [toppingUpId, setToppingUpId] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const isSponsorView = canSupervise;

  const loadGoals = async () => {
    setStatus('loading');
    try {
      const g = await api.getGoals();
      setGoals(Array.isArray(g) ? g : []);
      setStatus('ready');
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  };

  // Reload whenever the signed-in user changes.
  useEffect(() => {
    let active = true;
    api
      .getGoals()
      .then((g) => {
        if (!active) return;
        setGoals(Array.isArray(g) ? g : []);
        setStatus('ready');
      })
      .catch((e) => {
        console.error(e);
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [currentUser.id]);

  const handleCreateGoal = async () => {
    if (!newTitle.trim()) {
      message.error('Введите название цели');
      return;
    }
    setLoading(true);
    try {
      await api.createGoal({ title: newTitle.trim(), target_amount: newAmount });
      message.success('Цель создана');
      setIsNewGoalModalOpen(false);
      setNewTitle('');
      await loadGoals();
      onRefresh();
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось создать цель'));
    } finally {
      setLoading(false);
    }
  };

  const handleTopUp = async (goalId: number, amount: number) => {
    setToppingUpId(goalId);
    try {
      await api.topUpGoal(goalId, amount);
      message.success(`Копилка пополнена на ${formatRub(amount)}`);
      await loadGoals();
      onRefresh();
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось пополнить копилку'));
    } finally {
      setToppingUpId(null);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="muted-label">Накопления</div>
          <div className="page-title" style={{ marginTop: 4 }}>
            {isSponsorView ? 'Цели семьи' : 'Мои цели'}
          </div>
          <div className="page-subtitle">
            {isSponsorView
              ? 'Доплата по цели участника зачисляется на ту же копилку.'
              : 'Родственник может дополнить вашу копилку.'}
          </div>
        </div>

        <Button type="primary" icon={<PlusOutlined />} onClick={() => setIsNewGoalModalOpen(true)}>
          Создать цель
        </Button>
      </div>

      {status === 'loading' ? (
        <div className="app-card">
          <LoadingBlock label="Загрузка целей" height={200} />
        </div>
      ) : status === 'error' ? (
        <div className="app-card">
          <ErrorBlock onRetry={loadGoals} height={200} />
        </div>
      ) : goals.length === 0 ? (
        <div className="app-card">
          <EmptyState
            title="Пока нет ни одной цели"
            text="Создайте цель и пополняйте её частями."
            height={200}
          />
        </div>
      ) : (
        <Row gutter={[20, 20]}>
          {goals.map((goal) => {
            const percent =
              goal.target_amount > 0
                ? Math.min(100, Math.round((goal.current_amount / goal.target_amount) * 100))
                : 0;
            const addition = sponsorAddition(goal);

            return (
              <Col xs={24} md={12} key={goal.id}>
                <div
                  className="app-card app-card-hover"
                  style={{
                    padding: 22,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 10,
                        marginBottom: 12,
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 17,
                            fontWeight: 700,
                            color: 'var(--text-primary)',
                            letterSpacing: '-0.01em',
                          }}
                        >
                          {goal.title}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          Цель: {formatRub(goal.target_amount)}
                        </div>
                      </div>
                      {addition > 0 && (
                        <span className="status-tag status-tag-accent" style={{ flex: '0 0 auto' }}>
                          Множитель ×{goal.boost_multiplier}
                        </span>
                      )}
                    </div>

                    <div style={{ margin: '16px 0' }}>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          fontSize: 13,
                          marginBottom: 6,
                        }}
                      >
                        <span className="text-secondary">Собрано</span>
                        <span className="tnum" style={{ color: 'var(--text-primary)', fontWeight: 700 }}>
                          {formatRub(goal.current_amount)} · {percent}%
                        </span>
                      </div>
                      <Progress
                        percent={percent}
                        strokeColor="var(--accent)"
                        trailColor="var(--border)"
                        showInfo={false}
                      />
                    </div>

                    <div
                      className="app-panel"
                      style={{ padding: 14, marginBottom: 16, fontSize: 12 }}
                    >
                      <div
                        style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}
                      >
                        <span className="text-muted">Внесено</span>
                        <span
                          className="tnum"
                          style={{ color: 'var(--text-primary)', fontWeight: 600 }}
                        >
                          {formatRub(goal.current_amount)}
                        </span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="text-muted">
                          {isSponsorView ? 'Дополнение по цели' : 'Дополнение родственника'}
                        </span>
                        <span className="tnum" style={{ color: 'var(--success-text)', fontWeight: 700 }}>
                          {addition > 0 ? `+${formatRub(addition)}` : 'нет'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                    <Button
                      type="primary"
                      block
                      loading={toppingUpId === goal.id}
                      onClick={() => handleTopUp(goal.id, 500)}
                    >
                      +500 ₽
                    </Button>
                    <Button
                      block
                      disabled={toppingUpId === goal.id}
                      onClick={() => handleTopUp(goal.id, 1000)}
                    >
                      +1 000 ₽
                    </Button>
                  </div>
                </div>
              </Col>
            );
          })}
        </Row>
      )}

      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <AimOutlined style={{ color: 'var(--accent-text)' }} />
            <span>Новая цель</span>
          </div>
        }
        open={isNewGoalModalOpen}
        onCancel={() => setIsNewGoalModalOpen(false)}
        footer={null}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
          <div>
            <Text style={{ color: 'var(--text-muted)', fontSize: 12 }}>Название цели</Text>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="Например: учебные курсы"
              style={{ marginTop: 4 }}
            />
          </div>

          <div>
            <Text style={{ color: 'var(--text-muted)', fontSize: 12 }}>Целевая сумма, ₽</Text>
            <InputNumber
              value={newAmount}
              min={1000}
              step={1000}
              onChange={(val) => setNewAmount(val || 1000)}
              style={{ width: '100%', marginTop: 4 }}
            />
          </div>

          <div style={{ marginTop: 10, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <Button onClick={() => setIsNewGoalModalOpen(false)}>Отмена</Button>
            <Button type="primary" loading={loading} onClick={handleCreateGoal}>
              Создать
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
