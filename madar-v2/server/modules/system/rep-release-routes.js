import { createHash } from 'node:crypto';
import { constants as fsConstants, closeSync, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Router } from 'express';
import { env } from '../../config/env.js';
import { repApkPath } from '../../config/paths.js';
import { db } from '../../database/connection.js';
import { recordAudit } from '../audit.js';
import { requireAdmin } from '../auth/authorization.js';
import { HttpError, asyncHandler, optionalText } from '../http.js';

const router = Router();
router.use(requireAdmin);

function readVerifiedRelease() {
  if (basename(repApkPath) !== 'madar-rep-release.apk') {
    throw new HttpError(409, 'The configured APK is not the signed release artifact.');
  }
  const manifestPath = `${repApkPath}.manifest.json`;
  let apkDescriptor;
  let manifestDescriptor;
  try {
    for (const path of [repApkPath, manifestPath]) {
      const metadata = lstatSync(path);
      if (metadata.isSymbolicLink() || !metadata.isFile()) throw new HttpError(409, 'Release artifacts must be regular files, not symbolic links.');
    }
    const noFollow = fsConstants.O_NOFOLLOW ?? 0;
    apkDescriptor = openSync(repApkPath, fsConstants.O_RDONLY | noFollow);
    manifestDescriptor = openSync(manifestPath, fsConstants.O_RDONLY | noFollow);
    if (!fstatSync(apkDescriptor).isFile() || !fstatSync(manifestDescriptor).isFile()) {
      throw new HttpError(409, 'Release artifacts must be regular files.');
    }
  } catch (error) {
    if (apkDescriptor !== undefined) closeSync(apkDescriptor);
    if (manifestDescriptor !== undefined) closeSync(manifestDescriptor);
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new HttpError(409, 'No verified signed release artifact is available.');
    throw error;
  }
  let manifest;
  let apkBytes;
  try {
    manifest = JSON.parse(readFileSync(manifestDescriptor, 'utf8'));
    apkBytes = readFileSync(apkDescriptor);
  } catch { throw new HttpError(409, 'Release build metadata is invalid.'); }
  finally { closeSync(apkDescriptor); closeSync(manifestDescriptor); }
  const apkSha256 = createHash('sha256').update(apkBytes).digest('hex');
  if (manifest?.buildType !== 'release' || manifest.sourceTreeDirty !== false
      || !Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1
      || typeof manifest.versionName !== 'string' || !manifest.versionName.trim() || manifest.versionName.length > 40
      || !/^([0-9a-f]{40}|[0-9a-f]{64})$/i.test(manifest.sourceRevision ?? '')
      || !Number.isFinite(Date.parse(manifest.builtAt ?? ''))
      || !/^[0-9a-f]{64}$/i.test(manifest.apkSha256 ?? '') || manifest.apkSha256.toLowerCase() !== apkSha256
      || !/^[0-9a-f]{64}$/i.test(manifest.signerCertificateSha256 ?? '')) {
    throw new HttpError(409, 'Release metadata does not match a clean, signed APK.');
  }
  if (!env.repSignerCertificateSha256 || !/^[0-9a-f]{64}$/.test(env.repSignerCertificateSha256)) {
    throw new HttpError(503, 'Configure the approved release signer fingerprint before recording releases.');
  }
  if (manifest.signerCertificateSha256.toLowerCase() !== env.repSignerCertificateSha256) {
    throw new HttpError(409, 'This APK was not signed by the configured approved release key.');
  }
  return { manifest, apkSha256 };
}

router.get('/rep-releases', (_req, res) => {
  const releases = db.prepare(`SELECT id, version_code AS versionCode, version_name AS versionName,
      source_revision AS sourceRevision, source_tree_dirty AS sourceTreeDirty, apk_sha256 AS apkSha256,
      signer_certificate_sha256 AS signerCertificateSha256, status, published_at AS publishedAt,
      notes, artifact_path AS artifactPath
    FROM apk_releases ORDER BY version_code DESC, id DESC LIMIT 100`).all().map((release) => ({
    ...release, id: Number(release.id), versionCode: Number(release.versionCode),
    sourceTreeDirty: Boolean(release.sourceTreeDirty),
  }));
  res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' }).json({ success: true, releases });
});

router.post('/rep-releases/publish', asyncHandler(async (req, res) => {
  const { manifest, apkSha256 } = readVerifiedRelease();
  const notes = optionalText(req.body?.notes, 'notes', { maxLength: 2000 });
  const result = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM apk_releases WHERE version_code = ?').get(manifest.versionCode);
    if (existing) throw new HttpError(409, 'This release version code has already been recorded.');
    const inserted = db.prepare(`INSERT INTO apk_releases
      (version_code, version_name, source_revision, source_tree_dirty, apk_sha256,
       signer_certificate_sha256, artifact_path, status, published_by, notes)
      VALUES (?, ?, ?, 0, ?, ?, ?, 'available', ?, ?)`)
      .run(manifest.versionCode, manifest.versionName, manifest.sourceRevision, apkSha256,
        manifest.signerCertificateSha256.toLowerCase(), basename(repApkPath), req.user.id, notes);
    const id = Number(inserted.lastInsertRowid);
    recordAudit({ database: db, actorId: req.user.id, action: 'rep_release_published', entityType: 'apk_release', entityId: id,
      newValues: { version_code: manifest.versionCode, version_name: manifest.versionName,
        source_revision: manifest.sourceRevision, apk_sha256: apkSha256,
        signer_certificate_sha256: manifest.signerCertificateSha256.toLowerCase(), artifact_path: basename(repApkPath), notes } });
    return id;
  }).immediate();
  res.status(201).set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' }).json({
    success: true,
    release: db.prepare(`SELECT id, version_code AS versionCode, version_name AS versionName,
      source_revision AS sourceRevision, apk_sha256 AS apkSha256,
      signer_certificate_sha256 AS signerCertificateSha256, status, published_at AS publishedAt,
      notes FROM apk_releases WHERE id = ?`).get(result),
  });
}));

router.post('/rep-releases/:releaseId/withdraw', (req, res) => {
  const releaseId = Number(req.params.releaseId);
  if (!Number.isSafeInteger(releaseId) || releaseId < 1) throw new HttpError(400, 'releaseId must be a positive integer.');
  const result = db.transaction(() => {
    const current = db.prepare('SELECT id, status, version_code, version_name FROM apk_releases WHERE id = ?').get(releaseId);
    if (!current) throw new HttpError(404, 'Release was not found.');
    if (current.status === 'withdrawn') return current;
    db.prepare("UPDATE apk_releases SET status = 'withdrawn' WHERE id = ?").run(releaseId);
    recordAudit({ database: db, actorId: req.user.id, action: 'rep_release_withdrawn', entityType: 'apk_release', entityId: releaseId,
      oldValues: { status: current.status }, newValues: { status: 'withdrawn', version_code: current.version_code, version_name: current.version_name } });
    return { ...current, status: 'withdrawn' };
  }).immediate();
  res.json({ success: true, release: result });
});

export default router;
