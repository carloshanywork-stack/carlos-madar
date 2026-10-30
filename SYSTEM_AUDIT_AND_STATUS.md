# System Architecture, Audit & Status Report

**Purpose:** source-oriented technical specification for an external Principal Software Architect and Security Auditor. This report describes the checked-in implementation and its known limits; it is not a certification, penetration test, accounting opinion, production-data integrity attestation, or target-state design.

**Evidence boundary:** based on repository source, manifests/lockfile and tests, with verification on Windows/Node.js 24.21.0 (2026-10-30). The maintenance/operation UI separation and maintenance/workshop domain-alignment updates passed `npm test` (46/46), `npm run check`, and `npm run build` (1,640 modules transformed; 605.98 kB minified JavaScript, with the existing large-chunk warning). Isolated API coverage exercises workshop-linked invoice projections, bootstrap counts, FIFO issues from main and sub-stock, and movement-to-workshop links, alongside archived-order authorization/snapshots, direct maintenance archive defaults and custody settlement, manufacturing design/material/invoice flows, client statements, and exports. No live database or real customer storage was opened. These checks do not establish production-data integrity, legal/accountant approval or deployment readiness. This report did not inspect live SQLite data, customer storage, existing backup contents, uploaded workbooks or secrets; it did not run a dependency vulnerability audit, independent security review, Ubuntu deployment or crash/power-loss drill. Browser visual review was not performed. Treat operational claims as source-observed until independently reproduced.

## 1. Executive Summary & High-Level Architecture

### Core Mission & User Journey

Madar is a locally hosted ERP for a maintenance/operations business. It connects client and machine records to operation/maintenance work orders and photo evidence, then supports inventory/purchasing, sales invoicing, treasury, basic accounting, payroll, and operational reporting. Its browser users are employees in the configured roles (`admin`, `sales`, `operations`, `purchasing`); role restrictions are implemented even if a deployment chooses to give all users administrator accounts.

Typical operational journey: an Admin or Operations user selects a client and creates an order, associates machines, imports or uploads area photos, reviews machine matches and Before/After classification, edits/excludes cards, then archives the completed order and produces customer-facing reports. Purchasing records materials and purchase evidence and handles receipts/stock; Operations/Purchasing issues material to an order or general consumption; Sales records cash or credit invoices and receipts; Admin users configure accounts, review journals/reports, maintain users/employees, and manage backup/restore. This is an implemented workflow description, not confirmation that every business policy or accounting opening balance has been approved.

### Technology Stack

Versions below are lockfile-resolved versions where applicable, not merely package ranges. Node.js is the runtime; the repository requires `>=22` (`system/package.json`). The prior recorded Windows verification used Node.js 24.21.0. No minimum OS deployment compatibility is asserted.

| Technology | Locked version / runtime | Role |
|---|---:|---|
| JavaScript (CommonJS server and JSX/ES modules in Vite client) | — | Application language; no TypeScript project is present. |
| Node.js | `>=22`; prior verified 24.21.0 | API, file operations, background watcher/backup jobs, and build tooling. |
| Express | 4.22.3 | REST API, middleware, static SPA serving. |
| React / React DOM | 18.3.1 | Single-page user interface. |
| React Router DOM | 6.30.6 | Client-side routing. |
| Vite / `@vitejs/plugin-react` | 6.4.5 / 4.3.4 | Development server, React transform, production build. |
| SQLite | SQLite file; schema version 14 | Local relational persistence; WAL, foreign keys, and busy timeout are configured by `system/src/db.js`. |
| `better-sqlite3` | 13.0.3 | Synchronous handwritten SQL, schema creation/migrations, and many route transactions. |
| Sequelize / `sqlite3` | 6.37.8 / 6.0.1 | Model definitions and ORM transactions on the same SQLite file as `better-sqlite3`; this is dual-driver access, not a replacement of the handwritten SQL layer. |
| `jsonwebtoken` / `bcryptjs` | 9.0.3 / 2.4.3 | HS256 signed session token and password hashing/verification. |
| `helmet` / `compression` | 8.3.0 / 1.8.2 | HTTP security headers and response compression. |
| `multer` / `express-rate-limit` | 2.5.0 / 8.7.1 | Multipart upload parsing and route-specific request rate limits. |
| `sharp` / `exifr` | 0.35.5 / 7.1.3 | Derived image processing and EXIF timestamp extraction. |
| `chokidar` | 4.0.3 | Local `Areas/` directory watching with write-stability options. |
| Socket.IO / socket.io-client | 4.8.4 / 4.8.4 | Authenticated live notification transport; REST endpoints remain available. |
| `xlsx` / `xlsx-populate` / `csv-parse` | 0.18.5 / 1.21.0 / 7.0.3 | Spreadsheet and CSV import/export. |
| `pptxgenjs` / `docx` / `pdfkit` | 3.12.0 / 9.15.0 / 0.20.2 | PowerPoint, Word, and PDF report/history generation. |
| `archiver` / `yauzl` | 8.0.0 / 3.4.0 | ZIP creation and archive inspection/extraction workflows. |
| `node-cron` | 4.6.0 | Scheduled local backup task. |
| `@tanstack/react-virtual` / `@dnd-kit/core` | 3.14.23 / 6.3.1 | Virtualized photo review and drag/drop interactions. |
| `dotenv` / `fs-extra` | 16.6.1 / 11.2.0 | Root environment loading and filesystem utilities. |
| PM2 | Configured in root `ecosystem.config.js`; version not pinned in app manifest | Optional process supervisor, explicitly one forked instance. |

