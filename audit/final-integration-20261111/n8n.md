# n8n audit and delivery

Audited source: `26a9f6549ece44e0f17c50e453c23a0fc076071a`. Investigation began 2026-11-11 and resumed 2026-11-12, Africa/Cairo. Runtime targeted and locally installed: n8n **2.46.7**, Node **24.22.2**. This is independent of the root repository package's coincidentally matching version; `/usr/local/lib/node_modules/n8n/package.json` was checked directly.

## Deliverables and current verification boundary

| File | Purpose | Runtime behavior |
|---|---|---|
| `n8n-evidence-map.json` | Documentary architecture and evidence map | Sticky Notes only. Conceptual arrows in text are not executable business integration; no trigger, noOp, shell, credentials, schedules, or live calls. |
| `n8n-operational-verifier.json` | Fast operational check | Manual entry → explicit configuration → actual GET `/api/health` → validate HTTP200, status=ok, service=madar-v2. |
| `n8n-executable-verifier.json` | Release evidence verifier | Same direct health prerequisite, then credential-authenticated GET `/audit/release-result` from a trusted external runner → revision/freshness/provenance/check validation → structured summary or execution error. It consumes CI evidence; n8n does not run CI, compile APKs, operate ADB, or perform restore itself. |
| `validate-n8n.cjs` / `n8n-static-validation.json` | Reproducible static compatibility checks and actual results | Parses all 3 workflows, instantiates installed supported node classes, checks versions, syntax, references, connection targets, config presence, inactivity, GET/timeouts/retry bounds, and embedded-secret patterns. |
| `n8n-fixture-driver.py` | Disposable runtime acceptance harness | Starts loopback synthetic fixtures; imports into its own temporary user folder/SQLite only; synthetic credentials; no live n8n imports or production business mutations. |
| `n8n-live-inventory.json` | Sanitized available live configuration and execution metadata | Read-only local n8n SQLite; workflow names/IDs/types/schedules/references and execution status/timestamps only. No credential values or execution payloads. |

All three workflows are inactive by default. Structure and compatibility with installed n8n2.46.7 have been checked. **Import and actual runtime fixture verification completed successfully on2026-11-12 at07:19UTC (09:19Cairo)** in a disposable n8n user folder and SQLite. All3imports exited0 and persisted inactive workflow records. Operational execution1 and release execution2 succeeded; deliberately failed fixture execution3 produced error status and CLI exit1, explicitly naming required `failure-injection`. Authenticated runner fixture requests were captured. This validates workflow mechanics with synthetic evidence, not MADAR release readiness or the actual failing finance/GPS paths. The first socket-blocked/interrupted attempt performed no imports; the primary later ran the reviewed harness with local-socket permission. Evidence: `n8n-runtime-results.json`, per-step logs, and `n8n-fixture-driver.log`. Successful CLI logs are intentionally quiet under`N8N_LOG_LEVEL=error`; saved temporary-database execution statuses and captured HTTP requests provide the positive execution evidence.

## Existing deliverables: reused, corrected, and not changed live

The audit first inspected `madar-v2/n8n/MADAR_V2_FULL_LIFECYCLE_ARCHITECTURE.json`, its Markdown companion, `MADAR_V2_ACTIVE_CI_HEALTH.json`, and `madar-v2/scripts/n8n-system-check.mjs`.

- Reused the old architecture map's domain grouping, source pointers, human review boundaries, and explicit warning that a diagram is not business integration. The new map replaces its conceptual noOp/other execution nodes with Sticky Notes only, removes unsupported green readiness implications, and binds references to this audit revision and inventories. Original files remain unchanged.
- The live n8n DB's evidence-map copy differs from the repository JSON. Its node labels still claim immediate paid sales/purchase cash effects, volatile events/no replay, and a missing whole-unit offcut loop. Those labels are stale relative to audited source. Import history or a past successful static-map execution is not current implementation proof. The new file is an audit output, not an overwrite of the live workflow.
- The prior CI health file relies on Execute Command and a hard-coded repository path. Its script combines operational checks and a slow rep integration test; it calls unauthenticated HTTP health/map auth checks, reads configured production SQLite read-only, measures APK ZIP header/size/mtime and SHA, and checks Netdata. APK age and ZIP magic do not prove signature, version, embedded source, installed device, or URL compatibility. The script emits a JSON report even when checks fail; the downstream Code node throws when `overall==='FAIL'`. No external notification node or credential exists. It is not reused as an executable remote-shell assumption.
- The new manual HTTP verifiers replace that implementation only in this audit delivery. They need no Execute Command support, remote shell, package installation, production write endpoint, or workflow activation.

