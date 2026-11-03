import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { storageRoot } from '../config/paths.js';
import { HttpError } from './http.js';

function parseRelativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || isAbsolute(value)) {
    throw new HttpError(400, 'Invalid storage path.');
  }
  const segments = value.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
    throw new HttpError(400, 'Invalid storage path.');
  }
  return segments;
}

async function getStorageRoot() {
  await mkdir(storageRoot, { recursive: true });
  const metadata = await lstat(storageRoot);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new HttpError(500, 'Configured storage root must be a real directory.');
  }
  return realpath(storageRoot);
}

async function ensureDirectorySegments(root, segments) {
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const metadata = await lstat(current);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new HttpError(400, 'Storage path contains a non-directory or symbolic link.');
    }
  }
  return current;
}

function assertInsideRoot(root, absolutePath) {
  const relativePath = relative(root, absolutePath);
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new HttpError(400, 'Storage path escapes the configured storage root.');
  }
}

export async function writeStorageFile(relativePath, contents) {
  const segments = parseRelativePath(relativePath);
  const root = await getStorageRoot();
  const directory = await ensureDirectorySegments(root, segments.slice(0, -1));
  const absolutePath = join(directory, segments.at(-1));
  assertInsideRoot(root, absolutePath);
  await writeFile(absolutePath, contents, { flag: 'wx', mode: 0o600 });
  return { absolutePath, storedPath: segments.join('/') };
}

export async function copyStorageFile(sourceAbsolutePath, relativePath) {
  const segments = parseRelativePath(relativePath);
  const root = await getStorageRoot();
  const directory = await ensureDirectorySegments(root, segments.slice(0, -1));
  const absolutePath = join(directory, segments.at(-1));
  assertInsideRoot(root, absolutePath);
  const sourceMetadata = await lstat(sourceAbsolutePath);
  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isFile()) {
    throw new HttpError(400, 'Trip photo source must be a regular file.');
  }
  try {
    await pipeline(
      createReadStream(sourceAbsolutePath),
      createWriteStream(absolutePath, { flags: 'wx', mode: 0o600 }),
    );
  } catch (error) {
    try { await unlink(absolutePath); } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw cleanupError;
    }
    throw error;
  }
  return { absolutePath, storedPath: segments.join('/') };
}

export async function ensureStorageDirectory(...pathSegments) {
  const relativePath = pathSegments.join('/');
  const segments = parseRelativePath(relativePath);
  const root = await getStorageRoot();
  return ensureDirectorySegments(root, segments);
}

export async function moveStorageDirectory(sourceRelativePath, destinationRelativePath) {
  const sourceSegments = parseRelativePath(sourceRelativePath);
  const destinationSegments = parseRelativePath(destinationRelativePath);
  const root = await getStorageRoot();
  let source = root;
  for (const segment of sourceSegments) {
    source = join(source, segment);
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new HttpError(400, 'Staged storage folder is not a safe directory.');
    }
  }
  source = await realpath(source);
  assertInsideRoot(root, source);

  const destination = join(await ensureDirectorySegments(root, destinationSegments.slice(0, -1)), destinationSegments.at(-1));
  assertInsideRoot(root, destination);
  try {
    await lstat(destination);
    throw new HttpError(409, 'The destination storage folder already exists.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rename(source, destination);
  return { sourcePath: sourceRelativePath, destinationPath: destinationSegments.join('/') };
}

/** Atomically publish one staged file under the configured storage root. */
export async function moveStorageFile(sourceRelativePath, destinationRelativePath) {
  const sourceSegments = parseRelativePath(sourceRelativePath);
  const destinationSegments = parseRelativePath(destinationRelativePath);
  const root = await getStorageRoot();
  let source = root;
  for (const [index, segment] of sourceSegments.entries()) {
    source = join(source, segment);
    const metadata = await lstat(source);
    if (metadata.isSymbolicLink() || (index < sourceSegments.length - 1 && !metadata.isDirectory())
        || (index === sourceSegments.length - 1 && !metadata.isFile())) {
      throw new HttpError(400, 'Staged storage file is not a safe regular file.');
    }
  }
  source = await realpath(source);
  assertInsideRoot(root, source);

  const destinationDirectory = await ensureDirectorySegments(root, destinationSegments.slice(0, -1));
  const destination = join(destinationDirectory, destinationSegments.at(-1));
  assertInsideRoot(root, destination);
  try {
    await lstat(destination);
    throw new HttpError(409, 'The destination storage file already exists.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await rename(source, destination);
  return { sourcePath: sourceRelativePath, destinationPath: destinationSegments.join('/') };
}

export async function removeStorageDirectory(relativePath) {
  const segments = parseRelativePath(relativePath);
  const root = await getStorageRoot();
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new HttpError(403, 'Cannot remove a storage folder containing a symbolic-link path.');
    }
  }
  current = await realpath(current);
  assertInsideRoot(root, current);
  await rm(current, { recursive: true, force: false });
  return true;
}

export async function listStorageFiles(relativePath, { maxFiles = 10000, onProgress } = {}) {
  const segments = parseRelativePath(relativePath);
  const root = await getStorageRoot();
  let start = root;
  for (const segment of segments) {
    start = join(start, segment);
    let metadata;
    try {
      metadata = await lstat(start);
    } catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(404, 'Storage folder was not found.');
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new HttpError(403, 'Storage folder contains an invalid or symbolic-link path.');
    }
  }
  assertInsideRoot(root, await realpath(start));

  const files = [];
  async function walk(directory, relativeSegments) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new HttpError(403, 'Symbolic links are not allowed in storage folders.');
      const nextSegments = [...relativeSegments, entry.name];
      if (metadata.isDirectory()) {
        await walk(absolute, nextSegments);
      } else if (metadata.isFile()) {
        files.push(nextSegments.join('/'));
        if (files.length > maxFiles) throw new HttpError(413, 'Storage folder contains too many files to import.');
        onProgress?.({ processedFiles: files.length, stage: `جارٍ استكشاف محتويات المجلد (${files.length} ملف)...` });
      }
    }
  }
  await walk(start, segments);
  return files;
}

