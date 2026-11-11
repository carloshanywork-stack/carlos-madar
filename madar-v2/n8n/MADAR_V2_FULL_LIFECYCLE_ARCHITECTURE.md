# MADAR V2 — Full Lifecycle Architecture & Evidence Map

**Review snapshot:** 2026-11-10
**Scope:** checked-out `madar-v2/` source, associated tests, and local n8n/Tailscale configuration.
**Important:** This is an architecture/evidence map, not a certification that every deployed instance, handset, or production recovery path has been exercised. The checkout contained uncommitted changes during review.

## Status meanings

| Flag | Meaning |
|---|---|
| 🟢 | Source path and relevant automated test evidence exist. This does **not** mean 100% deployed or operationally verified. |
| 🟡 | Implementation/configuration exists, but device, production, or broader operational verification is missing or a boundary remains. |
| 🟠 | A human approval/review is an intentional step in the business path. |
| 🔴 | The requested capability was not evidenced in the inspected implementation. |

## Physical and business data flows

### 1. Transport, API, and persistence

**🟡 Android APK → HTTPS host → Express API → SQLite and configured local storage.** The APK build defaults to `https://carlos-pc.tail852ef0.ts.net` (`android/app/build.gradle`, `ANDROID_PACKAGING.md`). A live local `tailscale funnel status` check on the review date showed Funnel enabled for that host and proxying to `127.0.0.1:3000`; another Funnel listener was shown on `:8443` to `127.0.0.1:8000`. Therefore, the transport is **not Tailscale-private-only**: Funnel provides public HTTPS ingress. This confirms local configuration/status, not successful connectivity from every handset or a security review of the exposed service.

The API uses the existing SQLite database with WAL enabled (`server/database/connection.js`). Customer/visit images and other files use the configured storage root; visit images are stored under `Areas/<area>/<year>/<month>/<machine>/{Before,After}/...`, with recovery staging under `.madar-recovery/rep-visits/` (`server/modules/rep/service.js`).

### 2. HR, attendance, overtime, and payroll

**🟢 Employee master → attendance records → reviewed overtime → finalized payroll → treasury.** Employee and login identities are linked by the staff/user synchronization path. Attendance can be recorded by administrators or the representative app; app clock actions retain time, source, GPS fields, and a `biometricVerified` value. The business-zone default is `Africa/Cairo`; shift overlap is calculated against 09:00–18:00, with Friday hours classified separately (`server/modules/employees/attendance.js`). Overtime remains reviewable; payroll refuses finalization while pending overtime exists. Finalization checks cash availability, stores payroll lines, writes salary expenses to treasury, and audits the run (`server/modules/employees/service.js`).

**🟡 Biometric boundary:** Android invokes the platform biometric flow, but the API receives/stores a client-supplied `biometricVerified` flag. Tests establish API validation and persistence, not cryptographic Android hardware attestation or a field-device run.

Evidence: `test/attendance-engine.test.js` (shift calculations, app/admin clock actions, overtime review, advances/adjustments, and payroll-to-treasury); `test/phase4-finance.test.js` (monthly attendance/payroll); `test/database-maintenance.test.js` (additive attendance migrations).

### 3. Representative mobile, maps, GPS, and visit upload

**🟡/🟢 Native/app implementation → server route:**

1. Representative login creates the normal session cookie; the Android-native login response also returns a bearer token for background work (`server/modules/rep/routes.js`).
2. `/api/rep/today-route`, map-pack catalog/manifest/tile endpoints, and assigned work orders feed the client. Route/reason/map data is cached locally; native Android also has a durable SQLite queue and local photo files. GPS duty tracking and mock-location detection are implemented in Android/client code.
3. Photo processing reads EXIF orientation, ensures portrait orientation, applies a watermark, and writes a compressed JPEG into app storage (`RepNativeEnginePlugin.java`). The queue requires **exactly 3 Before photos and 0–3 optional After photos**. It is not a six-photo minimum.
4. Android WorkManager sends the bundle as multipart to `POST /api/rep/sync-visit` with bearer auth. The server validates the rep/order/region/card and GPS/geofence, hashes payload/photos, and uses the visit UUID plus SHA-256 to reject changed-content replays and accept an identical retry idempotently.
5. Server-side image processing stages files, moves them into the configured `Areas/...` tree, and commits the visit and photo references in SQLite. A successfully received visit has `rep_visits.status='completed'`, while `rep_visit_reviews.status='pending'`; the API reports `pending_review`. This means **upload complete, not maintenance card complete**.
6. A supervisor may request a reshoot or approve. Approval merges visit photo/reason references and sets the maintenance card to `completed` in a transaction. A reshoot keeps the card incomplete and returns work to the field workflow.