## Live n8n evidence and findings

Local DB metadata records **9 workflows**. Two have `active=1`: `7ab6c6736abad58c1624513571c7a838` (CI/API/storage health) and `6dae5a55-b25b-4d9a-9c8f-de5c275036ea` (biometric pipeline). The architecture map `e65f7b319ba84cb6a2e24071ad0a6b92` is inactive. Primary read-only PM2 evidence identifies `madar-n8n` PID2348, executable `/usr/local/bin/n8n`, cwd `/home/carlos`, Node24.22.2, port5678 as online. The sandbox's initial empty process list was incomplete; it is not evidence that live n8n was stopped.

The health workflow has manual and daily06:00 schedule entries and explicit `Africa/Cairo` settings. Its HTTP/shell script defaults include 5s fetch timeouts, a 120s child-test timeout, no credential references and no alert destination. Historical metadata has CI successes18–20, a crashed17, and evidence-map successes21–24 dated2026-11-10UTC. During the interrupted audit a new **scheduled execution25** ran2026-11-12 04:00:12–04:00:21UTC (**06:00 Cairo**), mode`trigger`, status`success`. Its saved runData was parsed with a strict output allowlist: actual node sequence was schedule → shell script → report; report **WARN**,7checks,0failed,1warning; the rep API subset reported3/3, SQLite WAL/integrity/FK checks passed, and APK check explicitly recorded signature/device installation unverified. Sanitized evidence is `n8n-scheduled-execution-summary.json`; raw execution payloads were not exported. Telemetry warning details were omitted to avoid unnecessary operational data exposure. This verifies one scheduled operational run, not the full V2 suite, release provenance, physical device, or alert delivery. Database activation is recorded separately from execution and delivery.

| Finding | Classification / severity | Expected vs actual | Evidence and reproduction | Safe remediation / acceptance |
|---|---|---|---|---|
| N8N-001 | Confirmed defect in workflow claims / High if used as release gate | Nodes named patch, Gradle build, ADB tests and release should perform those operations before asserting readiness. The active-labelled biometric pipeline is a Manual Trigger followed by **four noOp nodes**, all empty parameters. It performs no patch/build/device/release verification. | `n8n-live-inventory.json`, workflow`6dae5a55-b25b-4d9a-9c8f-de5c275036ea`; source of truth SQLite workflow_entity nodes field read-only; sanitized inventory lines1368–1424. Follow entry connections: all four nodes are noOp. No execution evidence for this workflow in accessible metadata. | Relabel it documentary or replace it only after explicit live-edit authorization with genuine credential-authenticated revision-bound runner evidence. Acceptance: successful trusted runner result plus deliberately failed build/device result visibly fails; device checks remain blocked until executed. |
| N8N-002 | Outdated documentation / Medium | Architecture evidence must describe current semantics. Live map has stale paid-invoice/cash, event-replay and offcut labels compared with repository map and source. | Live DB map`e65f…`; repo`madar-v2/n8n/MADAR_V2_FULL_LIFECYCLE_ARCHITECTURE.json`; business/operations audits. | Use new documentary artifact as reviewable replacement; no live overwrite performed. Acceptance: map connection IDs/statuses match final machine inventory and exact revision. |
| N8N-003 | Resolved evidence limitation / Informational | Active configuration alone was insufficient; later read-only evidence shows scheduled execution25 actually ran at06:00Cairo and returned WARN. Its scope is seven operational/subset checks, not full release acceptance. | `n8n-scheduled-execution-summary.json`: trigger mode, actual runData node sequence, overallWARN,7checks/0fail/1warning. Audit did not trigger this live run. | Keep current execution evidence separate from full-suite/build/device gates. Required-failure semantics of new verifier are tested only in isolated fixtures; no live failure injected. |
| N8N-004 | Not implemented/configured / Informational | Alert delivery must be a real authorized external destination. Existing summary is only an execution result; no alert node/credential/destination. | Prior CI Code node delivery text explicitly says result available in execution only; credential inventory empty. | Product/operations decision required for destination and authorization. Acceptance requires actual delivered notification evidence separately from workflow success. |

