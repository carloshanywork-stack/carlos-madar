# MADAR V2 Deep Audit & Closed-Loop Architecture Blueprint

**Review date:** 5 November 2026

**Scope:** `madar-v2/` source, current UI/API wiring, Android packaging and native sync source, SQLite migrations, storage/backup flows, tests, and deployment configuration.
**Review type:** source-based architecture and risk audit; not a penetration test, accounting opinion, release certification, or production-data integrity attestation.

## Executive readout

MADAR V2 has a credible local-first foundation: modular Express routes, a React/Vite client, a native Android representative app, SQLite with WAL/foreign keys, additive migration history, configured local file roots, transactional stock/treasury operations, and a durable Android visit queue. The current isolated automated suite passed **91/91 tests on Node.js 24.21.0**.

The system is **not yet demonstrated production-ready**. The most important architecture decisions and release gates are:

1. **Access policy is inconsistent at API boundaries.** Invoice lists and detailed payroll are available to any authenticated non-representative account, while related finance/payroll writes are gated. Several inventory, workshop, and maintenance mutations also have no route-level role gate. Risk depends on whether non-admin roles are actually issued; the source supports them, while the operating context also says the user base may be admin-only.
2. **Purchase settlement semantics conflict across the stated requirements.** V2 currently marks a purchase invoice fully paid and creates its treasury expense in the same transaction as stock receipt. The repository’s core rule says invoice creation and cash/payment vouchers are separate; the closed-loop target specification separately calls for strictly cash-at-purchase supplier purchases. An owner decision is required before changing this path.
3. **Storage restore is recoverable for ordinary exceptions, but not durably journaled across process/power loss.** It renames the existing storage root, publishes the new root, then replaces the database. Startup recovery handles maintenance and rep-upload stages, not an interrupted restore swap.
4. **Bulk transfer and export limits are not aligned.** Trip-folder uploads allow 20 GiB in the API, but the supplied Nginx configuration accepts only 250 MiB. Empty `orderIds` on PPTX export expands to every archived order after the 500-ID request check, and report buffers/completed exports are held in process memory.
5. **Mobile and dependency release evidence is incomplete.** Android queue/session protections are present in source, but there was no APK/Gradle or device run. The V2 Android package ID changed from an earlier ID and will not inherit that package’s private queue/data on install. The last recorded dependency scan reported unresolved advisories and was not rerun for this audit.

These findings describe the **current working tree**, which already contained uncommitted V2 and report changes. No implementation code, live database, customer storage, backups, `.env` secrets, APK, or deployment service was modified or exercised for this audit.

## Evidence and severity conventions

- **Confirmed:** directly visible in current source or demonstrated by an isolated test.
- **Conditional / policy:** behavior is confirmed, but the risk or desired behavior depends on an owner decision, role population, or deployment topology.
- **Unverified:** cannot be established from this Windows source/test run; it is not stated as a defect.
- **P1:** resolve before inviting non-admin users, relying on financial reports, or calling restore/release operations production-safe. **P2:** bounded reliability, capacity, or release-hardening work after P1 decisions.

## Six-pillar findings

### 1. Identity, authorization, and auditability

**Positive controls confirmed.** `server/app.js:138-159` requires authentication for the business API, routes representatives separately, and denies representatives access to non-rep APIs. Auth routes admit `admin`, `sales`, `operations`, and `purchasing` (`server/modules/auth/routes.js:47-60`); authentication uses active-user/session checks in `server/modules/auth/service.js`. The UI hides selected routes such as staff and supervisor, but frontend navigation is not the API authorization boundary (`client/src/App.jsx:58-70`).

