import { ZipArchive } from 'archiver';
import { closeSync, createWriteStream, existsSync, openSync, readSync } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import Database from 'better-sqlite3';
import * as yauzl from 'yauzl';
import multer from 'multer';
import { Router } from 'express';
import { db } from '../../database/connection.js';
import { backupRoot, dataDirectory, repApkPath, storageMountPath, storageRoot } from '../../config/paths.js';
import { recordAudit } from '../audit.js';
import { requestActorId } from '../actor.js';
import { asyncHandler, HttpError } from '../http.js';
import { withMaintenanceOrderStorageLock } from '../maintenance/deletion-lock.js';
import { getStorageHealth } from './health.js';

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024 * 1024;
const MAX_ENTRIES = 250_000;
const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');
const router = Router();
const backupSchedulerState = { lastRunAt: null, lastError: null, timer: null, running: null, nextRunAt: null, stop: null };

export function checkSystemDatabaseHealth(database = db) {
  const integrity = database.pragma('integrity_check', { simple: true });
  const foreignKeyViolations = database.pragma('foreign_key_check');
  return {
    status: integrity === 'ok' && foreignKeyViolations.length === 0 ? 'ok' : 'error',
    integrity,
    foreignKeyViolations: foreignKeyViolations.length,
    checkedAt: new Date().toISOString(),
  };
}

function checkAndCheckpointDatabase(database) {
  const checkpoint = database.pragma('wal_checkpoint(PASSIVE)')[0];
  const health = checkSystemDatabaseHealth(database);
  if (health.status !== 'ok') {
    throw new Error(`SQLite health check failed: integrity=${health.integrity}, foreignKeyViolations=${health.foreignKeyViolations}`);
  }
  return { checkpoint, health };
}

function nextDailyBackupDate(now = new Date()) {
  const hour = Number(process.env.MADAR_V2_BACKUP_HOUR ?? 2);
  const minute = Number(process.env.MADAR_V2_BACKUP_MINUTE ?? 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('MADAR_V2_BACKUP_HOUR/MINUTE must specify a valid daily local time.');
  }
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export function startSystemBackupScheduler({ database = db, createBackup = createSystemBackup, logger = console } = {}) {
  if (backupSchedulerState.stop) return stopSystemBackupScheduler;
  let stopped = false;
  const schedule = () => {
    if (stopped) return;
    const nextRun = nextDailyBackupDate();
    backupSchedulerState.nextRunAt = nextRun.toISOString();
    backupSchedulerState.timer = setTimeout(async () => {
      backupSchedulerState.timer = null;
      backupSchedulerState.running = (async () => {
        try {
          const backup = await createBackup(database);
          backupSchedulerState.lastRunAt = new Date().toISOString();
          backupSchedulerState.lastError = null;
          logger.info?.(`Scheduled MADAR V2 backup created: ${backup.filename}`);
        } catch (error) {
          backupSchedulerState.lastError = error.message;
          logger.error?.('Scheduled MADAR V2 backup failed:', error);
        } finally {
          backupSchedulerState.running = null;
          schedule();
        }
      })();
      await backupSchedulerState.running;
    }, Math.max(0, nextRun.getTime() - Date.now()));
    backupSchedulerState.timer.unref?.();
  };
  backupSchedulerState.stop = () => { stopped = true; };
  schedule();
  return stopSystemBackupScheduler;
}

export function stopSystemBackupScheduler() {
  backupSchedulerState.stop?.();
  backupSchedulerState.stop = null;
  if (backupSchedulerState.timer) clearTimeout(backupSchedulerState.timer);
  backupSchedulerState.timer = null;
  backupSchedulerState.nextRunAt = null;
  return backupSchedulerState.running ?? Promise.resolve();
}

function inside(parent, candidate) {
  const rel = relative(parent, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function ensureRealDirectory(directory) {
  await mkdir(directory, { recursive: true });
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new HttpError(500, 'Backup and storage roots must be real directories.');
}

async function ensureBackupDirectory() {
  if (inside(storageRoot, backupRoot)) throw new HttpError(500, 'Backup directory cannot be inside the customer storage root.');
  await ensureRealDirectory(backupRoot);
}

async function safeStorageTree(root) {
  await ensureRealDirectory(root);
  const realRoot = await realpath(root);
  const files = [];
  const directories = [];
  async function walk(directory, relativePath = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length === 0 && relativePath) directories.push(relativePath);
    for (const entry of entries) {
      const absolute = join(directory, entry.name);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) throw new HttpError(400, 'Backups refuse symbolic links in customer storage.');
      if (!relativePath && entry.name === '.madar-recovery') {
        if (!metadata.isDirectory()) throw new HttpError(400, 'Maintenance recovery staging must be a directory.');
        continue;
      }
      const rel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (metadata.isDirectory()) {
        await walk(absolute, rel);
      } else if (metadata.isFile()) {
        const real = await realpath(absolute);
        if (!inside(realRoot, real)) throw new HttpError(400, 'Storage file escapes the configured storage root.');
        files.push({ absolute, relative: rel });
      }
    }
  }
  await walk(root);
  return { files, directories };
}

function safeBackupFilename(value) {
  if (typeof value !== 'string' || !/^madar-v2-backup-[0-9TZ-]+\.zip$/.test(value)) throw new HttpError(400, 'Invalid backup filename.');
  return value;
}

function openZip(filePath) {
  return new Promise((resolveZip, reject) => {
    yauzl.open(filePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (error, zipFile) => {
      if (error) reject(new HttpError(400, 'The uploaded file is not a readable ZIP archive.'));
      else resolveZip(zipFile);
    });
  });
}

function validateEntryName(rawName, isDirectory) {
  if (typeof rawName !== 'string' || !rawName || rawName.includes('\\') || rawName.includes('\0') || rawName.startsWith('/')) {
    throw new HttpError(400, 'Backup contains an unsafe ZIP path.');
  }
  const name = isDirectory && rawName.endsWith('/') ? rawName.slice(0, -1) : rawName;
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) throw new HttpError(400, 'Backup contains an unsafe ZIP path.');
  if (parts[0] === 'storage') {
    if (parts[1] === '.madar-recovery') throw new HttpError(400, 'Backup archives may not contain maintenance recovery staging.');
    return parts;
  }
  if (name === 'data/madar-v2.sqlite' || name === 'madar-v2-backup.json') return parts;
  if (isDirectory && ['storage', 'data'].includes(name)) return parts;
  throw new HttpError(400, 'Backup contains an unexpected file.');
}

