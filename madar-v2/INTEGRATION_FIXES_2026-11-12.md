# MADAR V2 integration fixes — 12 November 2026

## Scope and behavior

Changes are made directly on `main`. They concern MADAR V2, not the legacy `system` application. Finance compatibility policy is outside this change.

- GPS backlog ingestion cannot open or reopen a duty session. Attendance creates/closes duty sessions; historical points must match one unambiguous representative-owned session. Durable representative-scoped point receipts distinguish insertion, identical retry, payload conflict, and rejected points. Legacy tracking rows remain readable.
- Android tracking owns a frozen representative identity. Queue identities survive restart and additive migration. Machine/attendance/tracking failures do not stop independent visit uploads; unresolved machine prerequisites still block their own visits.
- Foreground native SSE uses bearer authentication, account-scoped cursors, bounded reconnect, lifecycle pause/resume, and authoritative API reconciliation. Native WorkManager completion signals refresh visible queues. Maintenance mutations also request scoped API refreshes. This updates business data while the application is open; installing changed Android code still requires a new APK.
- Supervisor business notifications include attendance, visits, and machine reviews/corrections. GPS events update the map without individual notices. Notifications retain up to 100 entries per administrator/browser. There is no closed-app push provider in this implementation.
- SQLite publication failures use a private, fsynced filesystem event outbox. Replay uses durable numeric IDs. Failure of both SQLite and disk is logged and sends a live reconciliation hint; it cannot guarantee historical notification delivery. Mutation and event publication are not one atomic transaction: a process crash between them remains a notification gap; API reconciliation remains authoritative.
- Photo replacement uses Android AtomicFile. Each newly captured photo gets an immutable private archive snapshot before optional mirroring. Uploaded queue photos are preserved in that archive before queue cleanup; failure keeps the visit retryable under its original UUID.
- Android asks for a readable/writable local folder using Storage Access Framework, once per representative selection. It saves verified copies under `Areas/<region>/<year>/<month>/<machine>/<Before|After>`. Retakes retain older copies with a hash suffix. Permission revocation retains snapshots and shows pending/error status. Recovery JSON is also written and read back through this folder. Broad all-files access is not requested.
- Recovery exports explicitly report omitted pending archive photos. A package with omissions must not be treated as a complete phone backup.
- Supported old V2 backup databases are copied to isolated staging, migrated and checked before the existing restore/rollback procedure. Newer/unknown schemas are rejected safely. This does not promise arbitrary V1/custom database compatibility.
- Maintenance reports show historical countable quantities as one, preserve historical labels, and format replacement quantities explicitly. Analysis matches secondary reasons; replacement summaries include completed executed work only. Invoice/voucher separation is unchanged.
- Private deployment files are mode 0600. Android version is 2.0.1 (code 3). The official build supports `--artifact-only` and records source revision, dirty status, version, server URL and APK SHA256.

## Signing and transition gate

The approved release key is read from ignored `android/key.properties`; never commit that file, keystores or passwords.

Verified certificate SHA256 values:

- Existing distributed Android Debug: `6b7662b9baf48dc6a00c44911b5bc4e0d2eb7693083b71458c5cf9bd8e5d87d1`.
- Approved MADAR release: `f4c8bffc9f852ea6056e350b65156eb880d05629991682492159b9e3937c02a1`.

Android rejects an in-place update between those unrelated signing identities. Do not overwrite the distribution APK with a differently signed release and claim pending work is preserved. Never automatically uninstall the existing app.

Safe transition requires a same-signer transition build, successful external recovery export with zero omissions and verified photos, then a deliberate reinstall of the approved release and same-account import/reconciliation. Prove that sequence on a disposable device before field use. The release candidate can be prepared independently. A same-signer debug transition build remains a development artifact and is not the final security release.

Final artifacts (12 November 2026):

