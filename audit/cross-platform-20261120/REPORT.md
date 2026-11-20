# MADAR cross-platform integration review — 20 November 2026

Scope: native representative Android, manager Android distribution, Windows Electron, web and live MADAR V2 server. This was a targeted read-only review of application and production state, with HTTP mutation tests on isolated databases and storage. The legacy system and madar-flow were identified as separate trees and were not audited in depth.

## Deployment and artifacts

- Live PM2 MADAR V2: one fork, /api/health OK, boot revision fc8cdb81f2d8b719a38d0903969a6f3bf015787c, sourceDirty=false. main matches origin/main. Desktop branch 2865eb1 is an ancestor. Mobile branch eab892e has one extra commit changing only release manifest metadata.
- Representative Native APK: com.madar.rep.app, 2.5.0/32, release registry available, minimum supported version 19. Downloaded all 3,311,924 bytes via live loopback HTTP; SHA-256 142b06573fdfe76c2996b6c1f19b5a8f20283d439f1fe132cdc231da3b13e6a7 matches disk and registry. Manifest build revision is 42fb255; it is a separate artifact baseline. APK signer verified with apksigner.
- Windows: live status selects MADAR-Windows-1.0.2-Setup.exe; live range request returned 206. Installer on disk matches live latest.yml SHA-512. In osslsigncode, verification succeeds when explicitly trusting the MADAR certificate; default trust verification failed on the self-signed certificate and no timestamp was reported. Windows installed-app trust and auto-update execution were not tested.
- Manager: actual local APK com.madar.system.app 2.4.6/26, manifest 2.4.9/29, exact file hash matches manifest. Both Android files verify with the approved signer f4c8bffc9f852ea6056e350b65156eb880d05629991682492159b9e3937c02a1. An anonymous manager status request was denied. Authenticated manager download and installed behavior were not verified.

## Findings

| ID | Priority | Evidence and effect | Next acceptance criterion |
|---|---|---|---|
| XPL-01 | P1 | desktop-app/main.cjs:113 and :995 replace updater signature checks with success. Same overrides in local unpacked 1.0.2 ASAR. An installer hash from its update feed is not an independent publisher check. Direct correspondence of the unpacked ASAR to the installer was not confirmed. | Restore publisher verification, decide certificate distribution and trust, prove trusted update acceptance and rejection of untrusted updates on isolated Windows. |
| XPL-02 | P1 | MadarViewModel.kt:232 starts breadcrumb service after login. Server rep/service.js:1984 auto-heals duty only from an existing open attendance row. Isolated test at rep-attendance-radar-sync.test.js:248 expects auto-attendance with no prior clock-in and fails. GPS healing code at service.js:2019 and tracking-ledger.js:66 can write biometric-verified flag without a biometric operation when their insert branch runs. No live record alteration was reproduced. | Decide explicit auto-tracking policy, keep payroll clock-in and biometric evidence independent, verify no-attendance, existing shift, overnight and closed-session uploads. |
| XPL-03 | P1 | Manager artifact version and manifest disagree. app.js:187 validates manifest format/hash/declared signer but does not parse binary manifest version. Manager download branch app.js:349 skips representative registry. | Extract package/version/signature from final bytes before publication, store per-product release provenance, verify authenticated manager download. |
| XPL-04 | P2 | desktop-app/main.cjs:455 publishes cached index before background asset fetch. An interruption between those writes can leave shell HTML with missing chunks. Confirmed ordering in source; Windows behavior untested. | Stage complete versioned assets, verify hash/dependencies, atomically select cache, and test disconnect/restart during cache refresh. |
| XPL-05 | P2 | Desktop local replica has machine screen consumers only. Client/material replica and finance queue functions have no production callers outside their own modules in source search. Desktop-shell offline mode is not evidence of complete offline business operations. | Define supported offline actions and owner-bound durable queue with replay tests before offering offline writes. |
| XPL-06 | P2 | Representative packs use catalog-backed offline-map-packs.js. Supervisor routes.js:29 use legacy offline-tiles.js. SupervisorRadarMap.jsx:168 defaults to Google Hybrid. This is a distinct integration path and depends on policy for supervisor maps. | Deliberately align map source or document supported separate paths. Test representative and supervisor with network disabled and chosen packs installed. |
| XPL-07 | P2 | Some server events are published after transaction completion, e.g. rep/service.js:1150 and rep/routes.js:219. A crash can leave committed data without its event. Representative and supervisor need authoritative reconciliation in addition to realtime. | Transactional outbox for required events or proven reconnect reconciliation. Test commit/notification interruption and stale cursor. |
| XPL-08 | P2 | rep-api.test.js:432 inherits the live min version setting through dotenv when not overridden. Version gate returns 426 before authorization; isolated rerun with min=0 passes. That failure is a test/config boundary rather than evidence of permission bypass. | Explicit version-policy fixtures and tests for both role denial and update-required responses. |

## Maps and tests

Configured .env pack directory contains Egyptian overview z5–11 and six regional road packs. The same server parser in a fresh read-only Node process resolved seven available packs, checked manifest coverage/byte counts and matched one actual tile hash per pack. Counts: 7268, 7982, 10246, 14533, 5288, 11285, 12939. This did not exercise live authenticated map calls, full client download, or phone rendering. Desktop supervisor continues to use separate map endpoints.

- Focused desktop distribution, offline map packs, GIS smoothing and attendance/radar: 14/15 passed. The failing no-attendance auto-GPS case stopped at its first assertion.
- Focused representative HTTP, release registry, version gate, events, photo policy and recovery: 22/23 passed. Rerun rep-api with explicit disabled minimum in fixture: 4/4 passed (overlapping tests).
- No Windows device or Android physical acceptance conducted. ADB listed zero devices. No new deployment, build, APK replacement or business data changes. No full-suite assurance claimed.

## Engineering priority

1. Fix release trust and Manager metadata before next distribution.
2. Lock down GPS, duty, attendance and biometric state semantics on the server.
3. Build an automated release journey across actual artifact identities, representative offline visit, approval/reshoot on Desktop, client reconciliation and reports.
4. Finish reliable cache versioning, state visibility and explicitly supported offline Desktop workflows. Test server/download/geo coverage separately from installed-client acceptance.
