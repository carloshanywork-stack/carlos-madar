import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  RUN_ROLES,
  type ExecutionDetail,
  type ExecutionEvent,
  type ExecutionStep,
} from '../api';
import { AppShell } from '../components/ui';
import { useSession } from '../session';
import { formatDateTime, formatRelative } from '../lib/format';
import {
  formatDuration,
  formatJson,
  isActiveStatus,
  MODE_LABELS,
  NODE_STATUS_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  TRIGGER_LABELS,
} from '../lib/executions';

const EVENT_LABELS: Record<string, string> = {
  execution_started: 'بدء التنفيذ',
  execution_finished: 'انتهاء التنفيذ',
  execution_log: 'سجل',
  node_started: 'بدء عقدة',
  node_finished: 'انتهاء عقدة',
};

const EVENT_CLASSES: Record<string, string> = {
  execution_started: 'border-sky-400/20 bg-sky-400/5 text-sky-300',
  execution_finished: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300',
  execution_log: 'border-white/10 bg-white/5 text-slate-300',
  node_started: 'border-sky-400/20 bg-sky-400/5 text-sky-300',
  node_finished: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300',
};

interface StreamMessage {
  seq: number;
  type: string;
  payload: Record<string, unknown> | null;
  at?: string;
}

function mergeEvents(base: ExecutionEvent[], extra: ExecutionEvent[]): ExecutionEvent[] {
  const bySeq = new Map<number, ExecutionEvent>();
  for (const event of base) bySeq.set(event.seq, event);
  for (const event of extra) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre
      dir="ltr"
      className="max-h-72 overflow-auto rounded-xl border border-white/5 bg-slate-950/70 p-3 text-left text-[11px] leading-5 text-slate-300"
    >
      {formatJson(value)}
    </pre>
  );
}

function StepCard({ step }: { step: ExecutionStep }) {
  const statusClass =
    step.status === 'failed'
      ? 'border-rose-400/20 bg-rose-400/5 text-rose-300'
      : step.status === 'running'
        ? 'border-sky-400/20 bg-sky-400/5 text-sky-300'
        : 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300';

  return (
    <article className="rounded-2xl border border-white/10 bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass}`}>
            {NODE_STATUS_LABELS[step.status] ?? step.status}
          </span>
          <span className="text-sm font-semibold text-white">{step.nodeId}</span>
          <span className="text-[10px] text-slate-500" dir="ltr">
            {step.nodeType}
          </span>
          {step.attempt > 1 && (
            <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">
              محاولة {step.attempt}
            </span>
          )}
          {step.iteration > 0 && (
            <span className="text-[10px] text-slate-600">تكرار {step.iteration}</span>
          )}
        </div>
        <span className="text-[10px] text-slate-500" dir="ltr">
          {formatDuration(step.startedAt, step.finishedAt)}
        </span>
      </div>

      {step.error && (
        <p className="mt-2 rounded-lg border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-[11px] text-rose-300" dir="auto">
          {step.error.message ?? 'فشلت العقدة.'}
          {step.error.code ? ` (${step.error.code})` : ''}
        </p>
      )}

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        <details className="rounded-xl border border-white/5 bg-slate-950/40 p-2">
          <summary className="cursor-pointer px-1 text-[11px] font-semibold text-slate-400">
            المدخل
          </summary>
          <div className="mt-2">
            <JsonBlock value={step.input} />
          </div>
        </details>
        <details className="rounded-xl border border-white/5 bg-slate-950/40 p-2">
          <summary className="cursor-pointer px-1 text-[11px] font-semibold text-slate-400">
            المخرج
          </summary>
          <div className="mt-2">
            <JsonBlock value={step.output} />
          </div>
        </details>
      </div>

      <p className="mt-2 text-[10px] text-slate-600">
        بدأت {formatDateTime(step.startedAt)} · انتهت {formatDateTime(step.finishedAt)}
      </p>
    </article>
  );
}

