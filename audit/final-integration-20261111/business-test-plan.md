# Risk-based server verification plan
Source: 26a9f6549ece44e0f17c50e453c23a0fc076071a. No production mutations.
1. Inspect environment/path resolution and all test setup: tests importing database use temporary database paths; application tests use loopback ephemeral ports. Override all shared data/storage/backup/mount paths in test process environment, test-only JWT, cookies, and initial password to prevent dotenv defaults reaching production.
2. Focused checks: attendance age/exact boundary/replay/account conflict; location authorization/dependency/rollback; finance replay/response-loss; migration referenced attendance. Inspect and run existing tests without weakening assertions.
3. Run complete V2 node:test suite serially, save TAP log. Source-text checks are not device acceptance. Large lifecycle tests stop at first failure: no later assertions claimed.
4. Report failures with exact assertion/source and investigate source baseline. No application changes. No build or production services.
5. Mutation failure injection only where existing isolated suites explicitly inject DB/audit/filesystem failure. Record unavailable cases rather than fabricate execution.
