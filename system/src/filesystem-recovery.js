const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const RECOVERY_DIRECTORY = '.madar-recovery'
const MARKER_NAME = '.madar-recovery-operation.json'
const OPERATION_KINDS = new Set([
  'storage-delete',
  'machine-import-delete',
  'image-eradication',
  'machine-catalog-wipe',
])

function apiError(message) {
  return Object.assign(new Error(message), { status: 500 })
}

function isPathWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function relativeStoragePath(storageRoot, absolutePath) {
  const root = path.resolve(storageRoot)
  const target = path.resolve(absolutePath)
  if (!isPathWithin(root, target) || target === root) throw apiError('Recovery path is outside the configured storage root.')
  const relative = path.relative(root, target).split(path.sep).join('/')
  if (relative.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw apiError('Recovery path is invalid.')
  }
  return relative
}

function resolveStoragePath(storageRoot, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || relativePath.includes('\0')) {
    throw apiError('Recovery journal contains an invalid storage path.')
  }
  const parts = relativePath.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw apiError('Recovery journal contains an invalid storage path.')
  }
  const root = path.resolve(storageRoot)
  const absolute = path.resolve(root, ...parts)
  if (!isPathWithin(root, absolute) || absolute === root) throw apiError('Recovery journal path escapes storage.')
  return absolute
}

async function lstatOrNull(target) {
  try { return await fs.lstat(target) }
  catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

async function assertNoSymlinkComponents(storageRoot, target) {
  const root = path.resolve(storageRoot)
  const resolvedTarget = path.resolve(target)
  if (!isPathWithin(root, resolvedTarget)) throw apiError('Recovery path is outside the configured storage root.')
  const rootStats = await fs.lstat(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) throw apiError('Configured storage root is not a regular directory.')
  const relative = path.relative(root, resolvedTarget)
  let cursor = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment)
    const stats = await lstatOrNull(cursor)
    if (!stats) break
    if (stats.isSymbolicLink()) throw apiError('Recovery path contains a symbolic link.')
  }
}

function parseOperationRow(row) {
  if (!row || !OPERATION_KINDS.has(row.kind) || !/^[0-9a-f-]{36}$/i.test(row.id)) {
    throw apiError('Filesystem recovery record is invalid; startup must stop for manual review.')
  }
  let items
  try { items = JSON.parse(row.payload) }
  catch { throw apiError('Filesystem recovery record cannot be read; startup must stop for manual review.') }
  if (!Array.isArray(items) || items.some((item, index) => !item
    || typeof item.original !== 'string'
    || item.staged !== `${RECOVERY_DIRECTORY}/${row.id}/item-${index}`
    || !['file', 'directory'].includes(item.type))) {
    throw apiError('Filesystem recovery record contains unexpected paths; startup must stop for manual review.')
  }
  return items
}

async function verifyStageMarker(storageRoot, id, kind, { allowMissing = false } = {}) {
  const stageRoot = path.join(path.resolve(storageRoot), RECOVERY_DIRECTORY, id)
  await assertNoSymlinkComponents(storageRoot, stageRoot)
  const stats = await lstatOrNull(stageRoot)
  if (!stats && allowMissing) return { stageRoot, missing: true }
  if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) {
    throw apiError('Filesystem recovery stage is missing or unsafe; startup must stop for manual review.')
  }
  const markerPath = path.join(stageRoot, MARKER_NAME)
  const markerStats = await lstatOrNull(markerPath)
  if (!markerStats && allowMissing) return { stageRoot, missingMarker: true }
  if (!markerStats?.isFile() || markerStats.isSymbolicLink()) {
    throw apiError('Filesystem recovery stage marker is missing or unsafe; startup must stop for manual review.')
  }
  let marker
  try { marker = JSON.parse(await fs.readFile(markerPath, 'utf8')) }
  catch { throw apiError('Filesystem recovery stage marker cannot be read; startup must stop for manual review.') }
  if (marker.format !== 'madar-filesystem-recovery-v1' || marker.id !== id || marker.kind !== kind) {
    throw apiError('Filesystem recovery stage marker does not match its journal; startup must stop for manual review.')
  }
  return { stageRoot, markerPath }
}

async function removeKnownStageRoot(stageRoot, markerPath) {
  const entries = await fs.readdir(stageRoot)
  const allowed = new Set(markerPath ? [MARKER_NAME] : [])
  if (entries.some((entry) => !allowed.has(entry))) {
    throw apiError('Recovery stage contains unrecognized files; startup must stop for manual review.')
  }
  if (markerPath) await fs.unlink(markerPath)
  await fs.rmdir(stageRoot)
}

