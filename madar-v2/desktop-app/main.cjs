const { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('node:http');
const https = require('node:https');
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { join, extname } = require('node:path');

const APP_ID = 'com.madar.desktop';
let mainWindow;
let settingsWindow;
let loopbackServer;
let loopbackOrigin = '';
let currentServerOrigin = '';
let defaultServerOrigin = '';
let updateCheckInProgress = false;
let updatePromptOpen = false;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function getUserConfigPath() {
  return join(app.getPath('userData'), 'server-config.json');
}

function isLocalAddress(hostname) {
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (hostname.endsWith('.local')) return true;
  return false;
}

function validateServerUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('The configured MADAR server URL is invalid.'); }
  const local = isLocalAddress(url.hostname);
  if ((!local && url.protocol !== 'https:') || (local && !['http:', 'https:'].includes(url.protocol))
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('The Windows app requires an HTTPS server origin (HTTP is allowed only for localhost and local network).');
  }
  return url;
}

function readConfig() {
  let baseConfig = {
    serverUrl: process.env.MADAR_DESKTOP_SERVER_URL || 'http://127.0.0.1:3000',
    updateUrl: process.env.MADAR_DESKTOP_UPDATE_URL || '',
    releaseBuild: false,
  };

  if (app.isPackaged) {
    try {
      baseConfig = JSON.parse(readFileSync(join(app.getAppPath(), 'runtime-config.json'), 'utf8'));
    } catch {
      // If runtime-config is missing or unreadable, fall back to default
    }
  }

  defaultServerOrigin = validateServerUrl(baseConfig.serverUrl || 'http://127.0.0.1:3000').origin;

  // Check for user-configured server URL saved in userData
  try {
    const userConfigFile = getUserConfigPath();
    if (existsSync(userConfigFile)) {
      const userConfig = JSON.parse(readFileSync(userConfigFile, 'utf8'));
      if (userConfig?.serverUrl) {
        baseConfig.serverUrl = userConfig.serverUrl;
      }
    }
  } catch (err) {
    console.warn('Could not read user server config:', err.message);
  }

  currentServerOrigin = validateServerUrl(baseConfig.serverUrl).origin;
  if (!baseConfig.updateUrl && currentServerOrigin) {
    baseConfig.updateUrl = `${currentServerOrigin}/download/desktop/`;
  } else if (baseConfig.updateUrl && !baseConfig.updateUrl.endsWith('/')) {
    baseConfig.updateUrl = `${baseConfig.updateUrl}/`;
  }
  return baseConfig;
}

const config = readConfig();

function configureAutoUpdater() {
  let targetUpdateUrl = config.updateUrl || (currentServerOrigin ? `${currentServerOrigin}/download/desktop/` : '');
  if (!targetUpdateUrl) return false;
  if (!targetUpdateUrl.endsWith('/')) targetUpdateUrl = `${targetUpdateUrl}/`;
  try {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: targetUpdateUrl,
    });
    return true;
  } catch (err) {
    console.warn('Could not set autoUpdater feed URL:', err.message);
    return false;
  }
}

function isTrustedUrl(value) {
  try {
    const origin = new URL(value).origin;
    return origin === loopbackOrigin || origin === currentServerOrigin;
  } catch {
    return false;
  }
}

function getWebDirectory() {
  const packagedWeb = join(__dirname, 'web');
  if (existsSync(packagedWeb)) return packagedWeb;
  const devClientDist = join(__dirname, '../client/dist');
  if (existsSync(devClientDist)) return devClientDist;
  return packagedWeb;
}

function proxyRequest(req, res, targetOrigin) {
  let target;
  try {
    target = new URL(req.url, targetOrigin);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'INVALID_URL' }));
    return;
  }

  const client = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers };
  delete headers.host;
  headers['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';
  headers['x-forwarded-proto'] = 'http';
  headers['x-forwarded-host'] = req.headers.host || '127.0.0.1';

  const proxyReq = client.request(target, {
    method: req.method,
    headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      error: 'SERVER_UNREACHABLE',
      message: 'تعذر الاتصال بخادم MADAR على العنوان المحدد. يرجى التحقق من تشغيل السيرفر أو تعديل عنوان الخادم في الإعدادات.',
      target: targetOrigin,
      code: err.code || 'UNKNOWN',
    }));
  });

  req.pipe(proxyReq);
}