Declared versions and lock-resolved versions were read from `system/package.json` and `system/package-lock.json`; transitive packages are not exhaustively listed here. There are no identified external business APIs or cloud services in the reviewed application path.

### Architectural Pattern

The system is a **single-instance local web application / modular monolith in deployment, but only partially modular in code**: a React SPA calls an Express API in one Node process, which uses one local SQLite database and configured local filesystem roots. It is not microservices, and it is not a consistently layered Clean Architecture implementation. `system/src/server.js` is a large route/composition module containing authentication, role middleware, domain workflows, export generation, watcher/backup orchestration, and persistence calls. Some pure concerns have separate modules (`inventory.js`, `accounting.js`, `photo-time.js`, `backup-restore.js`, etc.); model and migration definitions are centralized separately. Front-end route state and several business views remain concentrated in `system/src/App.jsx`, with selected pages extracted under `system/src/components/`.

Development topology: Vite on `127.0.0.1:5173` proxies `/api`, `/storage`, `/socket.io` to Express (port 3100 by default). Production startup serves the built SPA and API from the Node process. Persistent state is local disk: SQLite, `storage/`, thumbnail cache, and ZIP backups. LAN/Tailscale may provide network reachability but is not an application integration or authorization layer.

## 2. Directory & Module Blueprint

```text
<repository-root>/
├── AGENTS.md                         # repository-specific engineering and domain constraints
├── ARCHITECTURE.md                   # existing detailed source-observed architecture review
├── SYSTEM_AUDIT_AND_STATUS.md        # this auditor-facing status/specification
├── ecosystem.config.js               # one-fork PM2 deployment configuration
├── .env                              # local configuration/secrets; do not commit or include in reports
├── Backups/                          # default local ZIP and rollback backup root (configurable)
├── storage/                          # default customer files/photos/imports root (configurable)
│   ├── Clients/                      # customer/order data and archived photo evidence
│   ├── Machines/                     # machine-catalog folders
│   ├── Areas/                        # incoming source folders for photo processing
│   └── Uploads/Excel/                # machine/import source workbooks
└── system/
    ├── index.js                      # guarded production startup entry point
    ├── package.json                  # scripts, declared dependencies, Node engine
    ├── package-lock.json             # exact dependency resolution
    ├── vite.config.js                # Vite build/dev proxy configuration
    ├── index.html                    # SPA HTML shell
    ├── dist/                         # generated production client build (not source)
    ├── data/                         # default SQLite database and thumbnail cache location
    ├── scripts/
    │   └── convert-historical-ledger.js # explicit-copy historical inventory ledger converter
    ├── src/
    │   ├── server.js                 # Express API composition, routes, middleware, integrations
    │   ├── db.js                     # direct SQLite connection, base schema, additive migrations
    │   ├── models/index.js            # Sequelize models and associations
    │   ├── App.jsx / main.jsx         # SPA state, routes, bootstrap and mount
    │   ├── components/                # extracted domain pages and reusable UI components
    │   ├── accounting.js               # accounting arithmetic and journal helpers
    │   ├── inventory.js                # stock/offcut arithmetic
    │   ├── money.js                    # currency parsing/rounding helpers
    │   ├── photo-time.js               # EXIF/name/mtime ordering and Before/After split
    │   ├── photo-uploads.js            # multipart limits/workspace/concurrency helpers
    │   ├── backup-restore.js           # backup validation and restore staging/recovery
    │   ├── filesystem-recovery.js      # journaled same-volume file staging/recovery
    │   ├── runtime.js / startup-checks.js # shutdown and preflight checks
    │   ├── login-throttle.js            # process-local progressive login delays
    │   ├── schema-version.js            # SQLite app/schema marker compatibility
    │   ├── historical-ledger-conversion.js # copy-only conversion logic
    │   ├── legacy-user-imports.js        # user import workbook compatibility/cleanup
    │   └── area-folder-rename.js         # safe area-folder rename operations
    └── test/                            # Node test-runner unit, migration, runtime and API tests
```

- `/system/src/components/orders`, `machines`, `users`, `employees`, `accounting`, `settings`, and `archive` hold selected extracted page/modal responsibilities. New module shells group Maintenance, Manufacturing, Warehouse, Accounting/Staff, Archive/Analytics, and Settings views; the nine enumerated top-level destinations are represented in `App.jsx`. They are not a complete frontend domain-module boundary: overview, inventory/finance views, shared API helpers and state remain substantially in `App.jsx`.
- `/system/src/models` maps Sequelize entities and associations to the existing schema; it does not own the schema lifecycle. Additive handwritten SQL migrations in `db.js` remain authoritative for database evolution.
- `/system/test` uses Node's built-in test runner. API/migration suites use temporary databases and storage roots per the repository instructions; test presence does not establish production data integrity or target-OS durability.
- Root `storage/`, `Backups/`, `.env`, SQLite files, generated thumbnails and logs are runtime data/configuration, not source modules. Keep them outside source-control sharing and protect their filesystem permissions.

## 3. Implemented Features & Modules Matrix

**Status rule:** the requested `100% Production-Ready` label is reserved for demonstrated release acceptance across deployment, real backup/restore, security review, and approved business policy. No feature below meets that evidence bar. `In-Progress` means substantial behavior exists in source/tests but production acceptance, policy, operations, or edge-case verification remains. `Mocked / Stubbed Data Only` means a feature is only placeholder/sample data. No major feature was identified as mock-only in the inspected architecture; this is not a claim that every screen has complete coverage.