async function prepareFilesystemOperation(db, storageRoot, kind, absolutePaths) {
  if (!OPERATION_KINDS.has(kind) || !Array.isArray(absolutePaths) || !absolutePaths.length) {
    throw apiError('Filesystem operation description is invalid.')
  }
  const id = crypto.randomUUID()
  const uniquePaths = [...new Set(absolutePaths.map((absolute) => path.resolve(absolute)))]
  const items = []
  for (const absolute of uniquePaths) {
    const original = relativeStoragePath(storageRoot, absolute)
    await assertNoSymlinkComponents(storageRoot, absolute)
    const stats = await fs.lstat(absolute)
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
      throw apiError('Only regular files and directories can be staged for recovery.')
    }
    items.push({
      original,
      staged: `${RECOVERY_DIRECTORY}/${id}/item-${items.length}`,
      type: stats.isDirectory() ? 'directory' : 'file',
    })
  }
  db.prepare(`INSERT INTO filesystem_operations(id,kind,state,payload)
    VALUES (?,?,'prepared',?)`).run(id, kind, JSON.stringify(items))
  return { id, kind, items }
}

async function stageFilesystemOperation(storageRoot, operation) {
  const recoveryRoot = path.join(path.resolve(storageRoot), RECOVERY_DIRECTORY)
  await assertNoSymlinkComponents(storageRoot, recoveryRoot)
  await fs.mkdir(recoveryRoot, { mode: 0o700 }).catch((error) => {
    if (error.code !== 'EEXIST') throw error
  })
  const recoveryStats = await fs.lstat(recoveryRoot)
  if (!recoveryStats.isDirectory() || recoveryStats.isSymbolicLink()) {
    throw apiError('Recovery root is not a regular directory.')
  }
  const stageRoot = path.join(path.resolve(storageRoot), RECOVERY_DIRECTORY, operation.id)
  await fs.mkdir(stageRoot)
  await fs.writeFile(path.join(stageRoot, MARKER_NAME), JSON.stringify({
    format: 'madar-filesystem-recovery-v1', id: operation.id, kind: operation.kind,
  }), { flag: 'wx', mode: 0o600 })
  for (const item of operation.items) {
    const original = resolveStoragePath(storageRoot, item.original)
    const staged = resolveStoragePath(storageRoot, item.staged)
    await assertNoSymlinkComponents(storageRoot, original)
    await fs.rename(original, staged)
  }
  return operation.items.map((item) => ({
    originalPath: resolveStoragePath(storageRoot, item.original),
    stagedPath: resolveStoragePath(storageRoot, item.staged),
  }))
}

function markFilesystemOperationCommitted(db, id) {
  const result = db.prepare(`UPDATE filesystem_operations SET state='committed',updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND state='prepared'`).run(id)
  if (result.changes !== 1) throw apiError('Filesystem recovery operation could not be committed.')
}

async function rollbackFilesystemOperation(db, storageRoot, id) {
  const row = db.prepare('SELECT * FROM filesystem_operations WHERE id=?').get(id)
  if (!row) return false
  if (row.state !== 'prepared') throw apiError('Committed filesystem operation cannot be rolled back automatically.')
  const items = parseOperationRow(row)
  const stageInfo = await verifyStageMarker(storageRoot, row.id, row.kind, { allowMissing: true })
  const markerlessEmptyStage = stageInfo.missingMarker && (await fs.readdir(stageInfo.stageRoot)).length === 0
  if (stageInfo.missingMarker && !markerlessEmptyStage) {
    throw apiError('Unmarked recovery stage contains data; startup must stop for manual review.')
  }
  if (stageInfo.missing || markerlessEmptyStage) {
    for (const item of items) {
      const original = resolveStoragePath(storageRoot, item.original)
      const originalStats = await lstatOrNull(original)
      if (!originalStats || originalStats.isSymbolicLink()
        || (item.type === 'file' ? !originalStats.isFile() : !originalStats.isDirectory())) {
        throw apiError('Prepared operation has no matching stage or original path; startup must stop for manual review.')
      }
    }
  }
  if (!stageInfo.missing && !stageInfo.missingMarker) {
    for (const item of [...items].reverse()) {
      const original = resolveStoragePath(storageRoot, item.original)
      const staged = resolveStoragePath(storageRoot, item.staged)
      const originalStats = await lstatOrNull(original)
      const stagedStats = await lstatOrNull(staged)
      if (originalStats && stagedStats) throw apiError('Both original and staged paths exist; startup must stop for manual review.')
      if (!originalStats && !stagedStats) throw apiError('Both original and staged paths are missing; startup must stop for manual review.')
      if (originalStats && (originalStats.isSymbolicLink()
        || (item.type === 'file' ? !originalStats.isFile() : !originalStats.isDirectory()))) {
        throw apiError('Original item type is unexpected; startup must stop for manual review.')
      }
      if (stagedStats) {
        if (stagedStats.isSymbolicLink() || (item.type === 'file' ? !stagedStats.isFile() : !stagedStats.isDirectory())) {
          throw apiError('Staged item type is unexpected; startup must stop for manual review.')
        }
        await assertNoSymlinkComponents(storageRoot, path.dirname(original))
        await fs.rename(staged, original)
      }
    }
    await removeKnownStageRoot(stageInfo.stageRoot, stageInfo.markerPath)
  } else if (markerlessEmptyStage) {
    await fs.rmdir(stageInfo.stageRoot)
  }
  db.prepare('DELETE FROM filesystem_operations WHERE id=? AND state=\'prepared\'').run(id)
  return true
}

