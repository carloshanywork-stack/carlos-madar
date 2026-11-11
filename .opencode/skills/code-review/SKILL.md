---
name: MADAR Code Review
description: Review MADAR V2 diffs for correctness, security, authorization, SQLite safety, and financial/inventory invariants before commit.
---

# MADAR V2 review checklist

- Review the complete diff and adjacent call paths. Report findings first, ordered by severity, with file/line references and concrete impact; distinguish verified defects from questions.
- Verify authentication, role/ownership checks, and Admin-only boundaries on every sensitive API path. Do not trust client-supplied actor, role, biometric, approval, or financial state.
- For financial and warehouse changes, trace the full transaction and rollback path; check cash/invoice separation, whole-unit main stock, offcut accounting, audit events, and preservation of IDs/history.
- Check input validation, path traversal/symlink protections, safe file handling, secrets in logs, and whether customer data or telemetry leaves the local/LAN boundary.
- Require additive/idempotent migrations and isolated temporary SQLite/storage fixtures. Never run tests against the configured business database or real customer storage.
- Suggest the smallest safe fix. Do not perform broad automated rewrites, destructive cleanup, or production operations as part of review.
