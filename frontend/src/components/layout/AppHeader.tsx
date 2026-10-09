import React from 'react';
import { Avatar, Button, Dropdown, Grid, Tooltip, Typography } from 'antd';
import {
  BankOutlined,
  DownOutlined,
  LogoutOutlined,
  MenuOutlined,
  MoonOutlined,
  SunOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useAuth } from '../../auth/AuthContext';
import { useThemeMode } from '../../theme/ThemeContext';
import { AUTHORITY_LABELS, PROFILE_LABELS } from '../../types';

const { Text } = Typography;

interface Props {
  onOpenMobileNav: () => void;
  onNavigate: (tab: string) => void;
}

const initialsOf = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

export const AppHeader: React.FC<Props> = ({ onOpenMobileNav, onNavigate }) => {
  const { user, family, logout } = useAuth();
  const { mode, toggleMode } = useThemeMode();
  const screens = Grid.useBreakpoint();
  const isCompact = !screens.lg;

  if (!user) return null;

  const items: MenuProps['items'] = [
    {
      key: 'identity',
      type: 'group',
      label: (
        <div style={{ padding: '4px 4px 8px' }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>{user.name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{user.email}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {family
              ? `${AUTHORITY_LABELS[family.authority]} · ${PROFILE_LABELS[family.role]}`
              : PROFILE_LABELS[user.role]}
            {family?.name ? ` · ${family.name}` : ''}
          </div>
        </div>
      ),
    },
    { type: 'divider' },
    { key: 'profile', icon: <UserOutlined />, label: 'Профиль и настройки' },
  ];

  // The family section exists only for the owner, who is the one who manages it.
  if (family?.is_owner) {
    items.splice(2, 0, { key: 'family', icon: <TeamOutlined />, label: 'Семья и заявки' });
  }

  items.push(
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Выйти', danger: true },
  );

  const onMenuClick: MenuProps['onClick'] = async ({ key }) => {
    if (key === 'profile' || key === 'family') onNavigate(key);
    if (key === 'logout') await logout();
  };

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        height: 64,
        background: 'var(--bg-header)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        borderBottom: '1px solid var(--border)',
        padding: '0 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        {isCompact && (
          <Button
            type="text"
            icon={<MenuOutlined />}
            onClick={onOpenMobileNav}
            aria-label="Открыть меню"
          />
        )}

        <div className="brand-mark" aria-hidden="true">
          <BankOutlined />
        </div>

        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em',
              whiteSpace: 'nowrap',
            }}
          >
            Семейный банк
          </div>
          {!isCompact && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-muted)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {family?.name || 'Личный кабинет'}
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Tooltip title={mode === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>
          <Button
            type="text"
            icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            onClick={toggleMode}
            aria-label="Переключить тему"
          />
        </Tooltip>

        <Dropdown
          menu={{ items, onClick: onMenuClick }}
          trigger={['click']}
          placement="bottomRight"
        >
          <Button
            type="text"
            aria-label="Меню профиля"
            style={{ height: 44, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 10 }}
          >
            <Avatar
              size={32}
              style={{
                background: 'var(--accent)',
                color: 'var(--text-on-accent)',
                fontWeight: 700,
                fontSize: 13,
                flex: '0 0 auto',
              }}
            >
              {initialsOf(user.name)}
            </Avatar>
            {!isCompact && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: 200 }}>
                <Text
                  strong
                  style={{
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {user.name.split(' ')[0]}
                </Text>
                <DownOutlined style={{ fontSize: 10, color: 'var(--text-muted)' }} />
              </span>
            )}
          </Button>
        </Dropdown>
      </div>
    </header>
  );
};

export default AppHeader;