function startLoopbackServer() {
  return new Promise((resolve, reject) => {
    const webDir = getWebDirectory();

    loopbackServer = http.createServer((req, res) => {
      const pathname = (req.url || '/').split('?')[0];

      // Proxy API, storage, and update endpoints to the configured backend server
      if (pathname.startsWith('/api/') || pathname.startsWith('/storage/') || pathname.startsWith('/download/')) {
        proxyRequest(req, res, currentServerOrigin);
        return;
      }

      // Serve static client assets
      let candidatePath = join(webDir, pathname === '/' ? 'index.html' : pathname.replace(/^\//, ''));
      if (!candidatePath.startsWith(webDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      if (existsSync(candidatePath) && !candidatePath.endsWith('/')) {
        try {
          const content = readFileSync(candidatePath);
          const ext = extname(candidatePath).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, {
            'Content-Type': contentType,
            'Cache-Control': candidatePath.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
          });
          res.end(content);
          return;
        } catch (readErr) {
          console.error('Error reading asset:', candidatePath, readErr.message);
        }
      }

      // SPA Navigation fallback: any non-file request routes to index.html
      const indexPath = join(webDir, 'index.html');
      if (existsSync(indexPath)) {
        try {
          const html = readFileSync(indexPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
          });
          res.end(html);
          return;
        } catch (indexErr) {
          console.error('Error reading index.html:', indexErr.message);
        }
      }

      // If no bundled web client exists, serve offline diagnostics
      const offlinePath = join(__dirname, 'offline.html');
      if (existsSync(offlinePath)) {
        const fallback = readFileSync(offlinePath, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(fallback);
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('تطبيق MADAR - الواجهة المحلية قيد التجهيز.');
      }
    });

    loopbackServer.listen(0, '127.0.0.1', () => {
      const port = loopbackServer.address().port;
      loopbackOrigin = `http://127.0.0.1:${port}`;
      resolve(loopbackOrigin);
    });

    loopbackServer.on('error', reject);
  });
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
  const configured = configureAutoUpdater();
  if (!app.isPackaged || !configured) {
    if (manual && mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'التحقق من التحديثات',
        message: 'قناة تحديث تطبيق Windows لم تُجهّز بعد.',
        detail: 'سيظل بإمكانك استخدام إصدار MADAR الحالي دون انقطاع.',
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
    if (manual && (!result || result.isUpdateAvailable === false) && mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'التحقق من التحديثات',
        message: 'تطبيق MADAR محدّث بالفعل.',
        detail: `أنت تستخدم أحدث إصدار متاح (${app.getVersion() || '1.0.0'}).`,
        buttons: ['حسناً'],
        noLink: true,
      });
    }
  } catch (error) {
    console.error('MADAR desktop update check failed:', error);
    if (manual && mainWindow) {
      await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: 'تعذر التحقق من التحديثات',
        message: 'لم نتمكن من الوصول إلى قناة التحديث الآن.',
        detail: 'بياناتك لم تتأثر. تحقق من اتصال السيرفر وحاول لاحقاً.',
        buttons: ['حسناً'],
        noLink: true,
      });
    }
  } finally {
    updateCheckInProgress = false;
  }
}

function openServerSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 540,
    height: 520,
    minWidth: 460,
    minHeight: 460,
    parent: mainWindow || undefined,
    modal: Boolean(mainWindow),
    title: 'إعدادات الاتصال بالخادم - MADAR',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  void settingsWindow.loadFile(join(__dirname, 'server-settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'MADAR',
      submenu: [
        {
          label: 'إعدادات الاتصال بالخادم...',
          accelerator: 'CmdOrCtrl+Alt+S',
          click: () => openServerSettingsWindow(),
        },
        {
          label: 'إعادة تحميل الواجهة',
          accelerator: 'CmdOrCtrl+R',
          click: () => { if (mainWindow) mainWindow.reload(); },
        },
        { type: 'separator' },
        { role: 'quit', label: 'إغلاق MADAR' },
      ],
    },
    {
      label: 'مساعدة',
      submenu: [
        { label: 'التحقق من وجود تحديث', click: () => { void checkForUpdates({ manual: true }); } },
        { type: 'separator' },
        { label: 'فتح MADAR في المتصفح', click: () => { void shell.openExternal(currentServerOrigin); } },
      ],
    },
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
    backgroundColor: '#0f172a',
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

  mainWindow.webContents.on('did-fail-load', (_event, errorCode) => {
    // If loading fails (-3 is aborted by navigation reload), show offline diagnostic page
    if (errorCode !== -3 && mainWindow && !mainWindow.isDestroyed()) {
      void mainWindow.loadFile(join(__dirname, 'offline.html'));
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Load the local loopback server URL, rendering local web assets instantly
  void mainWindow.loadURL(loopbackOrigin || currentServerOrigin);
}

app.setAppUserModelId(APP_ID);
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
});

ipcMain.handle('madar:desktop:version', () => app.getVersion());
ipcMain.handle('madar:desktop:check-updates', () => checkForUpdates({ manual: true }));
ipcMain.handle('madar:desktop:get-server-config', () => ({
  serverUrl: currentServerOrigin,
  defaultServerUrl: defaultServerOrigin,
  isConfigured: existsSync(getUserConfigPath()),
}));

ipcMain.handle('madar:desktop:set-server-config', (_event, payload) => {
  if (!payload?.serverUrl) throw new Error('يرجى تحديد عنوان خادم صحيح.');
  const validated = validateServerUrl(payload.serverUrl);
  currentServerOrigin = validated.origin;
  config.serverUrl = currentServerOrigin;
  config.updateUrl = `${currentServerOrigin}/download/desktop/`;
  configureAutoUpdater();
  const userConfigPath = getUserConfigPath();
  writeFileSync(userConfigPath, JSON.stringify({ serverUrl: currentServerOrigin }, null, 2), { encoding: 'utf8', mode: 0o600 });
  return { ok: true, serverUrl: currentServerOrigin };
});

ipcMain.handle('madar:desktop:test-server', async (_event, targetUrl) => {
  const start = Date.now();
  let parsed;
  try {
    parsed = validateServerUrl(targetUrl);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const healthUrl = new URL('/api/health', parsed.origin);
  const client = healthUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve) => {
    const req = client.get(healthUrl, { timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const latencyMs = Date.now() - start;
        if (res.statusCode === 200) {
          try {
            const body = JSON.parse(data);
            resolve({ ok: true, status: 200, service: body.service || 'MADAR V2', latencyMs });
          } catch {
            resolve({ ok: true, status: 200, latencyMs });
          }
        } else {
          resolve({ ok: false, status: res.statusCode, latencyMs, error: `رمز الاستجابة: ${res.statusCode}` });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'انتهت مهلة الاتصال بالخادم (4 ثوانٍ)' });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: err.code === 'ECONNREFUSED' ? 'تم رفض الاتصال (السيرفر غير مشغل)' : err.message });
    });
  });
});

ipcMain.handle('madar:desktop:open-server-settings', () => {
  openServerSettingsWindow();
  return true;
});

ipcMain.handle('madar:desktop:reload', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.reload();
  }
  return true;
});

let appTray = null;

function createTray() {
  const iconPath = join(__dirname, 'web/icon-192.png');
  if (!existsSync(iconPath)) return;
  try {
    appTray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'فتح MADAR ERP', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { label: 'إعدادات الاتصال بالخادم...', click: () => openServerSettingsWindow() },
      { type: 'separator' },
      { label: 'خروج', click: () => { app.isQuitting = true; app.quit(); } },
    ]);
    appTray.setToolTip('MADAR ERP - نظام مدار لإدارة العمليات');
    appTray.setContextMenu(contextMenu);
    appTray.on('double-click', () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {
    console.warn('Could not initialize system tray:', err.message);
  }
}

