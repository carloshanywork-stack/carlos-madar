import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError, AUDIT_ROLES, type AuditLogEntry } from '../api';
import { AppShell } from '../components/ui';
import { useSession } from '../session';
import { formatDateTime, formatRelative } from '../lib/format';
import { formatJson } from '../lib/executions';

const inputClass =
  'rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-sky-400/50';

const ACTION_LABELS: Record<string, string> = {
  'credential.created': 'إنشاء اعتماد',
  'credential.revoked': 'إلغاء اعتماد',
  'mfa.enabled': 'تفعيل MFA',
  'mfa.disabled': 'تعطيل MFA',
  'workflow.created': 'إنشاء Workflow',
  'workflow.published': 'نشر Workflow',
  'workflow.archived': 'أرشفة Workflow',
  'workflow.unarchived': 'استعادة Workflow',
  'workflow.rollback': 'استعادة نسخة',
  'execution.retried': 'إعادة محاولة تنفيذ',
};

function AuditRow({ entry }: { entry: AuditLogEntry }) {
  const [open, setOpen] = useState(false);
  const hasDetails = entry.oldValues !== null || entry.newValues !== null;

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/50">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-right"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-0.5 text-[10px] font-bold text-sky-300">
            {ACTION_LABELS[entry.action] ?? entry.action}
          </span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
            {entry.entityType}
          </span>
          {entry.entityId && (
            <span className="truncate text-[10px] text-slate-600" dir="ltr">
              {entry.entityId}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-3 text-[10px] text-slate-500">
          <span>{entry.actorLabel ?? 'نظام'}</span>
          <span>{formatRelative(entry.createdAt)}</span>
          {hasDetails && <span className="text-slate-600">{open ? '▲' : '▼'}</span>}
        </span>
      </button>

      {open && (
        <div className="border-t border-white/5 p-4">
          <div className="grid gap-3 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-[10px] font-semibold text-slate-500">قبل</p>
              <pre
                dir="ltr"
                className="max-h-56 overflow-auto rounded-xl border border-white/5 bg-slate-950/70 p-3 text-left text-[11px] leading-5 text-slate-300"
              >
                {formatJson(entry.oldValues)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold text-slate-500">بعد</p>
              <pre
                dir="ltr"
                className="max-h-56 overflow-auto rounded-xl border border-white/5 bg-slate-950/70 p-3 text-left text-[11px] leading-5 text-slate-300"
              >
                {formatJson(entry.newValues)}
              </pre>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-600">
            <span>التوقيت: {formatDateTime(entry.createdAt)}</span>
            {entry.ip && <span dir="ltr">IP: {entry.ip}</span>}
            {entry.traceId && (
              <span dir="ltr" className="font-mono">
                trace: {entry.traceId}
              </span>
            )}
            {entry.userAgent && (
              <span dir="ltr" className="max-w-full truncate">
                {entry.userAgent}
              </span>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

export function AuditPage() {
  const { workspaceId = '' } = useParams();
  const { workspaces } = useSession();
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [limit, setLimit] = useState(50);

  const canRead = workspace ? AUDIT_ROLES.has(workspace.role) : false;

  const auditQuery = useQuery({
    queryKey: ['audit', workspaceId, action, entityType, from, to, limit],
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (action.trim()) params.set('action', action.trim());
      if (entityType.trim()) params.set('entityType', entityType.trim());
      if (from) params.set('from', new Date(from).toISOString());
      if (to) params.set('to', new Date(to).toISOString());
      return api<AuditLogEntry[]>(`/workspaces/${workspaceId}/audit?${params.toString()}`);
    },
    enabled: Boolean(workspaceId && canRead),
  });

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

  if (!canRead) {
    return (
      <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
        <main className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-slate-300">سجل التدقيق متاح للمالك والمدير فقط.</p>
          <Link to={`/w/${workspaceId}`} className="mt-4 inline-block text-sm text-sky-400">
            العودة إلى الـ Workflows
          </Link>
        </main>
      </AppShell>
    );
  }

  const entries = auditQuery.data ?? [];

  return (
    <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div>
          <h1 className="text-2xl font-black text-white">سجل التدقيق</h1>
          <p className="mt-1 text-sm text-slate-400">
            كل تغيير حساس يُسجّل بالفاعل والوقت والقيم القديمة والجديدة، ويُحفظ للأبد.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-slate-500">الإجراء</span>
            <input
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="credential.created"
              dir="ltr"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-slate-500">نوع الكيان</span>
            <input
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
              placeholder="credential"
              dir="ltr"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-slate-500">من</span>
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-slate-500">إلى</span>
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold text-slate-500">العدد</span>
            <select
              value={limit}
              onChange={(event) => setLimit(Number(event.target.value))}
              className={inputClass}
            >
              {[25, 50, 100, 200].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void auditQuery.refetch()}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/5"
          >
            تحديث
          </button>
          {(action || entityType || from || to) && (
            <button
              type="button"
              onClick={() => {
                setAction('');
                setEntityType('');
                setFrom('');
                setTo('');
              }}
              className="rounded-xl px-3 py-2 text-xs text-slate-500 transition hover:text-slate-300"
            >
              مسح الفلاتر
            </button>
          )}
        </div>

        {auditQuery.error && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
            {auditQuery.error instanceof ApiError
              ? auditQuery.error.message
              : 'تعذّر تحميل سجل التدقيق.'}
          </p>
        )}

        <div className="mt-5 space-y-2">
          {auditQuery.isLoading &&
            Array.from({ length: 5 }).map((_, index) => (
              <div
                key={index}
                className="h-16 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
              />
            ))}

          {entries.map((entry) => (
            <AuditRow key={entry.id} entry={entry} />
          ))}

          {!auditQuery.isLoading && entries.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center">
              <p className="text-sm text-slate-400">لا توجد أحداث مطابقة.</p>
            </div>
          )}
        </div>

        {entries.length >= limit && (
          <p className="mt-6 text-center text-[11px] text-slate-600">
            تُعرض أحدث {entries.length} حدثًا. استخدم الفلاتر لتضييق النتائج.
          </p>
        )}
      </main>
    </AppShell>
  );
}
