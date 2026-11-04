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

1. Copy `.env.example` to `.env` if needed and keep the default during local testing:

   ```dotenv
   MADAR_REP_SERVER_URL=http://localhost:3000
   ```

   `capacitor.config.ts` loads this value on each Capacitor sync, validates the URL, and allows cleartext only for `localhost`. `localhost` on Android means the Android device itself, so keep the device attached and run this from a terminal with Android platform-tools:

   ```powershell
   adb reverse tcp:3000 tcp:3000
   ```

2. Start the MADAR API on port 3000, then build/synchronize and create the debug APK:

   ```powershell
   npm run android:sync
   npm run android:debug
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

Then increment `versionCode` in `android/app/build.gradle` for every update and run `npm run android:release`. The script refuses to launch Gradle if `android/key.properties` is absent; Gradle requires non-empty signing properties and an existing keystore, and validates the credentials during signing. The release APK is written to the ignored `madar-rep-release.apk`. The Settings → System screen reports whether the current download is a signed release or a fallback/test artifact, and its APK download button uses `/download/apk`.

## Package identity, storage isolation, and compatibility

- The installed package ID and Android namespace are both `com.madar.rep.app`. Capacitor uses the same `appId`; the FileProvider authority is `${applicationId}.fileprovider` (`com.madar.rep.app.fileprovider` in the merged app manifest), is not exported, and grants URI access only for configured files.
- Camera sharing is restricted to this app's `Pictures/` external-files directory and its private cache. It does not expose the entire device external-storage tree. The manifest disables Android backup (`allowBackup=false`); native SQLite and preferences use app-private storage, and Capacitor external visit backups use the application-specific directory `Android/data/com.madar.rep.app/files/Pending/`.
- Changing from the previous ID `com.madar.rep` to `com.madar.rep.app` intentionally creates a separate Android app identity. It can be installed beside the old app without package/provider collision, but it is **not** an in-place update: Android will not transfer the old app's private database, preferences, IndexedDB, or pending files. Keep the old app installed until any needed data has been synchronized or otherwise handled. Updates to the new package require both a monotonically increasing `versionCode` and the same release signing certificate.

The app loads the configured server URL. After the first successful online load, the service worker caches the UI shell and built assets for offline reopening; API requests, login validation, and visit synchronization still require the MADAR server. Keep `adb reverse` active while testing through USB. The build permits cleartext traffic only to `localhost`; use HTTPS for any non-local server. An authenticated Admin or representative can download the latest signed release APK from `/download/apk`; other roles are denied, and the endpoint returns 404 until the release artifact exists.

## Later Cloudflare Tunnel configuration

When the deployment URL is ready, set the full HTTPS origin in `madar-v2/.env`, for example:

```dotenv
MADAR_REP_SERVER_URL=https://rep.example.com
```

Then run `npm run android:sync` before building. The app loads UI/API from that host, so web UI changes can be served without rebuilding the APK. Changes to native Android code or Capacitor plugins still require a new APK. Do not put credentials or customer data in the URL.

## Native behavior and limits

- Android visit photos are captured with `CameraSource.Camera`; the Android rep screen does not offer a gallery picker. Browser-only file input remains available in the web version.
- A pending visit is stored in IndexedDB and copied under the app-specific external-files directory `Android/data/com.madar.rep.app/files/Pending/`. Android can remove this copy when the app is uninstalled; it is not a user-visible shared gallery. The app restores a missing IndexedDB visit from that copy after the same rep account signs in.
- Select **أون ديوتي** to start the foreground location service. Android 10+ requires the user to grant **Allow all the time** in app settings; Android 13+ also requests notifications. Android/OEM battery policies can still pause or stop background work.
- Location sampling adapts after three stationary minutes: browser polling slows from 12 seconds to 60 seconds; the Android foreground service slows from 5 seconds to 60 seconds. Both return to their faster interval when speed or displacement indicates movement. This is a battery-saving heuristic, not a guarantee of continuous background GPS; platform and OEM restrictions still apply.
- The native GPS bridge requests the GPS provider and checks Android's mock-location flag. Mock-location detection is a warning/control, not a guarantee against rooted devices, modified OS images, instrumentation, or other tampering. A photo watermark is likewise not tamper-proof evidence.
- The app does not request legacy `READ_EXTERNAL_STORAGE` or `WRITE_EXTERNAL_STORAGE` permissions. The external backup uses the app's own directory.

Test camera, precise GPS, mock-location warnings, duty tracking while backgrounded, offline shell recovery, backup restoration, and visit synchronization on a physical Android device before distributing the APK. No device-level test or signed release build is claimed by this packaging change.

The Windows verification recorded before the package-ID change completed `npm run android:sync`, which builds and synchronizes the Capacitor assets/plugins. It did not compile an APK: Java/JDK, Android SDK environment variables, and SDK tooling were unavailable on that workstation. A successful sync is not evidence of Gradle compilation, signing, installation, update compatibility, or handset behavior. The ignored `madar-rep.apk` present in the workspace predates the new package ID and must not be treated as the new build.
