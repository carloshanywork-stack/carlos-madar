-- 0003_phase4.sql
-- Admin TOTP, recovery codes, credential usage tracking, and audit filtering.

ALTER TABLE users ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN totp_confirmed_at timestamptz;
ALTER TABLE users ADD COLUMN totp_last_used_step bigint;

CREATE TABLE user_recovery_codes (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  code_hash text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX user_recovery_codes_user_hash_uq
  ON user_recovery_codes (user_id, code_hash);

CREATE INDEX user_recovery_codes_user_idx
  ON user_recovery_codes (user_id);

CREATE INDEX audit_logs_workspace_action_idx
  ON audit_logs (workspace_id, action, created_at DESC);

ALTER TABLE credentials ADD COLUMN last_used_at timestamptz;
