# MADAR Android package transition preflight

This runbook is required before replacing or retiring the field representative application. `com.madar.rep` and `com.madar.rep.app` are separate Android application identities; installing the new package does **not** migrate the old package's database, preferences, encrypted session, IndexedDB, or app-private photos. Android also cannot prevent a user from uninstalling an app. The only protection MADAR can provide is an in-app warning, a pending-work guard, and an export backup.

## 1. Inventory and authorization

- [ ] List every registered representative and every device running the old package.
- [ ] Record the installed package ID, version name/code, SHA-256 signing certificate, MADAR account, and last successful sync time.
- [ ] Confirm with the warehouse owner which devices may be updated, paused, or replaced.
- [ ] Confirm the approved MADAR_REP_SERVER_URL, backup location, and release signing key escrow before distributing the APK.
- [ ] Keep the old APK, its checksum, release keystore, `android/key.properties`, and the last known-good map/database backup in protected off-device storage. Never commit them to Git.

## 2. Preserve pending work

For each representative before uninstalling or replacing the app:

1. Open the old application and sign in normally.
2. Open **on-device measures** from the pending queue.
3. Tap **تصدير نسخة JSON** and keep the generated `madar-rep-pending-queue-*.json` until the server independently confirms the same visits.
4. Sync until the pending counter is zero, including failed/blocked items, before deleting the old app or clearing its data.
5. If any item cannot synchronize, keep the JSON export and the old app installed; do not clear data or uninstall it until the owner accepts the remaining data.
6. Verify the server visit count and image paths for a sample of exported records; do not accept a screenshot as proof.

The JSON export contains the queued visits and correction actions, with image bytes when they are locally available. It is a recovery backup, not automatic re-import; an operator still restores or reconciles it manually.

## 3. Signing, version, and identity gate

- [ ] `android/app/build.gradle`, Gradle namespace, Capacitor `appId`, native package, and FileProvider authority all use `com.madar.rep.app`.
- [ ] `versionCode` is an integer greater than every previously distributed `com.madar.rep.app` build; `versionName` is human-reviewable.
- [ ] The release APK is signed with the approved release key, not the debug key. Record its SHA-256 fingerprint and compare the old/new artifacts.
- [ ] Do not rotate the release key. A replacement key can only install as a new package and will abandon the previous signing identity.
- [ ] Android backup remains disabled; native database, session preferences, and visit photos remain app-private.

## 4. Build and device acceptance

Run the normal packaging workflow, then perform these physical-device checks on representative Android versions and OEM skins:

- clean install and side-by-side install beside the old package, if applicable;
- login, session persistence, logout/re-login, and account lockout;
- camera capture, before/after limits, watermark, and upload;
- camera, precise/coarse location, "Location all the time", notification, and biometric enrollment prompts;
- duty on/off and process death while the foreground service is active; notification remains required;
- partial wake-lock behavior, battery-exemption prompt, and OEM battery manager whitelist;
- offline visits, app restart, queued sync, duplicate retry after uncertain network responses;
- JSON export with a non-empty queue, and cleanup confirmation after export;
- low storage, airplane mode, screen lock, app force-stop, and reboot recovery;
- no visit submission is acknowledged until the server returns its committed status.

Do not use adb to copy an app-private database into the new package as a silent migration. Treat any manual data copying as an explicit, verified disaster-recovery procedure and test it on a disposable copy first.

## 5. Rollback and ownership

- [ ] The old package and its export remain available until the owner signs off the acceptance checklist.
- [ ] Server SQLite and `storage/`, including backups, are verified before any production update.
- [ ] A rollback selects the prior signed APK and preserves the same package ID and data root; it does not restore an old APK over a different signing identity.
- [ ] The owner receives the list of retained exports and their checksums.

## Pass criteria

The transition passes only when every target device has either (a) pending work synchronized to the server or (b) a verified JSON export stored outside the device, and the signed new APK has passed the device checklist. Otherwise the old application stays installed and the rollout does not proceed.
