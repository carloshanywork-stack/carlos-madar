# MADAR Windows desktop pilot

This is the first Windows-client slice for MADAR V2. It opens the existing V2 manager web client in a dedicated Windows window and keeps the website available as a fallback. The client continues to use the configured V2 HTTPS server; business data remains on that server.

## Current pilot boundary

- Electron loads the same-origin V2 web application so its current login/session and API behavior remain intact during the proof of concept.
- The renderer has no Node.js integration. Context isolation, sandboxing, HTTPS, same-origin navigation, and external-link restrictions are enabled.
- A packaged app preserves its Electron user-data directory across upgrades and uninstall; the installer does not touch the server database or Ubuntu storage.
- Packaged builds can check a generic HTTPS `electron-updater` feed. When an update is found, MADAR asks before downloading, verifies the updater's package metadata/signature policy, and offers restart after download. It does not force-close an active session.
- The Settings page exposes a Windows update check only when running inside the desktop shell. The ordinary website remains unchanged.

This pilot intentionally does **not** bundle a local/offline copy of the React UI, add offline editing, publish an installer, or alter Android APKs. A Windows installer download button should only be exposed after an approved signed Windows artifact and server distribution route exist.

## Local development

Build the local client once, start the V2 server (it serves `client/dist`), then launch Electron in a second terminal:

```powershell
cd madar-v2
$env:NODE_ENV = 'development'
npm --prefix client run build
npm start
```

In a second PowerShell window:

```powershell
cd madar-v2
$env:MADAR_DESKTOP_SERVER_URL = 'http://127.0.0.1:3000'
npm run desktop:dev
```

For an unsigned local installer used only for a pilot:

```powershell
$env:MADAR_DESKTOP_SERVER_URL = 'https://your-approved-madar-host.example'
npm run desktop:build
```

The generated installer is written under `madar-v2/build/windows/`. The server URL is included in that build; it is not a credential. Do not distribute an installer built for localhost.

## Signed release and updates

Before `npm run desktop:release`, set these values in the protected Windows build environment:

- `MADAR_DESKTOP_SERVER_URL`: the approved production HTTPS origin (no path/query).
- `MADAR_DESKTOP_UPDATE_URL`: HTTPS directory that will serve the generated `latest.yml`, installer, and blockmap.
- `MADAR_WINDOWS_PUBLISHER_NAME`: exact Authenticode publisher name expected by Electron Builder/updater.
- One protected certificate source supported by Electron Builder: `CSC_LINK`, `WIN_CSC_LINK`, or `CSC_NAME`; set its password only in the protected CI secret store when required.

The release command refuses to package a release without an HTTPS server, HTTPS update feed, publisher identity, and signing certificate selector. Build/sign/publish Windows artifacts separately from Ubuntu backend deployment. Do not put a signing certificate, password, access token, or private feed credential in the app or repository.

The hosting/CDN must serve only reviewed release artifacts over HTTPS. Keep at least one known-good prior version for rollback. Test update, download interruption, signature mismatch, install, and rollback on a staging Windows machine before inviting users.

## Data safety and rollout

1. Keep the current web app and APKs available; this pilot adds a client, not a backend migration.
2. Confirm the target V2 host and authentication path, then test with a staging server before production distribution.
3. Verify upgrade-in-place preserves `%APPDATA%`/`%LOCALAPPDATA%` application data and server records. Do not test uninstall/restore against production data.
4. The present app still requires server connectivity for shared records. Offline read cache and queued writes are separate future milestones; no offline edit is accepted by this pilot.
5. Only after a signed release is available should Settings show a downloadable Windows installer beside the APKs.