**P1 — Finance and payroll reads are broader than the corresponding write controls (confirmed; exposure conditional on issued roles).** `GET /api/finance/invoices` has no finance/admin middleware (`server/modules/finance/routes.js:34-51`), although treasury reads and invoice mutations use `requireFinanceOrAdmin`. `GET /api/employees/payroll` has no role middleware while payroll finalization, advances, and adjustments are admin-only (`server/modules/employees/routes.js:82-97`). The payroll result includes individual base salary, overtime, deductions, advances, and net pay (`server/modules/employees/service.js:510-580`). Any authenticated non-rep account can therefore read these endpoints in the current route composition. Add explicit negative API tests for every role after the owner approves a role matrix; do not infer that UI hiding is sufficient.

**P1 — Mutation authorization needs one complete matrix (conditional).** Warehouse and workshop mutation routes have no route-level role guard (`server/modules/warehouse/routes.js:27-60`; `server/modules/workshop/routes.js:25-64`). Many maintenance CRUD, custody, card, status, archive, and trip-folder routes likewise have no route-level role middleware (`server/modules/maintenance/routes.js:222-275, 304-415, 469-503, 540-563`), although some admin-only operations are guarded and the service enforces special cases such as archived-order edits. This is a confirmed route pattern, not a claim that every such action must be admin-only. If sales/operations/purchasing logins are enabled, specify and test each read/write permission; if the deployment truly has only admin accounts, record that as an explicit deployment policy and verify active accounts operationally.

**P2 — Audit events are written, but an Admin audit browser was not found in V2.** `server/modules/audit.js:3-23` persists actor/action/entity/old/new values. Source search found audit writers and internal queries, but no V2 audit-browsing route or UI page. This leaves operators without an evident supported way to investigate those records, despite the project requirement for Admin-only audit browsing. Add a read-only, filtered Admin API/UI and tests; avoid exposing sensitive audit payloads to other roles.

**Conditional — CORS trusts a broad Tailscale DNS suffix.** CORS enables credentialed requests and accepts HTTPS origins ending in the configured suffix (default `.ts.net`) in `server/app.js:75-81` and `:66-70`. This is not by itself an authentication bypass. Confirm the deployment’s tailnet/origin threat model; prefer an explicit origin list if unrelated tailnet sites should not be allowed to make credentialed browser requests.

### 2. Business workflows and closed-loop financial/inventory truth

**Confirmed workflow foundation.** Maintenance orders use `in_progress → review → archived`, record petty-cash advances, and reconcile actual expense/refund on archive transactionally (`server/modules/maintenance/service.js:2753-2793, 4564-4630`). Workshop orders use `in_production → ready → delivered_archived`; ready-stage offcuts are recorded in the secondary warehouse and delivery creates/links a sales invoice transactionally (`server/modules/workshop/service.js:20-21, 281-349`). The workshop machine selector already supports CNC router, laser, both, or manual production (`server/modules/workshop/service.js:20-21, 86-100`). Warehouse APIs expose issue, offcut, scrap-sale, and stock-count operations (`server/modules/warehouse/routes.js:27-60`). These are source-confirmed capabilities; their tests do not certify production balances or accountant approval.

**P1 — Resolve the purchase-invoice/payment rule before modifying accounting behavior (confirmed behavior; conflicting policy).** `createPurchaseInvoice` sets `paid_total_cents = total`, `remaining_cents = 0`, and `payment_status = 'paid'` (`server/modules/finance/invoices.service.js:142-152`), then increases stock and inserts a treasury expense in that same immediate transaction (`:164-220`). This matches the target specification’s “100% cash at purchase” rule, but conflicts with the core project rule that invoice creation does not itself move cash and payment vouchers are separate. Decide whether a purchase is explicitly a cash-purchase action (with a linked payment voucher created atomically) or whether the invoice may remain unpaid until a separate payment event. Preserve stock receipt, invoice state, treasury movement, audit, and rollback as one coherent business flow under the chosen rule.

**Policy decisions still needed.** Approve commission, mileage/per-diem, payroll settlement, allowed role ownership, supplier payment/evidence, and client payment terms. The payroll engine currently derives daily/hourly rates from 26 days × 9 hours and applies 1.5× normal / 2× Friday-holiday overtime (`server/modules/employees/service.js:538-556`); its calculations are not an accountant/legal approval. Keep the existing integer-cents and transaction boundaries while policies are settled.

