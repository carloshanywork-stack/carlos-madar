import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, ROLE_LABELS, type Workspace } from '../api';
import { AppShell } from '../components/ui';
import { useSession } from '../session';

export function WorkspacesPage() {
  const { workspaces, addWorkspace } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    setBusy(true);
    setError(null);
    try {
      const workspace = await api<Workspace>('/workspaces', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed }),
      });
      addWorkspace(workspace);
      setName('');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذر إنشاء مساحة العمل.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell>
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-white">مساحات العمل</h1>
            <p className="mt-1 text-sm text-slate-400">مساحاتك المعزولة وأدوارك فيها.</p>
          </div>

          <form onSubmit={handleCreate} className="flex w-full gap-2 sm:w-auto">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="اسم مساحة جديدة"
              className="w-full rounded-xl border border-white/10 bg-slate-900/60 px-4 py-2 text-sm outline-none placeholder:text-slate-600 focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20 sm:w-56"
            />
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="shrink-0 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              إنشاء
            </button>
          </form>
        </div>

        {error && (
          <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-300">
            {error}
          </p>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              to={`/w/${workspace.id}`}
              className="group rounded-2xl border border-white/10 bg-slate-900/50 p-5 transition hover:border-sky-400/30 hover:bg-slate-900/80"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate font-semibold text-white group-hover:text-sky-200">
                    {workspace.name}
                  </h2>
                  <p className="mt-1 truncate text-xs text-slate-500" dir="ltr">
                    {workspace.slug}
                  </p>
                </div>
                <span className="shrink-0 rounded-full border border-sky-400/20 bg-sky-400/10 px-2.5 py-1 text-[11px] font-semibold text-sky-300">
                  {ROLE_LABELS[workspace.role] ?? workspace.role}
                </span>
              </div>
              <p className="mt-6 text-[11px] text-slate-600">
                المعرف: <span dir="ltr">{workspace.id.slice(0, 8)}…</span>
              </p>
            </Link>
          ))}
        </div>

        {workspaces.length === 0 && (
          <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-slate-900/30 p-10 text-center">
            <p className="text-sm text-slate-400">لا توجد مساحات عمل بعد. أنشئ واحدة للبدء.</p>
          </div>
        )}

        <section className="mt-10 rounded-2xl border border-white/10 bg-slate-900/40 p-6">
          <h2 className="text-sm font-semibold text-slate-200">جاهز للبناء</h2>
          <p className="mt-2 text-sm leading-7 text-slate-400">
            اختر مساحة عمل لإنشاء Workflow، ثم صمّم الرسم، احفظ المسودة تلقائيًا، وانشر نسخة
            ثابتة قابلة للاستعادة في أي وقت.
          </p>
        </section>
      </main>
    </AppShell>
  );
}
