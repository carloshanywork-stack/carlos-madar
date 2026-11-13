# Photo review and explicit archive months

Owner decisions: uploaded photos from either the web system or a representative leave active work and wait for supervisor approval; only approved photos become completed. Existing archived orders remain unassigned to a business month until the owner selects one.

## Implemented behavior

- Representative default view is Remaining. Separate Pending Approval, Approved and All tabs prevent a submitted card from appearing as active work.
- System uploads and photo imports create a durable, revisioned card-photo review. The supervisor radar shows these alongside representative visits, with authenticated thumbnails, full-size originals, individual approve/reshoot and atomic mixed bulk approval.
- Approval verifies the displayed revision and current photo-list fingerprint. Additional photos invalidate stale approval screens. Storage renames preserve image bytes and approval decisions while advancing the review revision.
- Uploads cannot overwrite a pending/receiving representative visit. Offline submissions encountering system-uploaded pending/approved photos return a real 409; durable client evidence remains available for reconciliation. Explicit reshoot permits a new submission and supersedes the old manual review.
- Completion and review state come from durable records, not the day of the upload audit. Archived/review orders do not reopen as active representative work. New archive actions reject pending/receiving photo reviews, without posting a cash settlement.
- Maintenance and workshop orders have an optional `archive_month` (`YYYY-MM`). Existing rows are deliberately NULL. New UI archive/delivery actions require a month selection; older API clients can still leave it unassigned. Re-archiving without a supplied month preserves an existing selection.
- Administrators can set/change/clear an archived order's month. Audit records include actor and old/new values; the actual archive/delivery timestamp, invoices, receipts and treasury entries are preserved.
- Archive lists, maintenance area analysis, Excel records and archive PowerPoint selection use the chosen month, including an Unassigned filter. PowerPoint/Word/PDF preview headings show the assigned period, not an inferred creation/closing month. Whole-archive PowerPoint export now sends actual selected archive IDs.

## Migrations and compatibility

`20261113-explicit-order-archive-months` adds checked nullable columns and indexes to maintenance/workshop orders, without backfilling a month. `20261113-manual-card-photo-review` adds per-card review metadata; historical completed cards retain their completed classification, and unreviewed system evidence becomes pending. IDs, historical records and original image bytes are preserved.

The transition APK download filename is stable (`madar-rep-debug-transition.apk`); Android's actual package/version and signing certificate determine update compatibility. Release and Debug transition signing identities remain separate. Never uninstall a Debug-signed field app to force installation of a differently signed release.

## Risk-based verification

All mutation tests use temporary SQLite/storage and loopback test servers. Critical checks cover manual upload → queue → stale revision rejection → approval/reshoot → representative route; denied rep overwrite and orphan-file cleanup; atomic bulk rollback/replay; selected month independent of actual closing time; authorization/audit/no treasury effects; monthly Excel/PPTX and additive/repeatable migrations. Existing file-move, import, finance, backup/restore and representative suites remain regression gates.

Test setup changes are deliberate: completed report fixtures now obtain supervisor approval, period-specific fixtures explicitly choose their archive month, and image mutations expect Pending rather than automatic completion. The unrelated spreadsheet style assertions remain intact.

Physical-device camera, GPS, biometric, SAF, background upload and upgrade preservation are not established by server tests or APK compilation. No phone installation is performed by this change. The previously delivered n8n workflow remains a dated evidence snapshot of its own source revision; this task does not overwrite or reactivate it.

Final V2 regression gate: **171 tests passed, 0 failed, 0 skipped**. The isolated production-database-copy migration ran twice with unchanged existing domain-row counts, all historical archive months still NULL, `integrity_check=ok`, no foreign-key violations, and a readable pending system-photo queue. An isolated production-mode web build also passed. The predeployment snapshot is database-only plus prior web/APK artifacts; it is not a fresh backup of all customer storage files.

Release evidence and final test/build identities are recorded with the protected deployment receipt when publishing version 2.0.8 (10).