- Official release: `android/app/build/outputs/apk/release/app-release.apk`, SHA256 `78dc512a01b8f20bee2a7c60c8961b4685a2cc4fbcc69c84cf321ce43c6dd030`, package `com.madar.rep.app`, version `2.0.1` (code 3), non-debuggable, approved release signer above. Provenance records revision `2292c99156c8d3c14ee4f8df75696dd2393846d3`, clean source tree, HTTPS server URL, and matching artifact hash.
- Debug-signed transition: `android/app/build/outputs/apk/debug/app-debug.apk`, SHA256 `bd7180e3e6340d39cdf06ec15a3ffa309f1a6787a2b4cff21ed7ec1d1d9a4a2c`, same package/version, debuggable, and verified against the existing distributed Debug certificate. This is not the production security release, and physical-device transition/recovery acceptance was waived, not passed.
- The authenticated download's default selected path is `madar-rep.apk`. After signer compatibility was verified, it was atomically replaced with the transition build. The former APK (SHA256 `de5db6f610da4858ff498bd874518d72ea84eeefb1364ec69250e815c06fea55`) is preserved at `/mnt/madar-storage/Backups/MADAR-V2-apk-transition/madar-rep-before-transition-20261112T125524Z-de5db6f610da4858ff498bd874518d72ea84eeefb1364ec69250e815c06fea55.apk`. No phone was updated.

## Validation and deployment evidence

Tests use isolated temporary databases and storage. No test writes to production customer storage.

- Full MADAR V2 test suite: 143 passed, 0 failed, 0 skipped (`full-suite.tap`, exit 0).
- Focused Android packaging tests: 5 passed, 0 failed (`final-packaging.tap`).
- JVM Android unit tests: 1 passed, 0 failed (`android-tests-build.log`).
- Android instrumentation on isolated, unlocked API-36 emulator: 10 passed, 0 failed (`android-instrumentation.log`, exit 0). An earlier attempt on the pre-existing credential-locked emulator failed for that environment reason; it is retained separately in `android-instrumentation-before-unlock.log` and is not counted as a pass.
- Final official release and debug transition builds both completed from a clean source tree (`final-official-release-build.log`, `final-transition-debug-build.log`). APK signatures, package/version/debuggable state, hashes, release HTTPS host, bundled standalone assets, and provenance were verified. The debug transition signer matches the pre-existing distributed APK; the approved release signer intentionally does not.
- Isolated online copy of the live database: integrity `ok`, zero FK violations, 55 existing tables checked, no existing-table row-count changes. It already contained the feature migrations; this verifies repeat/idempotent migration behavior, not a first upgrade from a pre-migration production schema (`live-schema-migration-dry-run.json`).
- The integrity- and FK-checked snapshot at `Backups/pre-integration-fixes-1794485354549.sqlite` is database-only and already contains the new migration records. It is not an off-device DB+storage backup or restore drill (`pre-deployment-backup.json`).
- Deployment: `main` and `origin/main` aligned at `90ba7dfd5ffbe7645cd06219bb71cf75154aca96`; PM2 `madar-v2` is online in single-fork mode after a controlled restart. Local and public `/api/health` returned HTTP 200; the served UI entrypoint and a referenced JS asset returned HTTP 200. Live SQLite integrity check was `ok` with zero FK violations. A fresh online database-only snapshot at `/mnt/madar-storage/Backups/MADAR-V2-predeploy-20261112.sqlite` also passed integrity and FK checks (56 tables); customer storage was not included in that snapshot.
- The selected default download path was resolved at runtime to `madar-rep.apk`; its final SHA256 is the verified transition hash above. This confirms the selected local artifact, not a field-device download or installation.

The owner explicitly waived additional physical-device acceptance testing. This is a waiver, not a test result. Camera, biometric prompts, SAF provider/revocation behavior, battery/reboot restrictions, mobile-network behavior, the complete rendered SSE/folder-picker flows, and same-account export/reinstall/import have not been established on a physical device. No field-app uninstall, data clear, or device update was performed.

Remaining limitations: the old distributed APK is signed with Android Debug while the approved release key is different; Android does not permit an in-place update across those identities. Keep any same-signer debug transition APK distinct from the official release and do not represent the transition as a production-security release. No closed-app push provider is included or required. Device-reported biometric booleans are not cryptographic hardware proof. Business transaction and event publication are not atomic, so a crash in between can lose a historical notification; authoritative API reconciliation remains required. The isolated backup migration does not establish an off-device backup or complete real-data DB+storage recovery drill.
