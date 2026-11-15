# MADAR Native delivery check — 2026-11-15

## Result

The native Android project currently compiles, its unit tests pass, and release lint passes. **This is not a release or deployment acceptance:** no signed production APK was built or published, no emulator was available, Egypt map packages are absent from this checkout, and no Ubuntu deployment was performed.

## Verified locally

- Repository: `main`, baseline `0cb7ceca1027e52a3102e092c7df01fa3ffc2060` (`up`).
- Gradle: `:app:testDebugUnitTest :app:assembleDebug :app:lintVitalRelease --no-daemon --max-workers=1` — `BUILD SUCCESSFUL`.
- Unit tests: 8 passed; 0 failures/errors (`CoreSafetyTest`).
- Debug APK: `madar-v2/android/native-platform/app/build/outputs/apk/debug/app-debug.apk`.
- Debug APK identity: `com.madar.rep.app.debug`, versionCode 13, versionName `2.2.0-debug`, target SDK 36. The `.debug` application ID means this is **not** the upgrade/install release artifact.
- Debug APK SHA-256: `929280b03f9ab4f1523d638c9605241682bd5f94e527b0d06b884e93ce7135eb`.
- `:app:packageRelease` was intentionally blocked by the new fail-closed signing check: no `android/key.properties` or keystore was found. The approved signing certificate was therefore not verified.
- Version identity is unified through `madar-v2/android/version.properties` (`2.2.0` / code 13), consumed by the native Gradle project.
- Release lint initially found the old Fragment dependency used with Activity Result APIs. After adding Fragment 1.8.8, `:app:lintVitalRelease` passed.
- Android SDK reported no connected emulator. WSL reports no installed Linux distribution.
- `git diff --check` passed before this report was added.

## Code work in this checkout

- Restored native data/API/Room/repository/session/map/migration/sync source files were ignored by the broad `data/` ignore rule. They were force-added to Git and pushed as part of commit `ad1e22ea74e9e0158c584dc4aa0f4be628bde5f6` on `origin/main`.
- Added GPS-coordinate and policy validation, memory-only login password handling, eight core safety tests, shared version loading, and a release packaging guard against unsigned APKs.
- Camera now stays open for consecutive captures. Photo originals are written beneath app-private durable storage, use unique evidence directories, and are not deleted by the photo-removal path. Captures with missing/stale/mock/invalid GPS are not labelled with a current GPS fix.
- These camera/evidence changes have compile coverage only; they have not been exercised on an emulator. A complete interruption journal/recovery flow and immediate processed-photo preview remain unverified/incomplete.

## Not verified / release blockers

- No approved keystore or signing properties were available; no release APK, upgrade signature comparison, or installed-version upgrade test exists.
- No emulator/device was attached, so camera, migration, lifecycle, GPS, and offline behavior were not acceptance-tested. Physical-phone acceptance was explicitly waived; this is a waiver, not a pass.
- The staged map-download/rendering artifacts, PBF, generator scripts, and generated MBTiles described in the handoff were not present in this Windows checkout. The existing server catalog is not proof of nationwide coverage. No Egyptian map package was verified or published.
- Push verification: `origin/main` points to `ad1e22ea74e9e0158c584dc4aa0f4be628bde5f6`.
- Live `GET /api/health` still reported `sourceRevision=0cb7ceca1027e52a3102e092c7df01fa3ffc2060` and `sourceDirty=true` after the push. Thus the running service did **not** show the pushed revision at check time.
- Tailscale can see the Ubuntu host, but SSH to its `madar` account was rejected (`Permission denied (publickey,password)`). No server backup, pull/restart, APK publication, or authenticated download-hash check was performed.
- Migration ownership binding and legacy-backlog visibility still need review before enabling production sync; legacy owner IDs must not be silently mapped to a server-scoped local owner namespace.
- There is no verified application release link. The debug APK above is a local engineering artifact only.
