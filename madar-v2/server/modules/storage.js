import { lstat, mkdir, realpath, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
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
