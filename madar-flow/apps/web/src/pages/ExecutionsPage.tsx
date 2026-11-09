import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  RUN_ROLES,
  type ExecutionStatus,
  type ExecutionSummary,
  type WorkflowSummary,
} from '../api';
import { AppShell } from '../components/ui';
import { useSession } from '../session';
import { formatRelative } from '../lib/format';
import {
  formatDuration,
  isActiveStatus,
  MODE_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  TRIGGER_LABELS,
} from '../lib/executions';

const STATUS_OPTIONS: Array<{ value: '' | ExecutionStatus; label: string }> = [
  { value: '', label: 'كل الحالات' },
  { value: 'running', label: 'جارٍ التنفيذ' },
  { value: 'queued', label: 'في الانتظار' },
  { value: 'succeeded', label: 'ناجح' },
  { value: 'failed', label: 'فاشل' },
  { value: 'canceled', label: 'ملغي' },
];

export function ExecutionsPage() {
  const { workspaceId = '' } = useParams();
  const { workspaces } = useSession();
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  const [status, setStatus] = useState<'' | ExecutionStatus>('');
  const [workflowId, setWorkflowId] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const workflowsQuery = useQuery({
    queryKey: ['workflows', workspaceId, 'executions-filter'],
    queryFn: () => api<WorkflowSummary[]>(`/workspaces/${workspaceId}/workflows?includeArchived=true`),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  });

  const queryKey = ['executions', workspaceId, workflowId, status] as const;
  const executionsQuery = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ limit: '50' });
      if (status) params.set('status', status);
      if (workflowId) params.set('workflowId', workflowId);
      return api<ExecutionSummary[]>(`/workspaces/${workspaceId}/executions?${params.toString()}`);
    },
    enabled: Boolean(workspaceId),
    refetchInterval: (query) => {
      if (!autoRefresh) return false;
      const rows = query.state.data;
      return rows?.some((row) => isActiveStatus(row.status)) ? 2_500 : false;
    },
  });

  const canRun = workspace ? RUN_ROLES.has(workspace.role) : false;
  const executions = executionsQuery.data ?? [];
  const activeCount = useMemo(
    () => executions.filter((row) => isActiveStatus(row.status)).length,
    [executions],
  );

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

  return (
    <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white">التنفيذات</h1>
            <p className="mt-1 text-sm text-slate-400">
              سجلّ كامل لكل تشغيل، محفوظ للأبد مع الخطوات والأحداث.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            {activeCount > 0 && (
              <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[11px] font-bold text-sky-300">
                {activeCount} قيد التشغيل
              </span>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
                className="size-4 accent-sky-500"
              />
              تحديث تلقائي
            </label>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | ExecutionStatus)}
            className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none focus:border-sky-400/50"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            value={workflowId}
            onChange={(event) => setWorkflowId(event.target.value)}
            className="max-w-64 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none focus:border-sky-400/50"
          >
            <option value="">كل الـ Workflows</option>
            {workflowsQuery.data?.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void executionsQuery.refetch()}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/5"
          >
            تحديث
          </button>

          <Link
            to={`/w/${workspaceId}`}
            className="mr-auto rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/5"
          >
            الـ Workflows
          </Link>
        </div>

        {executionsQuery.error && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
            {executionsQuery.error instanceof ApiError
              ? executionsQuery.error.message
              : 'تعذّر تحميل التنفيذات.'}
          </p>
        )}

        <div className="mt-5 space-y-2">
          {executionsQuery.isLoading &&
            Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-20 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
              />
            ))}

          {executions.map((execution) => (
            <Link
              key={execution.id}
              to={`/w/${workspaceId}/executions/${execution.id}`}
              className="block rounded-2xl border border-white/10 bg-slate-900/50 p-4 transition hover:border-white/20 hover:bg-slate-900/80"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                      STATUS_CLASSES[execution.status] ?? STATUS_CLASSES.queued
                    }`}
                  >
                    {STATUS_LABELS[execution.status] ?? execution.status}
                  </span>
                  <span className="truncate text-sm font-semibold text-white">
                    {execution.workflowName}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                    {MODE_LABELS[execution.mode] ?? execution.mode}
                  </span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                    {TRIGGER_LABELS[execution.triggerType] ?? execution.triggerType}
                  </span>
                  {execution.hasErrors && (
                    <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      أخطاء عُقد
                    </span>
                  )}
                  {execution.error && !execution.hasErrors && (
                    <span className="rounded-full border border-rose-400/30 bg-rose-400/10 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                      خطأ
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-4 text-[11px] text-slate-500">
                  <span>{formatRelative(execution.createdAt)}</span>
                  <span dir="ltr">{formatDuration(execution.startedAt, execution.finishedAt)}</span>
                  <span className="hidden sm:inline">v{execution.version ?? '—'}</span>
                  <span className="text-slate-600">←</span>
                </div>
              </div>

              {execution.error?.message && (
                <p className="mt-2 line-clamp-2 text-[11px] text-rose-300/80" dir="auto">
                  {execution.error.message}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-slate-600">
                <span className="font-mono" dir="ltr">
                  {execution.id}
                </span>
                {execution.finishedAt && <span>انتهى {formatRelative(execution.finishedAt)}</span>}
                {execution.retryOfExecutionId && <span>إعادة محاولة</span>}
              </div>
            </Link>
          ))}

          {!executionsQuery.isLoading && executions.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center">
              <p className="text-sm text-slate-400">
                {status || workflowId
                  ? 'لا توجد تنفيذات مطابقة لهذا الفلتر.'
                  : 'لم يُشغّل أي Workflow بعد.'}
              </p>
              {canRun && (
                <Link
                  to={`/w/${workspaceId}`}
                  className="mt-4 inline-block rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-400"
                >
                  افتح Workflow للتشغيل
                </Link>
              )}
            </div>
          )}
        </div>

        {executions.length > 0 && (
          <p className="mt-6 text-center text-[11px] text-slate-600">
            يُعرض أحدث {executions.length} تنفيذ. استخدم الفلاتر لتضييق النتائج.
          </p>
        )}
      </main>
    </AppShell>
  );
}
