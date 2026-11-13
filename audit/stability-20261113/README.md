# MADAR stability implementation — 2026-11-13 (Africa/Cairo)

Baseline: clean `main`/`origin/main`, `34412aefabd5c139de35b643398359f1155ee4c4`. Work performed directly on main. Production customer DB/files are never test mutation targets.

## Changes

- Automatic full ZIP backup retention is one verified archive: write `.partial`, read every entry with size/CRC validation, sync, atomically publish, then delete only older regular application-owned ZIP files. Failure preserves the previous good archive. Manual recovery/release archives, unrelated files and symlinks are preserved. Cleanup errors appear in the result and scheduler diagnostics.
- Restorable ZIP/upload limit is configurable with `MADAR_V2_BACKUP_MAX_GB` (default 64; integer 1–1024), replacing the 10 GiB limit that excluded the actual ~20.4 GB archive. Restoration verifies CRC before extraction. `scripts/restore-drill.mjs <existing.zip> <temporary-parent>` extracts/migrates only disposable copies; it never calls the production restore endpoint.
- Missing build assets return 404 instead of a successful HTML page. HTML navigation revalidates; a Vite preload failure has one online reload per build and never clears durable queues or loops while offline/storage is denied.
- Running `/api/health` captures the actual source revision, initial clean/dirty state, selected source-tree identities and process start time. Auto-deploy tracks the last **verified deployed revision**, including when checkout/origin already match, blocks unpushed/dirty/divergent source, runs the V2 suite before restart and validates runtime revision + web assets afterward. Failure does not advance its receipt; previous web assets are restored after failed health. Automatic backend/database rollback is deliberately not claimed: additive schema/source compatibility must be reviewed by an operator.
- Representative visit submission and work claim/release persist publication intents inside their business transactions. Maintenance order/card/assignment/machine/photo-review mutations coalesce durable route invalidation in the same transaction through additive triggers. A five-second dispatcher atomically writes events/notification inbox rows and removes intents, with replay retention. Other semantic event producers that still call the legacy post-commit publisher have **not** all been converted; this is not a claim that every historical dual-write gap is eliminated.
- Fast scheduled operational checks no longer run the slow representative integration suite by default. `MADAR_CHECK_MODE=release` explicitly enables that suite. Failures exit nonzero; reports separate source identity/operational health from release/device acceptance. Admin system health includes pending event intents and backup policy diagnostics.

## Verification and operations

See TEST_PLAN.md and the collected result files. Full V2 suite passed 182/182; the subsequent historical HTTP restore fixture also passed in the focused 5/5 compatibility run. Crash/HTTP/backup tests passed 5/5 and deployment fixtures passed 4/4. Final deployment gate results are recorded separately. Builds use an isolated output first. A child process exits immediately after commit in the response-loss fixture; its durable intent is then recovered without duplication.

Actual recent full ZIP restore-drill outcome, cleanup and deployment identities will be recorded in sibling JSON evidence. No production restore, physical phone installation or off-device recovery is implied. The distributed 2.0.8 (10) APK and signing identities are preserved; these stability changes primarily affect server/web and do not replace an APK.

## n8n and alerts

Existing evidence-map/verifier workflow IDs are reused. New definitions are inactive; they use real GET probes, installed node versions, bounded retries/timeouts, source-tree matching and a missing-asset check. The documentary map does not execute business integration. Earlier stale filename-test evidence is removed; no adapted passing assertion is used. Slow release evidence remains dated and must be refreshed after source changes.

Authorized alert recipient: `carloshany.work@gmail.com`. No SMTP configuration, n8n SMTP credential, local sendmail or connected email sender was found. The optional email workflow must remain unconfigured/inactive until a sender and SMTP credential are selected securely in n8n; never paste passwords into Git or chat. Recipient authorization alone does not establish a working mail transport. External alert delivery remains BLOCKED_PREREQUISITE.

## Remaining acceptance

Physical-device camera/GPS/SAF/background/offline/upgrade tests remain unverified. A full extraction/migration drill on the same host is distinct from off-device disaster recovery. Existing placeholder biometric/noOp workflow is not functional automation; it is not activated or counted as a passing verifier. Review remaining legacy semantic publication sites before claiming universal transactional notification delivery.

## Historical restore defect found during the real drill

The first full-archive drill reached database migration and correctly failed closed: `migrate-from-v1-data-v1` was treated as an unknown future schema migration on a fresh installation. It is the existing data-provenance marker written by `scripts/migrate-from-v1.js`, now explicitly shared/recognized without rerunning that import.

A second database-only investigation found raw SQL-text comparison rejected supported historical ADD COLUMN layouts (column order and SQL formatting). The compatibility fingerprint now compares normalized, order-independent column definitions and preserves CHECK/UNIQUE/FK/default/type semantics plus indexes/triggers. It still rejects unknown migrations and changed constraints. One explicitly supported legacy exception is machines.updated_at: its recorded migration fills NULL technical update metadata from the existing created_at; it does not change financial or duty history. Both restore validation and the attached-snapshot copy use the same compatibility rules.

Focused acceptance actually restored a historical-layout ZIP through the authenticated HTTP endpoint into temporary DB/storage, preserved evidence and IDs, checked integrity/FKs, and invalidated the previous session. A deliberately different CHECK constraint remains incompatible. The real full ZIP drill is repeated after these fixes; see its final outcome rather than treating the first failure as a pass.


The restore HTTP fixture explicitly isolates database, storage, DATA_DIR (upload staging/journal), BACKUP_ROOT and mount settings. Its first setup used the default application DATA_DIR for transient upload/journal files while DB/customer storage remained isolated; it completed and cleaned those transient files. This setup was corrected and rerun successfully with every mutable path beneath its temporary directory.

n8n isolated acceptance: all three definitions imported into disposable n8n 2.46.7. Synthetic read-only checks succeeded; a deliberate HTTP 503 caused a visible failed check and failed execution. The optional email workflow failed explicitly at its missing sender/SMTP prerequisite, before any send. Actual production GET checks and live import are recorded in the protected deployment receipt after publication; external mail delivery is not claimed.
