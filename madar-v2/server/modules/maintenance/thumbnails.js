import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { thumbnailCacheDirectory } from '../../config/paths.js';
import { HttpError } from '../http.js';
import { applyPhotoRotation } from './photo-images.js';

const inFlight = new Map();

export const VARIANT_CONFIGS = {
  thumb: { size: 200, quality: 74, effort: 4 },
  '800': { size: 800, quality: 78, effort: 3 },
  preview: { size: 1200, quality: 80, effort: 3 },
  high: { size: 1800, quality: 84, effort: 3 },
  '2400': { size: 2400, quality: 86, effort: 3 },
};

async function ensureCacheDirectory() {
  await mkdir(thumbnailCacheDirectory, { recursive: true });
  const metadata = await lstat(thumbnailCacheDirectory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new HttpError(500, 'Thumbnail cache must be a real directory.');
  }
}

function rotationValue(value) {
  const angle = Number(value ?? 0);
  if (![0, 90, 180, 270].includes(angle)) throw new HttpError(400, 'Invalid saved photo rotation.');
  return angle;
}

export function computePhotoVariantKey(absolutePath, source, rotation = 0, variantName = 'thumb') {
  return createHash('sha256')
    .update(`${absolutePath}\0${source.size}\0${source.mtimeMs}\0${rotation}\0${variantName}`)
    .digest('hex');
}

export function computePhotoETag(absolutePath, source, rotation = 0, variantName = 'original') {
  const hash = computePhotoVariantKey(absolutePath, source, rotation, variantName);
  return `"${hash}"`;
}

export async function invalidateMaintenanceVariants(absolutePath, savedRotation = 0) {
  const rotation = rotationValue(savedRotation);
  const source = await stat(absolutePath).catch(() => null);
  if (!source || !source.isFile()) return;
  await ensureCacheDirectory();
  for (const variant of ['thumb', '800', 'preview', 'high', '2400']) {
    const key = computePhotoVariantKey(absolutePath, source, rotation, variant);
    const cachedPath = join(thumbnailCacheDirectory, `${key}.webp`);
    try {
      const metadata = await lstat(cachedPath);
      if (!metadata.isSymbolicLink() && metadata.isFile()) {
        await rm(cachedPath, { force: true });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export async function invalidateMaintenanceThumbnail(absolutePath, savedRotation = 0) {
  return invalidateMaintenanceVariants(absolutePath, savedRotation);
}

export async function getMaintenancePhotoVariant(absolutePath, savedRotation = 0, variantName = 'thumb') {
  const rotation = rotationValue(savedRotation);
  const source = await stat(absolutePath);
  if (!source.isFile()) throw new HttpError(404, 'Photo was not found.');
  await ensureCacheDirectory();

  let targetConfig = VARIANT_CONFIGS[variantName];
  if (!targetConfig) {
    const numericSize = Number(variantName);
    if (Number.isFinite(numericSize) && numericSize > 50 && numericSize <= 3840) {
      targetConfig = { size: numericSize, quality: 78, effort: 3 };
    }
  }
  if (!targetConfig) {
    targetConfig = VARIANT_CONFIGS.thumb;
  }

  const key = computePhotoVariantKey(absolutePath, source, rotation, variantName);
  const cachedPath = join(thumbnailCacheDirectory, `${key}.webp`);
  try {
    const cachedMetadata = await lstat(cachedPath);
    if (cachedMetadata.isSymbolicLink() || !cachedMetadata.isFile()) throw new HttpError(403, 'Unsafe thumbnail cache entry.');
    return await readFile(cachedPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (inFlight.has(key)) return inFlight.get(key);
  const generation = (async () => {
    const temporaryPath = join(thumbnailCacheDirectory, `.${key}-${randomUUID()}.tmp`);
    try {
      const rotatedSource = rotation
        ? await applyPhotoRotation(await readFile(absolutePath), rotation)
        : absolutePath;
      const pipeline = sharp(rotatedSource, { failOn: 'none' });
      const buffer = await (rotation ? pipeline : pipeline.rotate())
        .resize({ width: targetConfig.size, height: targetConfig.size, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: targetConfig.quality, effort: targetConfig.effort })
        .toBuffer();
      await writeFile(temporaryPath, buffer, { flag: 'wx', mode: 0o600 });
      try {
        await rename(temporaryPath, cachedPath);
      } catch (error) {
        if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
      }
      return buffer;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(415, 'This photo could not be converted to a derived variant.');
    } finally {
      await rm(temporaryPath, { force: true });
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, generation);
  return generation;
}

export async function getMaintenanceThumbnail(absolutePath, savedRotation = 0) {
  return getMaintenancePhotoVariant(absolutePath, savedRotation, 'thumb');
}

/**
 * Prunes old or oversized server-derived WebP thumbnail cache entries
 * to prevent unbounded disk accumulation.
 */
export async function pruneThumbnailCache({ maxAgeDays = 30, maxBytes = 500 * 1024 * 1024 } = {}) {
  await ensureCacheDirectory();
  const entries = await readdir(thumbnailCacheDirectory, { withFileTypes: true });
  const fileStats = [];
  let totalBytes = 0;
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.webp')) continue;
    const fullPath = join(thumbnailCacheDirectory, entry.name);
    try {
      const s = await stat(fullPath);
      totalBytes += s.size;
      fileStats.push({ path: fullPath, size: s.size, mtimeMs: s.mtimeMs });
    } catch {}
  }

  // 1. Evict entries older than maxAgeDays
  for (const f of fileStats) {
    if (now - f.mtimeMs > maxAgeMs) {
      try {
        await rm(f.path, { force: true });
        totalBytes -= f.size;
      } catch {}
    }
  }

  // 2. If total size still exceeds maxBytes, evict oldest first
  if (totalBytes > maxBytes) {
    fileStats.sort((a, b) => a.mtimeMs - b.mtimeMs);
    const targetBytes = Math.floor(maxBytes * 0.8);
    for (const f of fileStats) {
      if (totalBytes <= targetBytes) break;
      try {
        await rm(f.path, { force: true });
        totalBytes -= f.size;
      } catch {}
    }
  }

  return { totalBytesRemaining: totalBytes };
}
