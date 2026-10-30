---
name: madar-ui-domain-separation
description: Maintain MADAR ERP's maintenance-versus-operation UI boundaries, order forms, details, tables, workshop terminology, and archive workflows. Use when changing React pages or user-facing copy for MADAR maintenance, operations, manufacturing, or order archiving.
---

# MADAR UI Domain Separation

## Instructions

- Read the repository `AGENTS.md` and apply the MADAR ERP Core Guidelines before changing application behavior. Treat backend routes and tests as the source of truth for API contracts.
- Keep field maintenance focused on clients, areas, assigned employees, machine/photo review, notes, and status. Do not add machine catalog pickers or operation cost/selling inputs to maintenance order creation.
- Keep operation/manufacturing UI distinct from maintenance. Use **أمر تشغيل** terminology in the workshop and operation archive ledger; do not rename API paths or persisted values as part of a copy change.
- Maintenance order details expose only client/code, area, machine count, and status in the summary strip. Hide operation financial summaries, FIFO panels, material-issue controls, and cash-custody controls from maintenance details.
- Maintenance archiving uses a direct confirmation and the existing archive endpoint contract. Do not add financial prompts or silently change server-side custody, materials, warranty, audit, or transaction behavior. Add isolated API coverage if the UI relies on default archive behavior.
- The maintenance table columns are order number, client, area, machine count, status, date, and authorized actions. If list data needs an area, derive it from associated active machine cards without changing persistent schema.
- Preserve role authorization and existing shared components. Keep the operation order table and operation-only financial summaries intact when changing maintenance-specific layouts.
- Verify UI changes with `npm run build` and relevant tests from `system/`; run `npm test` for changes to order/archive behavior. Tests must use temporary databases and storage paths.
