-- 0001_initial.sql
-- Initial schema for Madar Flow (Phase 0/1 core).
-- All business tables are append-only in spirit: no automatic deletion.

CREATE TABLE workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX workspaces_slug_uq ON workspaces (slug);

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  totp_secret_encrypted text,
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX users_email_uq ON users (email);

CREATE TABLE memberships (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memberships_role_chk CHECK (role IN ('owner', 'admin', 'editor', 'runner', 'viewer'))
);
CREATE UNIQUE INDEX memberships_workspace_user_uq ON memberships (workspace_id, user_id);
CREATE INDEX memberships_user_idx ON memberships (user_id);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  family_id uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  grace_expires_at timestamptz,
  replaced_by_id uuid,
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refresh_tokens_hash_uq ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

CREATE TABLE workflows (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name text NOT NULL,
  description text,
  current_version_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX workflows_workspace_idx ON workflows (workspace_id);
CREATE INDEX workflows_workspace_created_idx ON workflows (workspace_id, created_at);

CREATE TABLE workflow_drafts (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  graph jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX workflow_drafts_workflow_uq ON workflow_drafts (workflow_id);

CREATE TABLE workflow_versions (
  id uuid PRIMARY KEY,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  version integer,
  kind text NOT NULL DEFAULT 'production',
  graph jsonb NOT NULL,
  note text,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_versions_kind_chk CHECK (kind IN ('production', 'test')),
  CONSTRAINT workflow_versions_version_chk CHECK (
    (kind = 'production' AND version IS NOT NULL)
    OR (kind = 'test' AND version IS NULL)
  )
);
CREATE UNIQUE INDEX workflow_versions_prod_uq
  ON workflow_versions (workflow_id, version)
  WHERE kind = 'production';
CREATE INDEX workflow_versions_workflow_idx ON workflow_versions (workflow_id, created_at);

CREATE TABLE credentials (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  name text NOT NULL,
  type text NOT NULL,
  encrypted_payload text NOT NULL,
  key_version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX credentials_workspace_idx ON credentials (workspace_id);

CREATE TABLE executions (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE RESTRICT,
  workflow_version_id uuid NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  trigger_type text NOT NULL,
  mode text NOT NULL DEFAULT 'production',
  status text NOT NULL DEFAULT 'queued',
  has_errors boolean NOT NULL DEFAULT false,
  error jsonb,
  retry_of_execution_id uuid REFERENCES executions(id) ON DELETE RESTRICT,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT executions_mode_chk CHECK (mode IN ('test', 'production')),
  CONSTRAINT executions_status_chk CHECK (
    status IN ('queued', 'running', 'waiting', 'succeeded', 'failed', 'canceled')
  )
);
CREATE INDEX executions_workspace_created_idx ON executions (workspace_id, created_at);
CREATE INDEX executions_workflow_created_idx ON executions (workflow_id, created_at);
CREATE INDEX executions_status_idx ON executions (status);

CREATE TABLE execution_steps (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
  node_id text NOT NULL,
  node_type text NOT NULL,
  iteration integer NOT NULL DEFAULT 0,
  attempt integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  input jsonb,
  output jsonb,
  error jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  CONSTRAINT execution_steps_status_chk CHECK (
    status IN ('pending', 'running', 'succeeded', 'failed', 'skipped')
  )
);
CREATE UNIQUE INDEX execution_steps_unique_uq
  ON execution_steps (execution_id, node_id, iteration, attempt);
CREATE INDEX execution_steps_execution_idx ON execution_steps (execution_id);

CREATE TABLE execution_events (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL REFERENCES executions(id) ON DELETE RESTRICT,
  seq bigint NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX execution_events_execution_seq_uq ON execution_events (execution_id, seq);
CREATE INDEX execution_events_execution_created_idx ON execution_events (execution_id, created_at);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  workspace_id uuid,
  actor_user_id uuid,
  actor_label text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  old_values jsonb,
  new_values jsonb,
  ip text,
  user_agent text,
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_workspace_created_idx ON audit_logs (workspace_id, created_at);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
CREATE INDEX outbox_pending_idx ON outbox (dispatched_at);

CREATE TABLE outbox_archive (
  id uuid PRIMARY KEY,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  archived_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbox_archive_created_idx ON outbox_archive (created_at);
