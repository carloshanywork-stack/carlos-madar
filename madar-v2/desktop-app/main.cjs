const { app, BrowserWindow, dialog, ipcMain, Menu, shell, Tray, Notification } = require('electron');
const { autoUpdater } = require('electron-updater');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join, extname, dirname } = require('node:path');

const APP_ID = 'com.madar.desktop';
const INTERNAL_TOKEN = crypto.randomBytes(32).toString('hex');
let mainWindow;
let settingsWindow;
let loopbackServer;
let loopbackOrigin = '';
let loopbackPort = 0;
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
    autoUpdater.verifyUpdateCodeSignature = false;
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

function getUserWebCacheDir() {
  try {
    if (app && typeof app.getPath === 'function') {
      try {
        const appData = app.getPath('appData');
        if (appData) return join(appData, 'madar-web-cache');
      } catch { }
      return join(app.getPath('userData'), 'madar-web-cache');
    }
    return join(__dirname, 'web');
  } catch {
    return join(__dirname, 'web');
  }
}

function getPackagedWebDirectory() {
  const packagedWeb = join(__dirname, 'web');
  if (existsSync(packagedWeb)) return packagedWeb;
  const devClientDist = join(__dirname, '../client/dist');
  if (existsSync(devClientDist)) return devClientDist;
  return packagedWeb;
}

function getWebDirectory() {
  const cacheDir = getUserWebCacheDir();
  if (existsSync(join(cacheDir, 'index.html'))) {
    return cacheDir;
  }
  return getPackagedWebDirectory();
}

function initWebCache() {
  try {
    const cacheDir = getUserWebCacheDir();
    if (!existsSync(cacheDir)) {
      mkdirSync(cacheDir, { recursive: true });
    }
    const indexCachePath = join(cacheDir, 'index.html');
    if (!existsSync(indexCachePath)) {
      const packagedDir = getPackagedWebDirectory();
      if (existsSync(join(packagedDir, 'index.html'))) {
        cpSync(packagedDir, cacheDir, { recursive: true });
        console.log('[WebCache] Initialized cache from bundled web assets.');
      }
    }
  } catch (err) {
    console.warn('[WebCache] Could not initialize web cache:', err.message);
  }
}

async function fetchLiveIndexHtml(targetOrigin, timeoutMs = 2500) {
  try {
    const url = new URL('/', targetOrigin).toString();
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': `MADAR-Desktop/${app.getVersion() || '1.0.1'}`,
      },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;
    const html = await res.text();
    if (html && (html.includes('<!DOCTYPE html') || html.includes('<html'))) {
      return html;
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchLiveAsset(pathname, targetOrigin, timeoutMs = 8000) {
  try {
    const cleanPath = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const url = new URL(cleanPath, targetOrigin).toString();
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'User-Agent': `MADAR-Desktop/${app.getVersion() || '1.0.1'}`,
      },
    });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get('content-type') || '';
    return { buffer, contentType };
  } catch {
    return null;
  }
}

const prefetchInProgress = new Set();

