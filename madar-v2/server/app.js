import { runtimeIdentity } from './config/runtime-identity.js';
import cors from 'cors';
import express from 'express';
import { createHash } from 'node:crypto';
import {
  closeSync, constants as fsConstants, createReadStream, fstatSync, lstatSync, openSync, readFileSync, existsSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { env } from './config/env.js';
import { clientDistPath, managerApkPath, repApkPath, repTransitionApkPath, storageMountPath, storageRoot } from './config/paths.js';
import { db } from './database/connection.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requireAuthentication } from './modules/auth/service.js';
import authRouter from './modules/auth/routes.js';
import usersRouter from './modules/auth/users.js';
import systemRouter from './modules/system/backup.js';
import auditRouter from './modules/system/audit-routes.js';
import repSupportRouter from './modules/system/rep-support-routes.js';
import repReleaseRouter from './modules/system/rep-release-routes.js';
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
import { getStorageHealth } from './modules/system/health.js';

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

let lastDiskAlertAt = 0;
app.get('/api/health', async (req, res) => {
  const storage = await getStorageHealth({
    storagePath: storageMountPath ?? storageRoot,
    mountRequired: Boolean(storageMountPath),
  });
  if (storage.status === 'warning' && Date.now() - lastDiskAlertAt >= 5 * 60 * 1000) {
    lastDiskAlertAt = Date.now();
    console.error(`URGENT: MADAR storage free space is ${storage.freePercent}% (threshold ${storage.thresholdPercent}%).`);
  }
  const status = storage.status === 'error' ? 'warning' : storage.status;
  res.json({ status, service: 'madar-v2', storage, ...runtimeIdentity });
});

app.get('/api/app-version', (_req, res) => {
  const latest = db.prepare(`SELECT version_code AS versionCode, version_name AS versionName,
      apk_sha256 AS sha256, notes AS releaseNotes
    FROM apk_releases WHERE status = 'available' ORDER BY version_code DESC, id DESC LIMIT 1`).get();
  const latestVersionCode = latest ? Number(latest.versionCode) : 0;
  res.set({ 'Cache-Control': 'no-store', Pragma: 'no-cache' }).json({
    success: true,
    latestVersionCode,
    minSupportedVersionCode: env.repMinSupportedVersionCode,
    versionName: latest?.versionName ?? null,
    apkUrl: latest ? '/download/apk' : null,
    sha256: latest?.sha256 ?? null,
    releaseNotes: latest?.releaseNotes ?? '',
  });
});

app.use('/api', (req, res, next) => {
  if (!req.path.startsWith('/rep/') || req.path === '/rep/login'
      || env.repMinSupportedVersionCode === 0) {
    next();
    return;
  }
  const header = req.get('X-App-Version-Code');
  const clientVersionCode = /^\d{1,10}$/.test(header ?? '') ? Number(header) : 0;
  if (clientVersionCode >= env.repMinSupportedVersionCode) {
    next();
    return;
  }
  const latestRelease = db.prepare(`SELECT version_code AS versionCode, apk_sha256 AS sha256, notes AS releaseNotes
    FROM apk_releases WHERE status = 'available' ORDER BY version_code DESC, id DESC LIMIT 1`).get();
  const latestVersionCode = Number(latestRelease?.versionCode ?? 0);
  res.set({
    Upgrade: `MADAR/${env.repMinSupportedVersionCode}`,
    'Cache-Control': 'no-store',
  }).status(426).json({
    error: 'يجب تحديث تطبيق مدار للمتابعة.',
    code: 'APP_UPDATE_REQUIRED',
    latestVersionCode: Math.max(latestVersionCode, env.repMinSupportedVersionCode),
    minSupportedVersionCode: env.repMinSupportedVersionCode,
    apkUrl: '/download/apk',
    sha256: latestRelease?.sha256 ?? null,
    releaseNotes: latestRelease?.releaseNotes ?? '',
  });
});

function openRegularFileNoFollow(path) {
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile()) throw Object.assign(new Error('Artifact is not a regular file.'), { code: 'EUNSAFEPATH' });
  const noFollow = fsConstants.O_NOFOLLOW ?? 0;
  const descriptor = openSync(path, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || (!noFollow && (opened.dev !== before.dev || opened.ino !== before.ino))) {
      throw Object.assign(new Error('Artifact changed while it was opened.'), { code: 'EUNSAFEPATH' });
    }
    return { descriptor, metadata: opened };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function readVerifiedApkMetadata(apkPath, apkDescriptor, { required = false } = {}) {
  const manifestPath = `${apkPath}.manifest.json`;
  let manifestDescriptor;
  try {
    ({ descriptor: manifestDescriptor } = openRegularFileNoFollow(manifestPath));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      if (!required) return null;
      throw Object.assign(new Error('The release APK has no matching build metadata.'), { code: 'EAPKMETADATA' });
    }
    throw error;
  }
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestDescriptor, 'utf8')); }
  finally { closeSync(manifestDescriptor); }
  const apkBytes = readFileSync(apkDescriptor);
  const apkSha256 = createHash('sha256').update(apkBytes).digest('hex');
  if (!['release', 'debug'].includes(manifest?.buildType)
      || (required && (manifest.buildType !== 'release' || manifest.sourceTreeDirty !== false))
      || !Number.isSafeInteger(manifest?.versionCode) || manifest.versionCode < 1
      || typeof manifest.versionName !== 'string' || !manifest.versionName.trim() || manifest.versionName.length > 40
      || !/^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(manifest.sourceRevision ?? '')
      || !Number.isFinite(Date.parse(manifest.builtAt ?? ''))
      || !/^[0-9a-f]{64}$/i.test(manifest.apkSha256 ?? '') || manifest.apkSha256.toLowerCase() !== apkSha256
      || !/^[0-9a-f]{64}$/i.test(manifest.signerCertificateSha256 ?? '')
      || (required && (!env.repSignerCertificateSha256
        || manifest.signerCertificateSha256.toLowerCase() !== env.repSignerCertificateSha256))) {
    throw Object.assign(new Error('The release APK metadata does not match a verified clean release artifact.'), { code: 'EAPKMETADATA' });
  }
  return {
    sourceRevision: manifest.sourceRevision,
    sourceTreeDirty: false,
    builtAt: manifest.builtAt,
    versionName: manifest.versionName,
    versionCode: manifest.versionCode,
    buildType: manifest.buildType,
    apkSha256,
    signerCertificateSha256: manifest.signerCertificateSha256.toLowerCase(),
  };
}

