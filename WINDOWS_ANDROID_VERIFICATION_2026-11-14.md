# Windows and Android verification — 2026-11-14

## Result

The Windows checkout was current with GitHub before testing. Automated V2 tests pass after fixing Windows file-flush failures. Physical-device acceptance is **not complete**: returning three camera photos to a visit fails when a fresh GPS lookup is unavailable, despite the screen displaying a prior accurate location. Offline street maps also lack their required server-side map package. Do not describe this run as proof that every feature works.

## Source and device identity

- Windows repository: `C:\Users\Carlos.wok\Desktop\MADAR\carlos-madar`, branch `main`.
- Initial `git fetch`, `git pull --ff-only origin main`, and `git ls-remote` confirmed local HEAD and GitHub `main` were `c7746cb0e6e04758ad3955508264e961ecdf6046`. The checkout was clean. The parent MADAR folder is a separate repository with tracked deletions and no remote; it was preserved.
- Node.js 24.21.0, npm 11.19.0 on Windows.
- Physical device: Redmi Note 12 Pro+ 5G, Android 14. USB initially unauthorized; the owner enabled debugging and ADB confirmed `device`.
- Installed package: `com.madar.rep.app`, version 2.0.9, versionCode 11, updated 2026-11-14 14:09:40. It is not marked debuggable.
- Installed APK SHA-256: `e9ae7515fe8fe5cee140c352de8c244dc5b45bc8baf44cc5856eda321d9ff7d6`.
- All 48 comparable packaged JS/CSS/HTML/JSON files matched checked-out `madar-v2/public/rep` after normalizing CRLF/LF. Two additional generated Cordova stub files were expected. This verifies packaged web assets, not a reproducible native DEX build.
- The ignored Windows `madar-v2/madar-rep.apk` is an older file dated November 3; its SHA-256 is `7c5a462aaadb5fc02a19c02e38ed52d701de91c03af74d2f359b4832538eded0`. Do not install it as the verified current APK. JDK/Android SDK were not found in the inspected local locations; no Windows APK build or install was performed.

## Fixes verified in this run

1. **High: Windows backups failed before publication.** `createSystemBackup` opened the completed archive read-only before `fsync`, producing `EPERM` on Windows. It now uses a writable `r+` handle. POSIX directory syncing remains enabled; Windows skips directory fsync because Node cannot flush directory handles there. File contents are still flushed before rename. This does not promise power-loss durability equivalent to POSIX directory fsync.
2. **High: fallback operation events could fail to queue on Windows.** The same read-only fsync problem stopped publication of the fallback JSON event. The file now uses `r+`, with directory fsync restricted to supported platforms. The existing injected-SQLite-failure test verifies subsequent delivery and no duplicate replay.
3. **Test portability:** directory-link fixtures use Windows junctions without requiring symlink privileges. Five deployment tests explicitly require Linux because the deployed Bash workflow uses `flock`, `timeout`, GNU `stat`, and POSIX PATH/executable semantics. They remain enabled on Linux.

## Automated verification

- Initial full V2 run: **176 tests, 166 passed, 10 failed**. One parity test file could not initialize its symlink fixture, so its individual tests were absent from this first total.
- Focused Windows backup/restore, deletion, event-retry and parity regression run after fixes: **23/23 passed**.
- Final full Windows V2 run: **187 tests, 182 passed, 0 failed, 5 explicitly skipped Linux deployment tests**, 152.4 seconds.
- The five unchanged deployment tests and their script/ignore dependencies were separately checked on SSH host `carlos@100.115.125.88`: **5/5 passed** in isolated temporary Git fixtures. No live deployment or PM2 restart was executed. Other dirty remote source files were preserved; this is not a claim that the remote working tree equals Windows.
- Client production build: passed, 6.82 seconds. `git diff --check`: passed.
- Existing suites exercise authentication, rep API isolation, offline attendance policy/idempotency, GPS ownership, camera-result normalization, visit recovery, image compression/watermarking, maintenance workflows, archive/reporting month, warehouse, finance, payroll, notifications, transactional events, backup validation and isolated restore recovery. This is automated fixture evidence, not interactive acceptance of every screen.
- Synthetic 557-card PowerPoint export completed in 53.7 seconds while the progress endpoint remained responsive. This is a heavy fixture workload, not measured production throughput.

