# Field Rep Tracking, Offline PWA, and Capacitor — Implementation Roadmap

**Repository audit:** `madar-v2/` source, checked 2026-11-02. This is an implementation plan, not a claim that later phases are already delivered. The current working tree has other in-progress changes; this roadmap does not reset or replace them.

## Current-state audit

- The app is a React/Vite SPA served by one Express process. The API and SPA currently use same-origin `fetch` with an HttpOnly session cookie. Authentication also accepts a Bearer token, and the login response returns a token, but the client does not persist it in native secure storage.
- SQLite is opened through `better-sqlite3` in WAL mode. The database is currently rooted under `data/`; customer files use the configured storage root; the backup module has a separate backup-root setting. These paths are configurable but were not previously unified under an external mount.
- `users.role` currently has a constrained set of ERP roles and no `rep` or `technician` role. The admin user API has a narrower role list. Maintenance orders have employee/technician assignments, but no login-user assignment for a field rep. Existing maintenance cards already hold before/after file-path arrays and maintenance-reason IDs.
- Existing photo APIs upload to an order/card and use storage-root path validation. There is no field-visit UUID/idempotency table, rep location endpoint, breadcrumb model, or daily route view.
- The client currently has no service worker, manifest-backed PWA/offline queue, IndexedDB visit queue, or Capacitor/Android project. No `@capacitor/*` dependencies were found.
- Current maintenance API access is primarily authenticated-user access rather than a field-rep, assigned-order authorization boundary. It is not safe to expose the current API through a public tunnel for reps until the authorization phase is complete.

## Phases and acceptance gates

### Phase 0 — Storage partition foundation (implemented in this first slice)

- Add optional `STORAGE_MOUNT_PATH` support. When unset, existing local path defaults remain unchanged.
- When set, default SQLite/WAL and thumbnail data, uploads, and backups beneath the mount. Explicit path overrides must also remain beneath it.
- On Linux, fail startup before opening the database unless the configured path is an exact active mountpoint on a filesystem device different from `/`. Do not create data in an unmounted directory under the root partition.
- Refuse the common silent-empty-database failure when an existing default V2 database is present but its mounted destination is missing. Never auto-move live data.
- Deployment verifies the mount before proceeding. Existing installations require an operator-controlled backup, stop, copy, and verification before switching paths.

**Acceptance:** isolated tests cover default compatibility, mount-derived paths, containment, exact mountpoint parsing, and fail-closed checks. No production DB, customer storage, or live mount is read or moved by these tests.

### Phase 1 — Field identity, role authorization, and assignments

- Design an additive migration for rep/technician identities while preserving user IDs, sessions, employee links, audit actors, order history, and all existing foreign keys.
- Add explicit order-to-login-user assignment and role-specific authorization. Reps see only their assigned routes/cards; technicians get only the rights explicitly approved for their workflow. Admin ERP access remains intact.
- Audit all existing routes before enabling the new roles; use deny-by-default checks for mobile endpoints. Revoke sessions when accounts/assignments are deactivated as required.

**Gate:** tests prove unassigned users cannot read or mutate an order, its photos, notes, or another rep's activity; existing roles and sessions remain compatible after migration.

### Phase 2 — Idempotent visit and photo ingestion

- Define a visit resource tied to one assigned order/card, with a unique `visit_uuid`, immutable actor/assignment context, selected reason IDs, capture metadata, and explicit draft/queued/received/completed states.
- Make retries safe: the same UUID and same payload returns the original result; reusing a UUID with different content returns a conflict rather than silently accepting new bytes.
- Stage files on the storage filesystem, validate paths/types/sizes, and commit visit metadata and card integration transactionally with recovery for interrupted filesystem/DB operations.
- Integrate completed visits into existing before/after card fields and reason selections only when the server has the required phases. Preserve existing card IDs/history and never overwrite photos by machine name.

**Gate:** duplicate/concurrent retries produce one visit and one stored set of files; partial uploads remain resumable and do not falsely mark a machine complete.

### Phase 3 — Mobile web workflow and offline queue

