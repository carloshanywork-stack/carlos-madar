# MADAR Rep Android packaging

This packages the existing field-representative UI in a Capacitor Android shell. It does not move business data or uploaded photos to a cloud service. The app talks to the MADAR server configured by `MADAR_REP_SERVER_URL`.

## Requirements

- Node.js 22 or newer.
- JDK 21 or newer; set `JAVA_HOME` to its installation directory.
- Android SDK with platform 36 and the matching Android Build Tools installed; set `ANDROID_HOME` or `ANDROID_SDK_ROOT`.
- Install the project and client dependencies from `madar-v2/`:

  ```powershell
  npm ci
  npm --prefix client ci
  ```

## Local USB/emulator build

1. In `madar-v2/.env`, keep the default during local testing:

   ```dotenv
   MADAR_REP_SERVER_URL=http://localhost:3000
   ```

   `capacitor.config.ts` reads the value whenever Capacitor synchronizes. `localhost` on Android means the Android device itself, so keep the device attached and run this from a terminal with Android platform-tools:

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

The app loads the configured server URL. After the first successful online load, the service worker caches the UI shell and built assets for offline reopening; API requests, login validation, and visit synchronization still require the MADAR server. Keep `adb reverse` active while testing through USB. The build permits cleartext traffic only to `localhost`; use HTTPS for any non-local server. An authenticated Admin or representative can download the latest built debug APK from `/download/apk`; other roles are denied, and the endpoint returns 404 until the build artifact exists.

## Later Cloudflare Tunnel configuration

When the deployment URL is ready, set the full HTTPS origin in `madar-v2/.env`, for example:

```dotenv
MADAR_REP_SERVER_URL=https://rep.example.com
```

Then run `npm run android:sync` before building. The app loads UI/API from that host, so web UI changes can be served without rebuilding the APK. Changes to native Android code or Capacitor plugins still require a new APK. Do not put credentials or customer data in the URL.

## Native behavior and limits

- Android visit photos are captured with `CameraSource.Camera`; the Android rep screen does not offer a gallery picker. Browser-only file input remains available in the web version.
- A pending visit is stored in IndexedDB and copied under the app-specific external-files directory `Android/data/com.madar.rep/files/Pending/`. Android can remove this copy when the app is uninstalled; it is not a user-visible shared gallery. The app restores a missing IndexedDB visit from that copy after the same rep account signs in.
- Select **أون ديوتي** to start the foreground location service. Android 10+ requires the user to grant **Allow all the time** in app settings; Android 13+ also requests notifications. Android/OEM battery policies can still pause or stop background work.
- The native GPS bridge requests the GPS provider and checks Android's mock-location flag. Mock-location detection is a warning/control, not a guarantee against rooted devices, modified OS images, instrumentation, or other tampering. A photo watermark is likewise not tamper-proof evidence.
- The app does not request legacy `READ_EXTERNAL_STORAGE` or `WRITE_EXTERNAL_STORAGE` permissions. The external backup uses the app's own directory.

Test camera, precise GPS, mock-location warnings, duty tracking while backgrounded, offline shell recovery, backup restoration, and visit synchronization on a physical Android device before distributing the APK. No device-level test or signed release build is claimed by this packaging change.
