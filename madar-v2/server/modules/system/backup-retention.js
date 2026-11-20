import { crc32 } from 'node:zlib';
import { lstat, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import * as yauzl from 'yauzl';

export const BACKUP_FILENAME = /^madar-v2-backup-[0-9TZ-]+\.zip$/;
export function backupByteLimit(value = process.env.MADAR_V2_BACKUP_MAX_GB ?? '64') {
  const gb = Number(value);
  if (!Number.isInteger(gb) || gb < 1 || gb > 1024) throw new Error('MADAR_V2_BACKUP_MAX_GB must be an integer from 1 to 1024.');
  return gb * 1024 ** 3;
}

/** Parse ISO Date from standard MADAR backup filename. */
export function parseBackupDate(filename) {
  const match = filename.match(/^madar-v2-backup-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.zip$/);
  if (!match) return null;
  const [, ymd, hh, mm, ss, ms] = match;
  return new Date(`${ymd}T${hh}:${mm}:${ss}.${ms}Z`);
}

/**
 * Pure helper that determines which backups to retain under Grandfather-Father-Son (GFS) strategy:
 * - Daily: latest backup for each day up to keepDaily days (default 7).
 * - Weekly: latest backup for each calendar week up to keepWeekly weeks (default 4).
 * - Monthly: latest backup for each calendar month up to keepMonthly months (default 12).
 */
export function calculateGfsRetention(filenames, { keepDaily = 7, keepWeekly = 4, keepMonthly = 12 } = {}) {
  const validFiles = filenames
    .filter((name) => BACKUP_FILENAME.test(name))
    .map((name) => ({ name, date: parseBackupDate(name) }))
    .filter((item) => item.date !== null && Number.isFinite(item.date.getTime()))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first

  if (validFiles.length === 0) return { retained: new Set(), toRemove: [] };

  const retained = new Set();

  // 1. Daily bucket: group by YYYY-MM-DD
  const dailyGroups = new Map();
  for (const item of validFiles) {
    const key = item.date.toISOString().slice(0, 10);
    if (!dailyGroups.has(key)) dailyGroups.set(key, item.name);
  }
  const dailyKept = Array.from(dailyGroups.values()).slice(0, keepDaily);
  for (const name of dailyKept) retained.add(name);

  // 2. Weekly bucket: group by Year-Week (using ISO week representation)
  const weeklyGroups = new Map();
  for (const item of validFiles) {
    const d = new Date(Date.UTC(item.date.getFullYear(), item.date.getMonth(), item.date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    const key = `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    if (!weeklyGroups.has(key)) weeklyGroups.set(key, item.name);
  }
  const weeklyKept = Array.from(weeklyGroups.values()).slice(0, keepWeekly);
  for (const name of weeklyKept) retained.add(name);

  // 3. Monthly bucket: group by YYYY-MM
  const monthlyGroups = new Map();
  for (const item of validFiles) {
    const key = item.date.toISOString().slice(0, 7);
    if (!monthlyGroups.has(key)) monthlyGroups.set(key, item.name);
  }
  const monthlyKept = Array.from(monthlyGroups.values()).slice(0, keepMonthly);
  for (const name of monthlyKept) retained.add(name);

  const toRemove = validFiles.map((x) => x.name).filter((name) => !retained.has(name));
  return { retained, toRemove };
}

/** Read every compressed entry, checking actual size and CRC, without extracting customer files. */
export async function verifyBackupArchive(path, { maxBytes = backupByteLimit() } = {}) {
  const zip = await new Promise((resolve, reject) => yauzl.open(path,
    { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
    (error, archive) => (error ? reject(error) : resolve(archive))));
  const seen = new Set(); let totalBytes = 0; let entries = 0;
  await new Promise((resolve, reject) => {
    const fail = (error) => { zip.close(); reject(error); };
    zip.on('error', fail); zip.on('end', resolve);
    zip.on('entry', (entry) => {
      (async () => {
        const name = entry.fileName;
        if (seen.has(name) || name.startsWith('/') || name.includes('\\') || name.includes('\0')
            || name.split('/').filter(Boolean).some((part) => part === '..' || part === '.' || part.includes(':'))
            || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
            || !(name.startsWith('storage/') || name === 'data/madar-v2.sqlite' || name === 'madar-v2-backup.json')) {
          throw new Error('Backup contains an unsafe or unexpected entry.');
        }
        seen.add(name);
        if (++entries > 250_000 || (totalBytes += entry.uncompressedSize) > maxBytes) throw new Error('Backup exceeds the configured restore limit.');
        if (name.endsWith('/')) return;
        const stream = await new Promise((resolve, reject) => zip.openReadStream(entry,
          (error, input) => (error ? reject(error) : resolve(input))));
        let crc = 0; let bytes = 0;
        for await (const chunk of stream) { crc = crc32(chunk, crc); bytes += chunk.length; }
        if (bytes !== entry.uncompressedSize || crc !== entry.crc32) throw new Error('Backup entry failed CRC/size validation.');
      })().then(() => zip.readEntry(), fail);
    });
    zip.readEntry();
  });
  if (!seen.has('data/madar-v2.sqlite') || !seen.has('madar-v2-backup.json') || !seen.has('storage/')) throw new Error('Backup is missing required contents.');
  return { entries, totalBytes, crcVerified: true };
}

/** Retain backups using Grandfather-Father-Son (GFS) rotation scheme. */
export async function retainGfsBackups(root, verifiedFilename, { keepDaily = 7, keepWeekly = 4, keepMonthly = 12 } = {}) {
  if (!BACKUP_FILENAME.test(verifiedFilename)) throw new Error('Invalid verified backup filename.');
  const retained = await lstat(join(root, verifiedFilename));
  if (!retained.isFile() || retained.isSymbolicLink()) throw new Error('Verified backup is not a regular file.');

  const allEntries = await readdir(root);
  const eligibleFiles = allEntries.filter((name) => BACKUP_FILENAME.test(name));
  const { retained: gfsSet, toRemove } = calculateGfsRetention(eligibleFiles, { keepDaily, keepWeekly, keepMonthly });

  // The freshly verified backup is guaranteed retained
  gfsSet.add(verifiedFilename);

  const removed = [];
  for (const name of toRemove) {
    if (name === verifiedFilename) continue;
    const metadata = await lstat(join(root, name));
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
    await rm(join(root, name));
    removed.push(name);
  }
  return removed.length;
}

/**
 * Retain backups according to the configured retention policy.
 * Defaults to 'latest' for backward compatibility with existing tests and scripts,
 * or 'gfs' when requested.
 */
export async function retainLatestBackup(root, verifiedFilename, options = {}) {
  const policy = options.policy ?? process.env.MADAR_BACKUP_POLICY ?? 'latest';
  if (policy === 'gfs') {
    return retainGfsBackups(root, verifiedFilename, options);
  }

  if (!BACKUP_FILENAME.test(verifiedFilename)) throw new Error('Invalid verified backup filename.');
  const retained = await lstat(join(root, verifiedFilename));
  if (!retained.isFile() || retained.isSymbolicLink()) throw new Error('Verified backup is not a regular file.');
  const removed = [];
  for (const name of await readdir(root)) {
    if (!BACKUP_FILENAME.test(name) || name >= verifiedFilename) continue;
    const metadata = await lstat(join(root, name));
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
    await rm(join(root, name));
    removed.push(name);
  }
  return removed.length;
}
