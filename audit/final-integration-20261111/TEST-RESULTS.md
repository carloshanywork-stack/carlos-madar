# Executed checks and failure injection

Audited source: `26a9f6549ece44e0f17c50e453c23a0fc076071a`. All mutations used isolated fixtures. Production checks were unauthenticated HTTP reads, sanitized process metadata and read-only database/configuration inspection. Original code/assertions were not changed.

## Results

| Check / evidence | Actual result | Evidence level and limits |
|---|---|---|
| Full V2 suite, `business-full-suite.tap `, ` v2-suite-summary.json` | **118 pass, 0 fail, 0 skipped, 0 cancelled**, 25 files, 173344.805076ms | Original suite, serial Node TAP; real temporary SQLite/storage/HTTP plus source assertions/mocks. Does not test every requested acceptance condition. |
| Focused offline attendance, `business-attendance-direct.log` | 8/8 pass | Actual isolated service/database tests; these tests overlap full 118, not additional unique coverage. |
| Focused migrations/maintenance, `business-migration-direct.log` | 11/11 pass | Actual temporary historical fixtures, repeatability and FK/history checks; overlaps full 118. |
| Configuration, `business-policy-direct.log` | Initial1 pass +1sandbox-blocked | Subprocess EPERM stopped startup loop at first iteration. Successful full-suite configuration tests supersede the environment blocker; no application failure inferred. |
| Finance retry, `business-replay-independent.log` | **2 acceptance scenarios fail**: sales and purchase double-apply partial settlement | Primary independently reran actual service transactions, discarding first committed result. Each yields paid2000 vs expected1000, 2 treasury/2 audits. Two additional operationId400 observations. No real TCP packet drop. |
| GPS, `gps-independent-result.json` | **2 acceptance scenarios fail**: closed duty reopens; reused ID changed payload accepted | Primary independently reran fresh SQLite/service probe. Not physical GPS/HTTP acceptance. |
| Quantity contract, `quantity-contract-result.json` | Requested capability absent; real service rejects quantity field400 | Source whitelist and initialized-schema probe. No fabricated quantity API or full valid visit claim. |
| HTTP contract, `http-contract-result.json` | 9/9 assertions pass | Real ephemeral server/fixture sessions. Includes default APK bytes/hash, role boundaries, logout invalidation and stored-session expiry. Not live authenticated download or device switching. |
| Events, `events-result.json` | 2 probes confirm limitations | Real isolated SQLite stale-cursor retention and injected event-insert failure. These are observations of deficient guarantees, not two release passes. First fixture setup failed before injection; seed corrected to actual modulo250 retention boundary without weakening assertions. |
| Android packaging + offline GPS mocks, `android-packaging-direct.tap `, ` offline-gps-direct.tap` | 5/5 +3/3 pass | Source assertions/pure ordering/mocked IndexedDB, already included in 118suite; no native/device execution. |
| Actual APK, `apk-identity.json `, ` apk-correspondence.json` | Artifact inspected; **release gate fails** debug signing/debuggable and provenance mismatch | SDK aapt/apksigner/hash/ZIP inspection. Primary independently confirmed hash, signer and debug flag. No installation. |
| Isolated web build, `web-build.log `, ` build-location.json ` | Pass, Vite6.4.5 / existing dependencies | Copied source and temporary output, preserved in` isolated-web-build.zip`. Initial isolation lacked parent Capacitor dependency link, corrected; no source changes/install. Not a clean install or deterministic release build. |
| Legacy, `legacy-inventory-direct.tap `, ` legacy-migration-direct.tap` | 5/5 inventory +3/3 migration pass | Eight distinct legacy tests; pure arithmetic and temporary SQLite. No full legacy server/browser suite. Initial2 file wrapper passes are not extra tests. |
| Madar Flow, `flow-engine-tests.tap` | 14/14 pass, 0 skips | Engine/template loopback HTTP and mocked context; no actual PostgreSQL/Valkey/worker deployment acceptance. |
| n8n JSON/type/syntax/config validation, `n8n-static-validation.json` | 3/3 workflow files pass | Installed n8n2.46.7 classes and supported node versions, references/expressions, inactive exports, credential references and secret checks. |
| n8n Code contract tests, `n8n-code-fixture-results.json` | 15/15 pass | Exported Code logic under mocked n8n helper inputs; distinct from real runtime. |
| Actual isolated n8n runtime, `n8n-runtime-results.json` | 3 inactive imports; operational execution 1 success; release execution 2 success; deliberately failed execution 3 error/CLI1 | Real installed n8n2.46.7, disposable user-folder/SQLite, synthetic credential, actual local HTTP requests. Synthetic mechanics only. Executable hashes unchanged. Final documentary text refreshed and statically revalidated after import; final map text not reimported. |
| Live health/storage/process, `live-http.json `, ` storage-metadata.json `, ` live-processes.json` | API200; anonymous boundaries401; index=disk; SQLite WAL/integrityok/FK0 | Point-in-time read-only operational evidence. Does not establish loaded source SHA, backup consistency, artifact device compatibility or release readiness. |
| Existing scheduled n8n run, `n8n-scheduled-execution-summary.json` | Execution 25 trigger success at2026-11-12 06:00 Cairo; reportWARN, 7 checks/0 fail/1warning, rep test subset3/3 | Historical/persisted real execution evidence, not auditor-triggered. Alert delivery not configured or proven. |

