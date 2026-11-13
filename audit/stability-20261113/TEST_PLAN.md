# Stability work — risk-based verification

Only isolated test DBs, storage, repositories and loopback services may be mutated by tests. The real existing backup ZIP is read only; the restore drill extracts into a disposable directory on the large drive and removes it afterward. Production customer files and DB are not restore targets.

1. Focused tests: verified new backup replaces older owned archives; failed creation or corrupt ZIP leaves the previous good archive intact; unknown/manual archives and symlinks are preserved. Validate configured restore limits.
2. Transactional publication: rollback emits nothing; committed intent without an HTTP response remains deliverable; failed event delivery retains intent; retry does not duplicate events. Maintenance mutations enqueue invalidation transactionally.
3. Deploy fixture: disposable Git main/origin, stub npm/PM2/node. Equal local/remote without receipt must deploy; failed tests prevent restart; health failure retains the old receipt and restores previous web assets; dirty edits are preserved.
4. Browser chunk recovery: online reload bounded to once per build; offline and denied storage never cause loops. Exercise real missing-asset HTTP behavior against isolated app.
5. Full unmodified V2 suite, with actual counts/failures; isolated web build. Android release/transition build only after verified source is committed, keeping published artifacts intact until checks pass.
6. Real backup drill: stream every entry with CRC/size validation; extract only into disposable storage; migrate an isolated DB copy twice; validate integrity, foreign keys and preserved business row counts. No production restore and no off-device claim.
7. n8n: update the existing delivery definition; retain workflow identities/inactive state, use only read-only GET checks, compare running revision and current asset content type, static validation plus isolated success/failure fixtures. No destination for external alerts has been supplied.
8. Controlled deployment only after tests/builds pass; verify the actual process revision and web asset. Never infer installed handset behavior from a build. Device acceptance remains blocked without a phone.