### 3. Database, migrations, and business history

**Positive controls confirmed.** `server/database/connection.js:12-17` enables foreign keys, WAL, `synchronous=NORMAL`, and a 5-second busy timeout. V2 uses additive, versioned schema migrations and retains historical IDs/relations by design; the tests include migration and schema-integrity coverage. Business mutations use SQLite transactions, including purchase/stock/treasury, maintenance custody, workshop delivery, and backup database replacement.

**Operational boundary.** SQLite and filesystem state do not share one transaction. The one-process PM2 configuration (`ecosystem.config.cjs:4-13`) is appropriate to the local SQLite design; do not scale to multiple app workers without redesigning locks, scheduling, and filesystem coordination. No production integrity check was performed in this audit.

**P2 — Auditability and recovery should be made an explicit cross-domain contract.** Audit writes exist, but read access is absent as noted above. Continue requiring actor, action, entity, before/after values, and timestamp for sensitive changes; add migration rollback/failure-injection tests for any new cross-table or filesystem workflows. Do not repair historical data or normalize records as a side effect of this audit.

### 4. Android field operations and offline reliability

**Positive controls confirmed in source/static tests.** Android stores route/reason snapshots and pending visit metadata in app-private SQLite with a durable photo queue (`android/app/src/main/java/com/madar/rep/app/RepLocalStore.java:18-41, 115-166`). The sync worker sends the whole visit bundle with the original UUID, retries uncertain responses, and only deletes local photos after a matching committed server acknowledgment (`MadarSyncWorker.java:29-159`). Session tokens use AndroidX encrypted preferences (`RepAuthStore.java`); background work is scheduled through WorkManager. The Android packaging test validates source/config contracts, not a compiled application (`test/android-packaging.test.js:10-49`).

**P1 release gate — verify package transition and recovery on devices.** `ANDROID_PACKAGING.md:63-67` records that the package ID changed from `com.madar.rep` to `com.madar.rep.app`; Android will install it as a separate app and will not transfer the old app’s private database, preferences, or pending files. Before replacing an installed field app, inventory installed versions, ensure pending visits are synchronized or safely migrated, and rehearse the transition. The current release signing key is owner-managed; versionCode must increase for updates (`ANDROID_PACKAGING.md:48-59`).

**Unverified — no APK/Gradle or physical-device verification.** The source supports camera/location permissions, encrypted auth storage, local queueing, and HTTPS API configuration, but this audit did not compile/sign/install an APK or test process death, Doze/OEM behavior, permissions, storage exhaustion, app update, or background GPS. JDK/Android SDK availability blocked native verification in the current environment. Do not equate the 91 Node tests or static Android test with device acceptance.

**Conditional external data transfer.** The representative app defaults to a Tailscale HTTPS host (`capacitor.config.ts:6-32`), which is network reachability and not evidence of cloud storage. The navigation helper constructs a Google Maps URL containing machine coordinates or address (`client/src/modules/rep/map-utils.js:12-19`). Confirm that this user-initiated transfer is approved for customer/site data; provide an approved alternative if policy requires all location handling to stay on the trusted network.

### 5. File storage, backups, restore, and infrastructure

**Positive controls confirmed.** Storage paths are configured, traversal segments are rejected, and root/subdirectory symlinks are rejected in `server/modules/storage.js:8-49, 173-200`. Backup restore validates ZIP paths/types/size, SQLite header/integrity/foreign keys/schema, and runs database replacement transactionally (`server/modules/system/backup.js:158-227, 235-254, 268-307`). The isolated parity test creates, lists, downloads, and restores a backup, then verifies restored business rows and a fresh login (`test/phase6-parity.test.js:717-747`). Startup recovery exists for several maintenance stages and interrupted representative uploads (`server/index.js:7-41`).