function triggerBackgroundAssetPrefetch(htmlContent, targetOrigin) {
  if (!htmlContent || !targetOrigin) return;
  const assetRegex = /(?:src|href)=["'](\/assets\/[^"'\s>]+)["']/g;
  const matchedAssets = new Set();
  let match;
  while ((match = assetRegex.exec(htmlContent)) !== null) {
    matchedAssets.add(match[1]);
  }

  const cacheDir = getUserWebCacheDir();
  for (const assetPath of matchedAssets) {
    const localFile = join(cacheDir, assetPath.replace(/^\//, ''));
    if (existsSync(localFile) || prefetchInProgress.has(assetPath)) {
      continue;
    }
    prefetchInProgress.add(assetPath);
    fetchLiveAsset(assetPath, targetOrigin, 10000)
      .then((result) => {
        if (result && result.buffer) {
          mkdirSync(dirname(localFile), { recursive: true });
          writeFileSync(localFile, result.buffer);
          console.log(`[Live Web Sync] Prefetched & cached: ${assetPath}`);
        }
      })
      .catch((err) => {
        console.warn(`[Live Web Sync] Failed to prefetch ${assetPath}:`, err.message);
      })
      .finally(() => {
        prefetchInProgress.delete(assetPath);
      });
  }
}

function proxyRequest(req, res, targetOrigin, redirectCount = 0) {
  if (redirectCount > 3) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'TOO_MANY_REDIRECTS' }));
    return;
  }
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
  delete headers['x-madar-internal-token'];
  headers['x-forwarded-for'] = req.socket.remoteAddress || '127.0.0.1';
  headers['x-forwarded-proto'] = 'http';
  headers['x-forwarded-host'] = req.headers.host || '127.0.0.1';

  const proxyReq = client.request(target, {
    method: req.method,
    headers,
  }, (proxyRes) => {
    if ([301, 302, 307, 308].includes(proxyRes.statusCode) && proxyRes.headers.location && ['GET', 'HEAD'].includes(req.method)) {
      try {
        const nextTarget = new URL(proxyRes.headers.location, target);
        if (nextTarget.origin === new URL(targetOrigin).origin) {
          req.url = nextTarget.pathname + nextTarget.search;
          proxyRes.resume();
          return proxyRequest(req, res, targetOrigin, redirectCount + 1);
        }
      } catch {
        // Fall back to piping redirect directly
      }
    }
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
    loopbackServer = http.createServer(async (req, res) => {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const pathname = parsedUrl.pathname;

      // 1. Proxy API, storage, and update endpoints to the configured backend server
      if (pathname.startsWith('/api/') || pathname.startsWith('/storage/') || pathname.startsWith('/download/')) {
        if (req.headers['x-madar-internal-token'] !== INTERNAL_TOKEN) {
          res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Forbidden: Unauthorized local caller');
          return;
        }
        proxyRequest(req, res, currentServerOrigin);
        return;
      }

      const cacheDir = getUserWebCacheDir();
      const packagedDir = getPackagedWebDirectory();

      // 2. Asset request (/assets/*)
      if (pathname.startsWith('/assets/')) {
        const relAsset = pathname.replace(/^\//, '');
        const cachedAssetPath = join(cacheDir, relAsset);
        const packagedAssetPath = join(packagedDir, relAsset);

        // Priority 1: User Web Cache
        if (existsSync(cachedAssetPath) && !cachedAssetPath.endsWith('/')) {
          try {
            const content = readFileSync(cachedAssetPath);
            const ext = extname(cachedAssetPath).toLowerCase();
            res.writeHead(200, {
              'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
              'Cache-Control': 'public, max-age=31536000, immutable',
            });
            res.end(content);
            return;
          } catch (err) {
            console.warn('Error reading cached asset:', err.message);
          }
        }

        // Priority 2: Packaged Web Assets
        if (existsSync(packagedAssetPath) && !packagedAssetPath.endsWith('/')) {
          try {
            const content = readFileSync(packagedAssetPath);
            const ext = extname(packagedAssetPath).toLowerCase();
            res.writeHead(200, {
              'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
              'Cache-Control': 'public, max-age=31536000, immutable',
            });
            res.end(content);
            return;
          } catch (err) {
            console.warn('Error reading packaged asset:', err.message);
          }
        }

        // Priority 3: Live fetch from server if connected
        if (currentServerOrigin) {
          try {
            const liveAsset = await fetchLiveAsset(pathname, currentServerOrigin, 8000);
            if (liveAsset && liveAsset.buffer) {
              try {
                mkdirSync(dirname(cachedAssetPath), { recursive: true });
                writeFileSync(cachedAssetPath, liveAsset.buffer);
              } catch (writeErr) {
                console.warn('Could not cache live asset to disk:', writeErr.message);
              }
              const ext = extname(cachedAssetPath).toLowerCase();
              res.writeHead(200, {
                'Content-Type': liveAsset.contentType || MIME_TYPES[ext] || 'application/octet-stream',
                'Cache-Control': 'public, max-age=31536000, immutable',
              });
              res.end(liveAsset.buffer);
              return;
            }
          } catch (fetchErr) {
            console.warn('Live asset fetch failed for', pathname, fetchErr.message);
          }
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Asset not found');
        return;
      }

      // 3. Static files with extensions (e.g. /favicon.ico, /icon-192.png, /manifest.webmanifest)
      const ext = extname(pathname).toLowerCase();
      if (ext && ext !== '.html') {
        const relFile = pathname.replace(/^\//, '');
        const cachedFile = join(cacheDir, relFile);
        const packagedFile = join(packagedDir, relFile);

        if (existsSync(cachedFile) && !cachedFile.endsWith('/')) {
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400',
          });
          res.end(readFileSync(cachedFile));
          return;
        }
        if (existsSync(packagedFile) && !packagedFile.endsWith('/')) {
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400',
          });
          res.end(readFileSync(packagedFile));
          return;
        }
        if (currentServerOrigin) {
          try {
            const liveFile = await fetchLiveAsset(pathname, currentServerOrigin, 5000);
            if (liveFile && liveFile.buffer) {
              try {
                mkdirSync(dirname(cachedFile), { recursive: true });
                writeFileSync(cachedFile, liveFile.buffer);
              } catch { }
              res.writeHead(200, {
                'Content-Type': liveFile.contentType || MIME_TYPES[ext] || 'application/octet-stream',
                'Cache-Control': 'public, max-age=86400',
              });
              res.end(liveFile.buffer);
              return;
            }
          } catch { }
        }
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      // 4. HTML / SPA Navigation (/ or /index.html or client routes)
      // Attempt live web sync if server is reachable
      let html = null;
      if (currentServerOrigin) {
        html = await fetchLiveIndexHtml(currentServerOrigin, 2500);
        if (html) {
          try {
            const cachedIndexPath = join(cacheDir, 'index.html');
            mkdirSync(cacheDir, { recursive: true });
            writeFileSync(cachedIndexPath, html, 'utf8');
            triggerBackgroundAssetPrefetch(html, currentServerOrigin);
          } catch (cacheWriteErr) {
            console.warn('Failed to write index.html to cache:', cacheWriteErr.message);
          }
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'X-Madar-Source': 'live-sync',
          });
          res.end(html);
          return;
        }
      }

      // Fallback 1: User Web Cache
      const cachedIndexPath = join(cacheDir, 'index.html');
      if (existsSync(cachedIndexPath)) {
        try {
          html = readFileSync(cachedIndexPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Madar-Source': 'offline-cache',
          });
          res.end(html);
          return;
        } catch (err) {
          console.warn('Failed to read cached index.html:', err.message);
        }
      }

      // Fallback 2: Packaged Web Assets
      const packagedIndexPath = join(packagedDir, 'index.html');
      if (existsSync(packagedIndexPath)) {
        try {
          html = readFileSync(packagedIndexPath, 'utf8');
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache',
            'X-Madar-Source': 'packaged-fallback',
          });
          res.end(html);
          return;
        } catch (err) {
          console.warn('Failed to read packaged index.html:', err.message);
        }
      }

      // Fallback 3: Offline Diagnostic page
      const offlinePath = join(__dirname, 'offline.html');
      if (existsSync(offlinePath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(readFileSync(offlinePath, 'utf8'));
      } else {
        res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('تطبيق MADAR - الواجهة المحلية قيد التجهيز.');
      }
    });

    loopbackServer.listen(0, '127.0.0.1', () => {
      const port = loopbackServer.address().port;
      loopbackPort = port;
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
      if (Notification && Notification.isSupported()) {
        new Notification({
          title: 'تحديث MADAR',
          body: `جارٍ تنزيل تحديث MADAR (${info.version})...`,
          icon: join(__dirname, 'web/icon-192.png'),
        }).show();
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(0.01);
      }

      try {
        await autoUpdater.downloadUpdate();
      } catch (diffErr) {
        console.warn('Differential download failed, retrying with full package download:', diffErr.message);
        autoUpdater.disableDifferentialDownload = true;
        await autoUpdater.downloadUpdate();
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }

      const choice = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'اكتمل تنزيل تحديث MADAR',
        message: `تم تنزيل الإصدار الجديد (${info.version}) وجاهز للتثبيت.`,
        detail: 'هل ترغب في إعادة تشغيل تطبيق MADAR الآن لتطبيق التحديث؟',
        buttons: ['إعادة التشغيل الآن', 'لاحقاً'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });

      if (choice.response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    }
  } catch (error) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
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
    if (url.includes('.apk') || url.includes('/download/apk')) {
      mainWindow.webContents.downloadURL(url);
      return { action: 'deny' };
    }
    if (isTrustedUrl(url)) {
      void mainWindow.loadURL(url);
    } else if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.includes('.apk') || url.includes('/download/apk')) {
      event.preventDefault();
      mainWindow.webContents.downloadURL(url);
      return;
    }
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

