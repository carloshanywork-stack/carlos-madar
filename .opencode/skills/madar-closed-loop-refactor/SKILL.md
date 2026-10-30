---
name: madar-closed-loop-refactor
description: Plan, implement, or audit MADAR's closed-loop maintenance, manufacturing, dual-warehouse, staff/payroll, purchasing, treasury, and receivables workflows. Use when the user asks to apply or review the MADAR master engineering specification or related ERP refactoring.
---

# MADAR Closed-Loop ERP Refactoring

## Purpose and scope

Use the specification below as a **future target**, not as a statement of current capability. Apply it incrementally to the existing MADAR repository when the user requests implementation, planning, or review. Do not claim a module is complete or “100% Closed-Loop” merely because the target is written here.

## Required workflow

1. Read applicable repository `AGENTS.md` files and the Madar ERP Core Guidelines. If a task concerns OpenCode itself, also follow the OpenCode skill and its current documentation requirements.
2. Inspect the current schema, migrations, API handlers, models, UI routes, tests, and `SYSTEM_AUDIT_AND_STATUS.md` before designing changes. Treat checked-in implementation and tests as evidence; treat this skill as desired behavior.
3. Establish the requested slice and its prerequisites. The full specification spans multiple domains; do not silently broaden a focused request into a wholesale rewrite. If a policy conflict or material ambiguity blocks a safe implementation, ask before choosing.
4. Preserve existing SQLite data, IDs, relations, WAL mode, driver conventions and audit history. Migrations must be additive, transactional, versioned and registered in `schema_migrations`. Never recreate the database or use destructive synchronization. Use soft deletion for persistent business records; preserve Sequelize `paranoid: true` where applicable.
5. Keep customer files and processing local or on trusted LAN/Tailscale. Use configured storage roots, not hard-coded repository-relative paths. Preserve archived source images byte-for-byte; compress only derived in-memory export buffers.
6. Keep changes aligned with existing auth/RBAC. Audit sensitive actions with actor, action, entity, before/after data and timestamp. Do not weaken authorization or expose data to new roles without explicit product approval.
7. Make cross-domain financial/inventory mutations transactionally coherent. Validate currency/quantity boundaries, preserve idempotency where present, and define rollback/recovery behavior for filesystem work that cannot share a database transaction.
8. Add focused unit, migration, and isolated API tests using temporary SQLite and storage paths. Never point tests at the live database or real customer storage. Run relevant tests, `npm run check`, and `npm run build` for code changes; report commands and outcomes accurately.
9. Update `SYSTEM_AUDIT_AND_STATUS.md` when implementation status, architecture, risks, or verification evidence changes. Separate implemented, tested, policy-approved, operationally drilled, and production-ready claims.

## Completion criteria

Assess each requested workflow end-to-end, including UI, API authorization/validation, persistence, transaction/rollback, file handling, audit, exports and tests as applicable. A loop is closed only when its input, business transition, inventory/treasury/accounting effects, user-visible result and failure/recovery behavior are evidenced. Never label the entire system or a module 100% complete without current source evidence, tests, approved business policies, security review and relevant deployment/restore drills.

## Master specification (verbatim target requirements)

# Comprehensive Engineering Specification & Architecture Refactoring for MADAR ERP

## Objective & Mission
Refactor and upgrade the MADAR local ERP system to eliminate architectural overlap, split conflicting domain modules, unify identity/HR management, implement a mathematically strict payroll engine, and establish an end-to-end closed-loop integration connecting all operations to Inventory and the Treasury.

Follow the exact specifications below without bypassing existing data integrity, schema conventions, or transactional guarantees.

---

## 1. Domain Separation: Split "Orders" into Two Distinct Modules

Deprecate the unified `orders` entity and screen. Separate the workflow into two independent first-class modules:

### Module A: Field Maintenance Work Orders (`/maintenance`)
* **Core Purpose:** On-demand site/machine field maintenance services. Completely free of recurring PM schedules.
* **Lifecycle Stages (3 Dedicated Tabs only — eliminate the "All" tab):**
  1. `[In Progress]` (`قيد التنفيذ`):
     - Assign client and site location.
     - Assign one or multiple technicians/employees.
     - Disburse required materials (LEDs, power supplies/adapters, transistors, wiring) from the **Main Warehouse** directly into the custody of the assigned technician.
     - Disburse Petty Cash (Cash Custody / عهدة نقدية) from the **Treasury** to the team supervisor.
  2. `[For Approval]` (`للاعتماد`):
     - Ingest site photo folders using the existing EXIF/timestamp pipeline.
     - Support flexible photo counts (e.g., 2, 3, or 4 photos for Before and After per inspection point/machine).
     - Allow manual drag-and-drop and categorization. Work is technically verified, but financial/stock custody remains open.
  3. `[Archived]` (`الأرشيف`):
     - Final financial and material reconciliation step.
     - Settle Petty Cash: Enter approved field expense receipts (with receipt photo uploads), calculate remaining cash balance, and automatically return the remaining cash back to the Treasury with a cash receipt voucher.
     - Reconcile Materials: Record actually consumed parts; return any surplus parts back to the Main Warehouse automatically.
     - Lock the order as Read-Only.
* **Export & Reporting Engine:**
  - Support exporting PowerPoint (PPTX) and Word (DOCX) reports with flexible photo selection: Export Before-only, After-only, or Both.
  - **Written Technical Summary Report:** In addition to photos, generate a comprehensive statistical breakdown of maintenance actions (e.g., "Total 100 machines: 30 spare parts replaced, 20 transistors replaced, 10 electrical repairs, 40 inspected & certified").
* **Post-Archive Admin Audit Trail:**
  - Only users with the `admin` role may edit an archived order.
  - Any post-archive modification must automatically persist an immutable audit snapshot: recording `actor_id`, `timestamp`, `version_number`, and the exact `before_snapshot` vs. `after_snapshot` payload.

---

### Module B: Acrylic Manufacturing & Production Work Orders (`/manufacturing`)
* **Core Purpose:** Dedicated workshop production for acrylic fabrication and signage products. Completely free of Before/After photo pipelines.
* **Key Fields:**
  - Order Code (e.g., `MFG-1001`), Client, Product description, Target delivery date, Assigned workshop technician.
  - **Machine Allocation:** Selector for machine used: `[CNC Router]`, `[Laser]`, `[Both]`, or `[Manual Assembly]`.
* **Materials Consumption & Offcuts Loop:**
  - Consume materials from the **Main Warehouse** (deducting full sheets, e.g., acrylic or wood sheets 1x1m, -1 unit).
  - Alternatively, allow selecting and consuming existing pieces from the **Secondary Warehouse (Offcuts)** if small pieces suffice.
* **Lifecycle Stages (3 Stages):**
  1. `[In Production]` (`قيد التصنيع`): Sheet reserved and cutting/assembly underway.
  2. `[Ready for Delivery]` (`جاهز للتسليم`): Production completed; the technician registers usable remaining offcuts (e.g., 0.25 sheet or 50x50 cm piece). The system automatically credits these offcuts into the **Secondary Warehouse (المخزن الجانبي للخامات)** with dimensions/quantity.
  3. `[Delivered & Archived]` (`تم التسليم ومؤرشف`): Product delivered to client; sales invoice issued and linked to client balance.

---

## 2. Inventory Architecture: Dual-Warehouse & Scrap Clearance Loop

* **Warehouse 1: Main Warehouse (المخزن الرئيسي):**
  - Stores standard, intact whole units only (full acrylic sheets, full wood boards, spare parts, LEDs, transistors, consumable hardware).
* **Warehouse 2: Secondary Warehouse (المخزن الجانبي للخامات):**
  - Stores reusable offcuts, sheet remnants, and fractional boards generated by manufacturing orders.
  - Searchable and consumable by upcoming manufacturing orders to minimize raw material waste.