## Physical-device findings still open

### P1 — camera photos do not enter the visit when fresh GPS acquisition fails

The owner authorized use of the existing test order `تجريبي` / Test Client. Initially geofencing correctly blocked capture outside 50m. The owner then adjusted the test machine's location, and the UI showed an effective distance of zero.

Two sequences reached **3/3 before photos** in the native camera. Selecting “إنهاء هذه المجموعة” returned to the visit, but its photo count remained **0/3** and the error was “يلزم تحديد موقع GPS قبل التقاط صور الزيارة.” No visit submission or synchronization success was observed. Android's location dump also showed older GPS-provider data; availability of fresh satellite fixes remains an environmental factor.

Source trace: `MachineVisitSheet.jsx` → `processCaptures` requests another location through `captureVisitLocation` and returns before processing any photos when it receives null. `RepApp.jsx` catches lookup/validation failure and returns null, but retains the displayed previous GPS unless the error specifically says GPS is disabled. Thus the visible accuracy indicator can be misleading, and a valid camera result is not retained in React photo state for a later retry.

Next fix should validate GPS freshness before opening the camera, clearly label an old/unavailable fix, and retain captured private photo references so a failed later lookup can be retried without recapturing. Preserve mock-location and geofence checks; do not silently accept stale coordinates or broaden the real machine radius. Re-test both three-photo phases, cancellation, interrupted capture, full save, offline restart and server acknowledgment on a fresh native build with current GPS.

### P2 — offline street map is not provisioned

The map panel displayed “لا توجد حزمة MBTiles محملة على الخادم.” The download button was unavailable. Offline GPS/map UI code existing in the repository does not supply the missing geographic tile dataset. Provision the intended licensed map package and verify download, offline rendering and refresh separately.

### P2 — measurable animation/camera-return stutter

After resetting Android gfx statistics, the mixed manual navigation/camera workload ended at **5,051 rendered frames, 804 janky frames (15.92%), p95 34ms, p99 73ms**. This includes automation, camera transitions and user interaction and is not a controlled benchmark. Before the workload, existing session statistics were 3.77% jank.

Logcat recorded camera-close Binder/monitor contention around 206–209ms and `RepCameraSequenceActivity.onPause` around 211ms. Inspect camera/session shutdown on the main thread and profile screen scrolling separately; these measurements justify investigation but do not prove one root cause for every dropped frame. No fatal exception or ANR was found in the bounded inspected current-process log window.

### P3 — mobile presentation

The long synthetic machine code overflowed the visit header; the search field had low-contrast text on a dark input background. Verify wrapping and inherited theme styles with ordinary and long codes on the handset. These were observed but not changed in this patch.

## Device recovery and limitations

- Cached route and test card remained available when Wi-Fi and mobile data were temporarily disabled; warm resume succeeded and the header showed offline local mode. Both settings were restored to enabled, and the app again displayed server-connected status.
- The app was left at the representative home, still logged in. No clock-in/out was performed, no visit was submitted, and no pending business queue was cleared. Test camera images may exist in app-private cache or the owner-configured photo archive; no files were deleted from the phone.
- Real end-to-end six-photo save/upload/approval, offline queued-visit restart recovery, biometric attendance and sustained background tracking remain unverified on this device. The test-order location was changed by the owner during testing.
- No production database/storage restore, customer-file modification, APK replacement, service restart, or signing-key change was performed. Tests used temporary SQLite/storage fixtures.
- Local raw test/build logs and selected device screenshots are retained under ignored `madar-v2/logs/verification-20261114/`; they are not published to GitHub.
