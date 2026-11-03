import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { env } from './env.js';
import { assertMountedStorage, resolveStorageLayout } from './storage-layout.js';

export const projectRoot = env.projectRoot;
const storageLayout = resolveStorageLayout({
  projectRoot,
  storageMountPath: env.storageMountPath,
  dataDirectory: env.dataDirectory,
  databasePath: env.databasePath,
  storageRoot: env.storageRoot,
  backupRoot: env.backupRoot,
});

export const storageMountPath = storageLayout.storageMountPath;
export const dataDirectory = storageLayout.dataDirectory;
export const thumbnailCacheDirectory = join(dataDirectory, 'thumbnail-cache');
export const storageRoot = storageLayout.storageRoot;
export const databasePath = storageLayout.databasePath;
export const backupRoot = storageLayout.backupRoot;
export const schemaPath = join(projectRoot, 'server', 'database', 'schema.sql');
export const clientDistPath = join(projectRoot, 'client', 'dist');
export const repApkPath = resolve(projectRoot, env.repApkPath ?? 'madar-rep.apk');

function assertExistingPathIsSafe(path, { mountDevice, type, label }) {
  const relativePath = relative(storageMountPath, path);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`${label} must remain beneath STORAGE_MOUNT_PATH.`);
  }

  let currentPath = storageMountPath;
  const segments = relativePath ? relativePath.split(sep) : [];
  for (let index = 0; index <= segments.length; index += 1) {
    if (index > 0) currentPath = join(currentPath, segments[index - 1]);

    let metadata;
    try {
      metadata = lstatSync(currentPath);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }

    if (metadata.isSymbolicLink()) {
      throw new Error(`${label} must not pass through a symbolic link (${currentPath}).`);
    }
    if (metadata.dev !== mountDevice) {
      throw new Error(`${label} must remain on the STORAGE_MOUNT_PATH filesystem (${currentPath}).`);
    }

    const isTarget = index === segments.length;
    if (!isTarget && !metadata.isDirectory()) {
      throw new Error(`${label} contains a non-directory path component (${currentPath}).`);
    }
    if (isTarget && type === 'directory' && !metadata.isDirectory()) {
      throw new Error(`${label} must be a directory (${currentPath}).`);
    }
    if (isTarget && type === 'file' && !metadata.isFile()) {
      throw new Error(`${label} must be a regular file (${currentPath}).`);
    }
  }
}

if (storageMountPath) {
  if (process.platform !== 'linux') {
    throw new Error('STORAGE_MOUNT_PATH is supported only on Linux; unset it for local development or run MADAR on Ubuntu.');
  }
  let mountMetadata;
  try {
    mountMetadata = lstatSync(storageMountPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`STORAGE_MOUNT_PATH does not exist (${storageMountPath}); refusing to create data on the system partition.`, { cause: error });
    }
    throw error;
  }
  if (mountMetadata.isSymbolicLink() || !mountMetadata.isDirectory()) {
    throw new Error(`STORAGE_MOUNT_PATH must be an existing real directory (${storageMountPath}).`);
  }

  try {
    assertMountedStorage({
      mountPath: storageMountPath,
      mountInfo: readFileSync('/proc/self/mountinfo', 'utf8'),
      mountRealPath: realpathSync(storageMountPath),
      mountDevice: mountMetadata.dev,
      rootDevice: statSync('/').dev,
    });
  } catch (error) {
    throw new Error(`STORAGE_MOUNT_PATH startup check failed: ${error.message}`, { cause: error });
  }

  const mountDevice = mountMetadata.dev;
  for (const [path, label] of [
    [dataDirectory, 'MADAR_V2_DATA_DIR'],
    [thumbnailCacheDirectory, 'thumbnail cache directory'],
    [storageRoot, 'MADAR_V2_STORAGE_ROOT'],
    [backupRoot, 'MADAR_V2_BACKUP_ROOT'],
  ]) {
    assertExistingPathIsSafe(path, { mountDevice, type: 'directory', label });
  }
  assertExistingPathIsSafe(databasePath, { mountDevice, type: 'file', label: 'MADAR_V2_DATABASE_PATH' });
  assertExistingPathIsSafe(`${databasePath}-wal`, { mountDevice, type: 'file', label: 'SQLite WAL file' });
  assertExistingPathIsSafe(`${databasePath}-shm`, { mountDevice, type: 'file', label: 'SQLite shared-memory file' });

  const legacyDatabasePath = join(projectRoot, 'data', 'madar-v2.sqlite');
  let hasLegacyDatabase = false;
  try {
    lstatSync(legacyDatabasePath);
    hasLegacyDatabase = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  let hasMountedDatabase = false;
  try {
    hasMountedDatabase = lstatSync(databasePath).isFile();
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (databasePath !== legacyDatabasePath && hasLegacyDatabase && !hasMountedDatabase) {
    throw new Error(`An existing V2 database is at ${legacyDatabasePath}, but the mounted database is missing at ${databasePath}. Copy and verify the database before enabling STORAGE_MOUNT_PATH; startup will not create an empty replacement.`);
  }
}