| Feature | Business responsibility and status | Key files / entry points |
|---|---|---|
| Authentication, users, roles | First-admin setup, login/logout, cookie JWT sessions, user CRUD/import/export, active-user checks and route RBAC. **In-Progress**: first setup is unauthenticated by necessity; login delay is process-local; HTTPS/proxy/deployment configuration is external. | `system/src/server.js`: `issueAuthToken`, `authenticatedUser`, `requireAuth`, `allowRoles`, `/auth/setup`, `/auth/login`, `/auth/logout`, `/users/*`; `system/src/login-throttle.js`; `system/src/components/users/UsersPage.jsx`; `system/src/db.js`: `users`, `sessions`. |
| Clients and customer branding | Client/contact records, logos, order relation and customer storage structure. **In-Progress**: role-based shared access is not tenant isolation; no customer-scoped account model. | `system/src/server.js`: `/clients*`; `system/src/models/index.js`: `Client`; `system/src/App.jsx`. |
| Employees and legacy workers | Employee records, optional login links, assignments, history, payroll/advances and history export. Legacy `/workers` endpoints are compatibility adapters backed by `employees`; the legacy table/model and historical worker relation columns remain for migration/history compatibility. | `system/src/server.js`: `/employees*`, employee-backed `/workers*`, `/employees/:id/history*`; `system/src/components/employees/EmployeesPage.jsx`, `workers/WorkersPage.jsx`; `db.js`: v9 employee fields and legacy `workers` backfill. |
| Machine catalog and imports | Machine CRUD, stable business codes, area listing and CSV/XLSX import; machine photos and metadata are linked by code/ID. **In-Progress**: bulk import/removal and legacy data need controlled operational validation. | `system/src/server.js`: `/machines*`, `/machine-areas`, `/machine-areas` aliases, import/eradicate/wipe; `system/src/components/machines/MachinesPage.jsx`, `MachineAreaSelector.jsx`, `MachineCode.jsx`; `models/index.js`: `Machine`. |
| Orders, maintenance/operations, photo pipeline | Existing `/orders*` supports order/card/photo/review/archive workflows. Maintenance custody now supports petty-cash issuance, archive-time expense/refund settlement, main-stock returns, warranty dates, and an append-only audit snapshot for Admin post-archive edits. **In-Progress**: maintenance still uses the legacy `orders` table/API rather than a fully separate `maintenance_orders` workflow; active legacy operation orders remain preserved and are not bulk reclassified. Image job status is memory-only and filesystem crash durability is undrilled. | `system/src/App.jsx`; `components/maintenance/MaintenanceModulePage.jsx`, `components/orders/OrdersPage.jsx`, `OrderFormModal.jsx`, `components/machines/AreaFileExplorerModal.jsx`; `server.js`: `/orders*`, `/process-area`, `/areas*`, `/storage/bind-folder`, `/files*`, archive/export routes; `photo-time.js`, `photo-uploads.js`, `filesystem-recovery.js`; `db.js`: `orders`, `order_machines`, `area_folders`, `maintenance_order_settlements`. |
| Inventory, purchasing, stock counts | Material catalog/variants, purchase invoices and evidence, inventory lots/movements, FIFO consumption, offcuts, stock counts, imports/exports, correction/revision history. **In-Progress**: legacy stock valuation and accounting conversion require reviewed crosswalk/policy; no production inventory reconciliation is claimed. | `server.js`: `/materials*`, `/inventory/purchases*`, `/inventory/issue`, `/inventory/import`, `/inventory/stock-counts*`; `inventory.js`, `money.js`, `accounting.js`; `db.js`: `materials`, `inventory_movements`, `inventory_lots`, `inventory_lot_consumptions`, `purchase_invoice_revisions`, `stock_counts*`; `App.jsx`. |
| Sales invoicing, receipts, treasury | Sales invoices snapshot tax; cash sale collects immediately, credit sale uses separate receipt vouchers; treasury/funding movements are recorded. Client statements include billed, paid, outstanding, and unpaid invoices aged at least 60 days; manufacturing delivery can optionally issue and link a sales invoice. **In-Progress**: rates, opening balances, account mapping and accounting policy need owner/accountant approval. | `server.js`: `/inventory/sales`, `/sales/invoices`, `/clients/:id/statement`, `/treasury/invoices/:id/payments`, `/treasury/entries`, `/treasury/funding`; `db.js`: `invoices`, `invoice_items`, `treasury_transactions`, `sales_tax_rates`; `App.jsx`. |
| Accounting and finance reports | Mapped double-entry journals, opening-balance schedules, ledger/trial balance/statements, tax/receivable reports, WIP-to-COGS, dashboard. **In-Progress**: not accountant-approved; historical transaction journals are incomplete until explicit conversion/backfill decisions; opening cutover is not a full historic ledger import. | `system/src/accounting.js`; `server.js`: `/accounting/*`, `/finance/dashboard`; `db.js`: `accounts`, `account_mappings`, `journal_entries`, `journal_lines`, `opening_balance_*`; `components/accounting/AccountingPage.jsx`; `App.jsx`. |
| Payroll, advances, employee history | Payroll calculation/finalization/payment and advance events, linked employee history and exports. The payroll engine now derives daily/hourly rates from 26 workdays × 9 hours, applies 1.5× normal overtime and 2× holiday overtime, and records up to 26 absence days with cent-rounded absence deductions. **In-Progress**: legal/accountant approval, full payslip delivery, role-unification, holiday-day input mode and broader staff requirements remain open. | `system/src/accounting.js`: `calculatePayroll`; `server.js`: `parsePayrollInputs`, `/payroll*`, `/employees/:id/history*`; `db.js`: v8 `payroll_records.absence_days` and `absence_deduction_cents`; `components/accounting/AccountingPage.jsx`; `test/accounting.test.js`, `test/api.test.js`, `test/migration.test.js`, `test/backup-restore.test.js`. |
| Maintenance/manufacturing domains | The UI has three maintenance stage filters, an embedded machine-catalog tab, and a dedicated three-stage manufacturing page. Manufacturing APIs support authenticated design attachments/downloads, transactional consumption from whole main-stock units, material sub-stock, or secondary-warehouse offcuts, costed offcut returns, and delivery against an existing same-client invoice or optional invoice creation. Bootstrap/dashboard data separates active maintenance and workshop orders, and workshop material issues are persisted as workshop consumption and source-linked movements. **In-Progress**: maintenance still uses legacy `orders`; active legacy operation rows are preserved and are not surfaced as manufacturing orders. Business policy, report acceptance, and production validation remain open. | `system/src/routes/manufacturing.js`; `system/src/components/manufacturing/ManufacturingPage.jsx`; `system/src/components/maintenance/MaintenanceModulePage.jsx`; `system/src/components/archive/ArchiveLedgerPage.jsx`; `system/src/db.js`: v9, v13, and v14 additive domain/custody/issue schema; integration tests in `system/test/api.test.js`. |
| Audit and notifications | Actor-aware audit events, Admin browsing, persistent operational notifications and Socket.IO refresh events. **In-Progress**: coverage and sensitive-field minimization should be independently reviewed; audit rows are in the same database/admin trust boundary. | `server.js`: `sequelizeAudit`, `/audit`, `/notifications*`, Socket.IO setup; `db.js`: `audit_log`, `persistent_notifications`; `models/index.js`: `AuditLog`; `App.jsx`. |
| Storage explorer and local file access | Authenticated file listing/read, thumbnails, upload, archive analysis and customer exports. **In-Progress**: file endpoints are authenticated and enforce configured-root/symlink checks, but are not customer/role scoped; other file consumers use separate validation paths. | `server.js`: `/storage/explorer`, `/storage/files`, `/files`, `/files/thumbnail`; `components/settings/SettingsPage.jsx`, `components/machines/AreaFileExplorerModal.jsx`; `db.js`: file references embedded in domain records. |
| Backup, restore and operations status | Scheduled/manual ZIP backup, health status, archive validation, rollback copy, staged restore and restart recovery. **In-Progress**: no approved retention/off-host destination or measured RPO/RTO; real host-loss and power-loss restore drills have not been demonstrated. | `system/src/backup-restore.js`; `system/src/filesystem-recovery.js`; `server.js`: `/backup/create`, `/backup/restore`, `/system/backups`, `/operations/status`; `system/src/startup-checks.js`, `runtime.js`; `components/settings/SettingsPage.jsx`; root `Backups/`. |
| Archive analysis and generated reports | Archive navigation groups the existing Admin-only maintenance archive/export ledger with archive analytics and an Admin-only delivered-manufacturing list. Excel/PDF history and analysis, bulk maintenance DOCX/PPTX with action statistics, and print output exist. **In-Progress**: analytics and exports remain based on legacy maintenance orders; report layouts/content acceptance and large-export resource limits require operational review. | `server.js`: `/reports/archive`, `/analysis/*`, `/export/bulk-maintenance`, `/reports/export.pptx`, `/reports/export.docx`, `/reports/print`; `components/archive/ArchiveModulePage.jsx`, `ArchiveLedgerPage.jsx`, `ArchiveAnalysisPage.jsx`; `sharp`, `xlsx`, `pdfkit`, `pptxgenjs`, `docx`. |