async function extractBackupArchive(archivePath, stageRoot) {
  const zip = await openZip(archivePath);
  const seen = new Set();
  let entryCount = 0;
  let totalBytes = 0;
  let sawStorage = false;
  let sawDatabase = false;
  await new Promise((resolveDone, rejectDone) => {
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      zip.close();
      rejectDone(error);
    };
    zip.on('error', fail);
    zip.on('end', () => {
      if (settled) return;
      settled = true;
      resolveDone();
    });
    zip.on('entry', (entry) => {
      void (async () => {
        entryCount += 1;
        if (entryCount > MAX_ENTRIES) throw new HttpError(413, 'Backup contains too many ZIP entries.');
        const isDirectory = entry.fileName.endsWith('/');
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000) throw new HttpError(400, 'Backup may not contain symbolic links.');
        const parts = validateEntryName(entry.fileName, isDirectory);
        const normalizedName = parts.join('/') + (isDirectory ? '/' : '');
        if (seen.has(normalizedName)) throw new HttpError(400, 'Backup contains duplicate ZIP paths.');
        seen.add(normalizedName);
        if (parts[0] === 'storage') sawStorage = true;
        if (entry.fileName === 'data/madar-v2.sqlite') sawDatabase = true;
        if (entry.uncompressedSize > MAX_ARCHIVE_BYTES || (totalBytes += entry.uncompressedSize) > MAX_ARCHIVE_BYTES) {
          throw new HttpError(413, 'Backup expands beyond the allowed 10 GB limit.');
        }
        const target = resolve(stageRoot, ...parts);
        if (!inside(stageRoot, target)) throw new HttpError(400, 'Backup path escapes its staging directory.');
        if (isDirectory) {
          await mkdir(target, { recursive: true });
        } else {
          await mkdir(dirname(target), { recursive: true });
          const stream = await new Promise((resolveStream, rejectStream) => {
            zip.openReadStream(entry, (error, inputStream) => error ? rejectStream(error) : resolveStream(inputStream));
          });
          await pipeline(stream, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
        }
      })().then(() => zip.readEntry(), fail);
    });
    zip.readEntry();
  });
  if (!sawStorage || !sawDatabase) throw new HttpError(400, 'Backup must contain data/madar-v2.sqlite and the storage folder.');
  return { databaseFile: join(stageRoot, 'data', 'madar-v2.sqlite'), storageDirectory: join(stageRoot, 'storage') };
}

