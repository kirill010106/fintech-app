import React, { useState } from 'react';
import {
  Alert,
  App as AntdApp,
  Button,
  Col,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Row,
  Segmented,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import {
  CheckOutlined,
  CopyOutlined,
  LockOutlined,
  MoonOutlined,
  PhoneOutlined,
  ReloadOutlined,
  SunOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAuth } from '../auth/AuthContext';
import { useThemeMode } from '../theme/ThemeContext';
import { api, extractErrorMessage } from '../api';
import { AUTHORITY_LABELS, PROFILE_LABELS } from '../types';

const { Text } = Typography;

export const ProfilePage: React.FC = () => {
  const { user, family, updateProfile, changePassword, refresh } = useAuth();
  const { mode, setMode } = useThemeMode();
  const { message } = AntdApp.useApp();

  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [rotatingCode, setRotatingCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  if (!user) return null;

  const activeCode = inviteCode ?? family?.invite_code ?? null;
  const canManageFamily = family?.is_owner === true;
  const isPendingMember = family?.membership_status === 'pending';

  const handleProfileSave = async (values: { name: string; phone: string }) => {
    setSavingProfile(true);
    try {
      await updateProfile(values.name.trim(), values.phone.trim());
      message.success('Данные сохранены');
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось сохранить данные'));
    } finally {
      setSavingProfile(false);
    }
  };

  const handlePasswordSave = async (values: {
    current_password: string;
    new_password: string;
    confirm: string;
  }) => {
    setSavingPassword(true);
    try {
      await changePassword(values.current_password, values.new_password);
      passwordForm.resetFields();
      message.success('Пароль изменён');
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось изменить пароль'));
    } finally {
      setSavingPassword(false);
    }
  };

  const handleCopy = async () => {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      message.success('Код скопирован');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      message.warning('Не удалось скопировать. Выделите код вручную');
    }
  };

  const handleRotate = async () => {
    setRotatingCode(true);
    try {
      const result = await api.regenerateFamilyInvite();
      setInviteCode(result.invite_code);
      await refresh();
      message.success('Выдан новый код. Старый больше не действует.');
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось обновить код'));
    } finally {
      setRotatingCode(false);
    }
  };

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length < 6) return;

    setJoining(true);
    try {
      await api.joinFamily(code);
      await refresh();
      setJoinCode('');
      message.success('Заявка отправлена. Владелец семьи должен её подтвердить.');
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось отправить заявку'));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="muted-label">Аккаунт</div>
          <h1 className="page-title">Профиль и настройки</h1>
          <p className="page-subtitle">Личные данные, пароль и семейная группа</p>
        </div>
      </div>

      <Row gutter={[20, 20]}>
        <Col xs={24} lg={14}>
          {/* Personal data */}
          <div className="app-card" style={{ padding: 24, marginBottom: 20 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 20,
              }}
            >
              <div>
                <div className="section-title">Личные данные</div>
                <div className="page-subtitle">Видны вам и членам вашей семьи</div>
              </div>
              <div className="tag-row" style={{ marginTop: 0 }}>
                <span className="status-tag status-tag-neutral">
                  {AUTHORITY_LABELS[family?.authority ?? 'member']}
                </span>
                <span className="status-tag status-tag-neutral">
                  {PROFILE_LABELS[family?.role ?? user.role]}
                </span>
              </div>
            </div>

            <Form
              form={profileForm}
              layout="vertical"
              requiredMark={false}
              initialValues={{ name: user.name, phone: user.phone }}
              onFinish={handleProfileSave}
            >
              <Form.Item
                name="name"
                label="Имя и фамилия"
                rules={[{ required: true, message: 'Укажите имя' }]}
              >
                <Input prefix={<UserOutlined className="text-muted" />} />
              </Form.Item>

              <Form.Item label="Электронная почта">
                <Input value={user.email} disabled />
              </Form.Item>

              <Form.Item
                name="phone"
                label="Телефон"
                rules={[{ required: true, message: 'Укажите телефон' }]}
              >
                <Input prefix={<PhoneOutlined className="text-muted" />} />
              </Form.Item>

              <Button type="primary" htmlType="submit" loading={savingProfile}>
                Сохранить
              </Button>
            </Form>
          </div>

          {/* Password */}
          <div className="app-card" style={{ padding: 24 }}>
            <div className="section-title" style={{ marginBottom: 4 }}>
              Смена пароля
            </div>
            <div className="page-subtitle" style={{ marginBottom: 20 }}>
              После смены пароля текущая сессия останется активной
            </div>

            <Form
              form={passwordForm}
              layout="vertical"
              requiredMark={false}
              onFinish={handlePasswordSave}
            >
              <Form.Item
                name="current_password"
                label="Текущий пароль"
                rules={[{ required: true, message: 'Введите текущий пароль' }]}
              >
                <Input.Password
                  prefix={<LockOutlined className="text-muted" />}
                  autoComplete="current-password"
                />
              </Form.Item>

              <Form.Item
                name="new_password"
                label="Новый пароль"
                rules={[
                  { required: true, message: 'Придумайте пароль' },
                  { min: 8, message: 'Минимум 8 символов' },
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined className="text-muted" />}
                  autoComplete="new-password"
                />
              </Form.Item>

              <Form.Item
                name="confirm"
                label="Повторите новый пароль"
                dependencies={['new_password']}
                rules={[
                  { required: true, message: 'Повторите пароль' },
                  ({ getFieldValue }) => ({
                    validator(_, value) {
                      if (!value || getFieldValue('new_password') === value) return Promise.resolve();
                      return Promise.reject(new Error('Пароли не совпадают'));
                    },
                  }),
                ]}
              >
                <Input.Password
                  prefix={<LockOutlined className="text-muted" />}
                  autoComplete="new-password"
                />
              </Form.Item>

              <Button type="primary" htmlType="submit" loading={savingPassword}>
                Изменить пароль
              </Button>
            </Form>
          </div>
        </Col>

        <Col xs={24} lg={10}>
          {/* Family */}
          <div className="app-card" style={{ padding: 24, marginBottom: 20 }}>
            <div className="section-title" style={{ marginBottom: 4 }}>
              {canManageFamily ? 'Ваша семейная группа' : 'Семейная группа'}
            </div>
            <div className="page-subtitle" style={{ marginBottom: 18 }}>
              {canManageFamily
                ? 'Код приглашения подключает родственника к вашему счёту. Заявка появится в разделе Семья.'
                : 'Введите код владельца семьи, чтобы отправить заявку на вступление.'}
            </div>

            <Descriptions column={1} size="small" colon={false} style={{ marginBottom: 16 }}>
              <Descriptions.Item label={<Text type="secondary">Название</Text>}>
                {family?.name || 'не выбрана'}
              </Descriptions.Item>
              <Descriptions.Item label={<Text type="secondary">Статус</Text>}>
                {isPendingMember ? 'ожидает подтверждения владельца' : 'активна'}
              </Descriptions.Item>
            </Descriptions>

            {activeCode ? (
              <>
                <div className="muted-label" style={{ marginBottom: 8 }}>
                  Код приглашения
                </div>
                <div
                  className="app-panel"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '12px 16px',
                    marginBottom: 14,
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      letterSpacing: 5,
                      color: 'var(--text-primary)',
                    }}
                  >
                    {activeCode}
                  </span>
                  <Space>
                    <Tooltip title="Скопировать">
                      <Button
                        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
                        onClick={handleCopy}
                      />
                    </Tooltip>
                    {canManageFamily && (
                      <Popconfirm
                        title="Выдать новый код?"
                        description="Старый код перестанет работать."
                        okText="Выдать"
                        cancelText="Отмена"
                        onConfirm={handleRotate}
                      >
                        <Tooltip title="Обновить код">
                          <Button icon={<ReloadOutlined />} loading={rotatingCode} />
                        </Tooltip>
                      </Popconfirm>
                    )}
                  </Space>
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  Родственник вводит этот код при регистрации, после чего вы подтверждаете заявку.
                </Text>
              </>
            ) : (
              <Alert type="info" showIcon message="Вы пока не состоите в семейной группе" />
            )}

            {!canManageFamily && !isPendingMember && (
              <div className="divider-top" style={{ marginTop: 20, paddingTop: 20 }}>
                <div className="section-title" style={{ fontSize: 14, marginBottom: 4 }}>
                  Присоединиться к другой семье
                </div>
                <div className="page-subtitle" style={{ marginBottom: 12 }}>
                  Введите код владельца семьи. Заявку подтверждает владелец.
                </div>
                <Space.Compact style={{ width: '100%' }}>
                  <Input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="AB12CD"
                    maxLength={6}
                    className="mono"
                    style={{ letterSpacing: 2, textTransform: 'uppercase' }}
                    onPressEnter={handleJoin}
                  />
                  <Button
                    type="primary"
                    onClick={handleJoin}
                    loading={joining}
                    disabled={joinCode.length < 6}
                  >
                    Присоединиться
                  </Button>
                </Space.Compact>
              </div>
            )}
          </div>

          {/* Appearance */}
          <div className="app-card" style={{ padding: 24 }}>
            <div className="section-title" style={{ marginBottom: 4 }}>
              Оформление
            </div>
            <div className="page-subtitle" style={{ marginBottom: 16 }}>
              Выберите удобную тему интерфейса
            </div>
            <Segmented
              block
              value={mode}
              onChange={(value) => setMode(value as 'dark' | 'light')}
              options={[
                { label: 'Тёмная', value: 'dark', icon: <MoonOutlined /> },
                { label: 'Светлая', value: 'light', icon: <SunOutlined /> },
              ]}
            />
          </div>
        </Col>
      </Row>
    </div>
  );
};

export default ProfilePage;