## 4. Data Architecture & Flow

### Data Models / Schemas

The authoritative schema is local SQLite, initialized and migrated additively in `system/src/db.js`. Current application schema version is 14 (`system/src/schema-version.js`). SQLite uses WAL, `foreign_keys=ON`, and `busy_timeout=5000`. `schema_migrations` records one-time migrations. The v8 payroll-attendance migration adds absence fields; v9 `operational-domains-secondary-warehouse-schema-v9` adds maintenance/manufacturing tables, offcuts/scrap-sale links, and employee salary/login fields; v13 `custody-manufacturing-remediation-v13` adds maintenance custody settlement, warranty, manufacturing consumption/design/invoice links; v14 `workshop-inventory-issue-source-v14` preserves workshop consumption history and expands its source warehouse options for general material sub-stock. Existing orders and worker data are retained; `operation` is not reclassified. Do not infer that every foreign-key-looking field has a declared SQL FK; inspect migration DDL for each relation.

Principal tables and relationships:

- **Identity:** `users` (role constrained to `admin`, `sales`, `operations`, `purchasing`), `sessions` keyed by token hash, optional user/employee association; `employees`; legacy `workers` table remains, while compatibility API reads/writes now use employees. `audit_log.user_id` identifies the actor where available.
- **Operations:** `clients` 1:N `orders`; `orders` M:N `machines` through `order_machines`; `orders` 1:N `area_folders`, whose `machine_id` is optional. `maintenance_reasons` is referenced from card state. Employee assignments use `order_employee_assignments`. Order cards store before/after photo paths, reason IDs and notes as JSON/text fields rather than child photo/reason entities.
- **Inventory/purchases:** `materials` (variant/business code, unit and main/sub-stock) 1:N `inventory_movements`; purchase `invoices` contain `invoice_items`, evidence attachments, and revision snapshots; inventory lots and `inventory_lot_consumptions` preserve FIFO cost provenance. `inventory_issues` captures issue classification/work-order relation in the newer accounting flow.
- **Sales/cash:** `invoices` with `invoice_items`, optional client/order links, tax snapshot, sale type, paid/remaining/status fields; `treasury_transactions` link receipts/payments/funding and invoice/employee context.
- **Accounting:** `accounts` and `account_mappings`; `journal_entries` 1:N `journal_lines`; opening-balance batches/lines; payroll and employee advance events; stock counts/items; tax rates and categorized other invoices/items/attachments.
- **Cross-cutting/operations:** `counters`, `idempotency_keys`, `audit_log`, `schema_migrations`, `filesystem_operations`, `backup_health`, and `persistent_notifications`.
- **File bytes:** photos, invoice evidence, logos, workbooks and generated artifacts live in configured local storage, not as SQLite BLOBs. Database rows store path strings or JSON arrays of relative paths. `system/data/thumbnails` (configurable) stores derived WebP cache; original/archive source images should remain byte-preserved.

