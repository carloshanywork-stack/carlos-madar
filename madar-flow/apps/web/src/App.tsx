import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { LoadingScreen } from './components/ui';
import { AuditPage } from './pages/AuditPage';
import { AuthPage } from './pages/AuthPage';
import { CredentialsPage } from './pages/CredentialsPage';
import { EditorPage } from './pages/EditorPage';
import { ExecutionDetailPage } from './pages/ExecutionDetailPage';
import { ExecutionsPage } from './pages/ExecutionsPage';
import { SecurityPage } from './pages/SecurityPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { WorkspacesPage } from './pages/WorkspacesPage';
import { useSession } from './session';

function RequireSession({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') return <LoadingScreen label="جارٍ التحقق من الجلسة…" />;
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<AuthPage />} />
      <Route
        path="/"
        element={
          <RequireSession>
            <WorkspacesPage />
          </RequireSession>
        }
      />
      <Route
        path="/w/:workspaceId"
        element={
          <RequireSession>
            <WorkflowsPage />
          </RequireSession>
        }
      />
      <Route
        path="/w/:workspaceId/workflows/:workflowId"
        element={
          <RequireSession>
            <EditorPage />
          </RequireSession>
        }
      />
      <Route
        path="/w/:workspaceId/executions"
        element={
          <RequireSession>
            <ExecutionsPage />
          </RequireSession>
        }
      />
      <Route
        path="/w/:workspaceId/executions/:executionId"
        element={
          <RequireSession>
            <ExecutionDetailPage />
          </RequireSession>
        }
      />
      <Route
        path="/w/:workspaceId/credentials"
        element={
          <RequireSession>
            <CredentialsPage />
          </RequireSession>
        }
      />
      <Route
        path="/w/:workspaceId/audit"
        element={
          <RequireSession>
            <AuditPage />
          </RequireSession>
        }
      />
      <Route
        path="/w/:workspaceId/security"
        element={
          <RequireSession>
            <SecurityPage />
          </RequireSession>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
