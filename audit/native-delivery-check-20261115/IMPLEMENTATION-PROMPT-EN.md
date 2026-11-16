# MADAR Native — Implementation Prompt (Remaining Release Work)

## ROLE AND MODE

You are the implementing engineer for **MADAR V2**. This is an execution task, not a planning task. Write the code, run the tests, and ship it.

- Work directly on `main`. Do not create branches or worktrees unless explicitly asked.
- Follow the existing patterns in the repository. Do not introduce a new state library, a new HTTP client, a new DB driver, or a new UI framework.
- Do not redesign anything that already works.

## VERIFIED BASELINE — 16 Nov 2026

These facts were confirmed by direct inspection. Do not re-litigate them, but re-verify before building.

- `origin/main` = `c4c6cd4`, production server clean (`sourceDirty=false`).
- Production health: `https://carlos-pc.tail852ef0.ts.net/api/health`.
- Version: **2.2.2 / versionCode 15**.
- Release artifact on the server: `madar-rep-release.apk`, 15 MB, `sha256 dc4a909f4c71767551c6c6afdb1a3602303b4a0e34f388af7d4482257498d924`, signed `f4c8bffc9f852ea6056e350b65156eb880d05629991682492159b9e3937c02a1`.
- **The release keystore exists on the production server**: `android/madar-release.keystore`, alias `madar-rep`, with `android/key.properties` (mode 600). It is not on the Windows workstation.
- Server test suite: **198/198 passing**.
- Deployed tables: `rep_bug_reports`, `rep_bug_report_attachments`, `rep_bug_report_events`, `rep_machine_location_change_requests`, `apk_releases`.
- `MADAR_REP_SIGNER_CERT_SHA256` is set in the server `.env` and matches the approved certificate.
- No GitHub token is configured on the server.
- SSH access works as `ssh Ubuntu-Server` (user `carlos`), not as `madar@100.115.125.88`.

## HARD RULES

1. **Phone testing is not a gate.** Build, test, sign, and publish without a physical device. Never claim a real-device test, an in-place upgrade, or a successful installation without evidence. Emulator use is optional.
2. **Secrets never leave the server.** Never print, commit, or copy the keystore passwords, `MADAR_V2_JWT_SECRET`, or the GitHub token.
3. **Migrations are additive and idempotent**, recorded in `schema_migrations`. Preserve IDs and history. Never recreate tables.
4. **Keep the suite green.** `npm test` must stay at 198+ passing with zero failures. Add tests for every new behaviour.
5. **Do not duplicate existing endpoints.** Extend them.
6. **Take a backup before touching production.** SQLite + storage. Verify the restore path first.
7. Do not change the package id `com.madar.rep.app`.

## EXISTING CONTRACTS — USE THESE, DO NOT REDESIGN

### Bug reports
- `POST /api/rep/support/reports` — multipart: `report` (JSON string) + optional `attachment` (single image, ≤4 MB).
- Report fields: `reportUuid`, `category`, `severity`, `description`, `screenName`, `appVersion`, `deviceModel`, `androidVersion`, `logs`.
- `GET /api/rep/support/reports` — own reports.
- Admin: `GET /api/system/rep-support/reports`, `GET /api/system/rep-support/reports/:id`, `PATCH /api/system/rep-support/reports/:id`, `POST /api/system/rep-support/reports/:id/github-issue`, `GET /api/system/rep-support/:reportId/attachments/:attachmentId`.

### Location change requests
- `POST /api/rep/machines/:machineId/location-change-requests` — multipart: `request` (JSON) + optional `evidence` (single image, ≤4 MB).
- Request JSON: `actionUuid`, `cardId`, `location { latitude, longitude, accuracy, updatedAt, isMock }`, `note`.
- Server already enforces: non-mock, accuracy ≤100 m, fix age <5 min, machine must be `is_location_locked = 1`, no second pending request per machine.
- `GET /api/rep/location-change-requests` — own requests.
- Admin: `GET /api/system/rep-location-changes`, `GET /api/system/rep-location-changes/:id/evidence`, `POST /api/system/rep-location-changes/:id/approve|reject`.