**P1 — Restore’s filesystem swap has no durable crash-recovery journal (confirmed).** `restoreStorageFromStage` renames the live root to a random `.madar-v2-storage-old-*` sibling, renames the staged tree into place, then replaces the database and deletes the old tree (`server/modules/system/backup.js:309-337`). Exception handlers attempt an in-process rollback, but a process/power loss between those steps can leave the live root absent, the old root orphaned, or database and files from different snapshots. Startup recovery in `server/index.js:7-41` does not include restore operations. Add a same-volume durable operation journal with startup recovery for each state, plus injected-crash tests on isolated data. Do not relocate storage while serving requests; schedule an approved downtime window for any root relocation.

**P1/P2 — Backup confidentiality and retention are not closed.** The API backup path writes ZIP entries without application-level encryption (`server/modules/system/backup.js:379-415`), and `listSystemBackups` only lists archives; no retention/deletion policy appears in this module (`:419-430`). A separate optional `scripts/cloud-backup.sh` creates a GPG-encrypted local archive but includes `.env` files in the encrypted payload (`:33-48, 127-157`); the script does not establish that any remote upload occurs, and it was not executed end-to-end here. Decide retention, encryption/key custody, separate-device or trusted-LAN copy, and restore drill ownership. Restrict backup file permissions and never include plaintext secrets in an external destination.

**P1 deployment mismatch — 20 GiB API upload vs 250 MiB proxy cap (confirmed in supplied configs).** `POST /api/maintenance/orders/:id/process-folder` accepts a 20 GiB ZIP (`server/modules/maintenance/routes.js:78-82`), while `nginx-madar.conf:8-10` caps request bodies at 250 MiB. If this Nginx config fronts the server, uploads above 250 MiB fail at the proxy before the API’s own limit. Choose realistic maximums and align proxy, API, temp-disk, timeout, and backup capacity; document whether TLS terminates at this HTTP-only Nginx sample or at a trusted upstream proxy.

### 6. Performance, supply chain, and verification

**P1/P2 — PPTX export can silently become unbounded work (confirmed).** The request rejects more than 500 submitted IDs, but an empty array is then replaced with every archived order (`server/modules/maintenance/export.js:641-665`). The generated PPTX is returned as a full in-memory buffer (`:925-938`); async completed reports and progress are process-local maps with a 10-minute completed-report TTL (`:39-99`). A caller that sends `orderIds: []` can therefore request a large archive export that bypasses the submitted-ID cap. Reject empty selection unless “all” is an explicit, separately authorized, bounded operation; cap total cards/photos/output bytes, bind progress/results to the requesting user, and test concurrent export memory/time under representative data.

**P1 release gate — dependency findings are stale, not cleared.** `madar-v2/package-lock.json` pins the dependency tree and the package requires Node 22+ (`package.json:6-18`). The latest recorded `npm audit --omit=dev` result in `SYSTEM_AUDIT_AND_STATUS.md` reports **8 unresolved advisories (5 moderate, 3 high)**, including `image-size` through `pptxgenjs` and high-severity `xlsx` advisories without a recorded npm fix. That scan was not rerun for this audit; treat it as a follow-up signal, not a current fresh inventory. Re-scan the locked production tree, review upstream/vendor advisories, test compatible upgrades, and avoid blind major-version updates.

**P2 — automated release gates are not evidenced.** The inspected V2 tree has no workflow files under `madar-v2/.github/workflows/`, and `madar-v2/package.json` has no `npm run check` script. Establish repeatable CI for the serial test suite, client build, migration/schema tests, dependency review, Android static packaging checks, and release artifact metadata. This audit did not verify a Linux/Ubuntu host, PM2 runtime, reverse-proxy TLS chain, production storage mount, or backup capacity.

## Prioritized architecture blueprint

### Phase 0 — Decide the policy contract (before implementation)

