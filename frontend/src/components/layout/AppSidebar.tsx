import React from 'react';
import { Badge } from 'antd';
import { useAuth } from '../../auth/AuthContext';
import { navFor, PROFILE_NAV_ITEM, type NavItem } from './navConfig';

interface Props {
  activeTab: string;
  onChangeTab: (key: string) => void;
  pendingCount?: number;
}

export const AppSidebar: React.FC<Props> = ({ activeTab, onChangeTab, pendingCount = 0 }) => {
  const { user, family } = useAuth();
  if (!user) return null;

  const items = navFor(family?.authority ?? 'member', family?.role ?? user.role);

  const renderItem = (item: NavItem) => {
    const isActive = activeTab === item.key;
    const badge = item.key === 'shield' ? pendingCount : 0;

    return (
      <button
        key={item.key}
        type="button"
        onClick={() => onChangeTab(item.key)}
        className={`nav-item${isActive ? ' nav-item-active' : ''}`}
        aria-current={isActive ? 'page' : undefined}
      >
        <span className="nav-icon" aria-hidden="true">
          {item.icon}
        </span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.label}
        </span>
        {badge > 0 && <Badge count={badge} size="small" />}
      </button>
    );
  };

  return (
    <nav
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 12,
        height: '100%',
      }}
    >
      {items.map(renderItem)}

      <div style={{ flex: 1 }} />

      <div className="divider-top" style={{ paddingTop: 8, marginTop: 8 }}>
        {renderItem(PROFILE_NAV_ITEM)}
      </div>
    </nav>
  );
};

export default AppSidebar;
