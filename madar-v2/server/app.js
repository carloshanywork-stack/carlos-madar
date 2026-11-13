import { runtimeIdentity } from './config/runtime-identity.js';
import cors from 'cors';
import express from 'express';
import { existsSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { env } from './config/env.js';
import { clientDistPath, repApkPath, repTransitionApkPath } from './config/paths.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requireAuthentication } from './modules/auth/service.js';
import authRouter from './modules/auth/routes.js';
import usersRouter from './modules/auth/users.js';
import systemRouter from './modules/system/backup.js';
import auditRouter from './modules/system/audit-routes.js';
import { requestLogger } from './middleware/request-logger.js';
import clientsRouter from './modules/clients/routes.js';
import maintenanceRouter from './modules/maintenance/routes.js';
import workshopRouter from './modules/workshop/routes.js';
import warehouseRouter from './modules/warehouse/routes.js';
import financeRouter from './modules/finance/routes.js';
import employeesRouter from './modules/employees/routes.js';
import staffRouter from './modules/employees/staff-routes.js';
import attendanceRouter from './modules/employees/attendance-routes.js';
import repRouter from './modules/rep/routes.js';
import supervisorRouter from './modules/supervisor/routes.js';
import notificationsRouter from './modules/notifications/routes.js';

export const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.trustProxyHops);

function canonicalHost(host, protocol) {
  if (!host) return null;
  try {
    return new URL(`${protocol}//${host}`).host.toLowerCase();
  } catch {
    return null;
  }
}

function isCorsOriginAllowed(origin, req) {
  if (!origin) return true;
  if (env.corsOrigins.includes(origin)) return true;

  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsedOrigin.protocol)
      || parsedOrigin.username || parsedOrigin.password
      || parsedOrigin.origin !== origin
      || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash) return false;

  const originHost = parsedOrigin.host.toLowerCase();
  if (originHost === canonicalHost(req.get('host'), parsedOrigin.protocol)) return true;

  // Express only trusts X-Forwarded-* when the immediate peer is covered by
  // TRUST_PROXY_HOPS. Do not let an arbitrary client opt itself into CORS.
  const trustProxy = req.app.get('trust proxy fn');
  const forwardedHostIsTrusted = typeof trustProxy === 'function'
    && trustProxy(req.socket?.remoteAddress, 0);
  if (forwardedHostIsTrusted) {
    const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
    if (originHost === canonicalHost(forwardedHost, parsedOrigin.protocol)) return true;
  }

  if (parsedOrigin.protocol === 'https:') {
    const hostname = parsedOrigin.hostname.toLowerCase();
    if (env.corsTailscaleSuffixes.some((suffix) => hostname.length > suffix.length && hostname.endsWith(suffix))) {
      return true;
    }
  }
  return false;
}

app.use((req, res, next) => cors({
  origin(origin, callback) {
    callback(null, isCorsOriginAllowed(origin, req));
  },
  credentials: true,
  exposedHeaders: ['Content-Disposition'],
})(req, res, next));
app.use(express.json({ limit: '1mb' }));
app.use(requestLogger);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'madar-v2', ...runtimeIdentity });
});

app.get('/download/apk', requireAuthentication, (req, res, next) => {
  if (!['admin', 'rep'].includes(req.user?.role)) {
    res.status(403).json({ error: 'Administrator or field representative access is required.' });
    return;
  }
  if (!existsSync(repApkPath)) {
    res.status(404).json({ error: 'The representative APK has not been built on this server.' });
    return;
  }
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/vnd.android.package-archive',
  });
  res.download(repApkPath, 'madar-rep.apk', (error) => {
    if (error && !res.headersSent) next(error);
  });
});

app.get('/download/apk/debug-transition', requireAuthentication, (req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required for the legacy debug transition APK.' });
    return;
  }
  if (!existsSync(repTransitionApkPath)) {
    res.status(404).json({ error: 'The legacy debug transition APK has not been built on this server.' });
    return;
  }
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/vnd.android.package-archive',
  });
  res.download(repTransitionApkPath, 'madar-rep-debug-transition.apk', (error) => {
    if (error && !res.headersSent) next(error);
  });
});

app.get('/download/apk/status', requireAuthentication, (req, res) => {
  if (!['admin', 'rep'].includes(req.user?.role)) {
    res.status(403).json({ error: 'Administrator or field representative access is required.' });
    return;
  }

  try {
    const metadata = statSync(repApkPath);
    if (!metadata.isFile()) throw new Error('APK artifact is not a regular file.');
    const artifactType = basename(repApkPath) === 'madar-rep-release.apk' ? 'release' : 'fallback';
    res.set('Cache-Control', 'private, no-store').json({
      available: true,
      artifactType,
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
      ...(req.user?.role === 'admin' ? { transitionAvailable: existsSync(repTransitionApkPath) } : {}),
    });
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
      res.status(500).json({ error: 'Unable to inspect the representative APK artifact.' });
      return;
    }
    res.set('Cache-Control', 'private, no-store').json({
      available: false,
      artifactType: 'missing',
      sizeBytes: null,
      modifiedAt: null,
      ...(req.user?.role === 'admin' ? { transitionAvailable: existsSync(repTransitionApkPath) } : {}),
    });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/rep', repRouter);
app.use('/api', requireAuthentication);
// Representatives may read and update only their own notification inbox, so
// this router stays ahead of the business-route restriction below.
app.use('/api/notifications', notificationsRouter);
app.use('/api', (req, res, next) => {
  if (req.user?.role === 'rep') {
    res.status(403).json({ error: 'Field representative accounts may only access /api/rep endpoints.' });
    return;
  }
  next();
});
app.use('/api/users', usersRouter);
app.use('/api/auth/users', usersRouter);
app.use('/api/system', auditRouter);
app.use('/api/system', systemRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/maintenance', maintenanceRouter);
app.use('/api/workshop', workshopRouter);
app.use('/api/warehouse', warehouseRouter);
app.use('/api/finance', financeRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/staff', staffRouter);
app.use('/api/attendance', attendanceRouter);
app.use('/api/supervisor', supervisorRouter);

if (existsSync(join(clientDistPath, 'index.html'))) {
  app.use(express.static(clientDistPath, { index: false }));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || req.path === '/api' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    const hasHiddenPathSegment = req.path.split('/').some((segment) => segment.startsWith('.') && segment !== '.well-known');
    if (hasHiddenPathSegment) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    // A missing build asset must never masquerade as a successful SPA response.
    if (req.path.startsWith('/assets/') || /\.[a-z0-9]{1,12}$/i.test(req.path)) {
      res.status(404).type('text/plain').send('Asset not found');
      return;
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(join(clientDistPath, 'index.html'), (error) => {
      if (error && !res.headersSent) next(error);
    });
  });
}

app.use(notFoundHandler);
app.use(errorHandler);
