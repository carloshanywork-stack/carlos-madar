import assert from 'node:assert/strict';
import test from 'node:test';
import { getStorageHealth } from '../server/modules/system/health.js';

const gib = 1024n ** 3n;

function statfsWith({ totalBytes, availableBytes }) {
  return async () => ({
    bsize: 1n,
    blocks: totalBytes,
    bavail: availableBytes,
  });
}

test('storage health warns below the 15 percent free-space threshold', async () => {
  const health = await getStorageHealth({
    storagePath: '/mnt/storage',
    statfsImpl: statfsWith({ totalBytes: 100n * gib, availableBytes: 14n * gib }),
  });

  assert.equal(health.status, 'warning');
  assert.equal(health.mountPath, '/mnt/storage');
  assert.equal(health.freePercent, 14);
  assert.equal(health.thresholdPercent, 15);
  assert.equal(health.totalBytes, Number(100n * gib));
  assert.equal(health.availableBytes, Number(14n * gib));
});

test('storage health is healthy at the exact free-space threshold', async () => {
  const health = await getStorageHealth({
    storagePath: '/mnt/storage',
    statfsImpl: statfsWith({ totalBytes: 100n * gib, availableBytes: 15n * gib }),
  });

  assert.equal(health.status, 'ok');
  assert.equal(health.freePercent, 15);
});

test('storage health fails closed when the filesystem cannot be checked', async () => {
  const health = await getStorageHealth({
    storagePath: '/mnt/storage',
    statfsImpl: async () => { throw new Error('synthetic missing mount'); },
  });

  assert.equal(health.status, 'error');
  assert.equal(health.mountPath, '/mnt/storage');
  assert.equal(health.error, 'Storage filesystem is unavailable or could not be checked.');
});