export async function listStorageDirectories(relativePath, { photoExtensions = ['.jpg', '.jpeg', '.png'] } = {}) {
  const segments = parseRelativePath(relativePath);
  const allowedPhotoExtensions = new Set(photoExtensions.map((extension) => extension.toLowerCase()));
  const root = await getStorageRoot();
  let current = root;

  for (const segment of segments) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(404, 'Storage folder was not found.');
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new HttpError(403, 'Storage folder contains an invalid or symbolic-link path.');
    }
  }

  const resolvedCurrent = await realpath(current);
  assertInsideRoot(root, resolvedCurrent);
  current = resolvedCurrent;

  async function inspectVisibleChildren(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    let hasSubfolders = false;
    let photoCount = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absolute = join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) continue;
      if (metadata.isDirectory()) {
        hasSubfolders = true;
      } else if (metadata.isFile() && allowedPhotoExtensions.has(extname(entry.name).toLowerCase())) {
        photoCount += 1;
      }
    }
    return { hasSubfolders, photoCount };
  }

  const entries = await readdir(current, { withFileTypes: true });
  const directories = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const absolute = join(current, entry.name);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) continue;
    const resolved = await realpath(absolute);
    assertInsideRoot(root, resolved);
    const details = await inspectVisibleChildren(resolved);
    directories.push({ name: entry.name, ...details });
  }
  return directories.sort((left, right) => left.name.localeCompare(right.name, 'ar'));
}

export async function resolveStorageDirectory(relativePath) {
  const segments = parseRelativePath(relativePath);
  const root = await getStorageRoot();
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(404, 'Storage folder was not found.');
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new HttpError(403, 'Symbolic links are not allowed in storage paths.');
    if (!metadata.isDirectory()) throw new HttpError(404, 'Storage folder was not found.');
  }
  const resolved = await realpath(current);
  assertInsideRoot(root, resolved);
  return resolved;
}

export async function resolveStorageFile(relativePath) {
  const segments = parseRelativePath(relativePath);
  const root = await getStorageRoot();
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT') throw new HttpError(404, 'Stored file was not found.');
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new HttpError(403, 'Symbolic links are not allowed in storage paths.');
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      throw new HttpError(404, 'Stored file path is invalid.');
    }
    if (index === segments.length - 1 && !metadata.isFile()) {
      throw new HttpError(404, 'Stored file was not found.');
    }
  }
  const resolved = await realpath(current);
  assertInsideRoot(root, resolved);
  return resolved;
}

export async function removeStorageFile(absolutePath) {
  try {
    await unlink(absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

export function storageDirectory(...segments) {
  return segments.join('/');
}