Evidence: `MadarSyncWorker.java`, `RepLocalStore.java`, `RepNativeEnginePlugin.java`, `server/modules/rep/{routes,service}.js`, `server/modules/supervisor/service.js`; `test/rep-api.test.js` exercises upload, pending review, optional After photos, idempotency, reshoot, approval, and the card-completion gate. The same test checks stored JPEG normalization and physical file placement. `test/android-packaging.test.js` checks build wiring, not operation on a field handset.

### 4. Maintenance records, comments, exports, and photo rotation

**🟢 Maintenance orders/cards → rep assignment → approved evidence → machine/card history.** Visit comments are written to the current card and append-only machine note history on successful sync. Approval commits approved photo/reason references and status; it intentionally does not overwrite a newer note.

**🟢 Area comments export is implemented, not pending.** `AreaMaintenanceDirectory.jsx` provides export controls; the API supports area/machine filtering, notes-only scope, and latest/all history, and produces XLSX. `test/phase6-parity.test.js` checks filtered exports, history, sheet content, and invalid parameters.

**🟢 Manual lightbox rotation is implemented, not pending.** The API persists rotation metadata and a durable upright JPEG derivative; Sharp applies the saved rotation to viewer/download, thumbnails, and exports without rewriting the archived source. Cross-order/card/phase reassignment relocates the derivative and its metadata. `test/maintenance-multi-area.test.js` checks access control, audit metadata, derived views, reassignment, repeated rotation, and byte-for-byte source preservation.

### 5. Workshop, warehouse, and serial tracking

**🟢 Workshop is a manufacturing workflow, not an ATM-module repair ledger.** `workshop_orders` progress through `in_production → ready → delivered_archived`, can assign Workshop-department employees and store design files, and are distinct from ATM maintenance cards. Warehouse issues are restricted to an in-production workshop order. Main materials and secondary-warehouse offcuts create inventory movements; marking an order ready registers reusable offcuts; later issue can consume them; scrap sale updates treasury. Delivery creates an approved unpaid sales invoice; a separate receipt voucher posts treasury income and updates the invoice balance.

**🔴 Serial-number gap:** the inspected schema exposes `serial_number` for `employee_tool_custody`, but no structured serial tracking was found for stocked materials, machines, or ATM modules. Do not mark ATM module serial tracking connected.

**🟢 Main-warehouse whole-unit policy implemented.** An additive transactional migration extends movement history with an `offcut_return` movement while preserving movement IDs, and installs database guards against fractional main stock. Fractional main issues require an explicit round-up choice, debit the next whole unit, and create/audit the fractional remainder in the secondary warehouse in the same transaction. The UI offers the secondary-offcut alternative; purchases, opening stock, and main-stock counts require whole units. Existing fractional legacy balances are not silently rounded and must be reconciled by stock count before issue/receipt mutations. Covered by migration and API assertions in `test/database-maintenance.test.js`, `test/phase3-warehouse.test.js`, and `test/phase4-finance.test.js`.

Evidence: `server/modules/{workshop,warehouse}/service.js`, `server/modules/finance/invoices.service.js`; `test/phase2-operations.test.js`, `test/phase3-warehouse.test.js`, and `test/phase4-finance.test.js`.

### 6. Finance, petty cash, treasury, and RBAC

**🟢 Treasury is a local income/expense cash ledger.** Finance endpoints require Finance/Admin authorization (`server/modules/finance/routes.js`). Maintenance orders and later custody advances create cash expenses; archiving records actual expenses and the refund/adjustment. Payroll finalization writes salary expenses. Purchase invoice creation increases stock and records an unpaid supplier liability; a separate purchase payment voucher posts the treasury expense and updates paid/remaining/status. Sales receipts likewise update invoice paid/remaining/status and treasury together; workshop delivery only creates the unpaid sales invoice.

**Boundary:** these ledger rows prove application accounting behavior, not that physical cash changed hands. The inspected paths do not show a bank/payment-rail integration or a payment-method selector. Do not describe all settlements as independently verified “100% cash-only” outside this application ledger.

Evidence: `server/modules/finance/{treasury.service,invoices.service}.js`, `server/modules/maintenance/service.js`, `server/modules/employees/service.js`; `test/attendance-engine.test.js`, `test/phase2-operations.test.js`, `test/phase3-warehouse.test.js`, `test/phase4-finance.test.js`.

