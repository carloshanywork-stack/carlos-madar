import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { validateExpressionsIn, validateNodeParameters, validateWorkflowForPublish } from '@madar/shared/browser';
import {
  api,
  ApiError,
  PUBLISH_ROLES,
  RUN_ROLES,
  WRITE_ROLES,
  type RunResponse,
  type WorkflowDetail,
  type WorkflowVersion,
  type WorkflowVersionSummary,
} from '../api';
import { AppShell } from '../components/ui';
import { useSession } from '../session';
import { NODE_CATALOG, metaFor, type NodeGroup } from '../editor/node-catalog';
import { MadarNodeView } from '../editor/MadarNodeView';
import { NodeForm } from '../editor/NodeForm';
import {
  defaultEdgeOptions,
  flowToGraph,
  useEditorStore,
  type MadarNode,
} from '../editor/store';
import { formatDateTime, formatRelative } from '../lib/format';

const MonacoJsonEditor = lazy(() => import('../editor/MonacoJsonEditor'));

const nodeTypes = { madar: MadarNodeView } as NodeTypes;

const GROUP_LABELS: Record<NodeGroup, string> = {
  trigger: 'Triggers',
  action: 'Actions',
  logic: 'Logic',
};

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 1024px)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const listener = () => setIsDesktop(query.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  return isDesktop;
}

export function EditorPage() {
  return (
    <ReactFlowProvider>
      <EditorInner />
    </ReactFlowProvider>
  );
}