Record one approved decision sheet for: role-by-route permissions and whether any non-admin accounts will be issued; supplier purchase payment semantics; sales/credit/receipt terms; payroll and custody rules; external Google Maps use; mobile package rollout; backup retention/encryption/key custody; and storage recovery objectives (RPO/RTO). Explicitly reconcile the two purchase rules instead of silently choosing one.

### Phase 1 — Protect sensitive reads and money-changing routes

Implement a reviewed server-side authorization matrix and test both allowed and denied roles for invoice reads, payroll reads/exports, employee data, warehouse adjustments/scrap sales, workshop transitions, and maintenance cash/card/archive mutations. Add the Admin-only audit browser. Keep role decisions in API middleware/service checks, not only frontend route visibility. Then implement the owner-approved purchase settlement workflow with invoice, stock, treasury, and audit updates in a single consistent transaction.

### Phase 2 — Make restore and backup operationally recoverable

Add a durable restore state journal and startup recovery that can safely complete or roll back every database/storage swap point. Add failure-injection tests for process loss before/after each rename and DB commit; require DB integrity, FK integrity, storage-path verification, session revocation, and successful login after recovery. Define encrypted backup/key custody, retention, a trusted independent copy, alerting, and a scheduled isolated restore drill. Keep any storage relocation in a separately approved downtime runbook.

### Phase 3 — Align mobile rollout and field acceptance

Choose a one-time transition plan for the old Android package ID and pending offline work. Verify monotonically increasing `versionCode`, release signing-key custody and backup, HTTPS origin, login, GPS/camera permissions, offline queue, duplicate retry, process death, app update, low-storage recovery, and device/OEM background behavior on representative physical devices. Only then distribute a signed release.

### Phase 4 — Bound large jobs and close deployment limits

Require explicit bounded export selection; add order/card/photo/output limits, per-user export ownership, cancellation/cleanup, and concurrency stress tests. Align Nginx, API, upload staging, and disk limits to a tested maximum. Measure memory, event-loop responsiveness, SQLite lock waits, disk usage, and backup duration using production-like synthetic data before raising caps.

### Phase 5 — Establish repeatable release assurance

Run a fresh lockfile-based dependency audit and resolve or formally accept each advisory; add CI gates for tests/build/schema integrity and Android packaging checks. Complete an isolated Ubuntu/PM2/reverse-proxy/restore rehearsal without production data, record exact runtime/configuration and RPO/RTO, and preserve a rollback plan. Do not claim production readiness until business policies, authorization tests, signed APK/device checks, and restore drills are all accepted.

## Verification record and limits

- **Executed for this audit:** `npm test` in `madar-v2/` on Node.js 24.21.0; **91/91 passed, no skips**. The suite uses isolated test databases/storage roots. No production DB or real customer storage was targeted.
- **Relevant test evidence:** `test/phase6-parity.test.js` covers an isolated backup/restore round trip and post-restore session login; `test/phase4-finance.test.js` covers finance lifecycle behavior; `test/attendance-engine.test.js` and `test/phase6-parity.test.js` cover payroll/employee behavior; `test/android-packaging.test.js` checks source/config contracts rather than compiling an APK.
- **Previously recorded, not rerun here:** `MADAR_V2_COMPLETE_SYSTEM_REPORT.md` records a Vite client build of 121 modules and `git diff --check` pass for an earlier verification pass. It also records that V2 has no `npm run check` script.
- **Not verified:** live users/role assignments, production DB/file consistency, backups/restore on real data, Linux/Ubuntu/PM2/Nginx behavior, JDK/Android SDK/Gradle build, signed APK installation/update, physical-device reliability, current dependency audit, and approved finance/HR policy.

## Scope-preservation note

The repository already had modified V2 implementation files and modified status/report documents when this audit continued. Those changes were treated as user work. This audit adds only a new report and its companion canvas; it does not amend or revert the existing files. Re-run `git status --short` before committing so the new audit artifacts remain distinct from the pre-existing worktree changes.
