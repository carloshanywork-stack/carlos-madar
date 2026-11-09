const API_BASE = '/api/v1';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

let accessToken: string | null = null;
let tokenListener: ((token: string | null) => void) | null = null;
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
  tokenListener?.(token);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setTokenListener(listener: ((token: string | null) => void) | null): void {
  tokenListener = listener;
}

async function refreshAccessToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        setAccessToken(null);
        return null;
      }
      const body = (await response.json()) as { accessToken: string };
      setAccessToken(body.accessToken);
      return body.accessToken;
    })()
      .catch(() => {
        setAccessToken(null);
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

export interface ApiRequestOptions extends RequestInit {
  token?: string | null;
}

async function request<T>(path: string, options: ApiRequestOptions, retry: boolean): Promise<T> {
  const { token, headers, ...rest } = options;
  const bearer = token === undefined ? accessToken : token;

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: 'include',
    headers: {
      ...(rest.body ? { 'content-type': 'application/json' } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...headers,
    },
  });

  const body = (await response.json().catch(() => null)) as
    | { detail?: string; title?: string; code?: string }
    | null;

  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return request<T>(path, { ...options, token: refreshed }, false);
  }

  if (!response.ok) {
    throw new ApiError(
      body?.detail ?? body?.title ?? `HTTP ${response.status}`,
      response.status,
      body?.code,
    );
  }

  return body as T;
}

export function api<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  return request<T>(path, options, true);
}

export async function bootstrapSession(): Promise<AuthResponse | null> {
  return request<AuthResponse>('/auth/refresh', { method: 'POST' }, false).catch(() => null);
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  role: string;
  createdAt?: string;
}

export interface AuthResponse {
  accessToken: string;
  user: User;
}

export interface RegisterResponse extends AuthResponse {
  workspace: Workspace;
}

export interface WorkflowSummary {
  id: string;
  name: string;
  description: string | null;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  draftRevision: number | null;
  updatedByDraftAt: string | null;
}

export interface WorkflowVersionSummary {
  id: string;
  version: number | null;
  kind: string;
  note: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByEmail: string | null;
}

export interface WorkflowGraph {
  nodes: Array<{
    id: string;
    type: string;
    typeVersion: number;
    name: string;
    position: { x: number; y: number };
    parameters: Record<string, unknown>;
    disabled?: boolean;
    notes?: string;
  }>;
  edges: Array<{
    id: string;
    source: string;
    sourceHandle?: string;
    target: string;
    targetHandle?: string;
  }>;
}

export interface WorkflowDetail extends WorkflowSummary {
  createdBy: string | null;
  draft: {
    id: string;
    graph: WorkflowGraph;
    revision: number;
    updatedAt: string;
    updatedBy: string | null;
  } | null;
  versions: WorkflowVersionSummary[];
}

export interface WorkflowVersion extends WorkflowVersionSummary {
  workflowId: string;
  graph: WorkflowGraph;
}

export const ROLE_LABELS: Record<string, string> = {
  owner: 'مالك',
  admin: 'مدير',
  editor: 'محرر',
  runner: 'مشغّل',
  viewer: 'مشاهد',
};

export const WRITE_ROLES = new Set(['owner', 'admin', 'editor']);
export const PUBLISH_ROLES = new Set(['owner', 'admin', 'editor']);
export const RUN_ROLES = new Set(['owner', 'admin', 'editor', 'runner']);

export type ExecutionStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export interface ExecutionError {
  message?: string;
  code?: string;
  details?: unknown;
}

export interface ExecutionSummary {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersionId: string;
  version: number | null;
  versionKind: string;
  mode: string;
  triggerType: string;
  triggerNodeId: string | null;
  status: ExecutionStatus;
  hasErrors: boolean;
  error: ExecutionError | null;
  retryOfExecutionId: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ExecutionStep {
  id: string;
  executionId: string;
  nodeId: string;
  nodeType: string;
  iteration: number;
  attempt: number;
  status: string;
  input: unknown;
  output: unknown;
  error: ExecutionError | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface ExecutionEvent {
  id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown> | null;
  createdAt: string;
}

export interface ExecutionDetail extends ExecutionSummary {
  workspaceId: string;
  triggerPayload: unknown;
  idempotencyKey: string | null;
  steps: ExecutionStep[];
  events: ExecutionEvent[];
  payloadAccess: boolean;
}

export interface RunResponse {
  id: string;
  workspaceId: string;
  workflowId: string;
  workflowName: string;
  workflowVersionId: string;
  mode: string;
  triggerType: string;
  status: ExecutionStatus;
  hasErrors: boolean;
  createdAt: string;
}

export interface CredentialMetadata {
  id: string;
  workspaceId: string;
  name: string;
  type: string;
  keyVersion: number;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

export interface CredentialPreflight {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; message?: string }>;
}

export const CREDENTIAL_ADMIN_ROLES = new Set(['owner', 'admin']);
export const AUDIT_ROLES = new Set(['owner', 'admin']);

export interface AuditLogEntry {
  id: string;
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  ip: string | null;
  userAgent: string | null;
  traceId: string | null;
  createdAt: string;
}

export interface MfaStatus {
  admin: boolean;
  totpEnabled: boolean;
  setupPending: boolean;
  confirmedAt: string | null;
}

export interface MfaChallengeResponse {
  mfaRequired: true;
  challengeToken: string;
  user: User;
}

export interface WorkflowTemplateSummary {
  id: string;
  name: string;
  description: string;
  category: string;
  trigger: 'manual' | 'webhook' | 'schedule';
  nodeTypes: string[];
  requiresHmacCredentialFor: string[];
  placeholders: Array<{
    nodeId: string;
    label: string;
    parameter: 'url';
    value: string;
  }>;
}