// The release registry is the distribution gate: an artifact may only be served
// for download when the exact bytes and signer of its version code are recorded
// and still marked available. Anything else (unrecorded, rebuilt under the same
// version code, withdrawn, retained for history) fails closed.
function readReleaseRegistration(metadata) {
  if (!metadata) return null;
  const row = db.prepare(`SELECT id, version_code AS versionCode, version_name AS versionName,
      apk_sha256 AS apkSha256, signer_certificate_sha256 AS signerCertificateSha256,
      status, published_at AS publishedAt
    FROM apk_releases WHERE version_code = ?`).get(metadata.versionCode);
  if (!row) {
    return {
      recorded: false,
      status: 'unrecorded',
      versionCode: metadata.versionCode,
      versionName: metadata.versionName,
      publishedAt: null,
    };
  }
  const matches = String(row.apkSha256).toLowerCase() === metadata.apkSha256.toLowerCase()
    && String(row.signerCertificateSha256).toLowerCase() === metadata.signerCertificateSha256.toLowerCase();
  return {
    recorded: matches,
    status: matches ? row.status : 'mismatch',
    versionCode: Number(row.versionCode),
    versionName: row.versionName,
    publishedAt: row.publishedAt,
  };
}

function releaseDistributionState(registration) {
  if (!registration) return { distributable: true, reason: null };
  if (registration.status === 'mismatch') return { distributable: false, reason: 'release_artifact_mismatch' };
  if (!registration.recorded) return { distributable: false, reason: 'release_not_recorded' };
  if (registration.status !== 'available') return { distributable: false, reason: `release_${registration.status}` };
  return { distributable: true, reason: null };
}

const RELEASE_DISTRIBUTION_ERRORS = Object.freeze({
  release_not_recorded: {
    status: 503,
    message: 'This release is not recorded in the release registry; an administrator must publish it before download.',
  },
  release_artifact_mismatch: {
    status: 503,
    message: 'This release artifact no longer matches its recorded digest and cannot be distributed.',
  },
  release_withdrawn: {
    status: 410,
    message: 'This release has been withdrawn and is no longer distributed.',
  },
  release_retained: {
    status: 410,
    message: 'This release is retained for history only and is not distributed.',
  },
});

