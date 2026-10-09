import React, { useState } from 'react';
import { Alert, Button, DatePicker, Divider, Form, Input, Typography } from 'antd';
import {
  BankOutlined,
  LockOutlined,
  MailOutlined,
  PhoneOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { Dayjs } from 'dayjs';
import { useAuth } from '../auth/AuthContext';
import { extractErrorMessage } from '../api';

const { Text, Title } = Typography;

type Mode = 'login' | 'register';

interface RegisterFormValues {
  name: string;
  email: string;
  phone: string;
  password: string;
  confirm: string;
  birth_date: Dayjs;
  family_name?: string;
  invite_code?: string;
}

/** Read once at module load so rendering stays free of side effects. */
const COPYRIGHT_YEAR = new Date().getFullYear();

/** Nobody younger than this may hold an account. Mirrors the server rule. */
const MIN_AGE = 14;

const LoginForm: React.FC<{ onSwitch: () => void }> = ({ onSwitch }) => {
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: { email: string; password: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      await login(values.email.trim().toLowerCase(), values.password);
    } catch (e) {
      setError(extractErrorMessage(e, 'Не удалось войти. Проверьте почту и пароль.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
      <Title level={3} style={{ marginBottom: 4 }}>
        Вход
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Почта и пароль, указанные при регистрации
      </Text>

      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <Form.Item
        name="email"
        label="Электронная почта"
        rules={[
          { required: true, message: 'Укажите почту' },
          { type: 'email', message: 'Похоже, это не почта' },
        ]}
      >
        <Input
          prefix={<MailOutlined className="text-muted" />}
          placeholder="name@example.com"
          autoComplete="email"
        />
      </Form.Item>

      <Form.Item
        name="password"
        label="Пароль"
        rules={[{ required: true, message: 'Введите пароль' }]}
      >
        <Input.Password
          prefix={<LockOutlined className="text-muted" />}
          placeholder="Ваш пароль"
          autoComplete="current-password"
        />
      </Form.Item>

      <Button type="primary" htmlType="submit" block loading={submitting} style={{ marginTop: 4 }}>
        Войти
      </Button>

      <Divider plain style={{ margin: '22px 0 16px' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Впервые у нас?
        </Text>
      </Divider>

      <Button block onClick={onSwitch}>
        Создать аккаунт
      </Button>
    </Form>
  );
};

const RegisterForm: React.FC<{ onSwitch: () => void }> = ({ onSwitch }) => {
  const { register } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const onFinish = async (values: RegisterFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      const inviteCode = values.invite_code?.trim().toUpperCase();
      await register({
        email: values.email.trim().toLowerCase(),
        password: values.password,
        name: values.name.trim(),
        phone: values.phone.trim(),
        birth_date: values.birth_date.format('YYYY-MM-DD'),
        ...(inviteCode ? { invite_code: inviteCode } : {}),
        ...(values.family_name?.trim() ? { family_name: values.family_name.trim() } : {}),
      });
    } catch (e) {
      setError(extractErrorMessage(e, 'Не удалось создать аккаунт.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
      <Title level={3} style={{ marginBottom: 4 }}>
        Создать аккаунт
      </Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
        Отдельный аккаунт для каждого члена семьи
      </Text>

      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          closable
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      <Form.Item
        name="name"
        label="Имя и фамилия"
        rules={[{ required: true, message: 'Укажите имя' }]}
      >
        <Input
          prefix={<UserOutlined className="text-muted" />}
          placeholder="Иван Иванов"
          autoComplete="name"
        />
      </Form.Item>

      <Form.Item
        name="birth_date"
        label="Дата рождения"
        extra="От неё зависят защитные настройки. Изменить может владелец семьи."
        rules={[
          { required: true, message: 'Укажите дату рождения' },
          {
            validator(_, value: Dayjs | undefined) {
              if (!value) return Promise.resolve();
              const age = new Date().getFullYear() - value.year();
              if (value.isAfter(new Date(), 'day')) {
                return Promise.reject(new Error('Дата не может быть в будущем'));
              }
              if (age > 120) return Promise.reject(new Error('Проверьте дату'));
              if (age < MIN_AGE) {
                return Promise.reject(new Error(`Регистрация доступна с ${MIN_AGE} лет`));
              }
              return Promise.resolve();
            },
          },
        ]}
      >
        <DatePicker
          style={{ width: '100%' }}
          format="DD.MM.YYYY"
          placeholder="ДД.ММ.ГГГГ"
          disabledDate={(current) => current && current.isAfter(new Date(), 'day')}
        />
      </Form.Item>

      <Form.Item
        name="email"
        label="Электронная почта"
        rules={[
          { required: true, message: 'Укажите почту' },
          { type: 'email', message: 'Похоже, это не почта' },
        ]}
      >
        <Input
          prefix={<MailOutlined className="text-muted" />}
          placeholder="name@example.com"
          autoComplete="email"
        />
      </Form.Item>

      <Form.Item
        name="phone"
        label="Телефон"
        rules={[{ required: true, message: 'Укажите телефон' }]}
      >
        <Input
          prefix={<PhoneOutlined className="text-muted" />}
          placeholder="+7 (999) 123-45-67"
          autoComplete="tel"
        />
      </Form.Item>

      {joining ? (
        <Form.Item
          name="invite_code"
          label="Код приглашения"
          extra="Код выдаёт владелец семьи. Заявку нужно подтвердить."
          rules={[{ required: true, message: 'Введите код приглашения' }]}
        >
          <Input
            prefix={<TeamOutlined className="text-muted" />}
            placeholder="AB12CD"
            maxLength={6}
            style={{ textTransform: 'uppercase', letterSpacing: 2 }}
          />
        </Form.Item>
      ) : (
        <Form.Item
          name="family_name"
          label="Название семьи"
          extra="Так ваша семья будет называться в приложении."
        >
          <Input prefix={<TeamOutlined className="text-muted" />} placeholder="Семья Ивановых" />
        </Form.Item>
      )}

      <Button
        type="link"
        size="small"
        style={{ padding: 0, marginBottom: 16 }}
        onClick={() => setJoining((prev) => !prev)}
      >
        {joining ? 'Создать новую семью вместо этого' : 'У меня есть код приглашения'}
      </Button>

      <Form.Item
        name="password"
        label="Пароль"
        rules={[
          { required: true, message: 'Придумайте пароль' },
          { min: 8, message: 'Минимум 8 символов' },
        ]}
      >
        <Input.Password
          prefix={<LockOutlined className="text-muted" />}
          placeholder="Минимум 8 символов"
          autoComplete="new-password"
        />
      </Form.Item>

      <Form.Item
        name="confirm"
        label="Повторите пароль"
        dependencies={['password']}
        rules={[
          { required: true, message: 'Повторите пароль' },
          ({ getFieldValue }) => ({
            validator(_, value) {
              if (!value || getFieldValue('password') === value) return Promise.resolve();
              return Promise.reject(new Error('Пароли не совпадают'));
            },
          }),
        ]}
      >
        <Input.Password
          prefix={<LockOutlined className="text-muted" />}
          placeholder="Ещё раз"
          autoComplete="new-password"
        />
      </Form.Item>

      <Button type="primary" htmlType="submit" block loading={submitting} style={{ marginTop: 4 }}>
        {joining ? 'Отправить заявку' : 'Создать аккаунт'}
      </Button>

      <Divider plain style={{ margin: '22px 0 16px' }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Уже есть аккаунт?
        </Text>
      </Divider>

      <Button block onClick={onSwitch}>
        Войти
      </Button>
    </Form>
  );
};

export const AuthPage: React.FC = () => {
  const [mode, setMode] = useState<Mode>('login');

  return (
    <div className="auth-shell">
      <main className="auth-form">
        <div className="auth-brand">
          <div className="brand-mark" aria-hidden="true">
            <BankOutlined />
          </div>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Семейный банк
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              Личный кабинет
            </div>
          </div>
        </div>

        {mode === 'login' ? (
          <LoginForm onSwitch={() => setMode('register')} />
        ) : (
          <RegisterForm onSwitch={() => setMode('login')} />
        )}

        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 28 }}>
          © {COPYRIGHT_YEAR} Семейный банк
        </div>
      </main>
    </div>
  );
};

export default AuthPage;