ipcMain.handle('madar:desktop:download-apk', async (_event, target) => {
  if (!mainWindow || mainWindow.isDestroyed()) throw new Error('لا توجد نافذة نشطة.');
  let targetUrl = target;
  if (!targetUrl || typeof targetUrl !== 'string') {
    targetUrl = `${currentServerOrigin}/download/apk`;
  } else if (targetUrl.startsWith('/')) {
    targetUrl = `${currentServerOrigin}${targetUrl}`;
  }
  mainWindow.webContents.downloadURL(targetUrl);
  return { ok: true, started: true, url: targetUrl };
});

function setupDownloadManager() {
  const { session } = require('electron');
  session.defaultSession.on('will-download', (event, item) => {
    const defaultFilename = item.getFilename() || 'madar-rep.apk';
    const filename = defaultFilename.endsWith('.apk') ? defaultFilename : `${defaultFilename}.apk`;
    const downloadsFolder = app.getPath('downloads');
    const savePath = join(downloadsFolder, filename);

    // Save directly to the user's Downloads folder without prompting
    item.setSavePath(savePath);

    item.on('updated', (_event, state) => {
      if (state === 'progressing') {
        if (!item.isPaused() && item.getTotalBytes() > 0 && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.setProgressBar(item.getReceivedBytes() / item.getTotalBytes());
        }
      }
    });

    item.once('done', (_event, state) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(-1);
      }
      if (state === 'completed') {
        if (Notification && Notification.isSupported()) {
          const notif = new Notification({
            title: 'اكتمل تنزيل تطبيق المندوب (APK)',
            body: `تم حفظ ${filename} بنجاح في مجلد التنزيلات.`,
            icon: join(__dirname, 'web/icon-192.png'),
          });
          notif.on('click', () => {
            shell.showItemInFolder(savePath);
          });
          notif.show();
        }
      } else {
        console.error(`Download ended with state: ${state}`);
      }
    });
  });
}