function EditorInner() {
  const { workspaceId = '', workflowId = '' } = useParams();
  const { workspaces } = useSession();
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const flow = useReactFlow();

  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [validationOpen, setValidationOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishNote, setPublishNote] = useState('');
  const [runOpen, setRunOpen] = useState(false);
  const [runMode, setRunMode] = useState<'production' | 'test'>('production');
  const [runPayload, setRunPayload] = useState('');
  const [runError, setRunError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const hydratedRef = useRef(false);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const toastTimer = useRef<number | null>(null);

  const nodes = useEditorStore((state) => state.nodes);
  const edges = useEditorStore((state) => state.edges);
  const revision = useEditorStore((state) => state.revision);
  const editSeq = useEditorStore((state) => state.editSeq);
  const dirty = useEditorStore((state) => state.dirty);
  const conflict = useEditorStore((state) => state.conflict);
  const lastSavedAt = useEditorStore((state) => state.lastSavedAt);
  const selectedNodeId = useEditorStore((state) => state.selectedNodeId);
  const onNodesChange = useEditorStore((state) => state.onNodesChange);
  const onEdgesChange = useEditorStore((state) => state.onEdgesChange);
  const onConnect = useEditorStore((state) => state.onConnect);
  const addNode = useEditorStore((state) => state.addNode);
  const updateNodeData = useEditorStore((state) => state.updateNodeData);
  const removeNode = useEditorStore((state) => state.removeNode);
  const selectNode = useEditorStore((state) => state.selectNode);
  const hydrate = useEditorStore((state) => state.hydrate);
  const markSaved = useEditorStore((state) => state.markSaved);
  const setConflict = useEditorStore((state) => state.setConflict);

  const canEdit = Boolean(workspace && WRITE_ROLES.has(workspace.role) && isDesktop);
  const canPublish = Boolean(workspace && PUBLISH_ROLES.has(workspace.role));
  const canRun = Boolean(workspace && RUN_ROLES.has(workspace.role));
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );
  const publishIssues = useMemo(
    () => validateWorkflowForPublish(flowToGraph(nodes, edges)),
    [nodes, edges],
  );

  const workflowQuery = useQuery({
    queryKey: ['workflow', workspaceId, workflowId],
    queryFn: () =>
      api<WorkflowDetail>(`/workspaces/${workspaceId}/workflows/${workflowId}`),
    enabled: Boolean(workspaceId && workflowId),
    refetchOnWindowFocus: false,
  });

  const versionsQuery = useQuery({
    queryKey: ['versions', workspaceId, workflowId],
    queryFn: () =>
      api<WorkflowVersionSummary[]>(
        `/workspaces/${workspaceId}/workflows/${workflowId}/versions`,
      ),
    enabled: versionsOpen,
  });

  useEffect(() => {
    const data = workflowQuery.data;
    if (!data || hydratedRef.current) return;
    hydrate(
      data.draft?.graph ?? { nodes: [], edges: [] },
      data.draft?.revision ?? 1,
    );
    setName(data.name);
    hydratedRef.current = true;
  }, [workflowQuery.data, hydrate]);

  useEffect(() => {
    if (workflowQuery.data) setName((current) => current || workflowQuery.data.name);
  }, [workflowQuery.data]);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4_000);
  }, []);

  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const persistDraft = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return savingRef.current;

    const state = useEditorStore.getState();
    if (!state.dirty) return true;

    const seq = state.editSeq;
    const revisionAtSave = state.revision;

    const run = async (): Promise<boolean> => {
      setSaving(true);
      setError(null);
      try {
        const response = await api<{ revision: number; updatedAt: string }>(
          `/workspaces/${workspaceId}/workflows/${workflowId}/draft`,
          {
            method: 'PUT',
            body: JSON.stringify({
              graph: flowToGraph(state.nodes, state.edges),
              revision: revisionAtSave,
            }),
          },
        );
        markSaved(response.revision, seq, response.updatedAt);
        return true;
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409) {
          setConflict(true);
          setError('تعارض: عُدّلت المسودة من جلسة أخرى. أعد تحميل النسخة قبل المتابعة.');
        } else {
          setError(caught instanceof ApiError ? caught.message : 'تعذّر حفظ المسودة.');
        }
        return false;
      } finally {
        setSaving(false);
        savingRef.current = null;
      }
    };

    const promise = run();
    savingRef.current = promise;
    return promise;
  }, [workspaceId, workflowId, markSaved, setConflict]);

  useEffect(() => {
    if (!canEdit || !dirty || conflict) return;
    const timer = window.setTimeout(() => {
      void persistDraft();
    }, 900);
    return () => window.clearTimeout(timer);
  }, [canEdit, dirty, conflict, editSeq, revision, persistDraft]);

  const reloadDraft = useCallback(async () => {
    const result = await workflowQuery.refetch();
    const data = result.data;
    if (!data) return;
    hydrate(data.draft?.graph ?? { nodes: [], edges: [] }, data.draft?.revision ?? 1);
    setName(data.name);
    setError(null);
    showToast('تم تحميل أحدث مسودة من الخادم.');
  }, [workflowQuery, hydrate, showToast]);

  async function commitName(): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed || !canEdit || trimmed === workflowQuery.data?.name) {
      setName(workflowQuery.data?.name ?? trimmed);
      return;
    }
    try {
      await api(`/workspaces/${workspaceId}/workflows/${workflowId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: trimmed }),
      });
      await queryClient.invalidateQueries({ queryKey: ['workflow', workspaceId, workflowId] });
      showToast('تم تحديث اسم الـ Workflow.');
    } catch (caught) {
      setName(workflowQuery.data?.name ?? '');
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تحديث الاسم.');
    }
  }

  async function handlePublish(): Promise<void> {
    if (!canPublish || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const saved = await persistDraft();
      if (!saved) return;
      const version = await api<WorkflowVersion>(
        `/workspaces/${workspaceId}/workflows/${workflowId}/publish`,
        { method: 'POST', body: JSON.stringify({ note: publishNote.trim() || null }) },
      );
      setPublishOpen(false);
      setPublishNote('');
      showToast(`تم نشر النسخة v${version.version}.`);
      await queryClient.invalidateQueries({ queryKey: ['versions', workspaceId, workflowId] });
      await queryClient.invalidateQueries({ queryKey: ['workflow', workspaceId, workflowId] });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر نشر الـ Workflow.');
    } finally {
      setPublishing(false);
    }
  }

  async function handleRun(): Promise<void> {
    if (!canRun || running) return;
    setRunError(null);

    let payload: unknown;
    if (runPayload.trim()) {
      try {
        payload = JSON.parse(runPayload);
      } catch {
        setRunError('بيانات التشغيل ليست JSON صالحًا.');
        return;
      }
    }

    setRunning(true);
    try {
      if (runMode === 'test') {
        const saved = await persistDraft();
        if (!saved) {
          setRunError('تعذّر حفظ المسودة قبل التشغيل التجريبي.');
          return;
        }
      }
      const execution = await api<RunResponse>(
        `/workspaces/${workspaceId}/workflows/${workflowId}/run`,
        {
          method: 'POST',
          body: JSON.stringify({ mode: runMode, payload }),
        },
      );
      setRunOpen(false);
      setRunPayload('');
      navigate(`/w/${workspaceId}/executions/${execution.id}`);
    } catch (caught) {
      setRunError(caught instanceof ApiError ? caught.message : 'تعذّر بدء التنفيذ.');
    } finally {
      setRunning(false);
    }
  }

  async function handleRollback(version: WorkflowVersionSummary): Promise<void> {    if (
      !window.confirm(
        `استعادة النسخة v${version.version}؟ ستُضاف نسخة جديدة مطابقة وتُستبدل المسودة الحالية.`,
      )
    ) {
      return;
    }
    try {
      await api(
        `/workspaces/${workspaceId}/workflows/${workflowId}/versions/${version.id}/rollback`,
        { method: 'POST' },
      );
      const result = await workflowQuery.refetch();
      if (result.data) {
        hydrate(
          result.data.draft?.graph ?? { nodes: [], edges: [] },
          result.data.draft?.revision ?? 1,
        );
        setName(result.data.name);
      }
      await queryClient.invalidateQueries({ queryKey: ['versions', workspaceId, workflowId] });
      showToast(`تمت الاستعادة إلى النسخة v${version.version}.`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّرت الاستعادة.');
    }
  }

  function handleAddNode(type: string): void {
    const center = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const offset = (nodes.length % 6) * 32;
    addNode(type, { x: Math.round(center.x - 112 + offset), y: Math.round(center.y - 40 + offset) });
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

  if (workflowQuery.isLoading) {
    return (
      <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
        <div className="grid h-[60vh] place-items-center">
          <div className="size-7 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
        </div>
      </AppShell>
    );
  }

  if (workflowQuery.error) {
    return (
      <AppShell workspaceName={workspace.name} workspaceId={workspace.id}>
        <main className="mx-auto max-w-3xl px-6 py-16 text-center">
          <p className="text-rose-300">
            {workflowQuery.error instanceof ApiError
              ? workflowQuery.error.message
              : 'تعذّر تحميل الـ Workflow.'}
          </p>
          <Link
            to={`/w/${workspaceId}`}
            className="mt-4 inline-block text-sm text-sky-400 hover:text-sky-300"
          >
            العودة إلى القائمة
          </Link>
        </main>
      </AppShell>
    );
  }

  const saveBadge = conflict
    ? { label: 'تعارض في المسودة', className: 'text-rose-300 bg-rose-400/10 border-rose-400/20' }
    : saving
      ? { label: 'جارٍ الحفظ…', className: 'text-amber-300 bg-amber-400/10 border-amber-400/20' }
      : dirty
        ? {
            label: 'تعديلات غير محفوظة',
            className: 'text-slate-300 bg-slate-400/10 border-slate-400/20',
          }
        : {
            label: lastSavedAt ? 'محفوظ الآن' : 'متزامن',
            className: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20',
          };

  return (
    <AppShell
      workspaceName={workspace.name}
      workspaceId={workspace.id}
      wide
      actions={
        <>
          <Link
            to={`/w/${workspaceId}`}
            className="hidden rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/5 sm:block"
          >
            القائمة
          </Link>
          <Link
            to={`/w/${workspaceId}/executions`}
            className="hidden rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-white/5 sm:block"
          >
            التنفيذات
          </Link>
          {canRun && (
            <button
              type="button"
              onClick={() => {
                setRunMode(workflowQuery.data?.currentVersionId ? 'production' : 'test');
                setRunError(null);
                setRunOpen(true);
              }}
              className="rounded-lg bg-sky-500 px-3.5 py-1.5 text-xs font-bold text-white transition hover:bg-sky-400"
            >
              تشغيل
            </button>
          )}
          <button
            type="button"
            onClick={() => setVersionsOpen(true)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition hover:bg-white/5"
          >
            الإصدارات
          </button>
          <button
            type="button"
            onClick={() => setValidationOpen(true)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-white/5 ${
              publishIssues.length > 0
                ? 'border-amber-400/30 bg-amber-400/10 text-amber-200'
                : 'border-white/10 text-slate-200'
            }`}
          >
            التحقق {publishIssues.length > 0 ? `(${publishIssues.length})` : '✓'}
          </button>
          {canPublish && (
            <button
              type="button"
              onClick={() => setPublishOpen(true)}
              disabled={publishing || conflict || publishIssues.length > 0}
              title={
                publishIssues.length > 0 ? 'أصلح مشكلات التحقق قبل النشر' : 'نشر نسخة جديدة'
              }
              className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
              {publishing ? 'جارٍ النشر…' : 'نشر'}
            </button>
          )}
        </>
      }
    >
      <div className="flex h-[calc(100dvh-57px)] flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 bg-slate-950/80 px-4 py-2.5">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
            disabled={!canEdit}
            className="min-w-40 max-w-xs flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-bold text-white outline-none transition focus:border-white/10 focus:bg-slate-900 sm:flex-none sm:w-64"
          />
          <span
            className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${saveBadge.className}`}
          >
            {saveBadge.label}
          </span>
          <span className="text-[11px] text-slate-600" dir="ltr">
            r{revision}
          </span>

          {toast && (
            <span className="rounded-lg bg-sky-400/10 px-3 py-1 text-[11px] text-sky-300">
              {toast}
            </span>
          )}

          {conflict && (
            <button
              type="button"
              onClick={() => void reloadDraft()}
              className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-1 text-[11px] font-bold text-rose-200"
            >
              إعادة تحميل المسودة
            </button>
          )}

          {!isDesktop && (
            <span className="rounded-lg bg-amber-400/10 px-3 py-1 text-[11px] text-amber-300">
              الجوال للقراءة فقط — استخدم سطح المكتب للتحرير.
            </span>
          )}
        </div>

        {error && (
          <div className="flex items-center justify-between gap-3 border-b border-rose-400/20 bg-rose-400/5 px-4 py-2 text-xs text-rose-300">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-rose-400">
              ✕
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          {canEdit && (
            <aside className="hidden w-60 shrink-0 overflow-y-auto border-l border-white/10 bg-slate-950/60 p-3 lg:block">
              <p className="mb-3 px-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                إضافة عقدة
              </p>
              {(['trigger', 'action', 'logic'] as const).map((group) => (
                <div key={group} className="mb-4">
                  <p className="mb-2 px-1 text-[10px] font-semibold text-slate-600">
                    {GROUP_LABELS[group]}
                  </p>
                  <div className="space-y-1.5">
                    {NODE_CATALOG.filter((meta) => meta.group === group).map((meta) => (
                      <button
                        key={meta.type}
                        type="button"
                        onClick={() => handleAddNode(meta.type)}
                        title={meta.description}
                        className="flex w-full items-center gap-2.5 rounded-xl border border-white/5 bg-slate-900/60 px-2.5 py-2 text-right transition hover:border-sky-400/30 hover:bg-slate-900"
                      >
                        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/5 text-xs text-slate-300">
                          {meta.icon}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-slate-200">
                            {meta.label}
                          </span>
                          <span className="block truncate text-[10px] text-slate-600">
                            {meta.description}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </aside>
          )}

          <div className="relative min-w-0 flex-1" dir="ltr">
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              defaultEdgeOptions={defaultEdgeOptions}
              fitView
              fitViewOptions={{ padding: 0.25 }}
              minZoom={0.15}
              maxZoom={2}
              deleteKeyCode={canEdit ? ['Backspace', 'Delete'] : null}
              nodesDraggable={canEdit}
              nodesConnectable={canEdit}
              elementsSelectable
              onNodeClick={(_, node) => selectNode(node.id)}
              onPaneClick={() => selectNode(null)}
              proOptions={{ hideAttribution: true }}
              className="bg-slate-950"
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#1e293b" />
              <Controls
                showInteractive={false}
                className="!rounded-xl !border !border-white/10 !bg-slate-900 !shadow-xl"
              />
              <MiniMap
                pannable
                zoomable
                className="!rounded-xl !border !border-white/10 !bg-slate-900"
                maskColor="rgba(2,6,23,0.65)"
                nodeColor="#334155"
              />
            </ReactFlow>

            {nodes.length === 0 && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="rounded-2xl border border-dashed border-white/10 bg-slate-900/70 px-8 py-6 text-center backdrop-blur">
                  <p className="text-sm font-semibold text-slate-200">ابدأ بإضافة Trigger</p>
                  <p className="mt-1 text-xs text-slate-500">
                    اختر «بدء يدوي» أو «Webhook» أو «جدولة» من اللوحة الجانبية.
                  </p>
                </div>
              </div>
            )}
          </div>

          {selectedNode && (
            <NodeInspector
              node={selectedNode}
              workspaceId={workspaceId}
              canEdit={canEdit}
              onUpdate={updateNodeData}
              onRemove={removeNode}
              onClose={() => selectNode(null)}
            />
          )}
        </div>
      </div>

      {runOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white">تشغيل الـ Workflow</h2>
            <p className="mt-1 text-sm text-slate-400">
              اختر نسخة الإنتاج المنشورة أو شغّل المسودة الحالية تجريبيًا.
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setRunMode('production')}
                disabled={!workflowQuery.data?.currentVersionId}
                className={`rounded-xl border p-3 text-right transition ${
                  runMode === 'production'
                    ? 'border-sky-400/40 bg-sky-400/10'
                    : 'border-white/10 hover:bg-white/5'
                } disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <span className="block text-xs font-bold text-white">الإنتاج</span>
                <span className="mt-1 block text-[10px] text-slate-400">
                  {workflowQuery.data?.currentVersionId
                    ? 'يستخدم النسخة المنشورة الحالية'
                    : 'انشر الـ Workflow أولًا'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setRunMode('test')}
                className={`rounded-xl border p-3 text-right transition ${
                  runMode === 'test'
                    ? 'border-amber-400/40 bg-amber-400/10'
                    : 'border-white/10 hover:bg-white/5'
                }`}
              >
                <span className="block text-xs font-bold text-white">تجريبي</span>
                <span className="mt-1 block text-[10px] text-slate-400">
                  يحفظ المسودة ثم يشغّلها في نسخة اختبارية
                </span>
              </button>
            </div>

            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-400">
                بيانات التشغيل (JSON اختياري)
              </span>
              <textarea
                value={runPayload}
                onChange={(event) => setRunPayload(event.target.value)}
                placeholder={'{\n  "orderId": "A-100"\n}'}
                rows={6}
                dir="ltr"
                className="w-full resize-y rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-left font-mono text-xs text-slate-200 outline-none placeholder:text-slate-700 focus:border-sky-400/50"
              />
            </label>

            {runError && (
              <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">
                {runError}
              </p>
            )}

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRunOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={
                  running || (runMode === 'production' && !workflowQuery.data?.currentVersionId)
                }
                className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-400 disabled:opacity-50"
              >
                {running ? 'جارٍ التشغيل…' : 'تشغيل الآن'}
              </button>
            </div>
          </div>
        </div>
      )}

      {publishOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white">نشر نسخة جديدة</h2>
            <p className="mt-1 text-sm text-slate-400">
              ستُنشأ نسخة غير قابلة للتعديل، ويصبح التنفيذ التالي مربوطًا بها.
            </p>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-xs font-semibold text-slate-400">
                ملاحظة الإصدار (اختياري)
              </span>
              <input
                value={publishNote}
                onChange={(event) => setPublishNote(event.target.value)}
                placeholder="مثال: إصلاح مسار الخطأ"
                maxLength={500}
                className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-4 py-2.5 text-sm outline-none focus:border-sky-400/50"
              />
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPublishOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/5"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handlePublish()}
                disabled={publishing}
                className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {publishing ? 'جارٍ النشر…' : 'تأكيد النشر'}
              </button>
            </div>
          </div>
        </div>
      )}

      {validationOpen && (
        <div className="fixed inset-0 z-50 flex justify-start bg-slate-950/60 backdrop-blur-sm">
          <button
            type="button"
            aria-label="إغلاق"
            className="absolute inset-0 cursor-default"
            onClick={() => setValidationOpen(false)}
          />
          <aside className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">تحقق النشر</h2>
              <button
                type="button"
                onClick={() => setValidationOpen(false)}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-400"
              >
                إغلاق
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              يفحص العقد المفعّلة، معاملاتها، تعبيرات JSONata، وبنية الرسم قبل النشر.
            </p>

            {publishIssues.length === 0 ? (
              <div className="mt-6 rounded-xl border border-emerald-400/20 bg-emerald-400/5 p-5 text-center">
                <p className="text-sm font-bold text-emerald-300">جاهز للنشر ✓</p>
                <p className="mt-1 text-xs text-emerald-200/60">
                  لا توجد مشكلات مانعة في المسودة الحالية.
                </p>
              </div>
            ) : (
              <div className="mt-5 space-y-2">
                {publishIssues.map((issue, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => {
                      if (issue.nodeId) selectNode(issue.nodeId);
                    }}
                    className="w-full rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-right transition hover:bg-amber-400/10"
                  >
                    <p className="text-xs font-semibold text-amber-200">
                      {issue.nodeName ?? 'الرسم'} {issue.path ? `· ${issue.path}` : ''}
                    </p>
                    <p className="mt-1 text-[11px] leading-5 text-amber-200/70">{issue.message}</p>
                  </button>
                ))}
              </div>
            )}
          </aside>
        </div>
      )}

      {versionsOpen && (
        <div className="fixed inset-0 z-50 flex justify-start bg-slate-950/60 backdrop-blur-sm">
          <button
            type="button"
            aria-label="إغلاق"
            className="absolute inset-0 cursor-default"
            onClick={() => setVersionsOpen(false)}
          />
          <aside className="relative z-10 h-full w-full max-w-md overflow-y-auto border-l border-white/10 bg-slate-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">الإصدارات المنشورة</h2>
              <button
                type="button"
                onClick={() => setVersionsOpen(false)}
                className="rounded-lg border border-white/10 px-2.5 py-1 text-xs text-slate-400"
              >
                إغلاق
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              كل الإصدارات محفوظة للأبد، والاستعادة تُنشئ نسخة جديدة.
            </p>

            <div className="mt-5 space-y-2">
              {versionsQuery.isLoading && (
                <p className="py-6 text-center text-xs text-slate-500">جارٍ التحميل…</p>
              )}
              {versionsQuery.data?.length === 0 && (
                <p className="rounded-xl border border-dashed border-white/10 py-8 text-center text-xs text-slate-500">
                  لم يُنشر أي إصدار بعد.
                </p>
              )}
              {versionsQuery.data?.map((version) => (
                <div
                  key={version.id}
                  className="rounded-xl border border-white/10 bg-slate-900/60 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-lg bg-sky-400/10 px-2 py-0.5 text-xs font-bold text-sky-300">
                      v{version.version ?? '—'}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {formatRelative(version.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-slate-300">{version.note || 'بلا ملاحظة'}</p>
                  <p className="mt-1 text-[10px] text-slate-600">
                    {version.createdByEmail ?? 'نظام'} · {formatDateTime(version.createdAt)}
                  </p>
                  {canPublish && (
                    <button
                      type="button"
                      onClick={() => void handleRollback(version)}
                      className="mt-3 w-full rounded-lg border border-white/10 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition hover:bg-white/5"
                    >
                      استعادة هذه النسخة
                    </button>
                  )}
                </div>
              ))}
            </div>
          </aside>
        </div>
      )}
    </AppShell>
  );
}

