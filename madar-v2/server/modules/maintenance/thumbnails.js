import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { thumbnailCacheDirectory } from '../../config/paths.js';
import { HttpError } from '../http.js';

const inFlight = new Map();

async function ensureCacheDirectory() {
  await mkdir(thumbnailCacheDirectory, { recursive: true });
  const metadata = await lstat(thumbnailCacheDirectory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new HttpError(500, 'Thumbnail cache must be a real directory.');
  }
}

export async function getMaintenanceThumbnail(absolutePath) {
  const source = await stat(absolutePath);
  if (!source.isFile()) throw new HttpError(404, 'Photo was not found.');
  await ensureCacheDirectory();
  const key = createHash('sha256')
    .update(`${absolutePath}\0${source.size}\0${source.mtimeMs}`)
    .digest('hex');
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
      const buffer = await sharp(absolutePath, { failOn: 'none' })
        .rotate()
        .resize({ width: 320, height: 240, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 74, effort: 4 })
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
      throw new HttpError(415, 'This photo could not be converted to a thumbnail.');
    } finally {
      await rm(temporaryPath, { force: true });
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, generation);
  return generation;
}
