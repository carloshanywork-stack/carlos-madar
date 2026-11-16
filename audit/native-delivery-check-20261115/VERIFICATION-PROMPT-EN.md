# MADAR Native — Verification, Gap-Fill, and Review Prompt

## ROLE

You are the **verification engineer and code reviewer** for the MADAR V2 representative-app release. Another engineer (or an earlier session) implemented a set of features. Your job is to prove whether they actually work as specified, fix what is missing, and then review the result with a critical eye.

You are not a planner producing theory. You produce evidence: commands, outputs, test results, and file-level findings.

## WHAT WAS SUPPOSED TO BE BUILT

Treat this as the specification. Every item below must end up marked PASS, PARTIAL, or FAIL with evidence.

| ID | Requirement |
|---|---|
| R1 | Representative approval = submit + conditional **server-side** auto-approval. Permission `can_self_approve_visits` defaults to off and is toggled by an admin. The client can never assert approval. |
| R2 | When auto-approval fails, the visit stays `pending` with explicit reason codes (`GPS_INACCURATE`, `OUTSIDE_GEOFENCE`, `MOCK_LOCATION`, `STALE_FIX`, `PERMISSION_DISABLED`, `DAILY_LIMIT`) and is audited. |
| R3 | Machine location change is a **request**. Coordinates change only after admin approval, transactionally, after re-checking that the old coordinates still match. |
| R4 | A pending or rejected location request never mutates machine coordinates. Duplicate pending requests per machine are refused. Re-submission with the same `actionUuid` is idempotent; the same UUID with different content is rejected. |
| R5 | Location evidence images are compressed, stored under the storage root, access-controlled, and never served by path traversal. |
| R6 | Bug reports are captured in-app with category, severity, description, screen, app version, device model, Android version, sanitized logs, and an optional screenshot. |
| R7 | Bug reports are stored on the server **before** any GitHub call. A GitHub failure never loses a report and is retryable. The token exists only server-side. |
| R8 | The admin dashboard exposes reports (list, detail, status, notes, attachment download), location requests (approve/reject with evidence), and releases (publish/withdraw). |
| R9 | Bug reports export as a per-report ZIP and a multi-row Excel workbook. |
| R10 | In-app update: authenticated status check, version comparison, download, SHA-256 verification, signer verification, package check, system installer handoff. No silent install, no uninstall, no data wipe on mismatch. |
| R11 | The signed-in app shows exactly two primary tabs (My Work, Map) with attendance, notifications, sync, support, permissions, update, and logout under Profile / Settings. |
| R12 | Permissions are requested in context, not all at first launch. |
| R13 | Release pipeline: version bumped, clean committed tree, build signed with `f4c8bffc…`, manifest sidecar matches APK bytes, signer allowlist enforced, previous artifact retained for rollback. |
| R14 | Every new endpoint enforces role checks server-side, is rate-limited consistently, and writes audit entries for privileged actions. |
| R15 | Migrations are additive and idempotent and apply cleanly to a restored copy of production. Existing data is preserved. |
| R16 | No regression: the pre-existing test suite still passes completely. |
| R17 | No claim of device testing, in-place upgrade, or deployment success without evidence. Anything hardware-dependent is listed as unverified. |

## BASELINE FACTS (verified 16 Nov 2026)

- `origin/main` = `c4c6cd4`; production `sourceDirty=false`.
- Version **2.2.2 / 15**; release APK `sha256 dc4a909f…598d924`, signed `f4c8bffc…`.
- Server suite: 198/198 passing.
- SSH: `ssh Ubuntu-Server` (user `carlos`). The release keystore is on that server at `android/madar-release.keystore`, alias `madar-rep`.
- No GitHub token configured.
- Android still has four tabs, no in-app update code, and the reports form is a single description field.

## RULES

1. **No phone is required.** Do not block on hardware and do not claim hardware results. Emulator use is optional.
2. **Never write to production data.** All mutating scenarios run against a **restored copy** of the production database and storage, in a separate directory with a separate port. Production gets read-only checks only.
3. **Never print secrets.** No keystore passwords, JWT secret, or GitHub token in output, logs, or commits.
4. **Fix what you find**, within scope, following existing patterns. Do not rewrite working subsystems. If a gap is large, implement it and say so explicitly.
5. **Evidence or it did not happen.** Every PASS needs a command and its output, a test name, or a file reference.
6. Work on `main`. Keep the suite green.

## PHASE A — Traceability and test plan (no code changes)