`system/src/models/index.js` defines Sequelize mappings/associations for the shared schema. Some money/quantity model attributes use floating-point types for compatibility, while newer money workflows parse and persist integer cents. This mixed representation deserves explicit review; do not assume all historical numeric values have been normalized.

### Request/Data Lifecycle

Typical authenticated JSON mutation:

1. UI route/component in `system/src/App.jsx` or `system/src/components/**` gathers input and calls the shared API helper; browser uses same-origin `/api` requests and session cookie. Folder upload progress uses XHR as Fetch has no upload progress interface.
2. Express route in `system/src/server.js` applies upload/rate/auth/role middleware as ordered on that route. `requireAuth` extracts `madar_session`; `authenticatedUser` validates JWT then checks session hash and current user status/role from SQLite. `allowRoles` gates route roles.
3. Route-specific validation/parsing normalizes IDs, strings, enums, decimal money, quantities and file constraints. `asyncRoute` forwards rejected async work to Express error handling. Spreadsheet, ZIP and multipart flows have dedicated parser/size/path defenses. Validation is not one shared schema layer; coverage varies by endpoint and must be assessed route-by-route.
4. Business logic runs in route handlers and helpers (`inventory.js`, `accounting.js`, `money.js`, `photo-time.js`, filesystem/backup modules). Multi-row stock, purchase, payment and accounting mutations use SQLite/Sequelize transactions; idempotency keys exist for selected operations, not necessarily every mutation.
5. Persistence is through parameterized `better-sqlite3` SQL and/or Sequelize against the same database file. The route may also write derived/customer files locally; sensitive mutations may write actor/action/entity/before-after audit records. Filesystem/database coordination is handled with staging/journals for selected deletion/restore operations, not a universal distributed transaction.
6. Express returns JSON or a streamed file/export. The SPA refreshes bootstrap/domain data; Socket.IO notifies connected clients for selected events. A filesystem operation and a DB transaction can still have distinct failure modes requiring reconciliation.

Photo processing specifically extracts EXIF `DateTimeOriginal`/`CreateDate`, falls back to supported filename timestamps, then filesystem `mtime`; exact ties go to Before for manual correction. It creates processed derivatives, matches normalized folder/code/name (optionally constrained by area), updates order cards/folder state, and later archives copies with a manifest. It does not rewrite archived source images. Processing job/progress state is in process memory and can disappear on restart.

### External Integrations

No third-party business API, payment gateway, email/SMS provider, webhook, OAuth identity provider, cloud object store, or remote analytics integration was identified in the inspected routes/dependencies. The application uses local libraries and local processes: Chokidar monitors configured `Areas/`, `node-cron` runs backup scheduling, Socket.IO delivers in-process notifications, and PM2 may supervise a single Node process. Vite proxy is development-only. LAN/Tailscale are deployment/network choices rather than integrations. No claim is made about network appliances outside this repository.

## 5. Security, Auth & Access Control Posture

### Authentication & Identity

- First-run `/api/auth/setup` is unauthenticated until the first user is created; after that setup is single-use. Login compares bcrypt hashes and uses a dummy bcrypt hash for unknown/inactive names plus a generic failure message.
- `issueAuthToken` in `system/src/server.js` signs HS256 JWTs with issuer `madar-erp`, audience `madar-client`, `sub`, `jti`, and a seven-day expiry. Cookie is `madar_session`, `HttpOnly`, `SameSite=Strict`, `Path=/`; `Secure` is conditional on `COOKIE_SECURE=true` (default false).
- JWT is not accepted solely on signature: token SHA-256 hash is registered in `sessions`; each request re-reads user and checks active/deleted state and role/username consistency. Logout removes the session, immediately revoking the presented token. Expired session rows are pruned on token issuance. There is no refresh-token flow; re-login creates a new seven-day session. Secret rotation invalidates all sessions.
- `JWT_SECRET` is required at startup and must be at least 32 bytes (`system/src/server.js`). It is loaded from environment/root `.env` via runtime configuration; do not print or commit it. `.env`/runtime data are expected to remain local and ignored by Git.