function schemaFingerprint(database) {
  return database.prepare(`SELECT type, name, sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
}

function validateSnapshot(snapshotPath) {
  const header = readFileSyncHeader(snapshotPath);
  if (!header.equals(SQLITE_HEADER)) throw new HttpError(400, 'Backup database does not have a valid SQLite header.');
  let snapshot;
  try {
    snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true });
    if (snapshot.pragma('integrity_check', { simple: true }) !== 'ok') throw new HttpError(400, 'Backup database failed SQLite integrity checks.');
    if (snapshot.pragma('foreign_key_check').length) throw new HttpError(400, 'Backup database contains foreign-key violations.');
    const currentSchema = schemaFingerprint(db);
    const incomingSchema = schemaFingerprint(snapshot);
    if (JSON.stringify(currentSchema) !== JSON.stringify(incomingSchema)) {
      throw new HttpError(409, 'Backup schema does not match this MADAR V2 installation. Apply compatible migrations before restoring it.');
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'Backup database could not be validated.');
  } finally {
    snapshot?.close();
  }
}

function readFileSyncHeader(filePath) {
  // Keep the check bounded; the complete database may be many gigabytes.
  const descriptor = openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(SQLITE_HEADER.length);
    readSync(descriptor, header, 0, header.length, 0);
    return header;
  } finally {
    closeSync(descriptor);
  }
}

async function replaceDatabaseFromSnapshot(snapshotPath, actorId) {
  const escapedSnapshot = snapshotPath.replaceAll("'", "''");
  db.exec(`ATTACH DATABASE '${escapedSnapshot}' AS restored_snapshot`);
  try {
    const tables = db.prepare(`SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((row) => row.name);
    const snapshotTables = db.prepare(`SELECT name FROM restored_snapshot.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map((row) => row.name);
    if (JSON.stringify(tables) !== JSON.stringify(snapshotTables)) throw new HttpError(409, 'Backup tables do not match the live schema.');
    const schema = db.prepare(`SELECT type, name, sql FROM main.sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
    const snapshotSchema = db.prepare(`SELECT type, name, sql FROM restored_snapshot.sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
    if (JSON.stringify(schema) !== JSON.stringify(snapshotSchema)) throw new HttpError(409, 'Backup schema changed during validation.');
    db.transaction(() => {
      db.exec('PRAGMA defer_foreign_keys = ON');
      for (const table of tables) db.exec(`DELETE FROM main."${table.replaceAll('"', '""')}"`);
      for (const table of tables) {
        const quoted = table.replaceAll('"', '""');
        const columns = db.prepare(`PRAGMA main.table_info("${quoted}")`).all().map((column) => column.name);
        const fields = columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(', ');
        db.exec(`INSERT INTO main."${quoted}" (${fields}) SELECT ${fields} FROM restored_snapshot."${quoted}"`);
      }
      const hasSequence = db.prepare(`SELECT 1 FROM main.sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`).get();
      if (hasSequence) {
        for (const table of tables) {
          const sequence = db.prepare('SELECT seq FROM restored_snapshot.sqlite_sequence WHERE name = ?').get(table);
          if (!sequence) continue;
          const current = db.prepare('SELECT 1 FROM main.sqlite_sequence WHERE name = ?').get(table);
          if (current) db.prepare('UPDATE main.sqlite_sequence SET seq = ? WHERE name = ?').run(sequence.seq, table);
          else db.prepare('INSERT INTO main.sqlite_sequence (name, seq) VALUES (?, ?)').run(table, sequence.seq);
        }
      }
      db.prepare('UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL').run();
      const safeActorId = actorId && db.prepare('SELECT 1 FROM users WHERE id = ?').get(actorId) ? actorId : null;
      recordAudit({ database: db, actorId: safeActorId, action: 'restore', entityType: 'system_backup', entityId: 1,
        newValues: { restored_at: new Date().toISOString(), sessions_revoked: true } });
    }).immediate();
    const violations = db.pragma('foreign_key_check');
    if (violations.length) throw new HttpError(400, 'Restored database failed foreign-key validation.');
  } finally {
    db.exec('DETACH DATABASE restored_snapshot');
  }
}

