import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

function optionalPath(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function resolveFromProject(projectRoot, value) {
  return isAbsolute(value) ? resolve(value) : resolve(projectRoot, value);
}

function assertInsideMount(mountPath, configuredPath, label) {
  const relativePath = relative(mountPath, configuredPath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${label} must resolve beneath STORAGE_MOUNT_PATH (${mountPath}).`);
  }
}

export function resolveStorageLayout({
  projectRoot,
  storageMountPath,
  dataDirectory,
  databasePath,
  storageRoot,
  backupRoot,
}) {
  const project = resolve(projectRoot);
  const configuredMount = optionalPath(storageMountPath);
  if (configuredMount && !isAbsolute(configuredMount)) {
    throw new Error('STORAGE_MOUNT_PATH must be an absolute path.');
  }

  const mount = configuredMount ? resolve(configuredMount) : null;
  const resolvedDataDirectory = resolveFromProject(
    project,
    optionalPath(dataDirectory) ?? (mount ? join(mount, 'data') : './data'),
  );
  const resolvedStorageRoot = resolveFromProject(
    project,
    optionalPath(storageRoot) ?? (mount ? join(mount, 'uploads') : '../storage'),
  );
  const resolvedDatabasePath = optionalPath(databasePath)
    ? resolveFromProject(project, optionalPath(databasePath))
    : join(resolvedDataDirectory, 'madar-v2.sqlite');
  const resolvedBackupRoot = resolveFromProject(
    project,
    optionalPath(backupRoot) ?? (mount ? join(mount, 'Backups') : './Backups'),
  );

  if (mount) {
    assertInsideMount(mount, resolvedDataDirectory, 'MADAR_V2_DATA_DIR');
    assertInsideMount(mount, resolvedDatabasePath, 'MADAR_V2_DATABASE_PATH');
    assertInsideMount(mount, resolvedStorageRoot, 'MADAR_V2_STORAGE_ROOT');
    assertInsideMount(mount, resolvedBackupRoot, 'MADAR_V2_BACKUP_ROOT');
  }

  return {
    storageMountPath: mount,
    dataDirectory: resolvedDataDirectory,
    databasePath: resolvedDatabasePath,
    storageRoot: resolvedStorageRoot,
    backupRoot: resolvedBackupRoot,
  };
}

function decodeMountInfoField(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, octal) => String.fromCharCode(Number.parseInt(octal, 8)));
}

export function isLinuxMountPoint(mountPath, mountInfo) {
  const expectedPath = posix.resolve(mountPath);
  return String(mountInfo).split('\n').some((line) => {
    const fields = line.trim().split(' ');
    return fields.length > 4 && decodeMountInfoField(fields[4]) === expectedPath;
  });
}

export function assertMountedStorage({ mountPath, mountInfo, mountRealPath, mountDevice, rootDevice }) {
  if (!posix.isAbsolute(mountPath)) throw new Error('STORAGE_MOUNT_PATH must be absolute.');
  const expectedPath = posix.resolve(mountPath);
  if (posix.resolve(mountRealPath) !== expectedPath) {
    throw new Error(`STORAGE_MOUNT_PATH must not be a symbolic-link path (${expectedPath}).`);
  }
  if (!isLinuxMountPoint(expectedPath, mountInfo)) {
    throw new Error(`STORAGE_MOUNT_PATH is not an active Linux mount point (${expectedPath}); refusing to use the system partition as storage.`);
  }
  if (mountDevice === rootDevice) {
    throw new Error(`STORAGE_MOUNT_PATH (${expectedPath}) is on the same filesystem device as /; configure a separate mounted filesystem.`);
  }
}
