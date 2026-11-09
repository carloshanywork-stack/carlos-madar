import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useSession } from '../session';
import { LoadingScreen, Logo } from '../components/ui';

export function AuthPage() {
  const { status, login, register, completeMfa } = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [code, setCode] = useState('');

  if (status === 'loading') return <LoadingScreen label="جارٍ التحقق من الجلسة…" />;
  if (status === 'authenticated') {
    const target = (location.state as { from?: string } | null)?.from ?? '/';
    return <Navigate to={target} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');

    try {
      if (mode === 'login') {
        const result = await login(email, password);
        if (result.mfaRequired) {
          setChallengeToken(result.challengeToken);
          setCode('');
          return;
        }
      } else {
        await register({
          email,
          password,
          displayName: String(form.get('displayName') ?? ''),
          workspaceName: String(form.get('workspaceName') ?? ''),
        });
      }
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذر الاتصال بالخادم.');
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!challengeToken) return;
    setBusy(true);
    setError(null);
    try {
      await completeMfa(challengeToken, code.trim());
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذر التحقق من الرمز.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_10%,rgba(14,165,233,0.18),transparent),radial-gradient(50%_40%_at_90%_80%,rgba(99,102,241,0.16),transparent)]" />

      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-12 lg:grid-cols-2">
        <section className="hidden lg:block">
          <div className="flex items-center gap-3">
            <Logo />
            <div>
              <p className="text-lg font-bold">Madar Flow</p>
              <p className="text-xs text-slate-500">Visual Workflow Automation</p>
            </div>
          </div>

          <h1 className="mt-10 text-4xl font-black leading-tight text-white">
            أتمتة عملك
            <span className="block bg-gradient-to-l from-sky-400 to-indigo-400 bg-clip-text text-transparent">
              بلا سطر كود واحد.
            </span>
          </h1>

          <p className="mt-5 max-w-md leading-8 text-slate-400">
            صمّم سير العمل بصريًا، اربط الأنظمة عبر HTTP، وشغّله عند الطلب أو بجدولة أو عبر
            Webhook — مع سجلات كاملة واحتفاظ دائم بالبيانات.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-slate-400">
            {[
              'عربي أولًا وواجهة RTL أصلية',
              'بياناتك تبقى على سيرفرك — Zero Cloud',
              'كل شيء محفوظ للأبد بلا حذف آلي',
            ].map((item) => (
              <li key={item} className="flex items-center gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-sky-400/10 text-sky-400">
                  ✓
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="w-full rounded-3xl border border-white/10 bg-slate-900/70 p-7 shadow-2xl backdrop-blur sm:p-9">
          <div className="flex rounded-xl bg-slate-950/60 p-1">
            {(['login', 'register'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  mode === value
                    ? 'bg-slate-800 text-white shadow'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {value === 'login' ? 'تسجيل الدخول' : 'حساب جديد'}
              </button>
            ))}
          </div>

          {challengeToken ? (
            <form onSubmit={handleVerify} className="mt-6 space-y-4">
              <div className="rounded-xl border border-sky-400/20 bg-sky-400/5 px-4 py-3 text-xs leading-6 text-sky-200">
                أدخل رمز التحقق من تطبيق المصادقة (6 أرقام) أو أحد رموز الاسترداد.
              </div>

              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-400">
                  رمز التحقق
                </span>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  autoFocus
                  dir="ltr"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-center font-mono text-lg tracking-[0.3em] text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20"
                />
              </label>

              {error && (
                <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={busy || code.trim().length < 6}
                className="w-full rounded-xl bg-gradient-to-l from-sky-500 to-indigo-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? 'جارٍ التحقق…' : 'تحقق ودخول'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setChallengeToken(null);
                  setCode('');
                  setError(null);
                }}
                className="w-full text-center text-xs text-slate-500 transition hover:text-slate-300"
              >
                العودة إلى تسجيل الدخول
              </button>
            </form>
          ) : (
          <form key={mode} onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === 'register' && (
              <>
                <Field label="الاسم" name="displayName" placeholder="اسمك الكامل" />
                <Field label="مساحة العمل" name="workspaceName" placeholder="مثال: فريق الصيانة" />
              </>
            )}

            <Field
              label="البريد الإلكتروني"
              name="email"
              type="email"
              placeholder="you@example.com"
              dir="ltr"
            />
            <Field
              label="كلمة المرور"
              name="password"
              type="password"
              placeholder={mode === 'register' ? '12 حرفًا على الأقل' : '••••••••••••'}
              dir="ltr"
            />

            {error && (
              <p className="rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-gradient-to-l from-sky-500 to-indigo-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-sky-500/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'جارٍ التنفيذ…' : mode === 'login' ? 'دخول' : 'إنشاء الحساب'}
            </button>
          </form>
          )}

          <p className="mt-5 text-center text-xs leading-6 text-slate-500">
            نسخة التطوير الداخلية — كل بيانات الأعمال محفوظة للأبد.
          </p>
        </section>
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  type = 'text',
  placeholder,
  dir,
}: {
  label: string;
  name: string;
  type?: string;
  placeholder?: string;
  dir?: 'ltr' | 'rtl';
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-400">{label}</span>
      <input
        name={name}
        type={type}
        dir={dir}
        placeholder={placeholder}
        required
        className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20"
      />
    </label>
  );
}
