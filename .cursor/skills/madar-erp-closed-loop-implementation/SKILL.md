---
name: madar-erp-closed-loop-implementation
description: Implements MADAR ERP staff, attendance, maintenance, manufacturing, inventory, treasury and receivables workflows. Use when changing MADAR domain code or connecting business operations to SQLite, warehouses, payroll, cash, reports or local storage.
---

# MADAR ERP Closed-Loop Implementation

## Workflow

1. Read `AGENTS.md`, `ARCHITECTURE.md`, the current status report, relevant schema/migrations, routes, models, UI pages and tests. Treat target specs as requirements, not evidence that behavior exists.
2. Choose one end-to-end vertical slice and identify its API, UI, authorization, persistence, audit and failure/recovery path before editing. Preserve the existing local SQLite/WAL and dual-driver architecture.
3. Add changes with versioned, additive, transactional migrations recorded in `schema_migrations`. Preserve IDs and historical relations; never use destructive schema recreation or alter live data during verification.
4. Make money/inventory/staff transitions atomic, idempotent where appropriate, validated in integer cents, and auditable. Invoice creation is not a cash receipt. Main warehouse stock is whole units; reusable remnants belong in the secondary warehouse.
5. Keep file processing local and rooted at configured paths. Preserve archived source image bytes; create compressed derivatives only. Reject storage-root escapes and symlinks.
6. Add migration, unit, API and model tests as applicable, using temporary database/storage paths. Run relevant tests, `npm run check`, `npm test` when scope warrants it, and `npm run build` for UI changes.
7. Update `SYSTEM_AUDIT_AND_STATUS.md` when the implementation or evidence changes. Report exact files, test results, remaining pieces of the loop, and whether production data was untouched.

## Completion standard

A workflow is closed only when its UI input, authorized API transition, persistence, related inventory/treasury/payroll effects, user-visible result, audit trail, and failure behavior are implemented and tested. Keep compatibility for historical `orders.type='operation'` unless explicitly approved otherwise. Do not claim production readiness without policy approval and operational backup/restore evidence.
