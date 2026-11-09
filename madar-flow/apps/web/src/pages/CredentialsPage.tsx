import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  CREDENTIAL_TYPES,
  CREDENTIAL_TYPE_LABELS,
  type CredentialType,
} from '@madar/shared/browser';
import {
  api,
  ApiError,
  CREDENTIAL_ADMIN_ROLES,
  type CredentialMetadata,
  type CredentialPreflight,
} from '../api';
import { AppShell } from '../components/ui';
import { useSession } from '../session';
import { formatDateTime, formatRelative } from '../lib/format';

const inputClass =
  'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/50 disabled:opacity-60';
const selectClass =
  'w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none focus:border-sky-400/50';

interface FieldDefinition {
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  type?: 'text' | 'password';
}

const TYPE_FIELDS: Record<CredentialType, FieldDefinition[]> = {
  api_key: [
    { key: 'secret', label: 'Secret', required: true, type: 'password' },
    { key: 'headerName', label: 'اسم الترويسة', placeholder: 'x-api-key' },
    { key: 'valuePrefix', label: 'بادئة القيمة (اختياري)', placeholder: 'Bearer ' },
  ],
  bearer: [{ key: 'token', label: 'Token', required: true, type: 'password' }],
  basic: [
    { key: 'username', label: 'Username', required: true },
    { key: 'password', label: 'Password', required: true, type: 'password' },
  ],
  oauth2: [
    { key: 'clientId', label: 'Client ID', required: true },
    { key: 'clientSecret', label: 'Client Secret', required: true, type: 'password' },
    { key: 'tokenUrl', label: 'Token URL', required: true, placeholder: 'https://example.com/oauth/token' },
    { key: 'scope', label: 'Scope (اختياري)' },
    { key: 'audience', label: 'Audience (اختياري)' },
  ],
  hmac: [
    {
      key: 'secret',
      label: 'HMAC Secret',
      required: true,
      type: 'password',
      placeholder: '16 حرفًا على الأقل',
    },
  ],
};

