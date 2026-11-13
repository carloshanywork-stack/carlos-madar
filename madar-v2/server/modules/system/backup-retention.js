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

/** Read every compressed entry, checking actual size and CRC, without extracting customer files. */
export async function verifyBackupArchive(path, { maxBytes = backupByteLimit() } = {}) {
  const zip = await new Promise((resolve, reject) => yauzl.open(path,
    { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
    (error, archive) => error ? reject(error) : resolve(archive)));
  const seen = new Set(); let totalBytes = 0; let entries = 0;
  await new Promise((resolve, reject) => {
    const fail = (error) => { zip.close(); reject(error); };
    zip.on('error', fail); zip.on('end', resolve);
    zip.on('entry', (entry) => {
      (async () => {
        const name = entry.fileName;
        if (seen.has(name) || name.startsWith('/') || name.includes('\\') || name.includes('\0')
            || name.split('/').filter(Boolean).some(part => part === '..' || part === '.' || part.includes(':'))
            || ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
            || !(name.startsWith('storage/') || name === 'data/madar-v2.sqlite' || name === 'madar-v2-backup.json')) {
          throw new Error('Backup contains an unsafe or unexpected entry.');
        }
        seen.add(name);
        if (++entries > 250_000 || (totalBytes += entry.uncompressedSize) > maxBytes) throw new Error('Backup exceeds the configured restore limit.');
        if (name.endsWith('/')) return;
        const stream = await new Promise((resolve, reject) => zip.openReadStream(entry,
          (error, input) => error ? reject(error) : resolve(input)));
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

/** Only application-owned regular ZIP files are eligible. Never delete recovery/release archives. */
export async function retainLatestBackup(root, verifiedFilename) {
  if (!BACKUP_FILENAME.test(verifiedFilename)) throw new Error('Invalid verified backup filename.');
  const retained = await lstat(join(root, verifiedFilename));
  if (!retained.isFile() || retained.isSymbolicLink()) throw new Error('Verified backup is not a regular file.');
  const removed = [];
  for (const name of await readdir(root)) {
    if (!BACKUP_FILENAME.test(name) || name >= verifiedFilename) continue;
    const metadata = await lstat(join(root, name));
    if (!metadata.isFile() || metadata.isSymbolicLink()) continue;
    await rm(join(root, name)); removed.push(name);
  }
  return removed.length;
}
