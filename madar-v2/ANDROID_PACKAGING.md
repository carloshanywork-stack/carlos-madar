# MADAR Rep Android packaging

This packages the existing field-representative UI in a Capacitor Android shell. It does not move business data or uploaded photos to a cloud service. The app talks to the MADAR server configured by `MADAR_REP_SERVER_URL`.

## Requirements

- Node.js 22 or newer.
- JDK 21 or newer; set `JAVA_HOME` to its installation directory.
- Android SDK with platform 36 and the matching Android Build Tools installed; set `ANDROID_HOME` or `ANDROID_SDK_ROOT`.
- For a distributable release APK, the owner must select and safeguard the permanent signing keystore. No release keystore or signing credentials are stored in this repository.
- Install the project and client dependencies from `madar-v2/`:

  ```powershell
  npm ci
  npm --prefix client ci
  ```

## Local USB/emulator build

1. Android debug/release APKs bundle the UI and use the HTTPS API by default. For intentional USB live-reload development only, temporarily set the URL in `.env`:

   ```dotenv
   MADAR_REP_SERVER_URL=http://localhost:3000
   # Do not set MADAR_REP_LIVE_RELOAD in .env; pass --live-reload to the build command below.
   ```

   `capacitor.config.ts` loads this value on each Capacitor sync, validates the URL, and allows cleartext only for `localhost`. `localhost` on Android means the Android device itself, so keep the device attached and run this from a terminal with Android platform-tools:

   ```powershell
   adb reverse tcp:3000 tcp:3000
   ```

2. Start the MADAR API on port 3000, then build/synchronize and create the debug APK:

   ```powershell
   npm run android:sync -- --live-reload
   npm run android:debug -- --live-reload
   ```

   The build script runs Vite and Capacitor via the active Node executable, including on Windows. `android:sync` builds `client/dist` for the local Express server and `public/rep` for the Android package, then copies the latest web assets/plugins into `android/`. `android:debug` repeats that sync, invokes Gradle's wrapper, and atomically copies the resulting debug APK to `madar-v2/madar-rep.apk`. The generated APK is ignored by Git.

3. Install the APK:

   ```powershell
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```

Debug APKs use Gradle's machine-local debug key and are for testing only. Do not distribute them as production updates. Each release APK must use the same approved signing key as every previous release of `com.madar.rep.app`; Android rejects an update signed with a different key. Keep the keystore and `android/key.properties` outside source control, retain secure backups of the keystore, and do not rotate or replace it for an existing package.

After the permanent release key has been approved, copy `android/key.properties.example` to the ignored `android/key.properties`, then fill in its fields (use an absolute keystore path, or a path relative to `android/`; never commit actual credentials):

```properties
storeFile=C:/secure/path/madar-rep-release.jks
storePassword=<keystore password>
keyAlias=<approved key alias>
keyPassword=<key password>
```

Then increment `versionCode` in `android/version.properties` for every update and run `npm run android:release`. The file is the version source for every build: `versionCode=2` and `versionName=2.0.0` currently, overridable for CI with `MADAR_REP_VERSION_CODE` and `MADAR_REP_VERSION_NAME`. The build script validates the file and prints the version it built. The script refuses to launch Gradle if `android/key.properties` is absent; Gradle requires non-empty signing properties and an existing keystore, and validates the credentials during signing. The release APK is written to the ignored `madar-rep-release.apk`. The Settings → System screen reports whether the current download is a signed release or a fallback/test artifact, and its APK download button uses `/download/apk`.

Android APKs bundle the UI by default (debug and release): the WebView never navigates to `localhost` or a remote UI URL. The default API host is `https://carlos-pc.tail852ef0.ts.net`; set `MADAR_REP_SERVER_URL` in `.env` to override it before building. Capacitor embeds the host as the API base URL and Android WorkManager uses the same value. Capacitor's native HTTP/cookie bridges carry foreground requests and uploads. The server allows the fixed Android WebView origin `https://localhost`; its session cookie is `Secure; SameSite=None` only for that origin and remains `SameSite=Strict` elsewhere. Normal Android build scripts forcibly disable live reload even if an old environment variable is present. Only passing `--live-reload` to `android:sync` or `android:debug` enables live reload; use it only for local development with `adb reverse`.

## Package identity, storage isolation, and compatibility

For any transition from a previous MADAR Android package, use the device-level checklist in [`ANDROID_PACKAGE_TRANSITION_PRECHECK.md`](./ANDROID_PACKAGE_TRANSITION_PRECHECK.md) before uninstalling or replacing it.

- The installed package ID and Android namespace are both `com.madar.rep.app`. Capacitor uses the same `appId`; the FileProvider authority is `${applicationId}.fileprovider` (`com.madar.rep.app.fileprovider` in the merged app manifest), is not exported, and grants URI access only for configured files.
- Camera sharing is restricted to this app's `Pictures/` external-files directory and its private cache. It does not expose the entire device external-storage tree. The manifest disables Android backup (`allowBackup=false`); native SQLite, visit photos, and encrypted session preferences use app-private storage.
- Changing from the previous ID `com.madar.rep` to `com.madar.rep.app` intentionally creates a separate Android app identity. It can be installed beside the old app without package/provider collision, but it is **not** an in-place update: Android will not transfer the old app's private database, preferences, IndexedDB, or pending files. Keep the old app installed until any needed data has been synchronized or otherwise handled. Updates to the new package require both a monotonically increasing `versionCode` and the same release signing certificate.

Debug and release builds open the packaged UI offline; login, server synchronization, and uploads still require the configured MADAR API. Only an explicit `--live-reload` build command uses `adb reverse` and cleartext localhost. Normal Android builds require HTTPS and reject localhost configuration. An authenticated Admin or representative can download the latest available APK from `/download/apk`; release artifacts take precedence, with the existing debug APK retained as a clearly identified fallback.