async function restoreStorageFromStage(stagedStorage, actorId) {
  await safeStorageTree(stagedStorage);
  await ensureRealDirectory(dirname(storageRoot));
  let existing = false;
  try {
    const metadata = await lstat(storageRoot);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new HttpError(400, 'Current storage root is not a real directory.');
    existing = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const oldStoragePath = join(dirname(storageRoot), `.madar-v2-storage-old-${randomUUID()}`);
  if (existing) await rename(storageRoot, oldStoragePath);
  try {
    await rename(stagedStorage, storageRoot);
    try {
      await replaceDatabaseFromSnapshot(actorId.snapshotPath, actorId.actorId);
    } catch (error) {
      await rm(storageRoot, { recursive: true, force: true });
      if (existing) await rename(oldStoragePath, storageRoot);
      throw error;
    }
    if (existing) await rm(oldStoragePath, { recursive: true, force: true });
  } catch (error) {
    if (existing) {
      try { await access(oldStoragePath); await rename(oldStoragePath, storageRoot); } catch { /* already restored */ }
    }
    throw error;
  }
}

async function restoreBackupFile(uploadedPath, actorId) {
  return withMaintenanceOrderStorageLock(async () => {
    assertNoPreparedMaintenanceDeletion(db);
    const storageParent = dirname(storageRoot);
    await ensureRealDirectory(storageParent);
    const stageRoot = await mkdtemp(join(storageParent, '.madar-v2-restore-'));
    try {
      const { databaseFile, storageDirectory } = await extractBackupArchive(uploadedPath, stageRoot);
      validateSnapshot(databaseFile);
      await restoreStorageFromStage(storageDirectory, { snapshotPath: databaseFile, actorId });
      return { restored: true, restoredAt: new Date().toISOString() };
    } finally {
      await rm(stageRoot, { recursive: true, force: true });
    }
  });
}

function assertNoPreparedMaintenanceDeletion(database) {
  if (database.prepare(`
    SELECT 1
    FROM maintenance_order_deletion_operations
    WHERE state = 'prepared'
    UNION ALL
    SELECT 1
    FROM maintenance_card_deletion_operations
    WHERE state = 'prepared'
    UNION ALL
    SELECT 1
    FROM maintenance_machine_decommission_operations
    WHERE state = 'prepared'
    UNION ALL
    SELECT 1
    FROM maintenance_unmatched_folder_deletion_operations
    LIMIT 1
  `).get()) {
    throw new HttpError(409, 'A maintenance photo-folder recovery is pending. Restart the server before continuing.');
  }
}

export async function createSystemBackup(database = db) {
  return withMaintenanceOrderStorageLock(async () => {
    assertNoPreparedMaintenanceDeletion(database);
    const { health } = checkAndCheckpointDatabase(database);
    await ensureBackupDirectory();
    const storage = await safeStorageTree(storageRoot);
    const createdAt = new Date();
    const stamp = createdAt.toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const filename = `madar-v2-backup-${stamp}.zip`;
    const outputPath = join(backupRoot, filename);
    const snapshotPath = join(backupRoot, `.snapshot-${randomUUID()}.sqlite`);
    try {
      await database.backup(snapshotPath);
      const output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
      const archive = new ZipArchive({ zlib: { level: 6 } });
      const done = new Promise((resolveDone, rejectDone) => {
        output.on('close', resolveDone);
        output.on('error', rejectDone);
        archive.on('error', rejectDone);
        archive.on('warning', (error) => error.code === 'ENOENT' ? rejectDone(error) : rejectDone(error));
      });
      archive.pipe(output);
      archive.append(Buffer.alloc(0), { name: 'storage/' });
      for (const directory of storage.directories) archive.append(Buffer.alloc(0), { name: `storage/${directory}/` });
      for (const file of storage.files) archive.file(file.absolute, { name: `storage/${file.relative}` });
      archive.file(snapshotPath, { name: 'data/madar-v2.sqlite' });
      archive.append(JSON.stringify({ format: 'madar-v2-backup', version: 1, createdAt: createdAt.toISOString() }, null, 2), { name: 'madar-v2-backup.json' });
      await archive.finalize();
      await done;
      const metadata = await stat(outputPath);
      return { filename, sizeBytes: metadata.size, createdAt: createdAt.toISOString(), databaseHealth: health.status };
    } catch (error) {
      await rm(outputPath, { force: true });
      throw error;
    } finally {
      await rm(snapshotPath, { force: true });
    }
  });
}

export async function listSystemBackups() {
  await ensureBackupDirectory();
  const files = await readdir(backupRoot, { withFileTypes: true });
  const backups = [];
  for (const file of files) {
    if (!file.isFile() || extname(file.name).toLowerCase() !== '.zip' || !file.name.startsWith('madar-v2-backup-')) continue;
    const path = join(backupRoot, file.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) continue;
    backups.push({ filename: file.name, sizeBytes: metadata.size, modifiedAt: metadata.mtime.toISOString() });
  }
  return backups.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

async function sendBackup(req, res) {
  const filename = safeBackupFilename(req.params.filename);
  const absolute = join(backupRoot, filename);
  const metadata = await lstat(absolute).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error));
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) throw new HttpError(404, 'Backup file was not found.');
  res.download(absolute, filename);
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Administrator access is required.' });
    return;
  }
  next();
}

const restoreUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, callback) {
      mkdir(join(dataDirectory, '.restore-incoming'), { recursive: true })
        .then(() => callback(null, join(dataDirectory, '.restore-incoming'))).catch(callback);
    },
    filename(req, file, callback) { callback(null, `${randomUUID()}.zip`); },
  }),
  limits: { fileSize: MAX_ARCHIVE_BYTES, files: 1, fields: 5, parts: 6 },
  fileFilter(req, file, callback) {
    callback(null, extname(file.originalname).toLowerCase() === '.zip');
  },
}).single('file');

router.use(adminOnly);
router.get('/health', asyncHandler(async (req, res) => {
  let database;
  try {
    database = checkSystemDatabaseHealth();
  } catch {
    database = {
      status: 'error',
      integrity: 'unavailable',
      foreignKeyViolations: null,
      checkedAt: new Date().toISOString(),
    };
  }
  const storage = await getStorageHealth({
    storagePath: storageMountPath ?? storageRoot,
    mountRequired: Boolean(storageMountPath),
  });
  const status = database.status !== 'ok' || storage.status === 'error'
    ? 'error'
    : storage.status === 'warning' ? 'warning' : 'ok';
  const health = {
    status,
    uptimeSeconds: Math.floor(process.uptime()),
    database,
    storage,
    backups: {
      lastScheduledAt: backupSchedulerState.lastRunAt,
      lastError: backupSchedulerState.lastError,
      nextScheduledAt: backupSchedulerState.nextRunAt,
    },
  };
  res.status(status === 'error' ? 503 : 200).json(health);
}));
router.post('/backup', asyncHandler(async (req, res) => {
  const backup = await createSystemBackup();
  recordAudit({ actorId: requestActorId(req), action: 'create', entityType: 'system_backup', entityId: 1, newValues: backup });
  res.status(201).json(backup);
}));
router.get('/backups', asyncHandler(async (req, res) => res.json(await listSystemBackups())));
router.get('/backups/:filename/download', asyncHandler(sendBackup));
router.post('/backup/restore', restoreUpload, asyncHandler(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'A ZIP backup file is required.');
  try {
    res.json(await restoreBackupFile(req.file.path, requestActorId(req)));
  } finally {
    await rm(req.file.path, { force: true });
  }
}));

router.get('/apk-info', asyncHandler(async (_req, res) => {
  const exists = existsSync(repApkPath);
  let sizeBytes = 0;
  let modifiedAt = null;
  if (exists) {
    const fileStat = await stat(repApkPath);
    sizeBytes = fileStat.size;
    modifiedAt = fileStat.mtime.toISOString();
  }
  res.json({
    exists,
    filename: 'madar-rep.apk',
    downloadUrl: '/download/apk',
    sizeBytes,
    modifiedAt,
  });
}));

export default router;
