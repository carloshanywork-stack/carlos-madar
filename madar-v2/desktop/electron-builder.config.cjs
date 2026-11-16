const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const publisherName = process.env.MADAR_WINDOWS_PUBLISHER_NAME?.trim();
const publishUrl = process.env.MADAR_DESKTOP_UPDATE_URL?.trim();
const releaseBuild = process.env.MADAR_DESKTOP_RELEASE_BUILD === 'true';
const buildLock = JSON.parse(readFileSync(join(__dirname, '../desktop-build/package-lock.json'), 'utf8'));
const electronVersion = buildLock.packages['node_modules/electron']?.version;
if (!electronVersion) throw new Error('The isolated desktop-build lockfile must pin Electron.');

module.exports = {
  appId: 'com.madar.desktop',
  productName: 'MADAR',
  electronVersion,
  directories: {
    app: 'desktop-app',
    output: 'build/windows',
  },
  files: ['**/*'],
  extraMetadata: {
    main: 'main.cjs',
  },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'MADAR-Windows-${version}-Setup.${ext}',
    icon: 'desktop/madar.ico',
    forceCodeSigning: releaseBuild,
  },
  nsis: {
    installerIcon: 'desktop/madar.ico',
    uninstallerIcon: 'desktop/madar.ico',
    oneClick: false,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    deleteAppDataOnUninstall: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'MADAR',
  },
  ...(publishUrl ? {
    publish: [{
      provider: 'generic',
      url: publishUrl,
      ...(publisherName ? { publisherName: [publisherName] } : {}),
    }],
  } : {}),
};
