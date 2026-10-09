import React from 'react';
import {
  CreditCardOutlined,
  HeartOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { Authority, Role } from '../../types';

export interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
}

const OVERVIEW: NavItem = { key: 'overview', label: 'Счета и карты', icon: <CreditCardOutlined /> };
const APPROVALS: NavItem = {
  key: 'shield',
  label: 'Согласования',
  icon: <SafetyCertificateOutlined />,
};
const GOALS: NavItem = { key: 'goals', label: 'Цели', icon: <TrophyOutlined /> };
const LIMITS: NavItem = { key: 'limits', label: 'Лимиты и правила', icon: <SettingOutlined /> };
const FAMILY: NavItem = { key: 'family', label: 'Семья', icon: <TeamOutlined /> };
const QUESTS: NavItem = { key: 'quests', label: 'Обучение', icon: <RocketOutlined /> };
const SENIOR_CARE: NavItem = { key: 'senior', label: 'Моя защита', icon: <HeartOutlined /> };

/**
 * The rail grows from two independent things: what the person may do
 * (authority) and how much supervision they need (profile). A member does not
 * see the family-management section, because they cannot manage the family; a
 * teenager gets the learning section, an older relative gets their own safety
 * settings. Neither axis alone determines the rail.
 */
export const navFor = (authority: Authority, profile: Role): NavItem[] => {
  const items: NavItem[] = [OVERVIEW];

  // Only whoever may supervise gets to see and manage the whole family.
  if (authority === 'owner' || authority === 'guardian') {
    items.push(FAMILY);
  }

  items.push(APPROVALS, GOALS);

  if (profile === 'teen') {
    items.push(QUESTS);
  } else if (profile === 'senior') {
    items.push(SENIOR_CARE);
  }

  // Only a supervisor sets the limits of other people.
  if (authority === 'owner' || authority === 'guardian') {
    items.push(LIMITS);
  }

  return items;
};

export const DEFAULT_TAB = 'overview';

/** The section pinned to the bottom of the rail. */
export const PROFILE_NAV_ITEM: NavItem = {
  key: 'profile',
  label: 'Профиль и настройки',
  icon: <UserOutlined />,
};

/** Falls back to the first allowed section when a role change invalidates the tab. */
export const resolveTab = (
  authority: Authority,
  profile: Role,
  requested: string,
): string => {
  if (requested === PROFILE_NAV_ITEM.key) return requested;
  const allowed = navFor(authority, profile).map((item) => item.key);
  return allowed.includes(requested) ? requested : DEFAULT_TAB;
};