### Authorization & RBAC

`requireAuth` and `allowRoles(...roles)` are route middleware in `server.js`. The schema supports `admin`, `sales`, `operations`, and `purchasing`, with Admin-only areas including user management, accounting configuration/journals/reports, audit browsing, payroll, backup/restore, and selected catalog destructive operations. Business endpoints have mixed role sets. Role checks are not resource ownership/tenant isolation: authenticated users can read broad operational/file data, including files through `/api/files`, `/api/files/thumbnail`, and `/api/storage/files`; this is explicitly not customer- or role-scoped. `/api/orders/:id` also returns card notes to any authenticated account; customer reports select a narrower set, but archive `order.json` retains notes. Reassess if user trust assumptions change.

Socket.IO authenticates the same cookie and uses role rooms for selected notifications; it is not an alternative authorization boundary. Route-by-route authorization and data minimization still require independent review.

### Data Sanitization & Validation

- SQL uses parameterized statements in inspected query patterns; dynamic `IN` placeholders are generated from IDs and values are bound. Spreadsheet imports validate/normalize rows and upsert by business code in transactional batches; verify import-specific matching and row/error policy before production use.
- Money helpers parse decimal currency into integer cents and reject precision beyond two decimals in newer flows. Legacy float columns remain. Inventory rules validate whole-unit main stock and fractional sub-stock/offcuts.
- File APIs resolve paths below configured `STORAGE_ROOT_PATH` and reject traversal/symlink components on the covered reads. This is not a uniform file resolver for every export/archive consumer, and external concurrent filesystem mutation is outside app coordination. Upload handlers apply MIME/extension/size/quantity limits; these checks do not guarantee content is benign.
- Restore code validates ZIP paths/types/sizes/CRC, SQLite integrity/foreign keys and schema markers, and active references for supported archives before staged replacement. Do not treat this as a substitute for isolated restore drills.
- Express uses Helmet and JSON/form/multipart parsers. Cookie `SameSite=Strict` is a CSRF mitigation, but no dedicated CSRF token mechanism was identified. Independently review all state-changing routes, content-type assumptions, CORS/origin behavior, upload parsers, export escaping, and request/body limits.

### Secrets Management

Configuration comes from root `.env` and process environment. Important settings include `JWT_SECRET`, `DATABASE_URL`, `STORAGE_ROOT_PATH`, `BACKUP_ROOT_PATH`, `THUMBNAIL_CACHE_PATH`, `HOST`/`PORT`, `COOKIE_SECURE`, and `TRUST_PROXY_HOPS`; backup/upload/login bounds have additional variables documented in source/`ARCHITECTURE.md`. Relative data paths resolve from repository root. Secret values were not read for this report. There is no vault/secret-manager integration; protect the host, `.env`, backups and logs with OS permissions and controlled offline handling. Set HTTPS at a trusted reverse proxy and `COOKIE_SECURE=true` for networked production; configure `TRUST_PROXY_HOPS` to the exact trusted chain only. Login delay is in-memory, per-process, and not a distributed brute-force control.

## 6. Technical Debt, Stubs & Temporary Workarounds

### Hardcoded Values / Dummy Data

- No active mock-only major module or sample-data seeder was established by the inspected source review. A source search for common `TODO`/`FIXME`/mock markers did not establish absence of fixtures or placeholder behavior; it mostly matched SQL variable names named `placeholders`. This is not proof of zero hardcoded/demo values.
- Deliberate constants include a seven-day JWT session (`SESSION_LIFETIME_MS`), JWT issuer/audience/algorithm, default roles and accounting mappings, photo/archive/export rules, and a 02:00 default backup schedule. Treat as policy/configuration decisions, not mock data.
- Login timing padding uses the fixed string `madar-invalid-login-timing-padding` only as input to a dummy bcrypt comparison; it is not a credential or token. Do not disclose or reuse real JWT secrets from `.env`.
- Legacy worker-linked fields/routes and compatibility endpoints (including `/system/backups`, `newAreaFolder`) remain intentionally for migration/backward compatibility. They should not be mistaken for a second supported domain design without review.
- Root `ARCHITECTURE.md` records that legacy user-import workbooks may have contained passwords; those historical files were not inspected. Treat possible credentials as exposed, restrict access and require resets as appropriate; do not delete files/backups without an approved retention decision.

### Temporary Workarounds / Non-idiomatic Patterns

- `server.js` is very large and mixes HTTP composition, domain logic, SQL/ORM operations, file IO and report generation. Many front-end views also remain in `App.jsx`. This raises coupling and change-review risk.
- Both synchronous `better-sqlite3` and Sequelize backed by `sqlite3` open the same SQLite file. This makes transaction boundaries, connection pragmas, schema assumptions and locking behavior harder to reason about; avoid parallel process scaling.
- Photo-processing job status/progress is held in memory; restart loses visible job state. Some files may already have been written when status disappears.
- `workers` and `employees` schemas and old relation fields (e.g. worker and employee links on orders/invoices/treasury) coexist for historical compatibility. New `/workers` reads/writes use employee records; the legacy table remains for migration/history and its Sequelize mapping.
- File/db operations cannot be one atomic transaction. Order deletion and selected destructive file workflows use same-volume staging/journals and recovery, but not every file mutation is covered by a single shared coordinator. Staging is recoverability, not secure erasure.
- There is no automated backup retention or independent destination policy. Default local backups share correlated disk/host risk with application data.
- The project is not described as a full layered architecture: validation schemas/services/repositories are not consistently separated; route middleware/order is endpoint-specific. Changes need careful local flow inspection.

