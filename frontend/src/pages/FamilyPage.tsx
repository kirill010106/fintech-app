import React, { useCallback, useEffect, useState } from 'react';
import {
  App as AntdApp,
  Button,
  DatePicker,
  Form,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  ReloadOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import type { Dayjs } from 'dayjs';
import { api, extractErrorMessage } from '../api';
import { useAuth } from '../auth/AuthContext';
import { EmptyState, ErrorBlock, LoadingBlock } from '../components/ui/States';
import {
  AUTHORITY_LABELS,
  PROFILE_LABELS,
  type Authority,
  type FamilyMemberInfo,
  type JoinRequest,
} from '../types';

const { Title, Text } = Typography;

interface ConfirmFormValues {
  authority: Authority;
  birth_date?: Dayjs;
}

/**
 * The owner's family screen: who is in, who asked to join, and what each person
 * may do. Authority and protection profile are shown as two separate things,
 * because they are two separate decisions.
 */
export const FamilyPage: React.FC = () => {
  const { family, refresh } = useAuth();
  const { message } = AntdApp.useApp();

  const [members, setMembers] = useState<FamilyMemberInfo[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [invite, setInvite] = useState<string | null>(family?.invite_code ?? null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<JoinRequest | null>(null);
  const [form] = Form.useForm<ConfirmFormValues>();

  /** Pure read: it fetches the owner's view and never touches state. */
  const fetchFamily = useCallback(async () => {
    const [memberList, requestList, inviteInfo] = await Promise.all([
      api.getFamilyMembers(),
      api.getJoinRequests(),
      api.getFamilyInvite().catch(() => null),
    ]);
    return { memberList, requestList, inviteCode: inviteInfo?.invite_code ?? null };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await fetchFamily();
      setMembers(data.memberList);
      setRequests(data.requestList);
      if (data.inviteCode) setInvite(data.inviteCode);
      setFailed(false);
    } catch (e) {
      setFailed(true);
      console.error(extractErrorMessage(e, 'Не удалось загрузить семью'));
    } finally {
      setLoading(false);
    }
  }, [fetchFamily]);

  const reload = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      message.success('Код скопирован');
    } catch {
      message.warning('Не удалось скопировать код, выделите его вручную');
    }
  };

  const regenerate = async () => {
    try {
      const info = await api.regenerateFamilyInvite();
      setInvite(info.invite_code);
      message.success('Код обновлён');
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось обновить код'));
    }
  };

  const confirmRequest = async () => {
    if (!confirming) return;
    const values = await form.validateFields();
    try {
      await api.confirmJoinRequest({
        user_id: confirming.user.id,
        authority: values.authority,
        ...(values.birth_date ? { birth_date: values.birth_date.format('YYYY-MM-DD') } : {}),
      });
      message.success('Участник подтверждён');
      setConfirming(null);
      form.resetFields();
      await load();
      await refresh();
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось подтвердить заявку'));
    }
  };

  const rejectRequest = async (userId: number) => {
    try {
      await api.rejectJoinRequest(userId);
      message.success('Заявка отклонена');
      await load();
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось отклонить заявку'));
    }
  };

  const changeAuthority = async (userId: number, authority: Authority) => {
    try {
      await api.updateMemberAuthority(userId, authority);
      message.success('Права обновлены');
      await load();
      await refresh();
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось изменить права'));
    }
  };

  const removeMember = async (userId: number) => {
    try {
      await api.removeFamilyMember(userId);
      message.success('Участник исключён');
      await load();
    } catch (e) {
      message.error(extractErrorMessage(e, 'Не удалось исключить участника'));
    }
  };

  const requestColumns: ColumnsType<JoinRequest> = [
    {
      title: 'Кто просит',
      dataIndex: ['user', 'name'],
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.user.name}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {row.user.email}
          </div>
        </div>
      ),
    },
    {
      title: 'Дата рождения',
      dataIndex: ['user', 'birth_date'],
      width: 150,
      render: (value: string) =>
        value ? new Date(value).toLocaleDateString('ru-RU') : <span className="text-muted">не указана</span>,
    },
    {
      title: '',
      key: 'actions',
      width: 170,
      align: 'right',
      render: (_, row) => (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button
            size="small"
            type="primary"
            onClick={() => {
              setConfirming(row);
              form.setFieldsValue({ authority: 'member' });
            }}
          >
            Принять
          </Button>
          <Popconfirm
            title="Отклонить заявку?"
            okText="Отклонить"
            cancelText="Отмена"
            onConfirm={() => rejectRequest(row.user.id)}
          >
            <Button size="small" danger>
              Отклонить
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ];

  const memberColumns: ColumnsType<FamilyMemberInfo> = [
    {
      title: 'Участник',
      key: 'member',
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>{row.user?.name ?? row.nickname}</div>
          <div className="text-muted" style={{ fontSize: 12 }}>
            {row.user?.email}
          </div>
        </div>
      ),
    },
    {
      title: 'Права',
      dataIndex: 'authority',
      width: 190,
      render: (authority: Authority, row) =>
        authority === 'owner' ? (
          <Tag color="blue">{AUTHORITY_LABELS.owner}</Tag>
        ) : (
          <Select<Authority>
            size="small"
            value={authority}
            style={{ width: 140 }}
            suffixIcon={null}
            onChange={(next) => changeAuthority(row.user_id, next)}
            options={[
              { label: AUTHORITY_LABELS.member, value: 'member' },
              { label: AUTHORITY_LABELS.guardian, value: 'guardian' },
            ]}
          />
        ),
    },
    {
      title: 'Защита',
      dataIndex: 'role',
      width: 170,
      render: (role: FamilyMemberInfo['role']) => PROFILE_LABELS[role],
    },
    {
      title: '',
      key: 'actions',
      width: 110,
      align: 'right',
      render: (_, row) =>
        row.authority === 'owner' ? null : (
          <Popconfirm
            title="Исключить участника?"
            description="Доступ к счетам семьи будет закрыт."
            okText="Исключить"
            cancelText="Отмена"
            onConfirm={() => removeMember(row.user_id)}
          >
            <Button size="small" danger type="text">
              Исключить
            </Button>
          </Popconfirm>
        ),
    },
  ];

  if (loading) return <LoadingBlock label="Загрузка семьи" height={280} />;
  if (failed) return <ErrorBlock onRetry={reload} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <Title level={3} style={{ margin: 0 }} className="page-title">
            {family?.name || 'Семья'}
          </Title>
          <Text type="secondary" className="page-subtitle">
            Права участников и защитные настройки задаёт владелец семьи
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button icon={<ReloadOutlined />} onClick={reload}>
            Обновить
          </Button>
        </div>
      </div>

      <div className="app-card" style={{ padding: 18, marginBottom: 20 }}>
        <div className="muted-label">Код приглашения</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          <span className="mono tnum" style={{ fontSize: 22, fontWeight: 700, letterSpacing: 3 }}>
            {invite ?? 'нет'}
          </span>
          {invite && (
            <Button size="small" icon={<CopyOutlined />} onClick={copyInvite}>
              Скопировать
            </Button>
          )}
          <Popconfirm
            title="Выпустить новый код?"
            description="Старый код перестанет работать."
            okText="Обновить"
            cancelText="Отмена"
            onConfirm={regenerate}
          >
            <Button size="small">Новый код</Button>
          </Popconfirm>
        </div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
          Код даёт право только отправить заявку. Принять участника можно ниже.
        </Text>
      </div>

      <div className="app-card app-card-marked" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <UserAddOutlined className="text-muted" />
          <span className="section-title">Заявки на присоединение</span>
          {requests.length > 0 && <Tag color="orange">{requests.length}</Tag>}
        </div>

        {requests.length === 0 ? (
          <EmptyState
            title="Заявок нет"
            text="Когда кто-то введёт код приглашения, заявка появится здесь."
            height={140}
          />
        ) : (
          <Table<JoinRequest>
            rowKey={(row) => row.id}
            columns={requestColumns}
            dataSource={requests}
            pagination={false}
            size="middle"
          />
        )}
      </div>

      <div className="app-card" style={{ padding: 18 }}>
        <div className="section-title" style={{ marginBottom: 12 }}>
          Участники семьи
        </div>
        {members.length === 0 ? (
          <EmptyState title="Пока никого" height={140} />
        ) : (
          <Table<FamilyMemberInfo>
            rowKey={(row) => row.id}
            columns={memberColumns}
            dataSource={members}
            pagination={false}
            size="middle"
          />
        )}
      </div>

      <Modal
        open={confirming !== null}
        title="Принять участника"
        okText="Принять"
        cancelText="Отмена"
        onOk={confirmRequest}
        onCancel={() => {
          setConfirming(null);
          form.resetFields();
        }}
      >
        <Text type="secondary">
          {confirming?.user.name} присоединится к семье. Права можно изменить позже.
        </Text>
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="authority"
            label="Права в семье"
            rules={[{ required: true, message: 'Выберите права' }]}
          >
            <Select<Authority>
              options={[
                { label: `${AUTHORITY_LABELS.member}: только свой счёт`, value: 'member' },
                { label: `${AUTHORITY_LABELS.guardian}: подтверждает операции`, value: 'guardian' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="birth_date"
            label="Дата рождения"
            extra="Укажите, если в заявке она неверная. От неё зависят защитные настройки."
          >
            <DatePicker style={{ width: '100%' }} format="DD.MM.YYYY" placeholder="ДД.ММ.ГГГГ" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default FamilyPage;
