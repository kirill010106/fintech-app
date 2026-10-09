import React, { useState, useEffect } from 'react';
import {
  App as AntdApp,
  Row,
  Col,
  Typography,
  Button,
  Radio,
  Modal,
  Progress,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';
import type { Quest, User } from '../../types';
import { api, extractErrorMessage } from '../../api';
import { EmptyState, ErrorBlock, LoadingBlock } from '../ui/States';

const { Text, Paragraph } = Typography;

type QuestAnswerResult = Awaited<ReturnType<typeof api.answerQuest>>;

interface Props {
  currentUser: User;
  onRefresh: () => void;
}

export const QuestsTab: React.FC<Props> = ({ currentUser, onRefresh }) => {
  const { message } = AntdApp.useApp();
  const [quests, setQuests] = useState<Quest[]>([]);
  const [activeQuest, setActiveQuest] = useState<Quest | null>(null);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [answering, setAnswering] = useState(false);
  const [result, setResult] = useState<QuestAnswerResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  const loadQuests = async () => {
    try {
      const q = await api.getQuests();
      setQuests(Array.isArray(q) ? q : []);
      setStatus('ready');
    } catch (e) {
      console.error(e);
      setStatus('error');
    }
  };

  const reload = () => {
    setStatus('loading');
    void loadQuests();
  };

  // Reload whenever the signed-in user changes.
  useEffect(() => {
    let active = true;
    api
      .getQuests()
      .then((q) => {
        if (!active) return;
        setQuests(Array.isArray(q) ? q : []);
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

  const handleStartQuest = (q: Quest) => {
    setActiveQuest(q);
    setSelectedOption(null);
    setResult(null);
  };

  const handleSubmitAnswer = async () => {
    if (!activeQuest || selectedOption === null) {
      message.error('Выберите один из вариантов ответа');
      return;
    }
    setAnswering(true);
    try {
      const res = await api.answerQuest(activeQuest.id, selectedOption);
      setResult(res);
      if (!res.is_correct) {
        message.warning('Неверный ответ. Посмотрите объяснение ниже.');
      } else if (res.already_completed) {
        message.info('Этот квест уже пройден, награда за него начислена ранее.');
      } else {
        message.success(
          `Правильно! +${res.reward_rub} ₽ на карту и +${res.safety_score_reward} баллов.`,
        );
      }
      await loadQuests();
      onRefresh();
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось проверить ответ'));
    } finally {
      setAnswering(false);
    }
  };

  const completedCount = quests.filter((q) => q.is_completed).length;
  const progressPercent = quests.length > 0 ? Math.round((completedCount / quests.length) * 100) : 0;

  return (
    <div className="page">
      <div className="page-head">
        <div style={{ flex: '1 1 340px', minWidth: 0 }}>
          <div className="muted-label">Обучение</div>
          <h1 className="page-title">Финансовая грамотность</h1>
          <p className="page-subtitle">
            Короткие сценарии о том, как распознавать мошеннические схемы. За правильные ответы
            начисляются баллы и бонус на карту.
          </p>
        </div>

        <div style={{ flex: '0 0 auto', width: 160 }}>
          <div className="muted-label">Пройдено</div>
          <div
            className="tnum"
            style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', marginTop: 2 }}
          >
            {completedCount} / {quests.length}
          </div>
          <Progress
            percent={progressPercent}
            strokeColor="var(--success)"
            trailColor="var(--border)"
            showInfo={false}
            size="small"
          />
        </div>
      </div>

      {status === 'loading' ? (
        <LoadingBlock label="Загрузка заданий" height={240} />
      ) : status === 'error' ? (
        <ErrorBlock title="Не удалось загрузить задания" onRetry={reload} height={240} />
      ) : quests.length === 0 ? (
        <EmptyState
          title="Заданий пока нет"
          text="Как только появятся новые сценарии, они будут показаны здесь."
          height={240}
        />
      ) : (
        <Row gutter={[20, 20]}>
          {quests.map((q) => (
            <Col xs={24} md={12} key={q.id}>
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
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 12,
                  }}
                >
                  <span
                    className={`status-tag ${q.is_completed ? 'status-tag-success' : 'status-tag-accent'}`}
                  >
                    {q.category}
                  </span>
                  <span className="status-tag status-tag-neutral tnum">
                    +{q.reward_rub} ₽, +{q.safety_score_reward} баллов
                  </span>
                </div>

                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 700,
                    color: 'var(--text-primary)',
                    marginBottom: 8,
                    letterSpacing: '-0.01em',
                  }}
                >
                  {q.title}
                </div>

                <Paragraph style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
                  {q.description}
                </Paragraph>
              </div>

              <div>
                {q.is_completed ? (
                  <div
                    className="app-panel"
                    style={{
                      padding: '10px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 8,
                      background: 'var(--success-soft)',
                      borderColor: 'transparent',
                      color: 'var(--success-text)',
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    <CheckCircleOutlined />
                    Пройдено, награда зачислена
                  </div>
                ) : (
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    onClick={() => handleStartQuest(q)}
                    block
                  >
                    Пройти задание
                  </Button>
                )}
              </div>
            </div>
          </Col>
        ))}
        </Row>
      )}

      {activeQuest && (
        <Modal
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <QuestionCircleOutlined style={{ color: 'var(--accent-text)' }} />
              <span>{activeQuest.title}</span>
            </div>
          }
          open={!!activeQuest}
          onCancel={() => setActiveQuest(null)}
          footer={null}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
            <div
              className="app-panel"
              style={{
                padding: '14px 16px',
                background: 'var(--accent-soft)',
                borderColor: 'transparent',
                color: 'var(--text-secondary)',
                fontSize: 14,
                lineHeight: 1.5,
              }}
            >
              <div className="muted-label" style={{ marginBottom: 4 }}>
                Ситуация
              </div>
              {activeQuest.scenario}
            </div>

            <div>
              <Text
                style={{
                  color: 'var(--text-primary)',
                  fontWeight: 700,
                  fontSize: 14,
                  display: 'block',
                  marginBottom: 10,
                }}
              >
                Как правильно поступить в этой ситуации?
              </Text>
              <Radio.Group
                value={selectedOption}
                onChange={(e) => setSelectedOption(e.target.value)}
                style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
              >
                {activeQuest.options.map((opt, idx) => {
                  const isSelected = selectedOption === idx;
                  return (
                    <Radio
                      key={opt}
                      value={idx}
                      style={{
                        padding: '12px 14px',
                        margin: 0,
                        background: isSelected ? 'var(--accent-soft)' : 'var(--bg-subtle)',
                        border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        color: 'var(--text-primary)',
                        fontSize: 13,
                      }}
                    >
                      {opt}
                    </Radio>
                  );
                })}
              </Radio.Group>
            </div>

            {result && (
              <div
                className="app-panel"
                style={{
                  padding: 14,
                  background: result.is_correct ? 'var(--success-soft)' : 'var(--danger-soft)',
                  borderColor: result.is_correct ? 'var(--success)' : 'var(--danger)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontWeight: 700,
                    color: result.is_correct ? 'var(--success-text)' : 'var(--danger-text)',
                    marginBottom: 4,
                  }}
                >
                  {result.is_correct ? <CheckCircleOutlined /> : <CloseCircleOutlined />}
                  {result.is_correct ? 'Верный выбор' : 'Опасное решение'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                  {result.explanation}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
              <Button onClick={() => setActiveQuest(null)}>Закрыть</Button>
              {!result?.is_correct && (
                <Button type="primary" loading={answering} onClick={handleSubmitAnswer}>
                  Проверить ответ
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
