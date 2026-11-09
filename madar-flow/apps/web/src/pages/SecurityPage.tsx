import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, type MfaStatus } from '../api';
import { AppShell } from '../components/ui';
import { useSession } from '../session';
import { formatDateTime } from '../lib/format';

const inputClass =
  'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/50 disabled:opacity-60';

const ADMIN_ROLES = new Set(['owner', 'admin']);

export function SecurityPage() {
  const { workspaceId = '' } = useParams();
  const { workspaces } = useSession();
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  const queryClient = useQueryClient();

  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [regenCode, setRegenCode] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isAdmin = workspace ? ADMIN_ROLES.has(workspace.role) : false;

  const statusQuery = useQuery({
    queryKey: ['mfa-status'],
    queryFn: () => api<MfaStatus>('/auth/mfa/status'),
    enabled: isAdmin,
  });

  const status = statusQuery.data;

  function copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(
      () => setNotice('تم النسخ إلى الحافظة.'),
      () => setNotice('تعذّر النسخ التلقائي؛ انسخ النص يدويًا.'),
    );
  }

  async function startSetup(): Promise<void> {
    setBusy('setup');
    setError(null);
    setNotice(null);
    setRecoveryCodes(null);
    try {
      const result = await api<{ secret: string; otpauthUrl: string }>('/auth/mfa/setup', {
        method: 'POST',
      });
      setSetup(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر بدء إعداد MFA.');
    } finally {
      setBusy(null);
    }
  }

  async function enable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('enable');
    setError(null);
    try {
      const result = await api<{ recoveryCodes: string[] }>('/auth/mfa/enable', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim() }),
      });
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setCode('');
      setNotice('تم تفعيل المصادقة الثنائية. احفظ رموز الاسترداد الآن.');
      await queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تفعيل MFA.');
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('regen');
    setError(null);
    try {
      const result = await api<{ recoveryCodes: string[] }>(
        '/auth/mfa/recovery-codes/regenerate',
        { method: 'POST', body: JSON.stringify({ code: regenCode.trim() }) },
      );
      setRecoveryCodes(result.recoveryCodes);
      setRegenCode('');
      setNotice('تم توليد رموز استرداد جديدة؛ الرموز القديمة أصبحت غير صالحة.');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر توليد الرموز.');
    } finally {
      setBusy(null);
    }
  }

  async function disable(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusy('disable');
    setError(null);
    try {
      await api('/auth/mfa/disable', {
        method: 'POST',
        body: JSON.stringify({ password, code: disableCode.trim() }),
      });
      setPassword('');
      setDisableCode('');
      setNotice('تم تعطيل المصادقة الثنائية.');
      await queryClient.invalidateQueries({ queryKey: ['mfa-status'] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تعطيل MFA.');
    } finally {
      setBusy(null);
    }
  }

  if (!workspace) {
    return (
      <AppShell>
        <main className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-slate-300">مساحة العمل غير متاحة لحسابك.</p>
          <Link to="/" className="mt-4 inline-block text-sm text-sky-400">
            العودة إلى المساحات
          </Link>
        </main>
      </AppShell>
    );
  }

  if (!isAdmin) {
    return (
      <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
        <main className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-slate-300">إعداد المصادقة الثنائية متاح للمالك أو المدير فقط.</p>
          <Link to={`/w/${workspaceId}`} className="mt-4 inline-block text-sm text-sky-400">
            العودة إلى الـ Workflows
          </Link>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div>
          <h1 className="text-2xl font-black text-white">الأمان</h1>
          <p className="mt-1 text-sm text-slate-400">
            المصادقة الثنائية عبر TOTP مطلوبة لحسابات المالك والمدير. رموز الاسترداد تُعرض مرة
            واحدة فقط وتُحفظ كتجزئات.
          </p>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </p>
        )}
        {notice && (
          <p className="mt-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-300">
            {notice}
          </p>
        )}

        <section className="mt-6 rounded-2xl border border-white/10 bg-slate-900/50 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-white">المصادقة الثنائية (TOTP)</h2>
              <p className="mt-1 text-xs text-slate-500">
                {status?.totpEnabled
                  ? `مفعّلة${status.confirmedAt ? ` منذ ${formatDateTime(status.confirmedAt)}` : ''}`
                  : status?.setupPending
                    ? 'بدأ الإعداد ولم يُؤكَّد بعد.'
                    : 'غير مفعّلة.'}
              </p>
            </div>
            {status?.totpEnabled ? (
              <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-300">
                محمي
              </span>
            ) : (
              <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-0.5 text-[10px] font-bold text-amber-300">
                غير محمي
              </span>
            )}
          </div>

          {!status?.totpEnabled && !setup && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void startSetup()}
                disabled={busy === 'setup'}
                className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-sky-400 disabled:opacity-50"
              >
                {busy === 'setup' ? 'جارٍ التحضير…' : 'بدء الإعداد'}
              </button>
            </div>
          )}

          {setup && (
            <div className="mt-4 space-y-3">
              <p className="text-xs leading-6 text-slate-400">
                أضف الحساب إلى تطبيق مصادقة (Google Authenticator أو مشابه)، ثم أدخل الرمز
                المكوّن من 6 أرقام للتأكيد.
              </p>
              <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
                <p className="text-[10px] font-semibold text-slate-500">المفتاح (Base32)</p>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 break-all text-left text-xs text-sky-300" dir="ltr">
                    {setup.secret}
                  </code>
                  <button
                    type="button"
                    onClick={() => copy(setup.secret)}
                    className="shrink-0 rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/5"
                  >
                    نسخ
                  </button>
                </div>
                <p className="mt-2 break-all text-[10px] text-slate-600" dir="ltr">
                  {setup.otpauthUrl}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => copy(setup.otpauthUrl)}
                    className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/5"
                  >
                    نسخ رابط otpauth
                  </button>
                  <a
                    href={setup.otpauthUrl}
                    className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-300 hover:bg-white/5"
                  >
                    فتح في التطبيق
                  </a>
                </div>
              </div>

              <form onSubmit={enable} className="flex flex-wrap items-end gap-2">
                <label className="block w-40">
                  <span className="mb-1 block text-[10px] font-semibold text-slate-500">
                    رمز التحقق
                  </span>
                  <input
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className={`${inputClass} text-center font-mono tracking-[0.2em]`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy === 'enable' || code.trim().length < 6}
                  className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busy === 'enable' ? 'جارٍ التفعيل…' : 'تأكيد وتفعيل'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSetup(null);
                    setCode('');
                  }}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs text-slate-300 transition hover:bg-white/5"
                >
                  إلغاء
                </button>
              </form>
            </div>
          )}

          {recoveryCodes && (
            <div className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
              <p className="text-xs font-bold text-amber-200">
                رموز الاسترداد — اعرضها واحفظها الآن، لن تُعرض مرة أخرى
              </p>
              <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {recoveryCodes.map((recoveryCode) => (
                  <code
                    key={recoveryCode}
                    dir="ltr"
                    className="rounded-lg bg-slate-950/60 px-2 py-1 text-center text-xs text-amber-200"
                  >
                    {recoveryCode}
                  </code>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => copy(recoveryCodes.join('\n'))}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 hover:bg-white/5"
                >
                  نسخ الكل
                </button>
                <button
                  type="button"
                  onClick={() => setRecoveryCodes(null)}
                  className="rounded-lg px-3 py-1.5 text-[11px] text-slate-500 hover:text-slate-300"
                >
                  أخفِ الرموز
                </button>
              </div>
            </div>
          )}
        </section>

        {status?.totpEnabled && (
          <>
            <section className="mt-4 rounded-2xl border border-white/10 bg-slate-900/50 p-5">
              <h2 className="text-sm font-bold text-white">رموز الاسترداد</h2>
              <p className="mt-1 text-xs text-slate-500">
                توليد رموز جديدة يُبطل كل الرموز القديمة غير المستخدمة.
              </p>
              <form onSubmit={regenerate} className="mt-3 flex flex-wrap items-end gap-2">
                <label className="block w-40">
                  <span className="mb-1 block text-[10px] font-semibold text-slate-500">
                    رمز التحقق الحالي
                  </span>
                  <input
                    value={regenCode}
                    onChange={(event) => setRegenCode(event.target.value)}
                    dir="ltr"
                    inputMode="numeric"
                    placeholder="123456"
                    className={`${inputClass} text-center font-mono tracking-[0.2em]`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy === 'regen' || regenCode.trim().length < 6}
                  className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-white/5 disabled:opacity-50"
                >
                  {busy === 'regen' ? 'جارٍ التوليد…' : 'توليد رموز جديدة'}
                </button>
              </form>
            </section>

            <section className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-5">
              <h2 className="text-sm font-bold text-rose-200">تعطيل المصادقة الثنائية</h2>
              <p className="mt-1 text-xs text-rose-200/60">
                يتطلب كلمة المرور ورمزًا صالحًا. سيُسجّل الإجراء في سجل التدقيق.
              </p>
              <form onSubmit={disable} className="mt-3 flex flex-wrap items-end gap-2">
                <label className="block w-48">
                  <span className="mb-1 block text-[10px] font-semibold text-rose-200/70">
                    كلمة المرور
                  </span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    dir="ltr"
                    autoComplete="current-password"
                    className={inputClass}
                  />
                </label>
                <label className="block w-40">
                  <span className="mb-1 block text-[10px] font-semibold text-rose-200/70">
                    رمز التحقق
                  </span>
                  <input
                    value={disableCode}
                    onChange={(event) => setDisableCode(event.target.value)}
                    dir="ltr"
                    inputMode="numeric"
                    placeholder="123456"
                    className={`${inputClass} text-center font-mono tracking-[0.2em]`}
                  />
                </label>
                <button
                  type="submit"
                  disabled={
                    busy === 'disable' || !password || disableCode.trim().length < 6
                  }
                  className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-400/20 disabled:opacity-50"
                >
                  {busy === 'disable' ? 'جارٍ التعطيل…' : 'تعطيل'}
                </button>
              </form>
            </section>
          </>
        )}
      </main>
    </AppShell>
  );
}
