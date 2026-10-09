import React from 'react';
import { Button, Typography } from 'antd';
import { ClockCircleOutlined } from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';

const { Title, Text } = Typography;

/**
 * Shown to somebody whose join request has not been confirmed yet. Until the
 * owner approves, the family's data is not theirs to see — so the app explains
 * the wait instead of showing an empty dashboard.
 */
export const PendingPage: React.FC = () => {
  const { family, user, logout, refresh } = useAuth();
  const [checking, setChecking] = React.useState(false);

  const checkAgain = async () => {
    setChecking(true);
    try {
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
      }}
    >
      <div className="app-card" style={{ maxWidth: 460, padding: 28, width: '100%' }}>
        <div className="state-block" style={{ padding: '8px 0 20px' }}>
          <span className="state-icon" aria-hidden="true">
            <ClockCircleOutlined />
          </span>
          <Title level={4} style={{ margin: 0 }}>
            Заявка отправлена
          </Title>
          <Text type="secondary" style={{ textAlign: 'center' }}>
            Владелец семьи{family?.name ? ` ${family.name}` : ''} должен подтвердить ваше
            участие. После этого откроется доступ к счетам и настройкам.
          </Text>
        </div>

        <div className="app-panel" style={{ padding: 14, marginBottom: 18 }}>
          <div className="muted-label">Ваш аккаунт</div>
          <div style={{ fontWeight: 600, marginTop: 4 }}>{user?.name}</div>
          <div className="text-muted" style={{ fontSize: 13 }}>
            {user?.email}
          </div>
        </div>

        <Button type="primary" block loading={checking} onClick={checkAgain}>
          Проверить статус
        </Button>
        <Button type="text" block style={{ marginTop: 8 }} onClick={logout}>
          Выйти
        </Button>
      </div>
    </div>
  );
};

export default PendingPage;
