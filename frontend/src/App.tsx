import React, { useCallback, useEffect, useRef, useState } from 'react';
import { App as AntdApp, ConfigProvider, Drawer, Grid, Layout, Spin, Typography } from 'antd';
import { AppHeader } from './components/layout/AppHeader';
import { AppSidebar } from './components/layout/AppSidebar';
import { resolveTab } from './components/layout/navConfig';
import { OverviewTab } from './components/tabs/OverviewTab';
import { ShieldTab } from './components/tabs/ShieldTab';
import { GoalsTab } from './components/tabs/GoalsTab';
import { QuestsTab } from './components/tabs/QuestsTab';
import { SeniorCareTab } from './components/tabs/SeniorCareTab';
import { TrustLimitsTab } from './components/tabs/TrustLimitsTab';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AuthPage } from './pages/AuthPage';
import { ProfilePage } from './pages/ProfilePage';
import { PendingPage } from './pages/PendingPage';
import { FamilyPage } from './pages/FamilyPage';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { ThemeModeProvider, useThemeMode } from './theme/ThemeContext';
import { api, extractErrorMessage, subscribeEvents } from './api';
import type { CoSignRequest, FamilyDashboardData } from './types';

const { Content, Footer } = Layout;
const { Text } = Typography;

/** Everything behind the sign-in gate. */
const Workspace: React.FC = () => {
  const { user, accounts, family, token, refresh } = useAuth();
  const { message } = AntdApp.useApp();
  const screens = Grid.useBreakpoint();
  const isCompact = !screens.lg;

  const [activeTab, setActiveTab] = useState('overview');
  const [dashboardData, setDashboardData] = useState<FamilyDashboardData | null>(null);
  const [pendingRequests, setPendingRequests] = useState<CoSignRequest[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const userId = user?.id ?? null;
  const familyId = family?.id ?? null;
  const authority = family?.authority ?? 'member';
  const profile = family?.role ?? user?.role ?? 'standard';
  const canSupervise = authority === 'owner' || authority === 'guardian';

  const currentTab = user ? resolveTab(authority, profile, activeTab) : 'overview';

  /** Pure read: fetches the workspace payload without touching component state. */
  const fetchWorkspaceData = useCallback(async () => {
    const [dash, reqs] = await Promise.all([api.getFamilyDashboard(), api.getPendingRequests()]);
    return { dash: dash || null, reqs: Array.isArray(reqs) ? reqs : [] };
  }, []);

  const reloadFromServer = useCallback(async () => {
    try {
      const data = await fetchWorkspaceData();
      setDashboardData(data.dash);
      setPendingRequests(data.reqs);
    } catch (e) {
      // A failed dashboard load must not blank out the whole application.
      console.error('Не удалось загрузить данные кабинета', e);
    }
  }, [fetchWorkspaceData]);

  const refreshAll = useCallback(async () => {
    await Promise.all([reloadFromServer(), refresh().catch(() => undefined)]);
  }, [reloadFromServer, refresh]);

  // Start on the first section whenever the signed-in identity changes.
  const [lastUserId, setLastUserId] = useState<number | null>(null);
  if (userId !== null && userId !== lastUserId) {
    setLastUserId(userId);
    setActiveTab('overview');
  }

  // (Re)load workspace data when the identity or the family group changes,
  // because joining a different family must refresh the dashboard too.
  useEffect(() => {
    if (userId === null || family?.membership_status === 'pending') return;
    let cancelled = false;

    fetchWorkspaceData()
      .then((data) => {
        if (cancelled) return;
        setDashboardData(data.dash);
        setPendingRequests(data.reqs);
      })
      .catch((e) => console.error('Не удалось загрузить данные кабинета', e));

    return () => {
      cancelled = true;
    };
  }, [userId, familyId, family?.membership_status, fetchWorkspaceData]);

  // Live updates from the server.
  useEffect(() => {
    if (!token || family?.membership_status === 'pending') return;

    const unsubscribe = subscribeEvents(token, (event) => {
      if (event.type === 'co_sign_created') {
        message.warning('Новая операция требует подтверждения');
      }
      void reloadFromServer();
    });

    return unsubscribe;
  }, [token, reloadFromServer, message, family?.membership_status]);

  // Announce newly arrived approval requests once per change.
  const knownPending = useRef<number>(0);
  useEffect(() => {
    const count = pendingRequests.length;
    if (count > knownPending.current && knownPending.current !== 0) {
      message.info(`Новых запросов на подтверждение: ${count - knownPending.current}`);
    }
    knownPending.current = count;
  }, [pendingRequests.length, message]);

  if (!user) return null;

  // Somebody whose request the owner has not confirmed yet has no access to the
  // family's data, so they see the waiting screen instead of an empty dashboard.
  if (family && family.membership_status === 'pending') return <PendingPage />;

  const renderTab = () => {
    switch (currentTab) {
      case 'overview':
        return (
          <OverviewTab
            currentUser={user}
            accounts={accounts}
            dashboardData={dashboardData}
            onRefresh={refreshAll}
            onNavigateToTab={setActiveTab}
            canSupervise={canSupervise}
          />
        );
      case 'shield':
        return (
          <ShieldTab
            pendingRequests={pendingRequests}
            onRefresh={refreshAll}
            canSupervise={canSupervise}
          />
        );
      case 'goals':
        return <GoalsTab currentUser={user} onRefresh={refreshAll} canSupervise={canSupervise} />;
      case 'quests':
        return <QuestsTab currentUser={user} onRefresh={refreshAll} />;
      case 'senior':
        return <SeniorCareTab currentUser={user} accounts={accounts} onRefresh={refreshAll} />;
      case 'limits':
        return (
          <TrustLimitsTab
            currentUser={user}
            dashboardData={dashboardData}
            onRefresh={refreshAll}
            canSupervise={canSupervise}
          />
        );
      case 'family':
        return <FamilyPage />;
      case 'profile':
        return <ProfilePage />;
      default:
        return null;
    }
  };

  const handleNavigate = (tab: string) => {
    setActiveTab(tab);
    setMobileNavOpen(false);
  };

  return (
    <Layout style={{ minHeight: '100vh', background: 'transparent' }}>
      <AppHeader onOpenMobileNav={() => setMobileNavOpen(true)} onNavigate={handleNavigate} />

      <div style={{ display: 'flex', alignItems: 'flex-start', flex: 1, minHeight: 0 }}>
        {!isCompact && (
          <aside
            style={{
              width: 248,
              flex: '0 0 248px',
              position: 'sticky',
              top: 64,
              height: 'calc(100vh - 64px)',
              overflowY: 'auto',
              borderRight: '1px solid var(--border)',
            }}
          >
            <AppSidebar
              activeTab={currentTab}
              onChangeTab={handleNavigate}
              pendingCount={pendingRequests.length}
            />
          </aside>
        )}

        <Content
          style={{
            flex: 1,
            minWidth: 0,
            padding: isCompact ? '18px 14px 40px' : '24px 28px 40px',
          }}
        >
          <ErrorBoundary>{renderTab()}</ErrorBoundary>
        </Content>
      </div>

      <Drawer
        placement="left"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        width={264}
        title={<span style={{ fontWeight: 700 }}>{family?.name || 'Личный кабинет'}</span>}
        styles={{ body: { padding: 0 } }}
      >
        <AppSidebar
          activeTab={currentTab}
          onChangeTab={handleNavigate}
          pendingCount={pendingRequests.length}
        />
      </Drawer>

      <Footer
        style={{
          textAlign: 'center',
          background: 'transparent',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-muted)',
          fontSize: 12,
          padding: '16px 20px',
        }}
      >
        Семейный банк, поддержка 8 800 100-24-24
      </Footer>
    </Layout>
  );
};

/** Decides between the sign-in screen and the workspace. */
const Root: React.FC = () => {
  const { status } = useAuth();
  const { message } = AntdApp.useApp();

  useEffect(() => {
    const onUnhandled = (event: PromiseRejectionEvent) => {
      const text = extractErrorMessage(event.reason, '');
      if (text) message.error(text);
    };
    window.addEventListener('unhandledrejection', onUnhandled);
    return () => window.removeEventListener('unhandledrejection', onUnhandled);
  }, [message]);

  if (status === 'loading') {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <Spin size="large" />
        <Text type="secondary">Загрузка</Text>
      </div>
    );
  }

  return status === 'authenticated' ? <Workspace /> : <AuthPage />;
};

/** Applies the active theme to the whole tree. */
const ThemedRoot: React.FC = () => {
  const { config } = useThemeMode();

  return (
    <ConfigProvider theme={config}>
      <AntdApp>
        <AuthProvider>
          <ErrorBoundary>
            <Root />
          </ErrorBoundary>
        </AuthProvider>
      </AntdApp>
    </ConfigProvider>
  );
};

export const App: React.FC = () => (
  <ThemeModeProvider>
    <ThemedRoot />
  </ThemeModeProvider>
);

export default App;