- Add a separate Arabic rep experience for today's assigned route, refresh/search/progress, first-login tutorial, reason selection, preview, and queued/synced states.
- Add a versioned service worker for the app shell and static assets only. Do not cache authenticated API responses, photos, or tokens in the Cache API.
- Persist pending visits in IndexedDB with migration/version handling, queue recovery after process/browser restart, retry/backoff, and explicit storage-full handling. Keep file blobs and metadata tied to the same UUID.

**Gate:** airplane-mode tests can create, inspect, and retain a queued visit; connectivity recovery uploads it once; sign-out/account changes do not expose one rep's queued data to another.

### Phase 4 — Capacitor Android capture and device storage

- Add an Android wrapper and use camera-only capture in the app UI, local compression, native filesystem staging, network-state monitoring, and secure token storage. IndexedDB and physical pending files need a reconciled single queue, not two unsynchronized sources of truth.
- Keep native plugin behavior behind tested adapters so the PWA can still run in a browser. APK builds and Android permission flows require a real Android SDK/device or emulator verification.
- Treat camera-source enforcement as a UI/provenance signal, not proof: a modified client can call the API directly. Do not claim that an image is impossible to forge based solely on which picker the official app presents.

**Gate:** device tests cover permission denial, low storage, process death, duplicate retry, app update, and recovery of pending files. APK signing keys remain outside the repository.

### Phase 5 — GPS evidence and supervisor trail

- Capture location/time with explicit on-duty consent and server-side authorization. Store accuracy, provider, mock-location indicator where available, and capture provenance separately from photos.
- Android native APIs may flag mock locations on supported OS versions, but rooted devices, modified clients, and location spoofing cannot be ruled out completely. Image watermarks are presentation evidence, not trusted geolocation proof; server metadata remains separately auditable.
- Implement movement/time sampling, foreground-service notification and Android background-location permissions, a supervisor map, access audit, retention policy, and correction/incident review.

**Gate:** verify battery behavior and Android background execution on target devices; define location retention and employee notice before enabling continuous tracking.

### Phase 6 — Public access and production operations

- Only after Phase 1 authorization and security testing, expose the app through the explicitly requested Cloudflare Tunnel. Keep the origin bound to loopback and do not publish port 3000. A tunnel provides HTTPS transport, not MADAR authorization by itself; all requests still require app authentication and role checks.
- Define Cloudflare Access compatibility for the native client, rate limits, request-size/timeouts, tunnel service supervision, firewall policy, secret handling, and incident response. Mobile photo/GPS traffic will transit Cloudflare; confirm that data-processing boundary before production use.
- Add mount ordering to systemd/PM2 startup and perform an Ubuntu staging deployment, backup/restore drill, mount-loss test, and offline-sync concurrency test before rollout.

## Cross-cutting rules

- Preserve the existing SQLite driver, WAL mode, IDs, and history. Migrations must be additive/transactional or use a reviewed table-rebuild migration that proves every foreign key and audit reference survives.
- Do not put customer files or business data in cloud storage. The requested Cloudflare Tunnel is an external network ingress path, not a data-storage target.
- Keep original uploaded bytes and server-generated derivatives distinct. Never treat client-side compression, GPS, timestamps, or watermarks as tamper-proof evidence.
- Do not expose existing finance, admin, archive, or storage APIs to field accounts by default. Add explicit permissions and tests before enabling the public ingress.
- Do not run migrations, copy files, or restore against a production database as an experiment. Use isolated test databases and a documented backup/rollback plan.

## Decisions to confirm before their implementation phase

1. Should a technician be an employee record, a login role, or both, and can technicians also be assigned orders directly?
2. Does a rep see only assigned maintenance orders, or any client/machine route beyond those assignments? The planned default is assigned records only.
3. What retention period and supervisor visibility should apply to continuous GPS trails and failed/queued photo uploads?
4. Should Cloudflare Access be used in addition to MADAR login? Native-app compatibility and recovery from Access challenges need to be designed before configuring the tunnel.
5. Are old V2 database and storage contents to be copied to `/mnt/storage` during rollout? The implementation requires an explicit operator migration; it will not infer or move live data.