### Unhandled Edge Cases / Incomplete Evidence

- Windows test success does not prove Ubuntu compatibility, filesystem rename durability, power-loss consistency, PM2 restart behavior, or permissions under a dedicated service account. Crash-injection and target-OS drills remain open.
- In-memory login throttle resets on restart and differs across instances; it is not distributed. Bound ingress and avoid multi-process deployment.
- In-memory photo jobs may leave reconciliation work after process termination. A persistent job state/retry/idempotency design is needed for high-assurance long-running imports.
- Backup status tracks outcomes/size/duration/free space/recovery counts, but does not define retention, RPO, RTO, independent destination or a successfully rehearsed recovery time. A local ZIP is not a disaster recovery strategy by itself.
- Accounting defaults and workflows require approved cutover date/opening balances, sales-tax rates, funding and stock-variance counterpart accounts, and reviewed historical issue classification/costs. Historical issues are not safely inferable from free-text references; provided converter requires explicit crosswalk and costs where lot costs are absent. Historical invoice/cash journal backfill is not claimed.
- File read checks and archive/export code paths are not all one resolver; assess symlink/path handling at each consumer and the time-of-check/time-of-use exposure if local untrusted processes can mutate storage.
- Generic audit is Admin-only, but verify coverage and redaction for every sensitive mutation and ensure logs/details do not retain secrets or excessive personal data.
- Dependency CVEs/advisories were not reviewed. Lockfile reproducibility is not evidence of vulnerability-free dependencies.
- Build has an existing large JavaScript chunk warning; no performance/load or SQLite contention benchmark is claimed.
- No product-facing mock/stub inventory, real-data reconciliation, accessibility audit, localization/encoding audit, or concurrency/load test is certified by this report.

## 7. Conceptual Flaws & Architectural Doubts (Critical Review Points)

### Scalability / Performance Bottlenecks

1. **Single local SQLite writer and one Node process.** PM2 is explicitly configured `instances: 1`, `exec_mode: 'fork'`; SQLite WAL and 5-second busy timeout do not eliminate write serialization or long transaction contention. Scaling horizontally would duplicate watcher/cron work and complicate local file coordination. Define workload/retention expectations and measure before considering alternate persistence or queueing.
2. **Dual SQLite connection stacks.** Synchronous `better-sqlite3` work can block the Node event loop; Sequelize/`sqlite3` provides a second connection/driver to the same file. Mixed transactions and busy behavior deserve stress tests and a deliberate long-term ownership boundary.
3. **Large server and UI modules.** `system/src/server.js` is the route/domain/integration hub; `App.jsx` hosts shared state and inline views. This increases startup/change complexity, broadens regression blast radius, and makes isolated domain-level testing harder.
4. **Memory-bound jobs and exports.** Photo progress is process-local. Multipart uploads, image transformations, workbook parsing and large PPTX/DOCX/ZIP exports can consume substantial memory/CPU; set limits and profile representative worst cases. Current build size warning also merits bundle splitting review.
5. **Filesystem and backup volume.** Local image archives, thumbnails, backups and rollback copies can exhaust a shared disk. No retention/off-host strategy or tested restore-time target is established.

### Business Logic Ambiguities

- **WIP/COGS timing:** current behavior posts material issues to WIP and recognizes work-order COGS at archive. Confirm policy with an accountant; do not equate archive status with accounting completion without sign-off.
- **Historical order-domain split:** existing `orders.type` is constrained to `operation`/`maintenance`; code does not prove all historical `operation` records are acrylic manufacturing. The user decision for this refactor is to preserve those records and their relations as legacy-compatible history rather than bulk-reclassify them. New `/manufacturing` records need an additive domain boundary, with explicit migration/compatibility for invoice, issue, archive and report links.
- **Historical conversion:** old negative inventory movements lack reliable order classification/cost in all cases. Conversion intentionally requires a human crosswalk and explicit costs; no inference should be made from free-text descriptions.
- **Accounting cutover:** opening schedules are explicit cutover balances, not imported historical transactions. Confirm cutover date, account mapping, owner funding, stock variance, tax, employee advances/payroll treatment and historical invoice journals.
- **Inventory semantics:** main warehouse is whole units, offcuts are fractional reusable stock; users can choose automatic/offcut, sub-only or full-unit withdrawal. Confirm accepted valuation/rounding and supplier-return policy.
- **Access model:** current stated usage may be administrator-trusted, but implementation has roles and broad authenticated file/order visibility. Decide whether non-admin users are genuinely trusted with all client documents, notes and audit-adjacent records before granting accounts.
- **Source/archive policy:** app-managed archive copies preserve source bytes, while processing creates derivatives. Define retention and external edits policy; external writers are not covered by application quiescence/recovery locks.

### Items Requiring Senior Review