Workflow expressions, node types/versions, schedules/timezone, reachability, credentials references, retries and request timeouts were inspected. Earlier maps contain disconnected static diagram roots; reachable noOp/code diagrams are not evidence their named business integration runs. No requirement was found to insert n8n into existing MADAR transactions, and these outputs do not do so.

## Safe import and configuration

1. Use an isolated n8n2.46.7 instance first. Import files as new workflows, keeping `active=false`. Do not import over existing IDs or change production workflows without separate instruction. These output IDs are new audit-specific identities.
2. Documentary map needs no credentials. It is meant to be opened visually; it has no runnable trigger.
3. Configure the `Configuration` Code node in each verifier. Non-secret fields are `operationalBaseUrl`, `resultBaseUrl`, exact40-character `expectedRevision`, `maxResultAgeMinutes` (1–1440), `maxFutureSeconds`, `requiredChecks`, `fixtureOnly`, and report path. Default URLs target loopback18181; default`fixtureOnly=true` prevents synthetic fixture output being accepted as real CI evidence. HTTPS or explicit loopback HTTP only; no URL credentials/query strings.
4. For real checks set actual authorized HTTPS targets and `fixtureOnly=false`. Create/select an n8n **Header Auth** credential for the trusted runner on `Read authenticated release result`. The exported credential reference is `MADAR_AUDIT_RESULT_HEADER_AUTH` / `MADAR Audit Result Header Auth`; it is a reference, not an embedded secret. The intentionally public `/api/health` request requires no authentication. The runner endpoint must independently authenticate and authorize access.
5. The runner endpoint is an explicit integration prerequisite, **not an existing MADAR API route**. Supply it through an authorized CI/result service; no service deployment occurred in this audit. Do not redirect to a production mutation endpoint. Results must have schema below and immutable evidence bound to the audited SHA.
6. Run the fast workflow manually for operational responsiveness. Run the release workflow manually after slow CI/release checks have completed externally. Every HTTP request is GET, timeout5s, maximum2 attempts with1s wait; only idempotent reads are retried. Health failure stops the release fetch. Authentication/network/schema/revision/freshness/required-check failures produce a failed execution, not success placeholders.
7. No schedule is included in new files. If later scheduling is approved, choose operational cadence separately from slow release evidence refresh and use `Africa/Cairo`. No alerts are configured or delivered by these files.

Runner result contract:

```json
{
  "schemaVersion": 1,
  "sourceRevision": "26a9f6549ece44e0f17c50e453c23a0fc076071a",
  "fixtureOnly": false,
  "provenance": "ci-runner",
  "verifiedAt": "ISO-8601 UTC timestamp",
  "runId": "immutable trusted runner execution ID",
  "evidenceUrl": "https://authorized-runner.example/results/immutable-id",
  "checks": [
    {"id":"v2-suite","status":"VERIFIED_PASS","evidence":"immutable evidence reference"},
    {"id":"artifact-correspondence","status":"VERIFIED_PASS","evidence":"immutable evidence reference"},
    {"id":"failure-injection","status":"VERIFIED_PASS","evidence":"immutable evidence reference"},
    {"id":"restore-drill","status":"VERIFIED_PASS","evidence":"immutable evidence reference"},
    {"id":"physical-device","status":"BLOCKED_PREREQUISITE","evidence":"No acceptance evidence available"}
  ]
}
```

