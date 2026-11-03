import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from './components/layout/AppShell.jsx';
import LoadingState from './components/ui/LoadingState.jsx';
import SignInPage from './modules/auth/SignInPage.jsx';
import { api } from './lib/api.js';

const RepApp = lazy(() => import('./modules/rep/RepApp.jsx'));
const SupervisorRadarPage = lazy(() => import('./modules/supervisor/SupervisorRadarPage.jsx'));

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

function readCachedRep() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('madar-rep-profile') ?? 'null');
    return parsed?.role === 'rep' && Number.isSafeInteger(Number(parsed.id)) ? parsed : null;
  } catch {
    return null;
  }
}

function cacheRepProfile(user) {
  if (user?.role !== 'rep') return;
  try { window.localStorage.setItem('madar-rep-profile', JSON.stringify(user)); } catch { /* Offline queue is still separated by its IndexedDB rep ID. */ }
}

function clearCachedRepProfile() {
  try { window.localStorage.removeItem('madar-rep-profile'); } catch { /* Lockout still clears the in-memory session. */ }
}

function BusinessRoutes({ user }) {
  return (
    <Suspense fallback={<LoadingState label="جارٍ تحميل الصفحة" />}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/maintenance" element={<MaintenancePage />} />
        <Route path="/maintenance/:id" element={<MaintenanceOrderDetail />} />
        <Route path="/supervisor" element={user?.role === 'admin' ? <SupervisorRadarPage /> : <Navigate to="/" replace />} />
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
  const [offlineOnly, setOfflineOnly] = useState(false);

  const fetchAuthStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await api.get('/api/auth/status');
      const authenticatedUser = status.authenticated ? status.user : null;
      setUser(authenticatedUser);
      cacheRepProfile(authenticatedUser);
      setOfflineOnly(false);
      setSetupRequired(Boolean(status.setupRequired));
      if (status.message === 'تم تعطيل حسابك من قبل الإدارة') {
        clearCachedRepProfile();
        setAuthError(status.message);
      } else {
        setAuthError('');
      }
    } catch (error) {
      const cachedRep = readCachedRep();
      setUser(cachedRep);
      setOfflineOnly(Boolean(cachedRep));
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
    if (!offlineOnly) return undefined;
    let checking = false;
    const revalidate = async () => {
      if (checking || !navigator.onLine) return;
      checking = true;
      try {
        const status = await api.get('/api/auth/status');
        const authenticatedUser = status.authenticated ? status.user : null;
        setUser(authenticatedUser);
        cacheRepProfile(authenticatedUser);
        setOfflineOnly(false);
        if (status.message === 'تم تعطيل حسابك من قبل الإدارة') clearCachedRepProfile();
        setAuthError(status.message || (status.authenticated ? '' : 'انتهت الجلسة. سجّل الدخول مجدداً لمزامنة الزيارات.'));
      } catch {
        // The offline cached profile is only a local workspace, never an API credential.
      } finally {
        checking = false;
      }
    };
    const onOnline = () => { void revalidate(); };
    window.addEventListener('online', onOnline);
    const interval = window.setInterval(revalidate, 30000);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', onOnline);
    };
  }, [offlineOnly]);

  useEffect(() => {
    const handleDisabledRep = (event) => {
      clearCachedRepProfile();
      setUser(null);
      setOfflineOnly(false);
      setSetupRequired(false);
      setAuthError(event.detail?.message || 'تم تعطيل حسابك من قبل الإدارة');
    };
    window.addEventListener('madar-rep-account-disabled', handleDisabledRep);
    return () => window.removeEventListener('madar-rep-account-disabled', handleDisabledRep);
  }, []);

  useEffect(() => {
    if (offlineOnly) return undefined;
    const onExpired = () => { void fetchAuthStatus(); };
    window.addEventListener('madar-auth-expired', onExpired);
    return () => window.removeEventListener('madar-auth-expired', onExpired);
  }, [fetchAuthStatus, offlineOnly]);

  useEffect(() => {
    try {
      window.localStorage.setItem('madar-v2-theme', theme);
    } catch {
      // Theme remains available for this page even when browser storage is disabled.
    }
  }, [theme]);

  useEffect(() => {
    const authenticated = Boolean(user);
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    document.title = user?.role === 'rep'
      ? 'مدار مناديب'
      : 'MADAR · نظام إدارة التشغيل والصيانة';
    document.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', user?.role === 'rep' ? '#126b57' : theme === 'dark' ? '#101925' : '#f4f6f7');
  }, [user, theme]);

  const toggleTheme = () => setTheme((current) => current === 'dark' ? 'light' : 'dark');

  const loginSuccess = (authenticatedUser) => {
    setUser(authenticatedUser);
    cacheRepProfile(authenticatedUser);
    setOfflineOnly(false);
    setSetupRequired(false);
    setAuthError('');
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      // Leave the workspace locally; the next status check will validate the server session.
    } finally {
      if (user?.role === 'rep') {
        try {
          const cachedRep = readCachedRep();
          if (Number(cachedRep?.id) === Number(user.id)) window.localStorage.removeItem('madar-rep-profile');
        } catch { /* Keep logout available when local storage is unavailable. */ }
      }
      setUser(null);
      setOfflineOnly(false);
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
      ) : user.role === 'rep' ? (
        <Suspense fallback={<LoadingState label="جارٍ تحميل تطبيق المندوب" />}>
          <RepApp user={user} offlineOnly={offlineOnly} onLogout={logout} />
        </Suspense>
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