export function CredentialsPage() {
  const { workspaceId = '' } = useParams();
  const { workspaces } = useSession();
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  const queryClient = useQueryClient();
  const [includeRevoked, setIncludeRevoked] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<CredentialType>('api_key');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<
    Record<string, CredentialPreflight | 'loading' | string>
  >({});

  const canManage = workspace ? CREDENTIAL_ADMIN_ROLES.has(workspace.role) : false;

  const queryKey = ['credentials', workspaceId, includeRevoked] as const;
  const credentialsQuery = useQuery({
    queryKey,
    queryFn: () =>
      api<CredentialMetadata[]>(
        `/workspaces/${workspaceId}/credentials?includeRevoked=${includeRevoked}`,
      ),
    enabled: Boolean(workspaceId),
  });

  function resetForm(): void {
    setName('');
    setType('api_key');
    setFields({});
    setFormError(null);
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);

    const payload: Record<string, unknown> = {};
    for (const field of TYPE_FIELDS[type]) {
      const value = fields[field.key] ?? '';
      if (!value.trim()) {
        if (field.required) {
          setFormError(`${field.label} مطلوب.`);
          setBusy(false);
          return;
        }
        continue;
      }
      payload[field.key] = value;
    }

    try {
      await api(`/workspaces/${workspaceId}/credentials`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), type, payload }),
      });
      setShowCreate(false);
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ['credentials', workspaceId] });
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ الاعتماد.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(credential: CredentialMetadata): Promise<void> {
    if (
      !window.confirm(
        `إلغاء الاعتماد «${credential.name}»؟ لن يُحذف السجل، وسيُمنع استخدامه في التنفيذات الجديدة.`,
      )
    ) {
      return;
    }
    try {
      await api(`/workspaces/${workspaceId}/credentials/${credential.id}/revoke`, {
        method: 'POST',
      });
      await queryClient.invalidateQueries({ queryKey: ['credentials', workspaceId] });
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'تعذّر إلغاء الاعتماد.');
    }
  }

  async function handlePreflight(credential: CredentialMetadata): Promise<void> {
    setPreflight((previous) => ({ ...previous, [credential.id]: 'loading' }));
    try {
      const result = await api<CredentialPreflight>(
        `/workspaces/${workspaceId}/credentials/${credential.id}/preflight`,
        { method: 'POST' },
      );
      setPreflight((previous) => ({ ...previous, [credential.id]: result }));
    } catch (caught) {
      setPreflight((previous) => ({
        ...previous,
        [credential.id]: caught instanceof ApiError ? caught.message : 'تعذّر الفحص.',
      }));
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

  if (!canManage) {
    return (
      <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
        <main className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-slate-300">إدارة الاعتمادات متاحة لمالك المساحة أو مديرها فقط.</p>
          <Link to={`/w/${workspaceId}`} className="mt-4 inline-block text-sm text-sky-400">
            العودة إلى الـ Workflows
          </Link>
        </main>
      </AppShell>
    );
  }

  const credentials = credentialsQuery.data ?? [];
  const activeCount = credentials.filter((entry) => !entry.revokedAt).length;

  return (
    <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white">الاعتمادات</h1>
            <p className="mt-1 text-sm text-slate-400">
              أسرار مشفّرة (AES-256-GCM) للاتصال بالأنظمة الخارجية. تُلغى ولا تُحذف أبدًا.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={includeRevoked}
                onChange={(event) => setIncludeRevoked(event.target.checked)}
                className="size-4 accent-sky-500"
              />
              إظهار الملغاة
            </label>
            <button
              type="button"
              onClick={() => {
                resetForm();
                setShowCreate(true);
              }}
              className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-sky-400"
            >
              + اعتماد جديد
            </button>
          </div>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          {activeCount} اعتماد نشط · {credentials.length} إجمالي
        </p>

        {credentialsQuery.error && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
            {credentialsQuery.error instanceof ApiError
              ? credentialsQuery.error.message
              : 'تعذّر تحميل الاعتمادات.'}
          </p>
        )}

        {formError && !showCreate && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
            {formError}
          </p>
        )}

        <div className="mt-5 space-y-2">
          {credentialsQuery.isLoading &&
            Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
              />
            ))}

          {credentials.map((credential) => {
            const check = preflight[credential.id];
            return (
              <article
                key={credential.id}
                className={`rounded-2xl border p-4 ${
                  credential.revokedAt
                    ? 'border-white/5 bg-slate-900/20 opacity-70'
                    : 'border-white/10 bg-slate-900/50'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-white">
                      {credential.name}
                    </span>
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                      {CREDENTIAL_TYPE_LABELS[credential.type as CredentialType] ??
                        credential.type}
                    </span>
                    {credential.revokedAt ? (
                      <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                        ملغى
                      </span>
                    ) : (
                      <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                        نشط
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!credential.revokedAt && (
                      <>
                        <button
                          type="button"
                          onClick={() => void handlePreflight(credential)}
                          disabled={check === 'loading'}
                          className="rounded-lg border border-white/10 px-3 py-1.5 text-[11px] text-slate-300 transition hover:bg-white/5 disabled:opacity-50"
                        >
                          {check === 'loading' ? 'جارٍ الفحص…' : 'فحص'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRevoke(credential)}
                          className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-1.5 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-400/20"
                        >
                          إلغاء
                        </button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-600">
                  <span>أُنشئ {formatRelative(credential.createdAt)}</span>
                  <span>آخر استخدام {formatRelative(credential.lastUsedAt)}</span>
                  <span className="font-mono" dir="ltr">
                    {credential.id}
                  </span>
                </div>

                {credential.revokedAt && (
                  <p className="mt-2 text-[11px] text-rose-300/70">
                    أُلغي في {formatDateTime(credential.revokedAt)} — السجل محفوظ للأبد.
                  </p>
                )}

                {check && check !== 'loading' && typeof check === 'string' && (
                  <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-[11px] text-rose-300">
                    {check}
                  </p>
                )}

                {check && typeof check === 'object' && (
                  <div className="mt-2 space-y-1 rounded-lg border border-white/5 bg-slate-950/40 p-2">
                    {check.checks.map((entry) => (
                      <p
                        key={entry.name}
                        className={`text-[11px] ${entry.ok ? 'text-emerald-300' : 'text-rose-300'}`}
                      >
                        {entry.ok ? '✓' : '✕'} {entry.name}
                        {entry.message ? ` — ${entry.message}` : ''}
                      </p>
                    ))}
                  </div>
                )}
              </article>
            );
          })}

          {!credentialsQuery.isLoading && credentials.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center">
              <p className="text-sm text-slate-400">لا توجد اعتمادات بعد.</p>
              <p className="mt-1 text-xs text-slate-600">
                أضف اعتمادًا لاستخدامه في عقد HTTP أو توقيع Webhook.
              </p>
            </div>
          )}
        </div>
      </main>

      {showCreate && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleCreate}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl"
          >
            <h2 className="text-lg font-bold text-white">اعتماد جديد</h2>
            <p className="mt-1 text-xs text-slate-500">
              تُشفّر البيانات قبل حفظها ولا تُعرض مرة أخرى بعد الإنشاء.
            </p>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">الاسم</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                placeholder="مثال: نظام الطلبات"
                className={inputClass}
              />
            </label>

            <label className="mt-3 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">النوع</span>
              <select
                value={type}
                onChange={(event) => {
                  setType(event.target.value as CredentialType);
                  setFields({});
                }}
                className={selectClass}
              >
                {CREDENTIAL_TYPES.map((credentialType) => (
                  <option key={credentialType} value={credentialType}>
                    {CREDENTIAL_TYPE_LABELS[credentialType]}
                  </option>
                ))}
              </select>
            </label>

            {type === 'hmac' && (
              <p className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[10px] leading-5 text-amber-200/80">
                اعتماد HMAC مطلوب لعقد Webhook. يُحسب التوقيع على الصيغة{' '}
                <code dir="ltr">{'${timestamp}.${rawBody}'}</code>.
              </p>
            )}

            <div className="mt-3 space-y-2">
              {TYPE_FIELDS[type].map((field) => (
                <label key={field.key} className="block">
                  <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">
                    {field.label}
                  </span>
                  <input
                    type={field.type ?? 'text'}
                    value={fields[field.key] ?? ''}
                    onChange={(event) =>
                      setFields((previous) => ({ ...previous, [field.key]: event.target.value }))
                    }
                    dir="ltr"
                    placeholder={field.placeholder}
                    required={field.required}
                    className={inputClass}
                  />
                </label>
              ))}
            </div>

            {formError && (
              <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
                {formError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreate(false);
                  resetForm();
                }}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-400 disabled:opacity-50"
              >
                {busy ? 'جارٍ الحفظ…' : 'حفظ الاعتماد'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