function setupSecurityHeaders() {
  const { session } = require('electron');
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    try {
      const url = new URL(details.url);
      const isLoopback = loopbackOrigin && (
        url.origin === loopbackOrigin ||
        ((url.hostname === '127.0.0.1' || url.hostname === 'localhost') && Number(url.port) === loopbackPort)
      );
      if (isLoopback) {
        details.requestHeaders['x-madar-internal-token'] = INTERNAL_TOKEN;
      }
    } catch {
      // Ignore URL parsing errors
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

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
autoUpdater.verifyUpdateCodeSignature = false;
autoUpdater.on('update-available', (info) => { void showUpdateAvailable(info); });
autoUpdater.on('error', (error) => console.error('MADAR desktop updater:', error));

autoUpdater.on('download-progress', (progressObj) => {
  const percent = progressObj.percent || 0;
  console.log(`[AutoUpdater] Download progress: ${percent.toFixed(1)}%`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setProgressBar(Math.max(0, Math.min(1, percent / 100)));
  }
});

autoUpdater.on('update-downloaded', (info) => {
  console.log(`[AutoUpdater] Update ${info.version} downloaded successfully.`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setProgressBar(-1);
  }
  if (Notification && Notification.isSupported()) {
    new Notification({
      title: 'MADAR ERP',
      body: `تم تنزيل تحديث ${info.version} بنجاح.`,
      icon: join(__dirname, 'web/icon-192.png'),
    }).show();
  }
});
configureAutoUpdater();

app.whenReady().then(async () => {
  initWebCache();
  setupDownloadManager();
  createMenu();
  createTray();
  try {
    await startLoopbackServer();
    setupSecurityHeaders();
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