### APK delivery
- `GET /download/apk/status` (auth required) returns `available`, `artifactType`, `sizeBytes`, `modifiedAt`, and `releaseMetadata` = `{ sourceRevision, sourceTreeDirty, builtAt, versionName, versionCode, buildType, apkSha256, signerCertificateSha256 }`.
- `GET /download/apk` (auth required) returns the APK bytes.

## WORK PACKAGES

### WP1 — In-app update (highest priority)

Without this, no future release can reach a single representative.

**Android only.** No server changes needed.

1. Add `<uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />` to `AndroidManifest.xml`.
2. Add an API method that calls `GET /download/apk/status` with the bearer token and parses `releaseMetadata` into a `@Serializable` model.
3. Add a streaming download of `GET /download/apk` into `context.cacheDir/updates/`, writing to a temp file and renaming on success.
4. Verify before handing off:
   - SHA-256 of the downloaded file equals `apkSha256`.
   - `versionCode` is strictly greater than `BuildConfig.VERSION_CODE`.
   - `signerCertificateSha256` equals the trusted constant embedded in the app.
   - Package name from `PackageManager.getPackageArchiveInfo(..., GET_SIGNING_CERTIFICATES)` equals `com.madar.rep.app`, and its signing certificate SHA-256 matches the same trusted constant.
5. Delete the temp file on any failure and show a specific message per failure (`hash mismatch`, `signer mismatch`, `not newer`, `not configured`, `download failed`).
6. Hand off with `Intent.ACTION_VIEW`, `application/vnd.android.package-archive`, a `FileProvider` content URI (`${applicationId}.fileprovider` already exists in the manifest) and `FLAG_GRANT_READ_URI_PERMISSION`.
7. If `packageManager.canRequestPackageInstalls()` is false, open `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` for the app and stop.
8. Never uninstall, never clear data, never auto-install silently.

**DoD:** unit tests for version comparison, hash comparison, and signer comparison pass; the debug build compiles; the UI shows current version, available version, and one clear action.

### WP2 — Two-tab shell with Profile / Settings

**Android only.**

1. `MadarRoot.kt` currently exposes four tabs: `ROUTE`, `MAP`, `SYNC`, `SUPPORT`. Reduce the bottom bar to **two**: “My Work” (route) and “Map”.
2. Add a Profile entry in the top bar that opens a new `ProfileScreen.kt`.
3. Move into `ProfileScreen`: attendance entry, notifications entry, sync screen entry, support/bug report entry, permissions status, update card (WP1), app version, logout.
4. Keep the existing rule that a capture in progress cannot be lost by navigation.
5. Do not delete the existing screens — reach them from Profile instead.

**DoD:** the bottom bar has exactly two items; every previous destination is reachable in at most two taps; no screen is orphaned.

### WP3 — Location-change request screen

**Android only** — the server contract already exists and is tested.

1. In the visit/ machine flow, when `isLocationLocked` is true and the machine has coordinates, offer “Request location change”.
2. Collect a fresh GPS fix through the existing `LocationProvider` (non-mock, accuracy ≤100 m, age <5 min).
3. Show current coordinates, proposed coordinates, accuracy, and computed distance before submission.
4. Submit multipart `request` JSON with a client-generated `actionUuid` (UUID), `cardId`, `location`, and `note`; attach an optional photo as `evidence`.
5. Show request status history from `GET /api/rep/location-change-requests` (pending / approved / rejected with note).
6. Handle `409` responses with their exact server messages: already pending, location changed, UUID reused with different content.

**DoD:** a rep can submit a request offline-intolerant but network-safe flow with idempotent UUID, and see its status later.

### WP4 — Bug report upgrade and offline queue

**Android + server validation only.**

