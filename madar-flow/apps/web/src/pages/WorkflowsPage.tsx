import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  ApiError,
  WRITE_ROLES,
  type WorkflowDetail,
  type WorkflowSummary,
  type WorkflowTemplateSummary,
} from '../api';
import { AppShell } from '../components/ui';
import { useSession } from '../session';
import { formatRelative } from '../lib/format';

const TRIGGER_LABELS: Record<WorkflowTemplateSummary['trigger'], string> = {
  manual: 'يدوي',
  webhook: 'Webhook',
  schedule: 'مجدول',
};

const TRIGGER_STYLES: Record<WorkflowTemplateSummary['trigger'], string> = {
  manual: 'border-sky-400/20 bg-sky-400/10 text-sky-300',
  webhook: 'border-violet-400/20 bg-violet-400/10 text-violet-300',
  schedule: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
};

export function WorkflowsPage() {
  const { workspaceId = '' } = useParams();
  const { workspaces } = useSession();
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [instantiating, setInstantiating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryKey = ['workflows', workspaceId, includeArchived] as const;
  const workflowsQuery = useQuery({
    queryKey,
    queryFn: () =>
      api<WorkflowSummary[]>(
        `/workspaces/${workspaceId}/workflows?includeArchived=${includeArchived}`,
      ),
    enabled: Boolean(workspaceId),
  });

  const templatesQuery = useQuery({
    queryKey: ['workflow-templates', workspaceId],
    queryFn: () =>
      api<WorkflowTemplateSummary[]>(`/workspaces/${workspaceId}/workflow-templates`),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
  });

  const canWrite = workspace ? WRITE_ROLES.has(workspace.role) : false;

  async function handleInstantiate(template: WorkflowTemplateSummary): Promise<void> {
    if (instantiating) return;
    setInstantiating(template.id);
    setError(null);
    try {
      const workflow = await api<WorkflowDetail>(
        `/workspaces/${workspaceId}/workflow-templates/${template.id}/instantiate`,
        { method: 'POST', body: JSON.stringify({}) },
      );
      window.location.assign(`/w/${workspaceId}/workflows/${workflow.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذر إنشاء Workflow من القالب.');
      setInstantiating(null);
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const workflow = await api<WorkflowDetail>(`/workspaces/${workspaceId}/workflows`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      setName('');
      setDescription('');
      setShowCreate(false);
      await queryClient.invalidateQueries({ queryKey: ['workflows', workspaceId] });
      window.location.assign(`/w/${workspaceId}/workflows/${workflow.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذر إنشاء الـ Workflow.');
    } finally {
      setBusy(false);
    }
  }

  async function runAction(action: () => Promise<unknown>): Promise<void> {
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ['workflows', workspaceId] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذر تنفيذ العملية.');
    }
  }

  if (!workspace) {
    return (
      <AppShell>
        <main className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-slate-300">مساحة العمل غير متاحة لحسابك.</p>
          <Link to="/" className="mt-4 inline-block text-sm text-sky-400 hover:text-sky-300">
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
            <h1 className="text-2xl font-black text-white">Workflows</h1>
            <p className="mt-1 text-sm text-slate-400">
              مسودات قابلة للتحرير ونُسخ منشورة غير قابلة للتعديل.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              to={`/w/${workspaceId}/executions`}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
            >
              التنفيذات
            </Link>
            <label className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={includeArchived}
                onChange={(event) => setIncludeArchived(event.target.checked)}
                className="size-4 rounded border-white/20 bg-slate-900 accent-sky-500"
              />
              إظهار المؤرشفة
            </label>
            {canWrite && (
              <button
                type="button"
                onClick={() => setShowCreate((previous) => !previous)}
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-400"
              >
                {showCreate ? 'إلغاء' : '+ Workflow جديد'}
              </button>
            )}
          </div>
        </div>

        {showCreate && canWrite && (
          <form
            onSubmit={handleCreate}
            className="mt-6 grid gap-3 rounded-2xl border border-white/10 bg-slate-900/50 p-5 sm:grid-cols-[1fr_1.5fr_auto]"
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="اسم الـ Workflow"
              required
              className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-sky-400/50"
            />
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="وصف مختصر (اختياري)"
              className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-sky-400/50"
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-bold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {busy ? '…' : 'إنشاء وفتح'}
            </button>
          </form>
        )}

        <section className="mt-6 rounded-2xl border border-white/10 bg-slate-900/30 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-white">ابدأ من قالب جاهز</h2>
              <p className="mt-1 text-xs text-slate-500">
                خمسة قوالب قبول (WF1–WF5) تُنشأ كمسودة قابلة للتعديل. استبدل الروابط التجريبية
                وأرفق الاعتمادات قبل النشر.
              </p>
            </div>
            {!canWrite && (
              <span className="text-[10px] text-slate-500">تحتاج صلاحية تحرير لاستخدام القوالب.</span>
            )}
          </div>

          {templatesQuery.error && (
            <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
              {templatesQuery.error instanceof ApiError
                ? templatesQuery.error.message
                : 'تعذر تحميل القوالب.'}
            </p>
          )}

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {(templatesQuery.data ?? []).map((template) => (
              <article
                key={template.id}
                className="flex flex-col rounded-xl border border-white/10 bg-slate-950/40 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-white">{template.name}</h3>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${TRIGGER_STYLES[template.trigger]}`}
                  >
                    {TRIGGER_LABELS[template.trigger]}
                  </span>
                </div>
                <p className="mt-2 flex-1 text-[11px] leading-5 text-slate-400">
                  {template.description}
                </p>
                <div className="mt-3 flex flex-wrap gap-1">
                  {template.nodeTypes.map((nodeType, index) => (
                    <span
                      key={`${nodeType}-${index}`}
                      dir="ltr"
                      className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] text-slate-400"
                    >
                      {nodeType}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-600">
                    {template.requiresHmacCredentialFor.length > 0
                      ? 'يتطلب اعتماد HMAC'
                      : `${template.placeholders.length} روابط قابلة للتعديل`}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleInstantiate(template)}
                    disabled={!canWrite || instantiating !== null}
                    className="rounded-lg bg-sky-500 px-3 py-1.5 text-[11px] font-bold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {instantiating === template.id ? 'جارٍ الإنشاء…' : 'استخدام القالب'}
                  </button>
                </div>
              </article>
            ))}

            {templatesQuery.isLoading &&
              Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="h-40 animate-pulse rounded-xl border border-white/5 bg-slate-900/40"
                />
              ))}
          </div>
        </section>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </p>
        )}

        <div className="mt-8 space-y-3">
          {workflowsQuery.isLoading &&
            Array.from({ length: 3 }).map((_, index) => (
              <div
                key={index}
                className="h-24 animate-pulse rounded-2xl border border-white/5 bg-slate-900/40"
              />
            ))}

          {workflowsQuery.error && (
            <div className="rounded-2xl border border-rose-400/20 bg-rose-400/5 p-6 text-sm text-rose-300">
              {workflowsQuery.error instanceof ApiError
                ? workflowsQuery.error.message
                : 'تعذر تحميل الـ Workflows.'}
            </div>
          )}

          {workflowsQuery.data?.map((workflow) => (
            <article
              key={workflow.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-900/50 p-5 transition hover:border-white/20"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    to={`/w/${workspaceId}/workflows/${workflow.id}`}
                    className="truncate text-base font-semibold text-white hover:text-sky-300"
                  >
                    {workflow.name}
                  </Link>
                  {workflow.archivedAt && (
                    <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                      مؤرشف
                    </span>
                  )}
                  {!workflow.currentVersionId && !workflow.archivedAt && (
                    <span className="rounded-full border border-slate-400/20 bg-slate-400/10 px-2 py-0.5 text-[10px] font-bold text-slate-300">
                      مسودة
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                  {workflow.description || 'بلا وصف'}
                </p>
                <p className="mt-2 text-[11px] text-slate-600">
                  آخر تحديث {formatRelative(workflow.updatedAt)} · مراجعة المسودة{' '}
                  <span dir="ltr">r{workflow.draftRevision ?? 0}</span>
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  to={`/w/${workspaceId}/workflows/${workflow.id}`}
                  className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/5"
                >
                  فتح المحرر
                </Link>
                {canWrite && (
                  <button
                    type="button"
                    onClick={() =>
                      void runAction(() =>
                        api(`/workspaces/${workspaceId}/workflows/${workflow.id}/duplicate`, {
                          method: 'POST',
                        }),
                      )
                    }
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
                  >
                    نسخ
                  </button>
                )}
                {canWrite && (
                  <button
                    type="button"
                    onClick={() => {
                      const nextArchived = !workflow.archivedAt;
                      if (
                        nextArchived &&
                        !window.confirm(
                          'أرشفة الـ Workflow؟ لن تُحذف بياناته، ويمكن استعادته في أي وقت.',
                        )
                      ) {
                        return;
                      }
                      void runAction(() =>
                        api(`/workspaces/${workspaceId}/workflows/${workflow.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify({ archived: nextArchived }),
                        }),
                      );
                    }}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
                  >
                    {workflow.archivedAt ? 'استعادة' : 'أرشفة'}
                  </button>
                )}
              </div>
            </article>
          ))}

          {workflowsQuery.data?.length === 0 && (
            <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/30 p-12 text-center">
              <p className="text-sm text-slate-400">
                لا توجد Workflows بعد. ابدأ بقالب فحص صحة النظام من المحرر.
              </p>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => setShowCreate(true)}
                  className="mt-4 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-400"
                >
                  إنشاء أول Workflow
                </button>
              )}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