1. Read the implementation for each requirement. Locate the exact files, functions, routes, tables, and UI components that satisfy it.
2. Produce a matrix: `Requirement → Implementation (file:line) → Test that proves it → Status (Implemented / Partial / Missing) → Risk`.
3. For anything Partial or Missing, state precisely what is absent. Examples of the level of detail expected: "`SupportScreen` sends `appVersion = "MADAR V2"` as a literal instead of `BuildConfig.VERSION_NAME`"; "no endpoint exports XLSX"; "no `REQUEST_INSTALL_PACKAGES` in the manifest".
4. Design the test cases per requirement. Minimum coverage:
   - **R1–R2:** eligible visit auto-approves; each reason code triggers individually; permission off forces pending; client-sent approval fields are ignored; the decision is audited with actor and source.
   - **R3–R5:** submit → pending (coordinates unchanged in DB) → approve (coordinates applied once) → replay approve (idempotent, no double apply); reject (unchanged); concurrent conflicting request (409); stale old coordinates (409); duplicate pending (409); evidence retrieval authorized for owner/admin only and unauthorized for another rep.
   - **R6–R9:** create with and without attachment; oversized attachment rejected; page-2 sanitized logs contain no tokens; GitHub unconfigured → clear error, report intact, retry works when configured; ZIP contents and XLSX headers/rows asserted programmatically.
   - **R10:** verifier unit tests for hash, version, signer, and package; download failure paths; mismatch never deletes the file silently; unknown-sources permission path is triggered only on user action.
   - **R11–R12:** navigation graph shows two bottom destinations; every previous screen reachable; no permission dialog at cold start.
   - **R13:** manifest equals APK hash; signer equals allowlist; dirty tree refused; previous artifact still downloadable after publish.
   - **R14–R15:** every new route returns 401 unauthenticated and 403 for the wrong role; migration re-run is a no-op; row counts preserved on the restored copy.
   - **R16:** full suite.
5. Define the exact commands, fixtures, and seeded accounts (a test rep with the permission off, one with it on, one admin, one supervisor, one unrelated rep).
6. Define how each result is captured (test name, curl command, SQL assertion, screenshot of the admin page).

**Deliverable A:** the matrix plus a numbered test plan with expected results. Do not start Phase B until this exists.

## PHASE B — Execute the plan

1. Create an isolated environment: copy the production SQLite file and storage into a temp directory; run the server on a free port with `MADAR_V2_*` overrides pointing there.
2. Run the automated suites: `npm test`, `npm --prefix client run build`, Android unit tests, `assembleDebug`.
3. Execute every scenario from Phase A, recording actual output next to expected.
4. Verify the admin pages against the isolated server: capture the URL, the action performed, and the visible result.
5. Verify the release artifacts **read-only** on production: `/download/apk/status` and `/download/apk` with an authenticated session; recompute SHA-256; run `apksigner verify --print-certs` on the downloaded bytes.
6. For the Android update logic without a device: run the verifier against the **published APK file** and prove it accepts the correct signer and rejects a modified copy and a differently signed APK.

**Deliverable B:** a results table with PASS / PARTIAL / FAIL, the evidence line for each, and every deviation from expected behaviour.

## PHASE C — Gap fill

1. Implement everything marked Missing or Partial, in priority order: R10 first, then R11, R6/R9, R7/R8, then the rest.
2. For each fix: add or extend tests, re-run the affected evidence from Phase B, and note the commit.
3. Do not silently change behaviour that already passes. If a requirement is ambiguous, choose the reading that preserves existing tests and document the choice.
4. If a gap cannot be closed without the owner (for example, a GitHub token), implement everything up to the configuration boundary and make the failure message explicit.

**Deliverable C:** a change list per gap with before/after test counts.

## PHASE D — Review the work

Review your own diff and the earlier implementation with the mindset of an external reviewer. Check at least:

- **Correctness:** off-by-one in photo counts, timezone handling in the daily limit, distance math, transaction boundaries, and rollback on partial failure.
- **Concurrency:** two admins approving the same location request; the same report uploaded twice; a visit submitted twice.
- **Security:** role checks on each route, storage path containment, symlink rejection, attachment content-type validation, rate limits, audit coverage, and no secret leakage in error text or logs.
- **Data safety:** no destructive migration, no orphaned files when a DB write fails, no deleted evidence on retry.
- **Failure UX:** every user-visible error is specific and actionable; nothing says "success" before the server committed.
- **Consistency:** naming, response shapes, and error envelopes match the rest of the codebase.
- **Honesty:** the release notes and reports state what was not verified.

**Deliverable D:** a review report with findings ordered by severity, each with file:line, impact, and fix status. Include a short list of things a human must still check on a real device.

## FINAL REPORT FORMAT

1. Summary verdict per requirement (table, R1–R17).
2. Test inventory: automated tests added, scenarios executed, total counts.
3. Gaps found and closed; gaps deliberately left open with reasons.
4. Evidence appendix: commands and trimmed outputs, hashes, and file paths.
5. Review findings by severity.
6. Explicit "not verified without a device" list.
7. Recommended next action.

## DEFINITION OF DONE

- Every requirement is PASS or explicitly PARTIAL with a documented reason.
- The full suite passes with the new tests included.
- No production data was mutated during verification.
- No secret appears in any output.
- The report separates proven facts from assumptions.
