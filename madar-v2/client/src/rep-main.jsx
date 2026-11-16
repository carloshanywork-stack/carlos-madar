import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './lib/api.js';
import LoadingState from './components/ui/LoadingState.jsx';
import SignInPage from './modules/auth/SignInPage.jsx';
import RepApp from './modules/rep/RepApp.jsx';
import { clearNativeSession } from './modules/rep/native-session.js';
import NativePermissionGate from './NativePermissionGate.jsx';
import './styles/tokens.css';
import './styles/base.css';
import './styles/auth.css';

function readCachedRep() {
  try {
    const user = JSON.parse(localStorage.getItem('madar-rep-profile') ?? 'null');
    return user?.role === 'rep' && Number.isSafeInteger(Number(user.id)) ? user : null;
  } catch { return null; }
}

function cacheRepProfile(user) {
  try {
    if (user?.role === 'rep') localStorage.setItem('madar-rep-profile', JSON.stringify(user));
    else localStorage.removeItem('madar-rep-profile');
  } catch { /* Offline profile caching is optional. */ }
}

function RepresentativeApplication() {
  const cachedUser = readCachedRep();
  const [user, setUser] = useState(cachedUser);
  const [offlineOnly, setOfflineOnly] = useState(Boolean(cachedUser));
  const [loading, setLoading] = useState(!cachedUser);
  const [setupRequired, setSetupRequired] = useState(false);
  const [authError, setAuthError] = useState('');
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('madar-v2-theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });

  const refreshSession = useCallback(async () => {
    try {
      const status = await api.get('/api/auth/status');
      setSetupRequired(Boolean(status.setupRequired));
      const authenticatedRep = status.authenticated && status.user?.role === 'rep' ? status.user : null;
      setUser(authenticatedRep);
      setOfflineOnly(false);
      cacheRepProfile(authenticatedRep);
      setAuthError(status.authenticated && status.user?.role !== 'rep'
        ? 'هذا تطبيق المندوبين. استخدم تطبيق الإدارة للحسابات الإدارية.'
        : status.message || '');
    } catch (error) {
      const cachedRep = readCachedRep();
      setUser(cachedRep);
      setOfflineOnly(Boolean(cachedRep));
      setAuthError(error.message || 'تعذر الاتصال بخدمة تسجيل الدخول.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refreshSession(); }, [refreshSession]);
  useEffect(() => {
    if (!offlineOnly) return undefined;
    const revalidate = () => { if (navigator.onLine) void refreshSession(); };
    const timer = window.setInterval(revalidate, 30000);
    window.addEventListener('online', revalidate);
    return () => { window.clearInterval(timer); window.removeEventListener('online', revalidate); };
  }, [offlineOnly, refreshSession]);
  useEffect(() => {
    const expired = () => { void refreshSession(); };
    window.addEventListener('madar-auth-expired', expired);
    return () => window.removeEventListener('madar-auth-expired', expired);
  }, [refreshSession]);
  useEffect(() => {
    document.documentElement.lang = 'ar';
    document.documentElement.dir = 'rtl';
    document.title = 'مدار مناديب';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#126b57');
    try { localStorage.setItem('madar-v2-theme', theme); } catch { /* Theme remains active for this page. */ }
  }, [theme]);

  const onLoginSuccess = (authenticatedUser) => {
    if (authenticatedUser?.role !== 'rep') {
      setAuthError('هذا تطبيق المندوبين. استخدم تطبيق الإدارة للحسابات الإدارية.');
      return;
    }
    setUser(authenticatedUser);
    cacheRepProfile(authenticatedUser);
    setOfflineOnly(false);
    setAuthError('');
    setSetupRequired(false);
  };
  const onLogout = async () => {
    try { await api.post('/api/auth/logout'); } catch { /* Logout remains available offline. */ }
    await clearNativeSession().catch(() => undefined);
    cacheRepProfile(null);
    setUser(null);
    setOfflineOnly(false);
  };

  return <div id="madar-app" dir="rtl" data-theme={theme}>
    {loading ? <LoadingState label="جارٍ التحقق من تسجيل الدخول..." /> : user
      ? <RepApp user={user} offlineOnly={offlineOnly} onLogout={onLogout} />
      : <SignInPage setupRequired={setupRequired} initialError={authError} onLoginSuccess={onLoginSuccess}
        theme={theme} onThemeToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />}
  </div>;
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode><NativePermissionGate><RepresentativeApplication /></NativePermissionGate></React.StrictMode>,
);
