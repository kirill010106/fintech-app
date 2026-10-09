import { theme, type ThemeConfig } from 'antd';

export type ThemeMode = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'familybank.theme';

/** Shared shape, so both modes stay visually consistent. */
const base: ThemeConfig['token'] = {
  borderRadius: 12,
  fontFamily:
    "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontSize: 14,
  controlHeight: 40,
};

export const darkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    ...base,
    colorPrimary: '#3b82f6',
    colorInfo: '#38bdf8',
    colorSuccess: '#10b981',
    colorWarning: '#f59e0b',
    colorError: '#ef4444',
    colorBgBase: '#0b1020',
    colorBgContainer: '#131b2e',
    colorBgElevated: '#1a2440',
    colorBorder: 'rgba(255, 255, 255, 0.09)',
    colorBorderSecondary: 'rgba(255, 255, 255, 0.06)',
    colorText: '#eef2f9',
    colorTextSecondary: '#b9c4d6',
    colorTextTertiary: '#7d8ba1',
  },
  components: {
    Layout: { bodyBg: 'transparent', headerBg: 'transparent', footerBg: 'transparent' },
    Card: { colorBgContainer: '#131b2e' },
    Modal: { contentBg: '#131b2e', headerBg: '#131b2e' },
    Drawer: { colorBgElevated: '#131b2e' },
    Table: { colorBgContainer: 'transparent', headerBg: 'rgba(255,255,255,0.03)' },
  },
};

export const lightTheme: ThemeConfig = {
  algorithm: theme.defaultAlgorithm,
  token: {
    ...base,
    colorPrimary: '#0a42d1',
    colorInfo: '#0284c7',
    colorSuccess: '#059669',
    colorWarning: '#d97706',
    colorError: '#dc2626',
    colorBgBase: '#f2f5fa',
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBorder: 'rgba(15, 23, 42, 0.11)',
    colorBorderSecondary: 'rgba(15, 23, 42, 0.07)',
    colorText: '#101a2e',
    colorTextSecondary: '#43536d',
    colorTextTertiary: '#71809a',
  },
  components: {
    Layout: { bodyBg: 'transparent', headerBg: 'transparent', footerBg: 'transparent' },
    Table: { headerBg: 'rgba(15,23,42,0.03)' },
  },
};

export const themeConfigs: Record<ThemeMode, ThemeConfig> = {
  dark: darkTheme,
  light: lightTheme,
};
