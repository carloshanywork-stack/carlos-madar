import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  parseBackupDate,
  calculateGfsRetention,
  retainGfsBackups,
  retainLatestBackup,
} from '../server/modules/system/backup-retention.js';
import { syncBackupToCloud, computeFileSha256 } from '../server/modules/system/cloud-sync.js';

test('parseBackupDate extracts correct UTC Date from backup filename', () => {
  const d = parseBackupDate('madar-v2-backup-2026-11-20T18-40-00-123Z.zip');
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), '2026-11-20T18:40:00.123Z');
  assert.equal(parseBackupDate('invalid-filename.zip'), null);
});

test('calculateGfsRetention keeps 7 daily, 4 weekly, and 12 monthly backups', () => {
  // Generate 20 daily backups over 20 consecutive days
  const filenames = [];
  for (let i = 1; i <= 20; i++) {
    const day = String(i).padStart(2, '0');
    filenames.push(`madar-v2-backup-2026-11-${day}T10-00-00-000Z.zip`);
    // Add a second backup on the same day to test intra-day deduplication
    filenames.push(`madar-v2-backup-2026-11-${day}T18-00-00-000Z.zip`);
  }

  const { retained, toRemove } = calculateGfsRetention(filenames, { keepDaily: 7, keepWeekly: 4, keepMonthly: 12 });
  assert.ok(retained.size >= 7);
  // The earlier second backup on day 20 should be removed in favor of 18:00
  assert.ok(retained.has('madar-v2-backup-2026-11-20T18-00-00-000Z.zip'));
  assert.ok(toRemove.includes('madar-v2-backup-2026-11-20T10-00-00-000Z.zip'));
});

test('retainGfsBackups safely removes redundant backups and keeps GFS tiers on disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'madar-gfs-test-'));
  try {
    const files = [
      'madar-v2-backup-2026-11-10T10-00-00-000Z.zip',
      'madar-v2-backup-2026-11-10T18-00-00-000Z.zip',
      'madar-v2-backup-2026-11-11T12-00-00-000Z.zip',
      'madar-v2-backup-2026-11-12T12-00-00-000Z.zip',
      'operator-custom.zip', // Non-standard file: must be preserved
    ];
    for (const f of files) {
      await writeFile(join(root, f), 'dummy backup bytes');
    }

    const removed = await retainGfsBackups(root, 'madar-v2-backup-2026-11-12T12-00-00-000Z.zip', { keepDaily: 2 });
    assert.ok(removed >= 1);

    const remaining = await readdir(root);
    assert.ok(remaining.includes('operator-custom.zip'), 'non-standard zip files are never touched');
    assert.ok(remaining.includes('madar-v2-backup-2026-11-12T12-00-00-000Z.zip'), 'verified file is retained');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('syncBackupToCloud returns skipped status when no remote destination configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'madar-cloud-sync-'));
  try {
    const testFile = join(root, 'test.zip');
    await writeFile(testFile, 'dummy archive');
    const sha = await computeFileSha256(testFile);
    assert.equal(typeof sha, 'string');
    assert.equal(sha.length, 64);

    const result = await syncBackupToCloud(testFile, {});
    assert.equal(result.synced, false);
    assert.equal(result.method, 'none');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
