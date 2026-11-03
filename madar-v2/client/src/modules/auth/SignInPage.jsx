import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';

export default function SignInPage({ setupRequired, initialError = '', onLoginSuccess, theme, onThemeToggle }) {
  const [form, setForm] = useState({ fullName: '', username: '', password: '', confirmPassword: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(initialError);
  const [accountMode, setAccountMode] = useState('staff');
  const [serverState, setServerState] = useState('checking');

  useEffect(() => {
    let active = true;
    const checkServer = async () => {
      if (!navigator.onLine) {
        if (active) setServerState('offline');
        return;
      }
      try {
        await api.get('/api/health');
        if (active) setServerState('online');
      } catch {
        if (active) setServerState('offline');
      }
    };
    const onOnline = () => { void checkServer(); };
    const onOffline = () => setServerState('offline');
    void checkServer();
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      active = false;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const update = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    if (error) setError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (setupRequired && form.password !== form.confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      let result;
      if (setupRequired) {
        result = await api.post('/api/auth/setup', {
          fullName: form.fullName,
          username: form.username,
          password: form.password,
        });
      } else if (accountMode === 'rep') {
        result = await api.post('/api/rep/login', {
          username: form.username,
          password: form.password,
        });
      } else {
        result = await api.post('/api/auth/login', {
          username: form.username,
          password: form.password,
        });
      }
      onLoginSuccess(accountMode === 'rep' && !setupRequired ? result.rep : result.user);
    } catch (requestError) {
      setError(requestError.message || 'Unable to sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-screen" dir={accountMode === 'rep' ? 'rtl' : 'ltr'}>
      <header className="auth-header">
        <div className="auth-wordmark" aria-label="تسجيل الدخول إلى مدار">
          <span className="auth-brand-mark">M</span>
          <span className="auth-brand-copy"><strong>MADAR</strong><small>{accountMode === 'rep' ? 'تطبيق المندوب الميداني' : 'نظام إدارة التشغيل والصيانة'}</small></span>
        </div>
        <button
          className="auth-theme-toggle"
          type="button"
          onClick={onThemeToggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        >
          <span aria-hidden="true">{theme === 'dark' ? '☼' : '☾'}</span>
          {theme === 'dark' ? 'Light mode' : 'Dark mode'}
        </button>
      </header>

      <section className="auth-layout" aria-label={setupRequired ? 'Administrator setup' : 'Sign in'}>
        <div className="auth-story">
          <div className="auth-story-orbit auth-story-orbit-one" />
          <div className="auth-story-orbit auth-story-orbit-two" />
          <div className="auth-story-content">
            <span className="auth-eyebrow"><span className="auth-eyebrow-dot" /> LOCAL-FIRST OPERATIONS</span>
            <h1>{accountMode === 'rep' ? 'كل زيارة محفوظة، حتى خارج التغطية.' : 'Clarity for every part of your operation.'}</h1>
            <p>{accountMode === 'rep' ? 'مسارك وصورك تُحفظ على هاتفك أولاً، ثم تُزامن مع نظام مدار عند توفر الاتصال.' : 'One calm workspace for maintenance, workshop, inventory and finance.'}</p>
            <div className="auth-story-points">
              {accountMode === 'rep' ? <>
                <span><i>01</i> مسار اليوم حسب المنطقة</span>
                <span><i>02</i> توثيق قبل وبعد</span>
                <span><i>03</i> حفظ محلي ومزامنة تلقائية</span>
              </> : <>
                <span><i>01</i> Work orders & machine history</span>
                <span><i>02</i> Stock, invoices & treasury</span>
                <span><i>03</i> Your data stays on your system</span>
              </>}
            </div>
          </div>
          <div className="auth-story-foot"><span>BUILT FOR THE WORK BEHIND THE WORK</span><span>V2.0</span></div>
        </div>

        <div className="auth-card-wrap">
          <div className="auth-card">
            <div className="auth-card-kicker">{setupRequired ? 'الإعداد لأول مرة' : accountMode === 'rep' ? 'الدخول الميداني' : 'مساحة عمل آمنة'}</div>
            <h2>{setupRequired ? 'إنشاء حساب المدير' : accountMode === 'rep' ? 'مرحباً بك يا مندوب' : 'مرحباً بعودتك'}</h2>
            <p className="auth-card-description" dir="rtl">
              {setupRequired
                ? 'أنشئ حساب المدير لتأمين مساحة عمل MADAR.'
                : accountMode === 'rep' ? 'سجّل الدخول لتنزيل مسار اليوم ومتابعة زياراتك.' : 'سجّل الدخول باستخدام حساب MADAR للمتابعة.'}
            </p>

            {!setupRequired && <div className="auth-account-switch" role="group" aria-label="نوع الحساب">
              <button type="button" className={accountMode === 'staff' ? 'active' : ''} onClick={() => setAccountMode('staff')}>موظف / إدارة</button>
              <button type="button" className={accountMode === 'rep' ? 'active' : ''} onClick={() => setAccountMode('rep')}>مندوب ميداني</button>
            </div>}

            <div className={`auth-server-status ${serverState === 'online' ? 'online' : ''} ${serverState === 'checking' ? 'checking' : ''}`} role="status">
              <i />{serverState === 'online' ? 'الخادم متصل وجاهز لتسجيل الدخول' : serverState === 'checking' ? 'جارٍ فحص اتصال الخادم…' : 'الخادم غير متاح · يلزم الاتصال لتسجيل الدخول'}
            </div>

            <form className="auth-form" dir="rtl" onSubmit={submit}>
              {setupRequired && (
                <label className="auth-field">
                  <span>الاسم الكامل</span>
                  <input
                    autoComplete="name"
                    autoFocus
                    maxLength={120}
                    name="fullName"
                    onChange={update('fullName')}
                    placeholder="الاسم الكامل"
                    required
                    value={form.fullName}
                  />
                </label>
              )}

              <label className="auth-field">
                <span>{accountMode === 'rep' && !setupRequired ? 'كود المندوب' : 'اسم المستخدم'}</span>
                <input
                  dir="ltr"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  autoFocus={!setupRequired}
                  maxLength={64}
                  name="username"
                  onChange={update('username')}
                  placeholder={accountMode === 'rep' && !setupRequired ? 'أدخل كود المندوب' : 'أدخل اسم المستخدم'}
                  required
                  value={form.username}
                />
              </label>

              <label className="auth-field">
                <span>كلمة المرور</span>
                <span className="auth-password-input">
                  <input
                    dir="ltr"
                    autoComplete={setupRequired ? 'new-password' : 'current-password'}
                    maxLength={72}
                    minLength={setupRequired ? 4 : 1}
                    name="password"
                    onChange={update('password')}
                    placeholder={setupRequired ? '4 خانات على الأقل' : 'أدخل كلمة المرور'}
                    required
                    type={showPassword ? 'text' : 'password'}
                    value={form.password}
                  />
                  <button type="button" onClick={() => setShowPassword((visible) => !visible)}>
                    {showPassword ? 'إخفاء' : 'إظهار'}
                  </button>
                </span>
                {setupRequired && <small>استخدم 4 خانات على الأقل. سيكون لهذا الحساب صلاحيات المدير.</small>}
              </label>

              {setupRequired && (
                <label className="auth-field">
                  <span>تأكيد كلمة المرور</span>
                  <input
                    autoComplete="new-password"
                    maxLength={72}
                    minLength={4}
                    name="confirmPassword"
                    onChange={update('confirmPassword')}
                    placeholder="أعد إدخال كلمة المرور"
                    required
                    dir="ltr"
                    type={showPassword ? 'text' : 'password'}
                    value={form.confirmPassword}
                  />
                </label>
              )}

              {error && <p className="auth-error" role="alert">{error}</p>}

              <button className="auth-submit" disabled={submitting} type="submit">
                {submitting && <span className="auth-submit-spinner" aria-hidden="true" />}
                {submitting ? 'جارٍ تسجيل الدخول...' : setupRequired ? 'إنشاء حساب المدير' : 'تسجيل الدخول'}
                {!submitting && <span aria-hidden="true">←</span>}
              </button>
            </form>

            <div className="auth-security-note">
              <span className="auth-security-icon" aria-hidden="true">⌑</span>
                <span><strong>جلسة محمية</strong><small>يُحفظ تسجيل الدخول في ملف ارتباط محمي من نوع HTTP-only. لا يُخزّن التوكن في الهاتف.</small></span>
            </div>
          </div>
          <p className="auth-local-note"><span /> مساحة عمل خاصة <b>·</b> بيانات محلية</p>
        </div>
      </section>

      <footer className="auth-footer"><span>© MADAR OPERATIONS</span><span>مصمم لفريقك</span></footer>
    </main>
  );
}
