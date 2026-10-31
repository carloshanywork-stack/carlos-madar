import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from './components/layout/AppShell.jsx';
import LoadingState from './components/ui/LoadingState.jsx';
import SignInPage from './modules/auth/SignInPage.jsx';
import { api } from './lib/api.js';

const DashboardPage = lazy(() => import('./modules/dashboard/OverviewPage.jsx'));
const ClientsPage = lazy(() => import('./modules/clients/ClientsPage.jsx'));
const MaintenancePage = lazy(() => import('./modules/maintenance/MaintenancePage.jsx'));
const MaintenanceOrderDetail = lazy(() => import('./modules/maintenance/OrderDetail.jsx'));
const WorkshopPage = lazy(() => import('./modules/workshop/WorkshopPage.jsx'));
const WorkshopOrderDetail = lazy(() => import('./modules/workshop/WorkshopOrderDetail.jsx'));
const WarehousePage = lazy(() => import('./modules/warehouse/WarehousePage.jsx'));
const FinancePage = lazy(() => import('./modules/finance/FinancePage.jsx'));
const AccountingPage = lazy(() => import('./modules/accounting/AccountingPage.jsx'));
const ArchivePage = lazy(() => import('./modules/archive/ArchivePage.jsx'));
const SettingsPage = lazy(() => import('./modules/settings/SettingsPage.jsx'));

function savedTheme() {
  try {
    const preference = window.localStorage.getItem('madar-v2-theme');
    if (preference === 'dark' || preference === 'light') return preference;
  } catch {
    // Fall back to the operating-system preference when browser storage is unavailable.
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light';
}

function BusinessRoutes({ user }) {
  return (
    <Suspense fallback={<LoadingState label="جارٍ تحميل الصفحة" />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/maintenance" element={<MaintenancePage />} />
        <Route path="/maintenance/:id" element={<MaintenanceOrderDetail />} />
        <Route path="/workshop" element={<WorkshopPage />} />
        <Route path="/workshop/:id" element={<WorkshopOrderDetail />} />
        <Route path="/warehouse" element={<WarehousePage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/accounting" element={<AccountingPage />} />
        <Route path="/archive" element={<ArchivePage isAdmin={user?.role === 'admin'} />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function AuthenticatedApplication() {
  const location = useLocation();
  const [theme, setTheme] = useState(savedTheme);
  const [user, setUser] = useState(null);
  const [setupRequired, setSetupRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const fetchAuthStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api.get('/api/auth/status');
      setUser(status.authenticated ? status.user : null);
      setSetupRequired(Boolean(status.setupRequired));
      setAuthError('');
    } catch (error) {
      setUser(null);
      setSetupRequired(false);
      setAuthError(error.message || 'تعذر الاتصال بخدمة تسجيل الدخول.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuthStatus();
  }, [fetchAuthStatus]);

  useEffect(() => {
    try {
      window.localStorage.setItem('madar-v2-theme', theme);
    } catch {
      // Theme remains available for this page even when browser storage is disabled.
    }
  }, [theme]);

  useEffect(() => {
    const authenticated = Boolean(user);
    document.documentElement.lang = authenticated ? 'ar' : 'en';
    document.documentElement.dir = authenticated ? 'rtl' : 'ltr';
    document.title = authenticated
      ? 'MADAR · نظام إدارة التشغيل والصيانة'
      : 'MADAR · Operations Workspace';
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#101925' : '#f4f6f7');
  }, [user, theme]);

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');

  const loginSuccess = (authenticatedUser) => {
    setUser(authenticatedUser);
    setSetupRequired(false);
    setAuthError('');
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Leave the workspace locally; the next status check will validate the server session.
    } finally {
      setUser(null);
    }
  };

  return (
    <div id="madar-app" dir="rtl" data-theme={theme}>
      {loading ? <LoadingState label="جارٍ التحقق من تسجيل الدخول..." /> : !user ? (
          <SignInPage
            setupRequired={setupRequired}
            initialError={authError}
            onLoginSuccess={loginSuccess}
            theme={theme}
            onThemeToggle={toggleTheme}
          />
      ) : location.pathname === '/login' ? (
        <Navigate to="/" replace />
      ) : (
        <AppShell
          user={user}
          onLogout={logout}
          theme={theme}
          onThemeToggle={toggleTheme}
        >
          <BusinessRoutes user={user} />
        </AppShell>
      )}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthenticatedApplication />
    </BrowserRouter>
  );
}