function downloadApkArtifact(req, res, next, path, downloadName, { release = false } = {}) {
  let descriptor;
  try {
    ({ descriptor } = openRegularFileNoFollow(path));
    if (release) {
      const verified = readVerifiedApkMetadata(path, descriptor, { required: true });
      const distribution = releaseDistributionState(readReleaseRegistration(verified));
      if (!distribution.distributable) {
        closeSync(descriptor);
        const rejection = RELEASE_DISTRIBUTION_ERRORS[distribution.reason] ?? {
          status: 503,
          message: 'This release is not available for distribution.',
        };
        res.set('Cache-Control', 'private, no-store').status(rejection.status).json({
          error: rejection.message,
          code: distribution.reason.toUpperCase(),
        });
        return;
      }
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    if (['ENOENT', 'ENOTDIR', 'ELOOP', 'EUNSAFEPATH', 'EAPKMETADATA'].includes(error.code)) {
      res.status(error.code === 'EAPKMETADATA' ? 503 : 404).json({ error: 'The selected APK artifact is unavailable or failed its integrity checks.' });
      return;
    }
    next(error);
    return;
  }
  const metadata = fstatSync(descriptor);
  res.set({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/vnd.android.package-archive',
    'Content-Length': String(metadata.size),
  });
  res.attachment(downloadName);
  const stream = createReadStream(path, { fd: descriptor, autoClose: true, start: 0 });
  stream.on('error', (error) => {
    if (res.headersSent) res.destroy(error);
    else next(error);
  });
  stream.pipe(res);
}

function apkTarget(req, res) {
  const target = req.query.target ?? 'rep';
  if (!['rep', 'system'].includes(target)) {
    res.status(400).json({ error: 'target must be rep or system.' });
    return null;
  }
  if (target === 'system' && req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required for the manager APK.' });
    return null;
  }
  if (target === 'rep' && !['admin', 'rep'].includes(req.user?.role)) {
    res.status(403).json({ error: 'Administrator or field representative access is required.' });
    return null;
  }
  return target;
}

app.get('/download/apk', requireAuthentication, (req, res, next) => {
  const target = apkTarget(req, res);
  if (!target) return;
  if (target === 'system') {
    downloadApkArtifact(req, res, next, managerApkPath, 'madar-manager.apk', {
      release: basename(managerApkPath) === 'madar-manager-release.apk',
    });
    return;
  }
  downloadApkArtifact(req, res, next, repApkPath, 'madar-rep.apk', {
    release: basename(repApkPath) === 'madar-rep-release.apk',
  });
});

app.get('/download/apk/debug-transition', requireAuthentication, (req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required for the legacy debug transition APK.' });
    return;
  }
  downloadApkArtifact(req, res, next, repTransitionApkPath, 'madar-rep-debug-transition.apk');
});

app.get('/download/apk/status', requireAuthentication, (req, res) => {
  const target = apkTarget(req, res);
  if (!target) return;
  const artifactPath = target === 'system' ? managerApkPath : repApkPath;

  try {
    const { descriptor, metadata } = openRegularFileNoFollow(artifactPath);
    let releaseMetadata = null;
    try {
      releaseMetadata = readVerifiedApkMetadata(artifactPath, descriptor, {
        required: basename(artifactPath) === (target === 'rep' ? 'madar-rep-release.apk' : 'madar-manager-release.apk'),
      });
    } finally { closeSync(descriptor); }
    const releaseFile = basename(artifactPath) === (target === 'rep' ? 'madar-rep-release.apk' : 'madar-manager-release.apk');
    const artifactType = releaseFile ? 'release' : 'fallback';
    const releaseRegistry = target === 'rep' && artifactType === 'release' ? readReleaseRegistration(releaseMetadata) : null;
    const distribution = target === 'rep' ? releaseDistributionState(releaseRegistry) : { distributable: artifactType === 'release', reason: artifactType === 'release' ? null : 'artifact_not_release' };
    res.set('Cache-Control', 'private, no-store').json({
      available: distribution.distributable,
      ...(target === 'system' ? { target } : {}),
      artifactType,
      sizeBytes: metadata.size,
      modifiedAt: metadata.mtime.toISOString(),
      ...(distribution.distributable ? {} : { reason: distribution.reason }),
      ...(releaseMetadata ? { releaseMetadata } : {}),
      ...(releaseRegistry ? { releaseRegistry } : {}),
      ...(target === 'rep' && req.user?.role === 'admin' ? { transitionAvailable: existsSync(repTransitionApkPath) } : {}),
    });
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
      res.status(500).json({ error: 'Unable to inspect the representative APK artifact.' });
      return;
    }
    res.set('Cache-Control', 'private, no-store').json({
      available: false,
      ...(target === 'system' ? { target } : {}),
      artifactType: 'missing',
      sizeBytes: null,
      modifiedAt: null,
      reason: 'artifact_missing',
      ...(target === 'rep' && req.user?.role === 'admin' ? { transitionAvailable: existsSync(repTransitionApkPath) } : {}),
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
app.use('/api/system', repSupportRouter);
app.use('/api/system', repReleaseRouter);
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
