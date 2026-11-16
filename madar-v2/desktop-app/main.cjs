const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const APP_ID = 'com.madar.desktop';
let mainWindow;
let updateCheckInProgress = false;
let updatePromptOpen = false;

function readConfig() {
  if (app.isPackaged) {
    try {
      return JSON.parse(readFileSync(join(app.getAppPath(), 'runtime-config.json'), 'utf8'));
    } catch (error) {
      throw new Error(`Windows app configuration is missing or invalid: ${error.message}`);
    }
  }
  return {
    serverUrl: process.env.MADAR_DESKTOP_SERVER_URL || 'http://127.0.0.1:3000',
    updateUrl: process.env.MADAR_DESKTOP_UPDATE_URL || '',
  };
}

function validateServerUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('The configured MADAR server URL is invalid.'); }
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if ((!localHost && url.protocol !== 'https:') || (localHost && !['http:', 'https:'].includes(url.protocol))
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('The Windows app requires an HTTPS server origin (HTTP is allowed only for localhost).');
  }
  return url;
}

const config = readConfig();
const serverOrigin = validateServerUrl(config.serverUrl).origin;

function isTrustedUrl(value) {
  try { return new URL(value).origin === serverOrigin; } catch { return false; }
}

async function showUpdateAvailable(info) {
  if (updatePromptOpen || !mainWindow) return;
  updatePromptOpen = true;
  try {
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'تحديث MADAR متاح',
      message: `يتوفر تحديث جديد للتطبيق (${info.version}).`,
      detail: `${info.releaseName || 'تحسينات وتحديثات للنظام'}\nالتحديث لا يستبدل بيانات السيرفر أو إعدادات التطبيق. احفظ أي تعديل جارٍ قبل إعادة التشغيل.`,
      buttons: ['تنزيل الآن', 'لاحقاً'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (result.response === 0) {
      await autoUpdater.downloadUpdate();
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'اكتمل تنزيل التحديث',
        message: 'تم تنزيل التحديث والتحقق منه.',
        detail: 'سيُثبّت عند إغلاق التطبيق أو يمكنك إعادة تشغيل MADAR الآن.',
        buttons: ['إعادة التشغيل الآن', 'لاحقاً'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      }).then((choice) => {
        if (choice.response === 0) autoUpdater.quitAndInstall(false, true);
      });
    }
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'تعذر تنزيل التحديث',
      message: 'لم يكتمل تنزيل تحديث MADAR.',
      detail: 'بيانات العمل على السيرفر لم تتغير. تحقق من الاتصال وحاول لاحقاً.',
      buttons: ['حسناً'],
      noLink: true,
    });
    console.error('MADAR desktop update failed:', error);
  } finally {
    updatePromptOpen = false;
  }
}

async function checkForUpdates({ manual = false } = {}) {
  if (!app.isPackaged || !config.updateUrl) {
    if (manual && mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'التحقق من التحديثات',
        message: 'قناة تحديث تطبيق Windows لم تُجهّز بعد.',
        detail: 'سيظل بإمكانك استخدام إصدار MADAR الحالي.',
        buttons: ['حسناً'],
        noLink: true,
      });
    }
    return;
  }
  if (updateCheckInProgress) return;
  updateCheckInProgress = true;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (manual && result?.isUpdateAvailable === false && mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info', title: 'التحقق من التحديثات',
        message: 'تطبيق MADAR محدّث بالفعل.', buttons: ['حسناً'], noLink: true,
      });
    }
  } catch (error) {
    console.error('MADAR desktop update check failed:', error);
    if (manual && mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: 'warning', title: 'تعذر التحقق من التحديثات',
        message: 'لم نتمكن من الوصول إلى قناة التحديث الآن.',
        detail: 'بياناتك لم تتأثر. تحقق من اتصال السيرفر وحاول لاحقاً.',
        buttons: ['حسناً'], noLink: true,
      });
    }
  } finally {
    updateCheckInProgress = false;
  }
}

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'MADAR', submenu: [{ role: 'quit', label: 'إغلاق MADAR' }] },
    { label: 'مساعدة', submenu: [
      { label: 'التحقق من وجود تحديث', click: () => { void checkForUpdates({ manual: true }); } },
      { type: 'separator' },
      { label: 'فتح MADAR في المتصفح', click: () => { void shell.openExternal(serverOrigin); } },
    ] },
  ]));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    title: 'MADAR',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedUrl(url)) {
      void mainWindow.loadURL(url);
    } else if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  mainWindow.on('closed', () => { mainWindow = null; });
  void mainWindow.loadURL(serverOrigin);
}

app.setAppUserModelId(APP_ID);
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

ipcMain.handle('madar:desktop:version', () => app.getVersion());
ipcMain.handle('madar:desktop:check-updates', () => checkForUpdates({ manual: true }));

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (info) => { void showUpdateAvailable(info); });
autoUpdater.on('error', (error) => console.error('MADAR desktop updater:', error));

app.whenReady().then(() => {
  createMenu();
  createWindow();
  if (app.isPackaged && config.updateUrl) {
    setTimeout(() => { void checkForUpdates(); }, 5000);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