* **Scrap Clearance & Sale Workflow (`تفريغ وبيع خردة`):**
  - Provide a dedicated action in the Secondary Warehouse to purge accumulated unusable scraps/remnants.
  - User selects scrap items/weight and inputs the total sale value received (e.g., 1,500 EGP).
  - System purges the selected scrap inventory and instantly creates a cash deposit transaction in the **Treasury** under the category: `إيرادات بيع خردة ومخلفات تشغيل` (Scrap Sales Revenue).

---

## 3. Unified Identity, HR & Mathematical Payroll Engine

Deprecate separate `users` and `workers` screens. Create a unified **Team & Staff (`/staff`)** module:

### Employee Profile Structure:
1. **Personal & Job Information:** Full Name, Phone, National ID, Hire Date, Job Title (Field Technician, CNC/Laser Operator, Accountant, Supervisor, Admin).
2. **System Login Access (Collapsible toggle):**
   - Toggle: `[ ] Enable System Login`.
   - When enabled: Input `username`, `password`, and assign `role` (`admin`, `operations`, `sales`, `purchasing`).
   - If an employee status is set to `Inactive`, their system login session and access must be immediately revoked.
   - Workshop technicians and workers who do not need computer access are registered without system login accounts.

### Mathematical Payroll Engine:
Configure the monthly payroll calculations according to these exact parameters:
* **Standard Work Schedule:** 9 hours/day, 26 working days/month (standard 30-day month convention).
* **Standard Derived Rates:**
  - $\text{Daily Rate} = \frac{\text{Base Salary}}{26}$
  - $\text{Hourly Rate} = \frac{\text{Daily Rate}}{9} = \frac{\text{Base Salary}}{234}$
* **Multipliers:**
  - **Normal Overtime:** Excess hours beyond standard 9 hours $\times 1.5 \times \text{Hourly Rate}$.
  - **Holiday / Off-Day Work:** Hours worked during holidays/off-days $\times 2.0 \times \text{Hourly Rate}$, or full holiday days worked $\times 2.0 \times \text{Daily Rate}$.
* **Monthly Payslip & Settlement Card:**
  At month-end, calculate the net payout:
  $$\text{Net Salary} = (\text{Base Salary} - (\text{Absence Days} \times \text{Daily Rate}) + \text{Overtime Pay} + \text{Holiday Pay} + \text{Bonuses}) - (\text{Monthly Advances} + \text{Deductions})$$
* **Treasury Settlement:**
  - Employee advances taken throughout the month are pulled directly from Treasury cash advance records.
  - Clicking `[Disburse Salary]` executes a cash payout transaction from the **Treasury**, generates a printable Payslip, and resets the monthly advance balance to zero for the new billing cycle.

---

## 4. Closed-Loop Treasury, Purchasing & Client Receivables

Ensure 100% financial and inventory cohesion:
1. **Supplier Purchases (مشتريات الموردين):**
   - Strictly 100% Cash at purchase. No credit supplier accounts.
   - Recording a purchase invoice immediately disburses cash from the **Treasury** and increases Main Warehouse stock.
   - Maintain the existing capability to upload and attach purchase invoice photos/receipts.
2. **Client Receivables & Accounts (مبيعات وحسابات العملاء):**
   - Support multiple collection terms: 100% Cash, Cash on Delivery (COD), or Credit / Installment payments.
   - Maintain a dedicated **Client Statement of Account (كشف حساب عميل)** tracking:
     - Total Invoices issued (Maintenance and Manufacturing).
     - All Payments/Receipt vouchers credited to Treasury.
     - Current Outstanding Balance (المتبقي).

---

## 5. Technical & Persistence Integrity Rules
* **Database & Migrations:** Retain local SQLite persistence (WAL mode). Implement all schema updates via additive, versioned migrations. Preserve all existing historical records, IDs, and relations.
* **File Protection:** Keep client storage (`storage/`) and backups (`Backups/`) strictly outside code bundles.
* **Separation of Concerns:** Decompose `server.js` route bloat by creating clean modular route handlers for `/api/maintenance`, `/api/manufacturing`, `/api/staff`, and `/api/warehouse`.
