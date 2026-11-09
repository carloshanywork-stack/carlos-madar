-- 0002_phase3.sql
-- Execution trigger payloads, idempotency, and trigger node selection.

ALTER TABLE executions ADD COLUMN trigger_payload jsonb;
ALTER TABLE executions ADD COLUMN trigger_node_id text;
ALTER TABLE executions ADD COLUMN idempotency_key text;

CREATE UNIQUE INDEX executions_idempotency_uq
  ON executions (workflow_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