ipcMain.handle('madar:desktop:get-printers', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return [];
  return mainWindow.webContents.getPrintersAsync();
});

ipcMain.handle('madar:desktop:print-silent', async (_event, options = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('لا توجد نافذة نشطة للطباعة.');
  return new Promise((resolve, reject) => {
    mainWindow.webContents.print(
      {
        silent: options.silent !== false,
        printBackground: true,
        deviceName: options.deviceName || '',
        margins: options.margins || { marginType: 'printableArea' },
        copies: options.copies || 1,
      },
      (success, failureReason) => {
        if (!success) reject(new Error(failureReason || 'تعذرت الطباعة المباشرة.'));
        else resolve({ success: true });
      },
    );
  });
});

ipcMain.handle('madar:desktop:notification', (_event, payload = {}) => {
  if (Notification && Notification.isSupported()) {
    const notif = new Notification({
      title: payload.title || 'MADAR ERP',
      body: payload.body || '',
      icon: join(__dirname, 'web/icon-192.png'),
      silent: Boolean(payload.silent),
    });
    notif.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
    notif.show();
    return { shown: true };
  }
  return { shown: false };
});

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (info) => { void showUpdateAvailable(info); });
autoUpdater.on('error', (error) => console.error('MADAR desktop updater:', error));

// Toast notifications for update lifecycle
autoUpdater.on('checking-for-update', () => {
  new Notification({ title: 'MADAR', body: 'Checking for updates…' }).show();
});
autoUpdater.on('update-available', (info) => {
  new Notification({ title: 'MADAR', body: `Update ${info.version} available` }).show();
});
autoUpdater.on('update-downloaded', (info) => {
  new Notification({ title: 'MADAR', body: `Update ${info.version} downloaded – restarting` }).show();
});
configureAutoUpdater();

app.whenReady().then(async () => {
  createMenu();
  createTray();
  try {
    await startLoopbackServer();
  } catch (err) {
    console.error('Could not start internal loopback server:', err);
  }
  createWindow();
  if (app.isPackaged && config.updateUrl) {
    setTimeout(() => { void checkForUpdates(); }, 5000);
  }
});

function reportDesktopCrash(error, context = 'uncaughtException') {
  try {
    const errorUuid = require('node:crypto').randomUUID();
    const bugPayload = {
      reportUuid: errorUuid,
      category: 'bug',
      severity: 'critical',
      description: `Desktop ${context}: ${error?.message || String(error)}`,
      screenName: 'desktop/main',
      appVersion: app.getVersion() || '2.0.0',
      deviceModel: `Windows ${process.platform} ${process.arch}`,
      androidVersion: process.getSystemVersion() || 'Windows',
      logs: `${error?.stack || ''}\nContext: ${context}\nMemory: ${JSON.stringify(process.memoryUsage())}`,
    };
    const storageBugsDir = process.env.STORAGE_ROOT_PATH ? join(process.env.STORAGE_ROOT_PATH, 'bugs') : '/mnt/madar-storage/madar-storage/bugs';
    if (existsSync(storageBugsDir)) {
      writeFileSync(join(storageBugsDir, `desktop-${errorUuid}.json`), JSON.stringify(bugPayload, null, 2), 'utf8');
    }
  } catch (err) {
    console.error('Failed to log desktop crash:', err);
  }
}

process.on('uncaughtException', (err) => {
  console.error('Unhandled desktop exception:', err);
  reportDesktopCrash(err, 'uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled desktop rejection:', reason);
  reportDesktopCrash(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection');
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('window-all-closed', () => {
  if (loopbackServer) {
    try { loopbackServer.close(); } catch { }
  }
  if (process.platform !== 'darwin') app.quit();
});