## Later Cloudflare Tunnel configuration

When the deployment URL is ready, set the full HTTPS origin in `madar-v2/.env`, for example:

```dotenv
MADAR_REP_SERVER_URL=https://rep.example.com
```

Then run `npm run android:sync` before building. The host is embedded as the API origin while the UI remains packaged in the APK; UI changes require rebuilding/reinstalling the APK. Changes to native Android code or Capacitor plugins also require a new APK. Do not put credentials or customer data in the URL.

## Native behavior and limits

- Android visit photos are captured with `CameraSource.Camera`; the Android rep screen does not offer a gallery picker. Browser-only file input remains available in the web version.
- Before the login screen, Android requests camera, precise/coarse location, and notification permissions together. Background location is requested separately or granted through App Settings on newer Android versions; after the required permissions are first granted, MADAR requests the battery exemption once and the foreground location service holds a partial wake lock while duty is active. Gallery/media permissions are not requested because this camera-only workflow stores derived JPEGs directly under `filesDir/visits/{visitUuid}/`.
- MADAR mirrors today's route and fault reasons into native SQLite (`machines`, `fault_reasons`, and `route_snapshots`); pending visit metadata and six photo paths are stored in SQLite, and duty GPS breadcrumbs remain in the native SQLite queue. The WebView queue is only a compatibility/UI mirror for new Android visits.
- Machine location confirmations and wrong-machine correction reports are also written to a durable native `pending_machine_actions` queue before the visit workflow continues. WorkManager drains them before attendance and visits with the original `actionUuid`; a confirmation stays `pending_approval` until supervisor review, a correction is removed only after a confirmed server response, and permanent 4xx failures are isolated for review. Visits for a card with a blocking machine action are skipped by the native worker.
- Native GPS rows carry the authenticated representative's `rep_id`; points written by older app versions remain explicitly unattributed (`rep_id = 0`), are preserved, and are never uploaded under a later account. The server returns a per-point `accepted`/`duplicate`/`rejected` result; the worker removes only acknowledged points and moves rejected points to the local `rejected_breadcrumbs` table with the server reason.
- A permanently rejected attendance punch is stored as `attendance_rejected` with the server reason instead of being retried forever ahead of later punches and visits. Transient network/5xx/202 responses still retry with the same `actionUuid`.
- WorkManager runs with a connected-network constraint, survives process/app restarts, and retries a single multipart request containing the JSON visit and all six image files. The bearer session token is stored with AndroidX `EncryptedSharedPreferences`. A server `200` with a committed visit status and matching UUID is the only response that marks the visit synced and removes its local photos. The current server's `202 {status: "processing", success: false}` is not an acknowledgment: the worker retains all files and retries the complete bundle with the same UUID.
- Older app-specific external visit backups are still read during migration. New visits do not use external backup folders or convert their images to Base64/IndexedDB Blobs.
- Select **أون ديوتي** to start the foreground location service. Android 10+ requires the user to grant **Allow all the time** in app settings; Android 13+ also requests notifications. Android/OEM battery policies can still pause or stop background work.
- Location sampling adapts after three stationary minutes: browser polling slows from 12 seconds to 60 seconds; the Android foreground service slows from 5 seconds to 60 seconds. Both return to their faster interval when speed or displacement indicates movement. This is a battery-saving heuristic, not a guarantee of continuous background GPS; platform and OEM restrictions still apply.
- The native GPS bridge requests the GPS provider and checks Android's mock-location flag. Mock-location detection is a warning/control, not a guarantee against rooted devices, modified OS images, instrumentation, or other tampering. A photo watermark is likewise not tamper-proof evidence.
- The app does not request `READ_EXTERNAL_STORAGE`, `READ_MEDIA_IMAGES`, or `WRITE_EXTERNAL_STORAGE`; photos originate from the camera and remain in the app-private files directory.

Test camera, precise GPS, mock-location warnings, duty tracking while backgrounded, offline shell recovery, backup restoration, and visit synchronization on a physical Android device before distributing the APK. No device-level test or signed release build is claimed by this packaging change.

The Windows verification recorded before the package-ID change completed `npm run android:sync`, which builds and synchronizes the Capacitor assets/plugins. It did not compile an APK: Java/JDK, Android SDK environment variables, and SDK tooling were unavailable on that workstation. A successful sync is not evidence of Gradle compilation, signing, installation, update compatibility, or handset behavior. The ignored `madar-rep.apk` present in the workspace predates the new package ID and must not be treated as the new build.

## Transition for installed Debug 2.0.2 (versionCode 4) phones

The administrator settings page offers a separate **Debug transition** download when `MADAR_REP_TRANSITION_APK_PATH` exists (default: `madar-v2/madar-rep-transition.apk`). This is for phones that still run the previously distributed Debug-signed `com.madar.rep.app` 2.0.2 (versionCode 4). The transition APK is now 2.0.6 (versionCode 8) and uses that same Debug certificate. It contains the native consecutive-photo camera and current representative route UI. The standard `/download/apk` continues to select the release-signed artifact; it is not replaced by this transition file.

Before updating, preserve pending visits and photos using the app's recovery process. Install the transition APK over the existing app without uninstalling it first. Confirm the version and run a real multi-photo visit on the handset. Matching the known certificate and increasing versionCode establish Android's update prerequisites for that distributed Debug build, but no physical-handset installation or data-preservation test has been performed. If the handset's certificate differs, stop and inspect it; do not uninstall to force installation. The transition remains a debuggable build and is not the security release. Moving from Debug to the release-signed APK needs an export/reinstall/import path with device acceptance testing.
