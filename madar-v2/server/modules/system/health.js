import { lstat, readFile, stat, statfs } from 'node:fs/promises';
import { isLinuxMountPoint } from '../../config/storage-layout.js';

export const STORAGE_LOW_SPACE_THRESHOLD_PERCENT = 15;

function jsonBytes(value) {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

async function assertMountedStorageIsActive(mountPath) {
  const [mountInfo, mountMetadata, rootMetadata] = await Promise.all([
    readFile('/proc/self/mountinfo', 'utf8'),
    lstat(mountPath, { bigint: true }),
    stat('/', { bigint: true }),
  ]);

  if (
    mountMetadata.isSymbolicLink()
    || !mountMetadata.isDirectory()
    || !isLinuxMountPoint(mountPath, mountInfo)
    || mountMetadata.dev === rootMetadata.dev
  ) {
    throw new Error('Configured storage mount is missing or is on the system filesystem.');
  }
}

export async function getStorageHealth({ storagePath, mountRequired = false, statfsImpl = statfs }) {
  try {
    if (mountRequired) await assertMountedStorageIsActive(storagePath);
    const filesystem = await statfsImpl(storagePath, { bigint: true });
    const blockSize = BigInt(filesystem.bsize);
    const totalBytes = BigInt(filesystem.blocks) * blockSize;
    const availableBytes = BigInt(filesystem.bavail) * blockSize;
    if (totalBytes <= 0n || availableBytes < 0n) throw new Error('Filesystem returned invalid capacity data.');

    const freePercent = Number((availableBytes * 10_000n) / totalBytes) / 100;
    const status = availableBytes * 100n < totalBytes * BigInt(STORAGE_LOW_SPACE_THRESHOLD_PERCENT)
      ? 'warning'
      : 'ok';

    return {
      status,
      mountPath: storagePath,
      totalBytes: jsonBytes(totalBytes),
      availableBytes: jsonBytes(availableBytes),
      freePercent,
      thresholdPercent: STORAGE_LOW_SPACE_THRESHOLD_PERCENT,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    return {
      status: 'error',
      mountPath: storagePath,
      thresholdPercent: STORAGE_LOW_SPACE_THRESHOLD_PERCENT,
      checkedAt: new Date().toISOString(),
      error: 'Storage filesystem is unavailable or could not be checked.',
    };
  }
}
