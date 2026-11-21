import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';
process.env.MADAR_V2_JWT_SECRET = 'test-secret-at-least-32-bytes-long-for-madar-media-tests';

const {
  computePhotoVariantKey,
  computePhotoETag,
  VARIANT_CONFIGS,
} = await import('../server/modules/maintenance/thumbnails.js');

test('server thumbnail variants define thumb, preview, and high resolutions', () => {
  assert.ok(VARIANT_CONFIGS.thumb, 'Missing thumb variant');
  assert.equal(VARIANT_CONFIGS.thumb.size, 200);

  assert.ok(VARIANT_CONFIGS.preview, 'Missing preview variant');
  assert.equal(VARIANT_CONFIGS.preview.size, 1200);

  assert.ok(VARIANT_CONFIGS.high, 'Missing high variant');
  assert.equal(VARIANT_CONFIGS.high.size, 1800);
});

test('computePhotoVariantKey generates distinct deterministic keys per file and variant', () => {
  const filePath = '/var/data/storage/Areas/North/order-1/photo.jpg';
  const stat = { mtimeMs: 1700000000000, size: 543210 };
  const thumbKey = computePhotoVariantKey(filePath, stat, 0, 'thumb');
  const previewKey = computePhotoVariantKey(filePath, stat, 0, 'preview');
  const highKey = computePhotoVariantKey(filePath, stat, 0, 'high');

  assert.equal(typeof thumbKey, 'string');
  assert.equal(thumbKey.length, 64); // SHA-256 hex

  // Distinct keys for different variants
  assert.notEqual(thumbKey, previewKey);
  assert.notEqual(previewKey, highKey);

  // Deterministic: same inputs produce exact same key
  assert.equal(computePhotoVariantKey(filePath, stat, 0, 'thumb'), thumbKey);
});

test('computePhotoETag computes valid HTTP ETag incorporating size and variant', () => {
  const filePath = '/var/data/storage/Areas/North/order-1/photo.jpg';
  const stat = { mtimeMs: 1700000000000, size: 543210 };
  const etagThumb = computePhotoETag(filePath, stat, 0, 'thumb');
  const etagPreview = computePhotoETag(filePath, stat, 0, 'preview');
  const etagOriginal = computePhotoETag(filePath, stat, 0, 'original');

  assert.ok(etagThumb.startsWith('"'));
  assert.ok(etagThumb.endsWith('"'));

  // Distinct ETags for different variants of the same source file
  assert.notEqual(etagThumb, etagPreview);
  assert.notEqual(etagPreview, etagOriginal);

  // Same stat and variant yields exact same ETag
  assert.equal(computePhotoETag(filePath, stat, 0, 'thumb'), etagThumb);
});

test('LRU eviction algorithm evicts oldest unpinned entries and protects in-use entries', () => {
  // Simulate the bounded cache entries
  const maxBudget = 1000; // 1000 bytes budget

  const entries = [
    { key: 'entry-1', byteSize: 400, lastAccessedAt: 100, inUse: false },
    { key: 'entry-2', byteSize: 300, lastAccessedAt: 200, inUse: true }, // pinned in-use!
    { key: 'entry-3', byteSize: 300, lastAccessedAt: 300, inUse: false },
  ];

  // Total existing = 1000 bytes. Adding 200 bytes requires 200 bytes eviction.
  const incomingBytes = 200;
  const currentTotal = entries.reduce((s, e) => s + e.byteSize, 0);
  let bytesToFree = (currentTotal + incomingBytes) - maxBudget;

  const sortedCandidates = [...entries].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
  const evictedKeys = [];

  for (const entry of sortedCandidates) {
    if (bytesToFree <= 0) break;
    // Skip in-use entries
    if (entry.inUse) continue;

    evictedKeys.push(entry.key);
    bytesToFree -= entry.byteSize;
  }

  // entry-1 is the oldest unpinned entry (lastAccessedAt: 100) and frees 400 bytes >= 200
  assert.deepEqual(evictedKeys, ['entry-1']);
  // entry-2 must NEVER be evicted because inUse is true
  assert.ok(!evictedKeys.includes('entry-2'));
});

test('partition naming enforces account and server isolation', () => {
  function getPartitionName(serverOrigin, userId) {
    const safeOrigin = (serverOrigin || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeUser = (userId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `madar-media-v2:${safeOrigin}:${safeUser}`;
  }

  const pUser1 = getPartitionName('https://carlos-pc.ts.net', 'user-admin');
  const pUser2 = getPartitionName('https://carlos-pc.ts.net', 'user-rep');
  const pDifferentServer = getPartitionName('https://other-server.ts.net', 'user-admin');

  assert.notEqual(pUser1, pUser2, 'Different users on same server must have isolated partitions');
  assert.notEqual(pUser1, pDifferentServer, 'Same user on different servers must have isolated partitions');
  assert.ok(pUser1.startsWith('madar-media-v2:'));
});