### 7. Audit and live SSE

**🟢 Persistent audit rows:** `recordAudit` stores actor, action, entity type/id, old/new JSON, and timestamp in `audit_log`; `/api/system/audit-log` is Admin-only and filterable (`server/modules/audit.js`, `server/modules/system/audit-routes.js`). Business services write audit entries in their transaction paths.

**🟢/🟡 Durable local replay plus in-process SSE:** rep and supervisor endpoints expose authenticated `text/event-stream` feeds. An additive SQLite event log supports `Last-Event-ID` replay after reconnect; retention is bounded to 10,000 rows. Live fan-out remains an in-process Set, so cross-process delivery is unsupported. If event persistence fails, the service logs the error and falls back to live in-process delivery; missed events still require API refresh. This fits the single-process SQLite deployment but is not an unbounded or zero-loss queue.

Evidence: `server/modules/operations-events.js`, `server/modules/rep/routes.js`, `server/modules/supervisor/routes.js`; `test/operations-events.test.js` and `test/rep-api.test.js`.

### 8. Backup, restore, and retention

**🟢 Implemented path:** a daily scheduler calls the system backup service. It checks/checkpoints database health, calls `database.backup(snapshotPath)`, and creates a ZIP containing the snapshot and configured storage tree under the local backup root. The restore endpoint validates and restores the archive. The implementation uses SQLite's backup API—not `VACUUM INTO` (`server/modules/system/backup.js`).

**🟡 Operational boundary:** integration tests create/download/restore against temporary paths, which is valuable automated evidence but not a production restore drill. A local ZIP is not proof of permanent retention, off-site protection, zero data loss, or recovery from disk failure. No such guarantee is claimed here.

Evidence: `test/phase6-parity.test.js`, `test/maintenance-order-deletion.test.js`, `test/storage-layout.test.js`.

## Proposed yellow items: checked against source

| Proposed pending item | Finding |
|---|---|
| Area maintenance selective comments export modal | **Implemented** in `client/src/modules/maintenance/AreaMaintenanceDirectory.jsx`; export API and selection/history behavior are covered in `test/phase6-parity.test.js`. Not a code gap based on this review. |
| Photo lightbox rotation and reassignment | **Implemented** in `client/src/modules/maintenance/OrderDetail.jsx`, maintenance routes/service, and `photo-images.js`; integration test verifies durable upright derivatives, cross-order/card/phase reassignment, audit, and unchanged source bytes. Not a code gap based on this review. |

## Remaining verification/actions

1. Exercise APK login, OS biometric prompt, camera/EXIF/watermark, offline queue/retry, offline maps, background GPS, and mock-location detection on supported physical Android devices.
2. Decide whether Funnel's public HTTPS ingress is intended; if private-only transport is a requirement, disable/reconfigure Funnel and verify the deployed APK/API path.
3. Specify and test structured serial tracking for ATM modules/parts if required.
4. Specify and test structured serial tracking for ATM modules/parts if required.
5. Decide whether bounded 10,000-row SSE replay and single-process fan-out meet the operational requirement; persistence failure and older-than-retention cursors still need normal API reconciliation.
6. Perform a documented production-safe restore drill and define backup retention/off-device strategy if stronger recovery guarantees are required.

## n8n artifact

`MADAR_V2_FULL_LIFECYCLE_ARCHITECTURE.json` is an independent, manual-only, inactive workflow (n8n workflow ID `e65f7b319ba84cb6a2e24071ad0a6b92`; 54 nodes). It contains no credentials, external API calls, schedules, or business writes. Its code node emits a **static** evidence index; the conceptual no-op diagram is disconnected from the manual trigger. The workflow was imported and exported back from local n8n; a manual CLI execution finished successfully. The instance contains eight workflows afterward, and the existing active CI/health workflow remains active and unchanged.

**Verification run (2026-11-10):** the serial full V2 test suite passed **98/98**; the client production build transformed **122 modules**; `npm run android:sync` passed; and `npm run android:debug` completed with JDK 21 and the SDK at `/home/carlos/android-sdk`. The generated debug APK passed `apksigner verify` and `unzip -t`; no physical-device install or field workflow was tested. `git diff --check` passed before this documentation update and was rerun afterward. The MADAR V2 package has no `npm run check` script. The JSON remains a static, inactive n8n evidence map, not a live business integration.