All four default required checks must exist once, have a passing explicit status, and carry evidence. Unknown statuses, duplicate IDs, wrong revision/provenance, stale/future timestamps or malformed results fail. Additional physical-device/external checks retain blocked/unverified statuses; they are never invented as passing. A required physical-device gate can be added explicitly to`requiredChecks`; it will fail until evidence exists. Default passing summary scope is the stated required checks and is not universal release readiness. TLS/credential access establishes the result channel, not correctness of an untrusted runner; runner provenance and artifact verification remain required operational controls.

## Reproduce static and isolated runtime checks

Run `node audit/final-integration-20261111/validate-n8n.cjs` against the already installed n8n2.46.7. This does not import workflows. The emitted JSON records static pass for3/3 files.

`node audit/final-integration-20261111/n8n-code-contract-tests.cjs` also executed the actual exported Code node logic in a Node VM with mocked n8n input helpers: **15/15 checks passed**, including successful synthetic result, required-check failure, revision mismatch, stale/future timestamps, fixture/provenance mismatch, missing/duplicate/unknown-status check, runner401/network error, retained blocked-device state, and health503/timeout. Evidence: `n8n-code-fixture-results.json`. These are contract-logic tests, **not** n8n import or runtime execution proof.

The reviewed runtime command is `python3 audit/final-integration-20261111/n8n-fixture-driver.py`. It needs permission for local sockets. It binds only127.0.0.1:18181, uses disposable`/tmp/madar-audit-n8n-*` SQLite/user folder, strips inherited n8n/DB/queue/execution environment, uses a generated synthetic encryption key and dummy fixture-only header credential, and runs installed n8n CLI with cwd=temp. No dependency install, production config read, live import, activation or business mutation is performed. Expected steps: import3inactive workflows, import synthetic credential, run operational success, run release synthetic success, set fixture's`failure-injection` status to`VERIFIED_FAIL`, observe release execution failure. Synthetic evidence proves workflow mechanics only. The actual full V2 suite separately passed118/118, while independent finance/GPS/artifact probes still expose release blockers; these synthetic results do not certify the application release. The driver records logs and sanitized result metadata under this directory and removes its temporary database afterward.

## Delivery status

- JSON validation: **passed**, all3files; installed classes/versions, syntax, references/targets, inactive exports, config and secret-pattern checks.
- Import verification: **passed**, all3workflows imported into isolated n8n2.46.7 and recorded inactive; no live imports. The documentary map's final runtime-status text was refreshed afterward and statically revalidated; the previously imported map's hashes are recorded separately.
- Execution verification: **passed against synthetic loopback fixtures**, operational execution1 and release execution2. This is not real CI/release/device acceptance.
- Deliberate-failure verification: **passed**, required`failure-injection` fixture was deliberately set toVERIFIED_FAIL; actual n8n execution3 errored and CLI exited1, with explicit failed summary.
- Alert delivery: **unconfigured and not performed**; no authorized destination supplied.
- Live activation/import/overwrite: **not performed**; all production workflows preserved.

## Exact executed artifacts

`n8n-executed-artifact-hashes.json` records the hashes captured immediately after the primary runtime. The executable files were kept byte-identical afterward:

- `n8n-executable-verifier.json`: SHA256`599a9351025d50aa718f7fe0dc8468a7d8519d73bfc4372acda5bec555b3624a`
- `n8n-operational-verifier.json`: SHA256`b7a2a6e9a7b766e1fa6e964f813a921a71f0c76c123ae81fc57eed60dbdd65c6`
- Documentary map imported at runtime: SHA256`48a8cd6482d71a7dc1bb4263d9e5941da9120db1a3530ff4e17653c0dad257cf`. Its Sticky Note text was subsequently refreshed with actual runtime status and statically revalidated. This final documentary text revision was not reimported; all node types/versions and non-executable structure are unchanged.

The n8n files are ready for import into the explicitly targeted compatible n8n2.46.7, after configuration/credential prerequisites are satisfied. The n8n verifier was successfully executed **against isolated synthetic fixtures only**. No live activation, production overwrite, notification delivery, external runner deployment or physical-device check was performed.