1. Replace the current single-field form with: category (picker), severity (low/normal/high/critical), description, current screen, optional screenshot, and an opt-in “attach diagnostics” switch.
2. Fill `appVersion` from `BuildConfig.VERSION_NAME` + `VERSION_CODE`, not a hardcoded string.
3. Collect `deviceModel` and `androidVersion` from `Build`.
4. Collect sanitized logs: last N lines from the in-app log buffer only. Strip tokens, cookies, phone numbers, and customer names. Never send raw logcat.
5. Queue reports in the local Room database when offline, keyed by `reportUuid`, and flush from the existing `SyncEngine` on reconnect. Retries must be idempotent (the server already deduplicates by `reportUuid`).
6. Server: no schema change expected. Confirm `category` and `severity` value sets are enforced and reject unknown values with `400`.

**DoD:** an offline report survives an app restart and lands exactly once on the server; tests cover queue flush, duplicate flush, and redaction.

### WP5 — ZIP and Excel export for bug reports

**Server + admin dashboard.**

1. `GET /api/system/rep-support/reports/:reportId/package.zip` — admin only. Contains `report.json`, `summary.txt`, and every attachment. Use the existing `archiver` dependency.
2. `GET /api/system/rep-support/reports/export.xlsx?status=&from=&to=` — admin only. One row per report with: id, uuid, representative, category, severity, description, screen, app version, device, Android version, status, GitHub issue URL, created/updated. Use `xlsx`.
3. Both endpoints must set correct `Content-Type` and `Content-Disposition`, be rate-limited consistently with the rest of the system, and be covered by tests.
4. Add two buttons to `RepSupportAdminPage.jsx` matching its existing style.

**DoD:** tests assert the ZIP contains the expected entries and the workbook has the expected headers and row count.

### WP6 — GitHub integration activation

1. Add `MADAR_GITHUB_ISSUES_TOKEN` and `MADAR_GITHUB_ISSUES_REPOSITORY` to `madar-v2/.env.example` with comments.
2. Keep issue creation **manual** (admin button already exists at `POST /api/system/rep-support/reports/:id/github-issue`). Do not create issues automatically.
3. When unconfigured, the button must explain that the integration is not configured instead of surfacing a raw server error.
4. Document in `ANDROID_PACKAGING.md` or a new `REP-SUPPORT.md`: token scope (Issues RW + Metadata R), storage location, rotation steps, and that it never reaches the client.

**DoD:** with no token, the admin sees a clear message; with a valid token, an issue is created once and the report stores `githubIssueUrl`.

## BUILD AND RELEASE

1. Bump to **2.3.0 / versionCode 16** in `madar-v2/android/version.properties`.
2. Run locally: `npm test`, `npm --prefix client run build`.
3. Build Android on the server (the keystore lives there): `npm run android:release` from `/home/carlos/Desktop/MADAR/madar-v2`, with `JAVA_HOME` pointing at JDK 21 and Android SDK 36.
4. Confirm the manifest sidecar: `buildType=release`, `sourceTreeDirty=false`, `versionCode=16`, `signerCertificateSha256=f4c8…`, and `apkSha256` equal to the actual file hash.
5. Copy the APK and sidecar to the served path, keep the previous pair for rollback, restart `pm2 restart madar-v2`, and verify `GET /download/apk/status` with an authenticated session.
6. Write a release note stating explicitly: **no physical-device or in-place upgrade test was performed.**

## REPORTING

Report back with:

- The commit SHA(s) pushed.
- Test counts before and after.
- Every changed file grouped by work package.
- The final APK hash, version, and signer.
- The exact authenticated `curl` output for `/download/apk/status`.
- A “not verified” list: anything dependent on hardware.

## OUT OF SCOPE

- Silent installation or MDM/Device Owner work.
- Changing the package id.
- New roles or permission models beyond `can_self_approve_visits`.
- Rewriting the visit approval engine — it works and is tested.
- Any change to the legacy `system/` application.
