const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Database = require('better-sqlite3')
const JSZip = require('jszip')
const {
  buildRestorePlan,
  extractBackupArchive,
  recoverInterruptedRestore,
  validateZipEntryName,
  validateDatabaseSnapshot,
  validateDatabaseStorageConsistency,
} = require('../src/backup-restore')
const { CURRENT_SCHEMA_VERSION, MADAR_APPLICATION_ID } = require('../src/schema-version')

test('rejects ZIP entries that can escape or target transient storage', () => {
  for (const entry of ['../outside.txt', 'storage/../../outside.txt', '/absolute.txt', 'C:/outside.txt', 'storage/.incoming/upload.zip']) {
    assert.throws(() => validateZipEntryName(entry), /مسار|مؤقتة/)
  }
  assert.deepEqual(validateZipEntryName('storage/Clients/Acme/logo.png'), {
    directory: false,
    parts: ['storage', 'Clients', 'Acme', 'logo.png'],
  })
})

test('validates restore schema markers and rejects foreign-key violations', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-restore-validation-test-'))
  const createSnapshot = (name, { applicationId = MADAR_APPLICATION_ID, schemaVersion = CURRENT_SCHEMA_VERSION,
    orphan = false, financeMigrations = true, manufacturingMappingsMigration = true,
    otherInvoiceAttachmentsMigration = true, otherInvoiceAttachmentsTable = true } = {}) => {
    const databasePath = path.join(tempRoot, name)
    const database = new Database(databasePath)
    database.exec(`
      CREATE TABLE users(id INTEGER PRIMARY KEY);
      CREATE TABLE clients(id INTEGER PRIMARY KEY);
      CREATE TABLE machines(id INTEGER PRIMARY KEY);
      CREATE TABLE orders(id INTEGER PRIMARY KEY, client_id INTEGER REFERENCES clients(id));
      CREATE TABLE schema_migrations(name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE audit_log(id INTEGER PRIMARY KEY);
    `)
    try {
      if (applicationId === MADAR_APPLICATION_ID && schemaVersion >= 6 && otherInvoiceAttachmentsTable) {
        database.exec(`CREATE TABLE other_invoices(id INTEGER PRIMARY KEY);
          CREATE TABLE other_invoice_attachments(id INTEGER PRIMARY KEY, other_invoice_id INTEGER REFERENCES other_invoices(id));`)
      }
      if (applicationId === MADAR_APPLICATION_ID && schemaVersion >= 1) {
        database.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('schema-version-markers-v1')
      }
      if (applicationId === MADAR_APPLICATION_ID && schemaVersion >= 2) {
        database.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('filesystem-recovery-and-backup-health-v1')
      }
      if (applicationId === MADAR_APPLICATION_ID && schemaVersion >= 3 && financeMigrations) {
        database.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('integrated-finance-payroll-stocktaking-v1')
        database.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('integrated-finance-followups-v1')
      }
      if (applicationId === MADAR_APPLICATION_ID && schemaVersion >= 4) {
        database.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('work-order-cogs-v1')
      }
      if (applicationId === MADAR_APPLICATION_ID && schemaVersion >= 5 && manufacturingMappingsMigration) {
        database.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('manufacturing-account-mappings-v1')
      }
      if (applicationId === MADAR_APPLICATION_ID && schemaVersion >= 6 && otherInvoiceAttachmentsMigration) {
        database.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('other-invoice-attachments-schema-v6')
      }
      if (orphan) {
        database.pragma('foreign_keys = OFF')
        database.prepare('INSERT INTO orders(id,client_id) VALUES (1,99)').run()
      }
      database.pragma(`application_id = ${applicationId}`)
      database.pragma(`user_version = ${schemaVersion}`)
    } finally {
      database.close()
    }
    return databasePath
  }

  try {
    const validPath = createSnapshot('valid.sqlite')
    await assert.doesNotReject(validateDatabaseSnapshot(validPath, {
      manifest: { schemaVersion: CURRENT_SCHEMA_VERSION, applicationVersion: '1.0.0' },
    }))
    const schema2Path = createSnapshot('schema-2.sqlite', { schemaVersion: 2 })
    await assert.doesNotReject(validateDatabaseSnapshot(schema2Path, {
      manifest: { schemaVersion: 2, applicationVersion: '1.0.0' },
    }))
    const missingFinanceMigrationPath = createSnapshot('missing-finance-migration.sqlite', { financeMigrations: false })
    await assert.rejects(validateDatabaseSnapshot(missingFinanceMigrationPath), /ترحيل المحاسبة والرواتب والجرد/)
    const missingManufacturingMappingsPath = createSnapshot('missing-manufacturing-mappings.sqlite', {
      manufacturingMappingsMigration: false,
    })
    await assert.rejects(validateDatabaseSnapshot(missingManufacturingMappingsPath), /ترحيل الحسابات القياسية للتصنيع/)
    const missingOtherInvoiceAttachmentsPath = createSnapshot('missing-other-invoice-attachments.sqlite', {
      otherInvoiceAttachmentsMigration: false,
    })
    await assert.rejects(validateDatabaseSnapshot(missingOtherInvoiceAttachmentsPath), /مرفقات فواتير المصروفات لمخطط v6/)
    const missingOtherInvoiceAttachmentsTablePath = createSnapshot('missing-other-invoice-attachments-table.sqlite', {
      otherInvoiceAttachmentsTable: false,
    })
    await assert.rejects(validateDatabaseSnapshot(missingOtherInvoiceAttachmentsTablePath), /جدول مرفقات فواتير المصروفات المطلوب لمخطط v6/)
    const orphanPath = createSnapshot('orphan.sqlite', { orphan: true })
    await assert.rejects(validateDatabaseSnapshot(orphanPath), /مخالفة مفاتيح خارجية/)
    const futurePath = createSnapshot('future.sqlite', { schemaVersion: CURRENT_SCHEMA_VERSION + 1 })
    await assert.rejects(validateDatabaseSnapshot(futurePath), /أحدث من الإصدار المدعوم/)
    const foreignPath = createSnapshot('foreign.sqlite', { applicationId: 123 })
    await assert.rejects(validateDatabaseSnapshot(foreignPath), /تطبيق آخر/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('validates active invoice evidence files in backup storage', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-invoice-storage-consistency-test-'))
  const databasePath = path.join(tempRoot, 'snapshot.sqlite')
  const storageRoot = path.join(tempRoot, 'storage')
  fs.mkdirSync(storageRoot)
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE invoices(id INTEGER PRIMARY KEY,deleted_at TEXT);
    CREATE TABLE invoice_attachments(id INTEGER PRIMARY KEY,invoice_id INTEGER,storage_path TEXT);
    CREATE TABLE other_invoices(id INTEGER PRIMARY KEY,deleted_at TEXT);
    CREATE TABLE other_invoice_attachments(id INTEGER PRIMARY KEY,other_invoice_id INTEGER,storage_path TEXT);
    INSERT INTO invoices(id,deleted_at) VALUES (1,NULL),(2,'2026-01-01');
    INSERT INTO invoice_attachments(id,invoice_id,storage_path)
      VALUES (1,1,'Clients/Example/Invoices/purchase.pdf'),(2,2,'Clients/Deleted/Invoices/old.pdf');
    INSERT INTO other_invoices(id,deleted_at) VALUES (1,NULL);
    INSERT INTO other_invoice_attachments(id,other_invoice_id,storage_path)
      VALUES (1,1,'Clients/Example/Invoices/expense.pdf');
  `)
  database.close()
  try {
    await assert.rejects(validateDatabaseStorageConsistency(databasePath, storageRoot), /Clients\/Example\/Invoices\/purchase.pdf/)
    await fs.promises.mkdir(path.join(storageRoot, 'Clients', 'Example', 'Invoices'), { recursive: true })
    await fs.promises.writeFile(path.join(storageRoot, 'Clients', 'Example', 'Invoices', 'purchase.pdf'), 'purchase')
    await assert.rejects(validateDatabaseStorageConsistency(databasePath, storageRoot), /Clients\/Example\/Invoices\/expense.pdf/)
    await fs.promises.writeFile(path.join(storageRoot, 'Clients', 'Example', 'Invoices', 'expense.pdf'), 'expense')
    await assert.doesNotReject(validateDatabaseStorageConsistency(databasePath, storageRoot))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('detects missing active storage references but ignores soft-deleted orders and excluded .incoming sources', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-storage-consistency-test-'))
  const databasePath = path.join(tempRoot, 'snapshot.sqlite')
  const storageRoot = path.join(tempRoot, 'storage')
  fs.mkdirSync(storageRoot)
  const database = new Database(databasePath)
  database.exec(`
    CREATE TABLE orders(id INTEGER PRIMARY KEY,deleted_at TEXT);
    CREATE TABLE order_machines(id INTEGER PRIMARY KEY,order_id INTEGER,before_photos TEXT,after_photos TEXT,excluded_at TEXT);
    CREATE TABLE area_folders(id INTEGER PRIMARY KEY,order_id INTEGER,deleted_at TEXT,image_paths TEXT,source_folder_paths TEXT);
    INSERT INTO orders(id,deleted_at) VALUES (1,NULL);
    INSERT INTO order_machines(id,order_id,before_photos,after_photos,excluded_at)
      VALUES (1,1,'["Clients/Example/Operation/OP-1/missing.jpg"]','[]',NULL);
    INSERT INTO area_folders(id,order_id,deleted_at,image_paths,source_folder_paths)
      VALUES (1,1,NULL,'[]','["Areas/.incoming/transient-source"]');
  `)
  database.close()
  try {
    await assert.rejects(validateDatabaseStorageConsistency(databasePath, storageRoot), /Clients\/Example\/Operation\/OP-1\/missing.jpg/)
    const update = new Database(databasePath)
    update.prepare("UPDATE orders SET deleted_at='2026-01-01' WHERE id=1").run()
    update.close()
    await assert.doesNotReject(validateDatabaseStorageConsistency(databasePath, storageRoot))
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('rejects a ZIP entry whose decompressed bytes do not match the central-directory CRC', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-zip-crc-test-'))
  try {
    const zip = new JSZip()
    zip.file('madar.sqlite', 'temporary test database')
    zip.file('storage/.madar-backup-v1-marker', '')
    zip.file('storage/proof.txt', 'temporary proof')
    const archiveBytes = await zip.generateAsync({ type: 'nodebuffer' })
    const centralDirectoryOffset = archiveBytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
    assert.ok(centralDirectoryOffset >= 0)
    archiveBytes.writeUInt32LE((archiveBytes.readUInt32LE(centralDirectoryOffset + 16) ^ 1) >>> 0, centralDirectoryOffset + 16)
    const archivePath = path.join(tempRoot, 'corrupt.zip')
    await fs.promises.writeFile(archivePath, archiveBytes)
    await assert.rejects(extractBackupArchive(archivePath, path.join(tempRoot, 'extracted')), /CRC/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('recovers both database and storage when a restore swap was interrupted', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-restore-recovery-test-'))
  try {
    const databasePath = path.join(tempRoot, 'data', 'madar.sqlite')
    const storageRoot = path.join(tempRoot, 'storage')
    const backupsRoot = path.join(tempRoot, 'Backups')
    const journalPath = path.join(backupsRoot, '.madar-restore-journal.json')
    const id = '123e4567-e89b-42d3-a456-426614174000'
    const extractionRoot = path.join(backupsRoot, `.madar-restore-${id}`)
    const plan = buildRestorePlan({ id, databasePath, storageRoot, extractionRoot })

    fs.mkdirSync(path.dirname(databasePath), { recursive: true })
    fs.mkdirSync(storageRoot, { recursive: true })
    fs.mkdirSync(backupsRoot, { recursive: true })
    fs.writeFileSync(databasePath, 'original database')
    fs.writeFileSync(path.join(storageRoot, 'original.txt'), 'original storage')
    fs.writeFileSync(plan.databaseStagePath, 'restored database')
    fs.mkdirSync(plan.storageStagePath, { recursive: true })
    fs.writeFileSync(path.join(plan.storageStagePath, 'restored.txt'), 'restored storage')

    fs.writeFileSync(journalPath, JSON.stringify({ ...plan, version: 1 }))
    fs.renameSync(storageRoot, plan.storageRollbackPath)
    fs.renameSync(databasePath, plan.databaseRollbackPath)
    fs.renameSync(plan.storageStagePath, storageRoot)
    fs.renameSync(plan.databaseStagePath, databasePath)

    assert.equal(recoverInterruptedRestore(journalPath, { databasePath, storageRoot }), true)
    assert.equal(fs.readFileSync(databasePath, 'utf8'), 'original database')
    assert.equal(fs.readFileSync(path.join(storageRoot, 'original.txt'), 'utf8'), 'original storage')
    assert.equal(fs.existsSync(path.join(storageRoot, 'restored.txt')), false)
    assert.equal(fs.existsSync(journalPath), false)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
