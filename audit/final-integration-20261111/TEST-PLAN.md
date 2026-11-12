# Risk-based audit plan

Audit began 2026-11-11 Africa/Cairo; continued past midnight 2026-11-12. Source baseline: main 26a9f6549ece44e0f17c50e453c23a0fc076071a. Initial Git status empty; cached origin/main 0 ahead/0 behind (no fetch implied).

## Execution gates
Read test imports, environment setup and subprocess targets before executing. Use independent mkdtemp directories and explicit database/storage/backup/map paths, NODE_ENV=test and fixture JWT keys. Never import production startup against default paths; no dependency installation, production restart, signing, APK replacement or workflow activation. Existing generated assets are read-only. Builds use an isolated output directory. No customer rows, tokens or secret config in logs.

## Order and responsibility
1. Android agent independently inspects actual APK and native source; isolated GPS probes for duty reopening and reused point identifiers; packaging/mock IndexedDB checks. Physical-device checks require existing suitable connected devices and otherwise remain blocked.
2. Business agent reviews auth/ownership, attendance cutoff and replay, location approval, visit replay, finance replay, quantity aggregation and restore tests. Focus suspected high-severity behavior first; then complete relevant V2 suite with isolated paths. Record early assertion termination rather than claim unexecuted scenarios passed.
3. Primary independently re-runs high GPS probes, inspects artifacts and live deployment identity, events dual writes/stale cursors, legacy/flow boundaries; build web into dedicated audit output only. Live requests are unauthenticated read-only health/boundary requests, no login session mutation.
4. n8n agent reviews previous exports FIRST, installed node schema/version and read-only live DB metadata, then generates inactive documentary and executable verifiers. Isolated user folder/fixtures only for imports/runtime; inject a failed fixture and preserve real failure output. No live import, schedule changes or alerts without configured authorized destination.

## Failure-injection matrix
- Response loss/duplicate/conflicting finance: isolated transaction/HTTP tests; retain commit identifier and compare row effects.
- Attendance exact age/future bounds, accepted replay outside age, changed UUID/account isolation: focused temporary DB tests.
- Queue independent failure, auth expiry/switch, interrupted evidence: existing tests plus source tracing; mark physical/process-death behavior unverified where no device.
- GPS closed session and identifier conflict: explicit temporary DB probe, independent primary rerun.
- Stale event cursor and persistence failure: explicit disposable DB probe plus receiving-client reconciliation inspection.
- Migration/restore failure: temporary backup/storage integration tests; no real restore.
- n8n deliberate failure: local compatible instance/CLI only where safe, otherwise static validation with exact limitation.

Coverage statements distinguish source inspection, source-assertion test, mocked client test, real SQLite service test, HTTP integration, actual APK inspection, n8n runtime and physical-device acceptance. No universal or zero-bug claim. Proposed leases/heartbeat locks/test machines/structured serials/push classified separately from approved requirements.