function EventRow({ event }: { event: ExecutionEvent }) {
  const [open, setOpen] = useState(false);
  const payload = event.payload ?? {};
  const nodeName = typeof payload.nodeName === 'string' ? payload.nodeName : null;
  const message = typeof payload.message === 'string' ? payload.message : null;
  const level = typeof payload.level === 'string' ? payload.level : null;

  return (
    <li className="rounded-xl border border-white/5 bg-slate-950/40">
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-right"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
              EVENT_CLASSES[event.type] ?? 'border-white/10 bg-white/5 text-slate-300'
            }`}
          >
            {EVENT_LABELS[event.type] ?? event.type}
          </span>
          <span className="text-[10px] text-slate-500" dir="ltr">
            #{event.seq}
          </span>
          {nodeName && <span className="truncate text-[11px] text-slate-300">{nodeName}</span>}
          {level && (
            <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase text-slate-400">
              {level}
            </span>
          )}
          {message && (
            <span className="truncate text-[11px] text-slate-400" dir="auto">
              {message}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[10px] text-slate-600">
          {formatDateTime(event.createdAt)}
        </span>
      </button>
      {open && (
        <div className="border-t border-white/5 p-2">
          <JsonBlock value={payload} />
        </div>
      )}
    </li>
  );
}

export function ExecutionDetailPage() {
  const { workspaceId = '', executionId = '' } = useParams();
  const { workspaces } = useSession();
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [live, setLive] = useState(false);
  const [streamEvents, setStreamEvents] = useState<ExecutionEvent[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'cancel' | 'retry' | null>(null);
  const refetchTimer = useRef<number | null>(null);

  const queryKey = useMemo(
    () => ['execution', workspaceId, executionId] as const,
    [workspaceId, executionId],
  );
  const executionQuery = useQuery({
    queryKey,
    queryFn: () =>
      api<ExecutionDetail>(`/workspaces/${workspaceId}/executions/${executionId}`),
    enabled: Boolean(workspaceId && executionId),
    refetchInterval: (query) =>
      isActiveStatus(query.state.data?.status) ? 3_000 : false,
    refetchOnWindowFocus: false,
  });

  const execution = executionQuery.data;
  const active = isActiveStatus(execution?.status);

  const scheduleRefetch = useCallback(() => {
    if (refetchTimer.current) return;
    refetchTimer.current = window.setTimeout(() => {
      refetchTimer.current = null;
      void executionQuery.refetch();
    }, 250);
  }, [executionQuery]);

  useEffect(
    () => () => {
      if (refetchTimer.current) window.clearTimeout(refetchTimer.current);
    },
    [],
  );

  useEffect(() => {
    setStreamEvents([]);
  }, [executionId]);

  useEffect(() => {
    if (!workspaceId || !executionId || !active) {
      setLive(false);
      return;
    }

    let cancelled = false;
    let source: EventSource | null = null;

    void (async () => {
      try {
        const token = await api<{ url: string; expiresIn: number }>(
          `/workspaces/${workspaceId}/executions/${executionId}/stream-token`,
          { method: 'POST' },
        );
        if (cancelled) return;

        source = new EventSource(token.url);
        source.addEventListener('open', () => {
          if (!cancelled) setLive(true);
        });
        source.addEventListener('error', () => {
          if (!cancelled) setLive(false);
        });

        source.addEventListener('snapshot', (event) => {
          if (cancelled) return;
          try {
            const data = JSON.parse((event as MessageEvent<string>).data) as {
              execution?: ExecutionDetail;
            };
            if (data.execution) {
              queryClient.setQueryData(queryKey, data.execution);
            }
          } catch {
            // Ignore malformed snapshots; polling remains the fallback.
          }
        });

        source.addEventListener('message', (event) => {
          if (cancelled) return;
          let message: StreamMessage;
          try {
            message = JSON.parse((event as MessageEvent<string>).data) as StreamMessage;
          } catch {
            return;
          }
          if (!message || typeof message.seq !== 'number') return;

          setStreamEvents((previous) => {
            if (previous.some((entry) => entry.seq === message.seq)) return previous;
            const payload = message.payload ?? {};
            const next: ExecutionEvent = {
              id: `stream-${message.seq}`,
              seq: message.seq,
              type: message.type,
              payload,
              createdAt:
                typeof payload.at === 'string' ? payload.at : new Date().toISOString(),
            };
            return [...previous, next].sort((a, b) => a.seq - b.seq);
          });

          if (message.type === 'execution_finished') {
            const status =
              typeof message.payload?.executionStatus === 'string'
                ? message.payload.executionStatus
                : undefined;
            if (status) {
              queryClient.setQueryData<ExecutionDetail>(queryKey, (previous) =>
                previous ? { ...previous, status: status as ExecutionDetail['status'] } : previous,
              );
            }
          }
          scheduleRefetch();
        });
      } catch {
        if (!cancelled) setLive(false);
      }
    })();

    return () => {
      cancelled = true;
      source?.close();
      setLive(false);
    };
  }, [workspaceId, executionId, active, queryClient, queryKey, scheduleRefetch]);

  const events = useMemo(
    () => mergeEvents(execution?.events ?? [], streamEvents),
    [execution?.events, streamEvents],
  );

  async function handleCancel(): Promise<void> {
    if (!execution || busy) return;
    if (!window.confirm('إلغاء هذا التنفيذ الآن؟')) return;
    setBusy('cancel');
    setActionError(null);
    try {
      await api(`/workspaces/${workspaceId}/executions/${executionId}/cancel`, {
        method: 'POST',
      });
      await executionQuery.refetch();
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'تعذّر إلغاء التنفيذ.');
    } finally {
      setBusy(null);
    }
  }

  async function handleRetry(): Promise<void> {
    if (!execution || busy) return;
    setBusy('retry');
    setActionError(null);
    try {
      const next = await api<ExecutionDetail>(
        `/workspaces/${workspaceId}/executions/${executionId}/retry`,
        { method: 'POST' },
      );
      await queryClient.invalidateQueries({ queryKey: ['executions', workspaceId] });
      navigate(`/w/${workspaceId}/executions/${next.id}`);
    } catch (caught) {
      setActionError(caught instanceof ApiError ? caught.message : 'تعذّرت إعادة المحاولة.');
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

  if (executionQuery.isLoading) {
    return (
      <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
        <div className="grid h-[60vh] place-items-center">
          <div className="size-7 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
        </div>
      </AppShell>
    );
  }

  if (executionQuery.error || !execution) {
    return (
      <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
        <main className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-rose-300">
            {executionQuery.error instanceof ApiError
              ? executionQuery.error.message
              : 'تعذّر تحميل التنفيذ.'}
          </p>
          <Link
            to={`/w/${workspaceId}/executions`}
            className="mt-4 inline-block text-sm text-sky-400 hover:text-sky-300"
          >
            العودة إلى التنفيذات
          </Link>
        </main>
      </AppShell>
    );
  }

  const canRun = workspace ? RUN_ROLES.has(workspace.role) : false;
  const duration = formatDuration(execution.startedAt, execution.finishedAt);
  const modeLabel = MODE_LABELS[execution.mode] ?? execution.mode;

  return (
    <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to={`/w/${workspaceId}/executions`}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-[11px] text-slate-400 transition hover:bg-white/5"
              >
                ← التنفيذات
              </Link>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                  STATUS_CLASSES[execution.status] ?? STATUS_CLASSES.queued
                }`}
              >
                {STATUS_LABELS[execution.status] ?? execution.status}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-slate-400">
                {modeLabel}
              </span>
              {active && (
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${
                    live
                      ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'
                      : 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                  }`}
                >
                  {live ? 'بث مباشر' : 'تحديث دوري'}
                </span>
              )}
              {execution.hasErrors && (
                <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                  اكتمل مع أخطاء عُقد
                </span>
              )}
            </div>

            <h1 className="mt-3 text-2xl font-black text-white">{execution.workflowName}</h1>
            <p className="mt-1 text-xs text-slate-500">
              <Link
                to={`/w/${workspaceId}/workflows/${execution.workflowId}`}
                className="text-sky-400 hover:text-sky-300"
              >
                فتح الـ Workflow
              </Link>
              <span className="mx-2 text-slate-700">·</span>
              <span dir="ltr" className="font-mono text-[10px]">
                {execution.id}
              </span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {active && canRun && (
              <button
                type="button"
                onClick={() => void handleCancel()}
                disabled={busy !== null}
                className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs font-bold text-rose-200 transition hover:bg-rose-400/20 disabled:opacity-50"
              >
                {busy === 'cancel' ? 'جارٍ الإلغاء…' : 'إلغاء التنفيذ'}
              </button>
            )}
            {!active && canRun && (
              <button
                type="button"
                onClick={() => void handleRetry()}
                disabled={busy !== null}
                className="rounded-xl bg-sky-500 px-4 py-2 text-xs font-bold text-white transition hover:bg-sky-400 disabled:opacity-50"
              >
                {busy === 'retry' ? 'جارٍ الإنشاء…' : 'إعادة المحاولة'}
              </button>
            )}
            <button
              type="button"
              onClick={() => void executionQuery.refetch()}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/5"
            >
              تحديث
            </button>
          </div>
        </div>

        {actionError && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
            {actionError}
          </p>
        )}

        {execution.error && (
          <div className="mt-5 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-4">
            <p className="text-xs font-bold text-rose-300">خطأ التنفيذ</p>
            <p className="mt-1 text-sm text-rose-200/90" dir="auto">
              {execution.error.message ?? 'فشل التنفيذ.'}
            </p>
            {execution.error.code && (
              <p className="mt-1 text-[10px] text-rose-300/60" dir="ltr">
                {execution.error.code}
              </p>
            )}
            {execution.error.details !== undefined && (
              <div className="mt-3">
                <JsonBlock value={execution.error.details} />
              </div>
            )}
          </div>
        )}

        <section className="mt-5 grid gap-3 rounded-2xl border border-white/10 bg-slate-900/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-[10px] font-semibold text-slate-500">Trigger</p>
            <p className="mt-1 text-sm text-slate-200">
              {TRIGGER_LABELS[execution.triggerType] ?? execution.triggerType}
              {execution.triggerNodeId && (
                <span className="text-[10px] text-slate-500" dir="ltr">
                  {' '}
                  · {execution.triggerNodeId}
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500">النسخة</p>
            <p className="mt-1 text-sm text-slate-200">
              v{execution.version ?? '—'}{' '}
              <span className="text-[10px] text-slate-500">
                {execution.versionKind === 'test' ? 'اختبارية' : 'إنتاجية'}
              </span>
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500">المدة</p>
            <p className="mt-1 text-sm text-slate-200" dir="ltr">
              {duration}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500">أُنشئ</p>
            <p className="mt-1 text-sm text-slate-200">
              {formatDateTime(execution.createdAt)}{' '}
              <span className="text-[10px] text-slate-500">({formatRelative(execution.createdAt)})</span>
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500">بدأ</p>
            <p className="mt-1 text-sm text-slate-200">{formatDateTime(execution.startedAt)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500">انتهى</p>
            <p className="mt-1 text-sm text-slate-200">{formatDateTime(execution.finishedAt)}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500">عدد الخطوات</p>
            <p className="mt-1 text-sm text-slate-200">{execution.steps.length}</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-slate-500">إعادة محاولة</p>
            <p className="mt-1 text-sm text-slate-200">
              {execution.retryOfExecutionId ? (
                <Link
                  to={`/w/${workspaceId}/executions/${execution.retryOfExecutionId}`}
                  className="text-sky-400 hover:text-sky-300"
                >
                  الأصلية
                </Link>
              ) : (
                '—'
              )}
            </p>
          </div>
        </section>

        {!execution.payloadAccess && (
          <p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs text-amber-200">
            لا تملك صلاحية <span dir="ltr">execution:read_payload</span>؛ بيانات الإدخال والإخراج
            مخفية. يمكنك مشاهدة الحالة والأخطاء فقط.
          </p>
        )}

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">بيانات التشغيل</h2>
            {execution.idempotencyKey && (
              <span className="text-[10px] text-slate-500" dir="ltr">
                key: {execution.idempotencyKey}
              </span>
            )}
          </div>
          <div className="mt-2 rounded-2xl border border-white/10 bg-slate-900/40 p-3">
            {execution.payloadAccess ? (
              <JsonBlock value={execution.triggerPayload} />
            ) : (
              <p className="py-4 text-center text-[11px] text-slate-600">مخفي بصلاحياتك.</p>
            )}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">الخطوات</h2>
            <span className="text-[10px] text-slate-600">{execution.steps.length} خطوة</span>
          </div>
          <div className="mt-2 space-y-2">
            {execution.steps.map((step) => (
              <StepCard key={step.id} step={step} />
            ))}
            {execution.steps.length === 0 && (
              <p className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 py-8 text-center text-xs text-slate-500">
                {active ? 'بانتظار بدء العقد…' : 'لم تُسجّل أي خطوات.'}
              </p>
            )}
          </div>
        </section>

        <section className="mt-6 pb-12">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">سجل الأحداث</h2>
            <span className="text-[10px] text-slate-600">
              {events.length} حدث · محفوظ للأبد
            </span>
          </div>
          <ol className="mt-2 max-h-[520px] space-y-1.5 overflow-y-auto pl-1">
            {events.map((event) => (
              <EventRow key={`${event.seq}-${event.id}`} event={event} />
            ))}
            {events.length === 0 && (
              <li className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 py-8 text-center text-xs text-slate-500">
                {active ? 'بانتظار الأحداث…' : 'لا توجد أحداث مسجلة.'}
              </li>
            )}
          </ol>
        </section>
      </main>
    </AppShell>
  );
}
