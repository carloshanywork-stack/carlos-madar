import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../session';

export function Logo({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <div
      className={`grid place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-600 font-black text-white shadow-lg shadow-sky-500/20 ${
        size === 'sm' ? 'size-8 text-xs' : 'size-10 text-sm'
      }`}
    >
      MF
    </div>
  );
}

export function LoadingScreen({ label = 'جارٍ التحميل…' }: { label?: string }) {
  return (
    <div className="grid min-h-screen place-items-center bg-slate-950">
      <div className="flex flex-col items-center gap-4">
        <Logo />
        <div className="size-6 animate-spin rounded-full border-2 border-slate-700 border-t-sky-400" />
        <p className="text-sm text-slate-500">{label}</p>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  workspaceName,
  workspaceId,
  actions,
  wide = false,
}: {
  children: React.ReactNode;
  workspaceName?: string;
  workspaceId?: string;
  actions?: React.ReactNode;
  wide?: boolean;
}) {
  const { user, workspaces, logout } = useSession();
  const navigate = useNavigate();
  const workspace = workspaces.find((entry) => entry.id === workspaceId);
  const isAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';

  async function handleLogout(): Promise<void> {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-slate-950/85 backdrop-blur">
        <div
          className={`mx-auto flex items-center justify-between gap-4 px-4 py-3 sm:px-6 ${
            wide ? 'max-w-[1600px]' : 'max-w-6xl'
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <Link to="/" className="shrink-0" aria-label="Madar Flow">
              <Logo size="sm" />
            </Link>
            <div className="min-w-0">
              <Link to="/" className="block truncate text-sm font-bold text-white">
                Madar Flow
              </Link>
              <p className="truncate text-xs text-slate-500">
                {workspaceName ?? 'منصة أتمتة سير العمل'}
              </p>
            </div>
            {workspaceId && (
              <nav className="mr-2 hidden items-center gap-1 text-xs sm:flex">
                <Link
                  to={`/w/${workspaceId}`}
                  className="rounded-lg px-2.5 py-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
                >
                  Workflows
                </Link>
                <Link
                  to={`/w/${workspaceId}/executions`}
                  className="rounded-lg px-2.5 py-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
                >
                  التنفيذات
                </Link>
                {isAdmin && (
                  <>
                    <Link
                      to={`/w/${workspaceId}/credentials`}
                      className="rounded-lg px-2.5 py-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
                    >
                      الاعتمادات
                    </Link>
                    <Link
                      to={`/w/${workspaceId}/audit`}
                      className="rounded-lg px-2.5 py-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
                    >
                      التدقيق
                    </Link>
                  </>
                )}
                <Link
                  to={`/w/${workspaceId}/security`}
                  className="rounded-lg px-2.5 py-1.5 text-slate-400 transition hover:bg-white/5 hover:text-slate-200"
                >
                  الأمان
                </Link>
              </nav>
            )}
          </div>

          <div className="flex items-center gap-3">
            {actions}
            <span className="hidden max-w-40 truncate text-sm text-slate-400 sm:block">
              {user?.displayName}
            </span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/5"
            >
              خروج
            </button>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