Do not add focused/source/mock reruns to118as unique tests. Custom probes and workflow executions use different denominators from node:test. No universal aggregate pass percentage is meaningful.

## Failure injection coverage

| Requested scenario | Evidence and result |
|---|---|
| Commit then response loss | Finance actual committed service response deliberately discarded; identical repeat duplicates money. HTTP/TCP dropped-response fixture not performed. Native multipart response-loss/device behavior unverified. |
| Duplicate/conflicting requests | Attendance UUID/content/owner and location HTTP/idempotency/conflict tests pass; GPS reused identity and finance retry fail their independent probes. |
| Token expiry/representative switch | Stored-session expiry and logout invalidation produce401in actual HTTP fixture; full auth tests pass. Native account switching/concurrent token/owner races not physically tested. |
| Independent queue failure | Source demonstrates early retryable tracking/attendance can block later visits; no suitable device/native failure harness. Mark IMPLEMENTED_NOT_VERIFIED, not pass. |
| Network interruption/reconnect | HTTP/server restart/location reconciliation tests pass; browser EventSource/cursor path inspected. No physical Android interruption/reconnect acceptance; stale-cursor suffix separately observed. |
| Interrupted local evidence write | Source delete-before-rename gap identified (AND-007); no physical crash injection. Blocked by no device. |
| Failed migration/restore | Existing temporary migration/current-schema restore/rollback/interrupted recovery assertions pass in 118suite. Not arbitrary historical backups or production restore. |
| Stale event cursor | Actual disposable10250-event fixture returns retained suffix without explicit reset; source polling mitigation traced. Full UI repair not tested. |
| Deliberately failing n8n fixture | Actual release execution 3errored, CLI exited1; explicit failed required-check summary preserved. |
| Real alert delivery | Not performed: no authorized configured destination. Workflow success is not notification proof. |

## Execution constraints and baseline

Initial sandbox tests could not listen/spawn or expose full child TAP; their file-level totals were not treated as inner scenario passes. Delegated approval calls remained pending and were interrupted without executing. Primary later obtained permission and ran the isolated suite/fixtures successfully. No automated approval rejection was reported. The first events fixture setup and finance probe table-name typo were audit-script issues; corrected audit scripts retained application assertions. No application tests were weakened or edited.

Initial tracked tree was clean at the baseline SHA. Final tracked diff remains empty; only audit output is untracked. Thus confirmed probes reproduce defects in the audited baseline, not audit-introduced application changes. No older-release comparison was performed to assign regression origin. Physical device count is0; no emulator/native install/upgrade acceptance is claimed.