function NodeInspector({
  node,
  workspaceId,
  canEdit,
  onUpdate,
  onRemove,
  onClose,
}: {
  node: MadarNode;
  workspaceId: string;
  canEdit: boolean;
  onUpdate: (id: string, patch: Partial<MadarNode['data']>) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const meta = metaFor(node.data.nodeType);
  const [paramsText, setParamsText] = useState(() =>
    JSON.stringify(node.data.parameters ?? {}, null, 2),
  );
  const [paramsError, setParamsError] = useState<string | null>(null);
  const [notes, setNotes] = useState(node.data.notes ?? '');
  const [tab, setTab] = useState<'form' | 'json'>('form');
  const jsonIssues = [
    ...validateNodeParameters(node.data.nodeType, node.data.parameters),
    ...validateExpressionsIn(node.data.parameters),
  ];

  useEffect(() => {
    setParamsText(JSON.stringify(node.data.parameters ?? {}, null, 2));
    setParamsError(null);
    setNotes(node.data.notes ?? '');
    // Only reset the editor when switching to a different node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  function applyParameters(): void {
    try {
      const parsed = JSON.parse(paramsText) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setParamsError('يجب أن تكون المعاملات كائن JSON.');
        return;
      }
      setParamsError(null);
      onUpdate(node.id, { parameters: parsed as Record<string, unknown> });
    } catch {
      setParamsError('JSON غير صالح.');
    }
  }

  return (
    <aside className="hidden w-80 shrink-0 overflow-y-auto border-r border-white/10 bg-slate-950/60 p-4 lg:block">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
            {meta.group}
          </p>
          <h2 className="mt-1 text-sm font-bold text-white">{meta.label}</h2>
          <p className="mt-0.5 text-[10px] text-slate-600" dir="ltr">
            {node.data.nodeType} · v{node.data.typeVersion}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-white/10 px-2 py-1 text-[10px] text-slate-400"
        >
          ✕
        </button>
      </div>

      <label className="mt-5 block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">اسم العقدة</span>
        <input
          value={node.data.label}
          onChange={(event) => onUpdate(node.id, { label: event.target.value })}
          disabled={!canEdit}
          className="w-full rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-sky-400/50 disabled:opacity-60"
        />
      </label>

      <label className="mt-3 flex items-center gap-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={Boolean(node.data.disabled)}
          onChange={(event) => onUpdate(node.id, { disabled: event.target.checked })}
          disabled={!canEdit}
          className="size-4 accent-sky-500"
        />
        تعطيل العقدة مؤقتًا
      </label>

      <div className="mt-5">
        <div className="flex rounded-lg bg-slate-900 p-0.5">
          {(['form', 'json'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`flex-1 rounded-md px-2 py-1.5 text-[11px] font-semibold transition ${
                tab === value ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {value === 'form' ? 'النموذج' : 'JSON متقدم'}
            </button>
          ))}
        </div>

        {tab === 'form' ? (
          <NodeForm
            node={node}
            canEdit={canEdit}
            workspaceId={workspaceId}
            onChange={(patch) => onUpdate(node.id, patch)}
          />
        ) : (
          <div className="mt-3">
            <Suspense
              fallback={<div className="h-[300px] animate-pulse rounded-xl bg-slate-900" />}
            >
              <MonacoJsonEditor
                value={paramsText}
                onChange={setParamsText}
                readOnly={!canEdit}
              />
            </Suspense>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] text-slate-600">
                {jsonIssues.length > 0 ? `${jsonIssues.length} مشكلة تحقق` : 'JSON صالح'}
              </span>
              <button
                type="button"
                onClick={applyParameters}
                disabled={!canEdit}
                className="rounded-lg bg-sky-500/15 px-2.5 py-1 text-[10px] font-bold text-sky-300 transition hover:bg-sky-500/25 disabled:opacity-50"
              >
                تطبيق JSON
              </button>
            </div>
            {paramsError && <p className="mt-1 text-[11px] text-rose-300">{paramsError}</p>}
            {jsonIssues.length > 0 && (
              <ul className="mt-1 space-y-1 text-[10px] leading-5 text-amber-200/70">
                {jsonIssues.slice(0, 4).map((issue, index) => (
                  <li key={index}>• {issue.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <label className="mt-4 block">
        <span className="mb-1.5 block text-[11px] font-semibold text-slate-400">ملاحظات</span>
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => onUpdate(node.id, { notes })}
          disabled={!canEdit}
          rows={3}
          className="w-full resize-y rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200 outline-none focus:border-sky-400/50 disabled:opacity-60"
        />
      </label>

      <button
        type="button"
        onClick={() => {
          if (window.confirm('حذف هذه العقدة من المسودة؟')) onRemove(node.id);
        }}
        disabled={!canEdit}
        className="mt-5 w-full rounded-xl border border-rose-400/20 bg-rose-400/5 px-3 py-2 text-xs font-semibold text-rose-300 transition hover:bg-rose-400/10 disabled:opacity-50"
      >
        حذف العقدة
      </button>
    </aside>
  );
}