async function completeFilesystemOperation(db, storageRoot, id) {
  const row = db.prepare('SELECT * FROM filesystem_operations WHERE id=?').get(id)
  if (!row) return true
  if (row.state !== 'committed') throw apiError('Uncommitted filesystem operation cannot be finalized.')
  const items = parseOperationRow(row)
  const stageInfo = await verifyStageMarker(storageRoot, row.id, row.kind, { allowMissing: true })
  if (stageInfo.missing) {
    db.prepare('DELETE FROM filesystem_operations WHERE id=? AND state=\'committed\'').run(id)
    return true
  }
  if (stageInfo.missingMarker) {
    if ((await fs.readdir(stageInfo.stageRoot)).length) {
      throw apiError('Unmarked recovery stage contains data; startup must stop for manual review.')
    }
    await fs.rmdir(stageInfo.stageRoot)
  } else {
    for (const item of items) {
      const staged = resolveStoragePath(storageRoot, item.staged)
      const stats = await lstatOrNull(staged)
      if (!stats) continue
      if (stats.isSymbolicLink() || (item.type === 'file' ? !stats.isFile() : !stats.isDirectory())) {
        throw apiError('Staged item type is unexpected; startup must stop for manual review.')
      }
      await fs.rm(staged, { recursive: item.type === 'directory', force: false })
    }
    await removeKnownStageRoot(stageInfo.stageRoot, stageInfo.markerPath)
  }
  db.prepare('DELETE FROM filesystem_operations WHERE id=? AND state=\'committed\'').run(id)
  return true
}

async function recoverPendingFilesystemOperations(db, storageRoot) {
  let recovered = 0
  let pending = 0
  const rows = db.prepare('SELECT * FROM filesystem_operations ORDER BY created_at,id').all()
  const knownIds = new Set(rows.map((row) => row.id))
  for (const row of rows) {
    if (row.state === 'prepared') {
      await rollbackFilesystemOperation(db, storageRoot, row.id)
      recovered += 1
      continue
    }
    if (row.state !== 'committed') throw apiError('Filesystem recovery state is invalid; startup must stop for manual review.')
    try {
      await completeFilesystemOperation(db, storageRoot, row.id)
      recovered += 1
    } catch (error) {
      pending += 1
      console.error(`Committed filesystem cleanup ${row.id} remains pending:`, error.message)
    }
  }
  const recoveryRoot = path.join(path.resolve(storageRoot), RECOVERY_DIRECTORY)
  await assertNoSymlinkComponents(storageRoot, recoveryRoot)
  const recoveryStats = await lstatOrNull(recoveryRoot)
  if (recoveryStats) {
    if (!recoveryStats.isDirectory() || recoveryStats.isSymbolicLink()) {
      throw apiError('Recovery root is unsafe; startup must stop for manual review.')
    }
    for (const entry of await fs.readdir(recoveryRoot, { withFileTypes: true })) {
      if (!/^[0-9a-f-]{36}$/i.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink() || !knownIds.has(entry.name)) {
        throw apiError('Unjournaled or unexpected filesystem recovery data exists; startup must stop for manual review.')
      }
    }
  }
  return { recovered, pending }
}

function pendingFilesystemOperationsCount(db) {
  return Number(db.prepare('SELECT COUNT(*) AS count FROM filesystem_operations').get().count)
}

module.exports = {
  completeFilesystemOperation,
  markFilesystemOperationCommitted,
  pendingFilesystemOperationsCount,
  prepareFilesystemOperation,
  recoverPendingFilesystemOperations,
  rollbackFilesystemOperation,
  stageFilesystemOperation,
}
