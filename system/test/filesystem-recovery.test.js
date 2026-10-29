const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Database = require('better-sqlite3')
const {
  markFilesystemOperationCommitted,
  prepareFilesystemOperation,
  recoverPendingFilesystemOperations,
  stageFilesystemOperation,
} = require('../src/filesystem-recovery')

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'madar-fs-recovery-test-'))
  const storage = path.join(root, 'storage')
  await fs.mkdir(storage)
  const database = new Database(path.join(root, 'test.sqlite'))
  database.exec(`CREATE TABLE filesystem_operations(
    id TEXT PRIMARY KEY,kind TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  return { root, storage, database }
}

test('recovers a prepared operation by restoring staged files after a rolled-back DB transaction', async () => {
  const { root, storage, database } = await fixture()
  try {
    const original = path.join(storage, 'Areas', 'batch-a')
    await fs.mkdir(original, { recursive: true })
    await fs.writeFile(path.join(original, 'photo.jpg'), 'preserve original')
    const operation = await prepareFilesystemOperation(database, storage, 'image-eradication', [original])
    const staged = await stageFilesystemOperation(storage, operation)
    assert.ok(staged[0].stagedPath.includes(operation.id))
    await assert.rejects(fs.stat(original), { code: 'ENOENT' })

    assert.throws(() => database.transaction(() => {
      database.exec("CREATE TABLE business_change(id INTEGER PRIMARY KEY)")
      markFilesystemOperationCommitted(database, operation.id)
      throw new Error('simulated transaction failure')
    })(), /simulated transaction failure/)
    const result = await recoverPendingFilesystemOperations(database, storage)
    assert.deepEqual(result, { recovered: 1, pending: 0 })
    assert.equal(await fs.readFile(path.join(original, 'photo.jpg'), 'utf8'), 'preserve original')
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM filesystem_operations').get().count, 0)
  } finally {
    database.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('finishes a committed operation after interruption without restoring its deleted data', async () => {
  const { root, storage, database } = await fixture()
  try {
    const original = path.join(storage, 'Uploads', 'Excel', 'machines_import_legacy.xlsx')
    await fs.mkdir(path.dirname(original), { recursive: true })
    await fs.writeFile(original, 'temporary fixture')
    const operation = await prepareFilesystemOperation(database, storage, 'machine-import-delete', [original])
    await stageFilesystemOperation(storage, operation)
    database.transaction(() => {
      database.exec('CREATE TABLE business_change(id INTEGER PRIMARY KEY)')
      markFilesystemOperationCommitted(database, operation.id)
    })()

    const result = await recoverPendingFilesystemOperations(database, storage)
    assert.deepEqual(result, { recovered: 1, pending: 0 })
    await assert.rejects(fs.stat(original), { code: 'ENOENT' })
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM filesystem_operations').get().count, 0)
  } finally {
    database.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})

test('refuses paths outside storage and leaves unexpected staged files for manual review', async () => {
  const { root, storage, database } = await fixture()
  try {
    await assert.rejects(prepareFilesystemOperation(database, storage, 'storage-delete', [root]), /outside the configured storage root/)
    const original = path.join(storage, 'Areas', 'source')
    await fs.mkdir(original, { recursive: true })
    await fs.writeFile(path.join(original, 'image.jpg'), 'source')
    const operation = await prepareFilesystemOperation(database, storage, 'image-eradication', [original])
    const staged = await stageFilesystemOperation(storage, operation)
    await fs.writeFile(path.join(path.dirname(staged[0].stagedPath), 'unknown.txt'), 'do not remove')
    database.transaction(() => markFilesystemOperationCommitted(database, operation.id))()
    const result = await recoverPendingFilesystemOperations(database, storage)
    assert.deepEqual(result, { recovered: 0, pending: 1 })
    assert.equal(await fs.readFile(path.join(path.dirname(staged[0].stagedPath), 'unknown.txt'), 'utf8'), 'do not remove')
  } finally {
    database.close()
    await fs.rm(root, { recursive: true, force: true })
  }
})