1. **Threat model and authorization:** review every route's role and object-level access; broad file reads and order-note exposure are current design choices, not isolation. Review bootstrap/setup, login throttle, CSRF/origin assumptions, proxy trust, upload validation, path resolution and log/audit redaction.
2. **Database ownership and consistency:** decide whether to retain the dual-driver architecture or migrate boundaries incrementally without changing the SQLite file/schema convention; assess SQLite type/float money legacy, foreign key completeness, transaction scope and migration/restore compatibility.
3. **Disaster recovery:** approve backup destination, retention, encryption/access, cadence/RPO and restore RTO. Perform isolated restore plus crash-injection drills on target OS/filesystems; measure end-to-end recovery before declaring operational readiness.
4. **Accounting and inventory policy:** an independent accountant should approve journals, mappings, tax, opening balances, WIP/COGS recognition, purchase correction/refund treatment, stocktaking and historical conversion before financial reliance.
5. **Module boundaries:** define domain/service/repository/API boundaries and transaction ownership before splitting `server.js`; extract incrementally with compatibility and migration tests rather than a broad rewrite.
6. **Reliability of asynchronous operations:** persist photo job state and design idempotent/restart-safe processing and reconciliation; test concurrent imports/uploads and cancellation/failure behavior.
7. **Dependency and operational posture:** run an approved dependency advisory review and update strategy; verify least privilege, TLS/reverse proxy, secure cookie, firewall, storage permissions, disk alerts, and log rotation on a staging host.

**Overall assessment:** substantial, non-mocked ERP functionality exists and has meaningful automated coverage, but “implemented” is not equivalent to audited, accountant-approved, production-ready or disaster-recovery-tested. The payroll arithmetic follows the requested 26×9 basis and absence-day rule at cent precision; maintenance custody settlement and archived-edit snapshots, manufacturing material/offcut/design/invoice paths, client statements, and statistical maintenance exports now have implementation and API-test coverage. The separate maintenance/manufacturing data boundary is still partial, legacy operation orders are not bulk reclassified, and cross-domain accounting/business policy remains subject to approval. The most consequential review areas remain role/object access and local file exposure, dual-driver SQLite transaction behavior, local backup/recovery operations, historical accounting semantics, and in-memory photo jobs. The evidence and open verification items above should be treated as part of this report's scope and limitations.

## 8. MADAR V2 — isolated Phase 1–4 status (2026-10-30)

`madar-v2/` is a separate Node.js/Express/SQLite project; Phase 2 added no routes or schema changes to the legacy `system/` application. Its API composes dedicated `clients`, `maintenance`, and `workshop` routers. Maintenance and workshop order lists require explicit stage filters; maintenance request bodies use allowlists and do not accept or return workshop cost/profit fields.

Implemented and locally tested in V2:

- Client codes/profiles, operational statistics, brand-logo upload/download, and a client-machine deployment relation. Existing deployments are backfilled from maintenance cards; new cards upsert the relation.
- Maintenance machine catalog, employee assignments, Before/After photo upload/read paths, review/archive transitions, warranty selection, petty-cash refund arithmetic, and audit snapshots.
- Workshop order creation, vector-file upload/download (extension allowlist, 40 MiB cap), ready/offcut registration, and delivered/archive transition. Delivery atomically creates an approved integer-cent sales invoice linked to the client and workshop order; duplicate delivery is rejected. Order details project source-linked issues from either warehouse.
- Materials catalog and opening-stock movements, real-time low-stock flags, 100-row movement history, transactional main-stock/offcut issues restricted to in-production workshop orders, manual offcut registration, and all-or-nothing scrap-sale treasury/movement records.
- Physical-count sessions snapshot active materials and available offcuts. Reconciliation requires a complete count set, compares against live system balances at reconciliation, posts linked gain/loss movements, records line variances, and closes the session. A zero-count offcut becomes `variance_lost` while its original quantity remains in history.
- Integer-cent finance: live Treasury balance and signed/referenced latest-entry listing; cash purchases atomically create approved purchase invoices, line snapshots, inventory restocks/movements, audit entries, and Treasury expenses; sales receipts update paid/remaining/status and create linked Treasury income. Expense posting rejects insufficient funds and fractional-cent purchase line totals are rejected.
- Maintenance custody advances and positive archive refunds post Treasury expense/income entries linked by maintenance-order ID/code. Client statements total approved sales billing and linked receipts, calculate outstanding balances, and identify unpaid invoices older than 60 days.
- Upload paths resolve under configurable `MADAR_V2_STORAGE_ROOT` (default repository-root `storage/`), use generated filenames, reject traversal and symlink components, and retain bytes outside the code bundle.
- Additive migrations `20261030-secondary-offcut-material-optional`, `20261030-client-machine-deployments`, `20261030-warehouse-lifecycle`, and `20261030-finance-lifecycle` preserve existing identifiers/history, permit unclassified offcut movements, add stock-count and invoice-line tables, backfill client-machine links, and add direct maintenance-order Treasury references. The cumulative `npm test` gate covers schema integrity, Phase 2 operations, Phase 3 warehouse/scrap treasury, Phase 4 finance lifecycle, and legacy-migration preservation: **14 passed, 0 failed**. Integration tests use isolated temporary SQLite databases and storage paths; no customer database was used.

Known V2 boundary: authentication/session middleware is not implemented yet. The server defaults to loopback, but if `HOST` is changed to a LAN-facing address, these routes are not protected by a V2 login boundary. Until auth is added, request audit attribution falls back to the bootstrap admin and is not per-human identity. Do not expose this API to a network before adding and testing authentication/authorization. The client machine list represents machine deployments inferred from maintenance cards; no explicit unassign/deployment-management endpoint exists yet. This phase is backend-only and does not establish production readiness, Ubuntu compatibility, accounting policy approval, or filesystem crash recovery.
