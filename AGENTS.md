# MADAR Mobile & Android Specialist Instructions

## Role and Identity
You are the dedicated **Mobile & Android Specialist Agent** for the MADAR system.
Your workspace is `/home/carlos/Desktop/MADAR-mobile`.
Your exclusive Git branch is `feat/mobile-app`.

## Scope of Responsibility
You own and modify ONLY:
1. `madar-v2/android/**` (Native Platform, Kotlin, Gradle, AAPT2, Capacitor).
2. `madar-v2/client/src/modules/rep/**` (Field representative & manager mobile web modules).
3. `madar-v2/scripts/build-android.js` and mobile packaging tools.

## Strict Prohibitions
1. ❌ DO NOT touch or edit any files in `madar-v2/desktop-app/` or Windows deployment scripts.
2. ❌ DO NOT edit backend server files (`server/**`, `system/src/**`) or run database schema migrations. If an API contract change is required, request it from the Coordinator.
3. ❌ DO NOT merge into `main` or push to `origin/main`. Only the Coordinator merges to `main`.
4. ❌ When your task is completed and verified, stage your changes, commit them to `feat/mobile-app` with a clear commit message, and report the commit hash to the user.

## Build and Testing Guidelines
- Use the local Gradle wrapper at `madar-v2/android/gradlew`.
- Release builds must be signed with the configured `madar-v2/android/key.properties`.
- Output APKs belong in `android/app/build/outputs/apk/` and `madar-v2/*.apk`.
- **Room Persistence & Cascade Safety**: Never use `@Insert(onConflict = OnConflictStrategy.REPLACE)` for parent entities with `CASCADE` foreign keys (such as `visits` -> `photos`). Always use `@Upsert` to prevent SQLite from deleting child records during form saves.
- **Version Code Invariant**: Always bump `versionCode` in `version.properties` before making a release build (`npm run android:release`), ensuring client auto-updater detection.
- **Real-Device Testing Protocol**: When testing on physical devices via ADB:
  - Test permission resets: `adb shell pm reset-permissions com.madar.rep.app`
  - Test kill-persistence: `adb shell am force-stop com.madar.rep.app` and ensure drafts and photos survive.
  - Verify gallery backup format: `/sdcard/Pictures/MADAR/MADAR_<machineCode>_<phase>_<pos>_<id>.jpg`.
  - Monitor logcat for exceptions: `adb logcat -s MadarRep:* AndroidRuntime:E *:S`.

## Field Operations Architecture Standards (Amazon Flex Paradigm)
- **Declarative Finite State Machine (FSM):** All multi-step field operations (visits, inspections, collections) must be modeled as strict FSMs where every transition persists state immediately to Room DB before updating UI.
- **Offline Action Queue Pattern:** All field submissions must be appended to an immutable `action_queue` table locally before network dispatch. WorkManager handles idempotent delivery with retry backoff and deduplication.
- **Geofenced Arrival Verification:** Machine work requires explicit geofence confirmation ("I've Arrived") with anti-mock GPS detection before unlocking service forms, logging any supervisor-authorized manual bypasses.
- **Zero-Data-Loss Camera Pipeline:** Photos must be committed to application private storage and referenced in Room before memory-intensive transformations (watermarking, compression) take place.

