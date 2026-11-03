import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { assertMountedStorage, isLinuxMountPoint, resolveStorageLayout } from '../server/config/storage-layout.js';

const projectRoot = resolve('madar-v2-project-fixture');

test('storage layout preserves existing local defaults when no mount is configured', () => {
  const layout = resolveStorageLayout({ projectRoot });

  assert.equal(layout.storageMountPath, null);
  assert.equal(layout.dataDirectory, resolve(projectRoot, 'data'));
  assert.equal(layout.databasePath, resolve(projectRoot, 'data', 'madar-v2.sqlite'));
  assert.equal(layout.storageRoot, resolve(projectRoot, '..', 'storage'));
  assert.equal(layout.backupRoot, resolve(projectRoot, 'Backups'));
});

test('storage mount defaults database, uploads, and backups beneath the mounted root', () => {
  const mountPath = resolve('mnt', 'madar-storage');
  const layout = resolveStorageLayout({ projectRoot, storageMountPath: mountPath });

  assert.equal(layout.storageMountPath, mountPath);
  assert.equal(layout.dataDirectory, resolve(mountPath, 'data'));
  assert.equal(layout.databasePath, resolve(mountPath, 'data', 'madar-v2.sqlite'));
  assert.equal(layout.storageRoot, resolve(mountPath, 'uploads'));
  assert.equal(layout.backupRoot, resolve(mountPath, 'Backups'));
});

test('mount path overrides are allowed only when all persistent roots remain beneath the mount', () => {
  const mountPath = resolve('mnt', 'madar-storage');
  const layout = resolveStorageLayout({
    projectRoot,
    storageMountPath: mountPath,
    dataDirectory: resolve(mountPath, 'erp-data'),
    databasePath: resolve(mountPath, 'erp-data', 'madar.sqlite'),
    storageRoot: resolve(mountPath, 'customer-files'),
    backupRoot: resolve(mountPath, 'safe-backups'),
  });
  assert.equal(layout.storageRoot, resolve(mountPath, 'customer-files'));

  assert.throws(() => resolveStorageLayout({
    projectRoot,
    storageMountPath: mountPath,
    storageRoot: resolve(projectRoot, '..', 'storage'),
  }), /MADAR_V2_STORAGE_ROOT must resolve beneath STORAGE_MOUNT_PATH/);
  assert.throws(() => resolveStorageLayout({
    projectRoot,
    storageMountPath: 'relative/mount',
  }), /STORAGE_MOUNT_PATH must be an absolute path/);
});

test('Linux mountpoint parsing is exact and decodes mountinfo path escapes', () => {
  const mountInfo = [
    '36 25 8:1 / /mnt/storage rw,relatime - ext4 /dev/sdb1 rw',
    '37 25 8:1 / /mnt/madar\\040storage rw,relatime - ext4 /dev/sdb1 rw',
  ].join('\n');

  assert.equal(isLinuxMountPoint('/mnt/storage', mountInfo), true);
  assert.equal(isLinuxMountPoint('/mnt/storage-extra', mountInfo), false);
  assert.equal(isLinuxMountPoint('/mnt/madar storage', mountInfo), true);
});

test('mounted-storage assertion rejects missing, aliased, and same-device mounts', () => {
  const valid = {
    mountPath: '/mnt/storage',
    mountInfo: '36 25 8:1 / /mnt/storage rw - ext4 /dev/sdb1 rw',
    mountRealPath: '/mnt/storage',
    mountDevice: 2049,
    rootDevice: 2048,
  };

  assert.doesNotThrow(() => assertMountedStorage(valid));
  assert.throws(() => assertMountedStorage({ ...valid, mountInfo: '' }), /not an active Linux mount point/);
  assert.throws(() => assertMountedStorage({ ...valid, mountRealPath: '/mnt/alias' }), /must not be a symbolic-link path/);
  assert.throws(() => assertMountedStorage({ ...valid, rootDevice: valid.mountDevice }), /same filesystem device as \//);
});

test('paths module refuses startup when STORAGE_MOUNT_PATH is not a verified mount', (t) => {
  const directory = mkdtempSync(resolve(tmpdir(), 'madar-storage-layout-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const result = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "await import('./server/config/paths.js')",
  ], {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      MADAR_V2_JWT_SECRET: 'x'.repeat(64),
      MADAR_V2_DATA_DIR: '',
      MADAR_V2_DATABASE_PATH: '',
      MADAR_V2_STORAGE_ROOT: '',
      MADAR_V2_BACKUP_ROOT: '',
      STORAGE_MOUNT_PATH: directory,
    },
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(`${result.stderr}\n${result.stdout}`, /STORAGE_MOUNT_PATH/);
});
