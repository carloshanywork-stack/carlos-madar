const fs = require('node:fs')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const { Transform } = require('node:stream')
const zlib = require('node:zlib')
const Database = require('better-sqlite3')
const yauzl = require('yauzl')
const {
  validateBackupVersionMetadata,
  validateDatabaseSchemaMetadata,
} = require('./schema-version')

const MAX_ARCHIVE_ENTRIES = 250_000
const ROOT_MARKER = 'storage/.madar-backup-v1-marker'

function isPathWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function validateZipEntryName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes('\0') || name.startsWith('/')) {
    throw new Error('ملف النسخة يحتوي على مسار غير صالح.')
  }
  const directory = name.endsWith('/')
  const parts = name.split('/')
  if (directory) parts.pop()
  if (!parts.length || parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) {
    throw new Error('ملف النسخة يحتوي على مسار غير صالح.')
  }
  if (parts[0] !== 'storage' && !['madar.sqlite', 'madar-backup-manifest.json'].includes(name)) {
    throw new Error('ملف النسخة لا يتبع بنية Madar المعتمدة.')
  }
  if (parts[0] === 'storage' && parts[1] === '.incoming') {
    throw new Error('لا يمكن استعادة ملفات الرفع المؤقتة من النسخة.')
  }
  return { directory, parts }
}

function openZip(archivePath) {
  return yauzl.openPromise(archivePath, {
    lazyEntries: true,
    decodeStrings: true,
    strictFileNames: true,
    validateEntrySizes: true,
  })
}

async function extractBackupArchive(archivePath, extractionRoot, {
  maxExtractedBytes = 100 * 1024 ** 3,
  maxEntries = MAX_ARCHIVE_ENTRIES,
} = {}) {
  await fs.promises.mkdir(extractionRoot, { recursive: false })
  const zipfile = await openZip(archivePath)

  const extracted = await new Promise((resolve, reject) => {
    const entries = new Set()
    let entryCount = 0
    let extractedBytes = 0
    let hasDatabase = false
    let hasStorage = false
    let finished = false

    const fail = (error) => {
      if (finished) return
      finished = true
      try { zipfile.close() } catch {}
      reject(error)
    }

    const next = () => {
      if (!finished) zipfile.readEntry()
    }

    zipfile.on('error', fail)
    zipfile.on('entry', (entry) => {
      if (finished) return
      void (async () => {
        entryCount += 1
        if (entryCount > maxEntries) throw new Error('ملف النسخة يحتوي على عدد عناصر يتجاوز الحد المسموح.')
        const { directory, parts } = validateZipEntryName(entry.fileName)
        const canonicalName = entry.fileName.replace(/\/$/, '')
        if (entries.has(canonicalName)) throw new Error('ملف النسخة يحتوي على عناصر مكررة.')
        entries.add(canonicalName)

        const unixMode = entry.externalFileAttributes >>> 16
        const unixType = unixMode & 0o170000
        if (unixType === 0o120000 || (unixType && unixType !== 0o100000 && unixType !== 0o040000)) {
          throw new Error('لا يمكن استعادة روابط رمزية أو ملفات خاصة من النسخة.')
        }
        if (entry.isEncrypted()) throw new Error('ملفات النسخ المشفرة غير مدعومة.')
        if (![0, 8].includes(entry.compressionMethod)) throw new Error('طريقة ضغط داخل ملف النسخة غير مدعومة.')
        if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0) {
          throw new Error('حجم عنصر داخل ملف النسخة غير صالح.')
        }
        extractedBytes += entry.uncompressedSize
        if (extractedBytes > maxExtractedBytes) throw new Error('حجم الملفات بعد فك الضغط يتجاوز الحد المسموح.')

        if (entry.fileName === 'madar.sqlite') hasDatabase = true
        if (entry.fileName === 'storage/' || entry.fileName === 'storage' || parts[0] === 'storage') hasStorage = true

        const destination = path.resolve(extractionRoot, ...parts)
        if (!isPathWithin(extractionRoot, destination)) throw new Error('ملف النسخة يحاول الكتابة خارج مجلد الاستعادة.')
        const isRootMarker = canonicalName === ROOT_MARKER
        if (isRootMarker && (directory || entry.uncompressedSize !== 0)) {
          throw new Error('علامة بنية التخزين في النسخة غير صالحة.')
        }
        if (directory && entry.uncompressedSize !== 0) throw new Error('مجلد داخل النسخة يحتوي بيانات غير صالحة.')
        if (isRootMarker && entry.crc32 !== 0) throw new Error('علامة بنية التخزين في النسخة غير صالحة.')

        if (directory) {
          await fs.promises.mkdir(destination, { recursive: true })
          next()
          return
        }
        if (isRootMarker) {
          next()
          return
        }

        await fs.promises.mkdir(path.dirname(destination), { recursive: true })
        zipfile.openReadStream(entry, (error, input) => {
          if (error) return fail(error)
          const output = fs.createWriteStream(destination, { flags: 'wx', mode: 0o600 })
          const checksum = new Transform({
            transform(chunk, _encoding, callback) {
              this.crc = zlib.crc32(chunk, this.crc)
              callback(null, chunk)
            },
          })
          checksum.crc = 0
          pipeline(input, checksum, output).then(() => {
            if ((checksum.crc >>> 0) !== entry.crc32) {
              fail(new Error(`ملف النسخة تالف: فشل تحقق CRC للعنصر ${entry.fileName}.`))
              return
            }
            next()
          }, fail)
        })
      })().catch(fail)
    })
    zipfile.on('end', () => {
      if (finished) return
      finished = true
      resolve({ entryCount, extractedBytes, hasDatabase, hasStorage })
    })
    next()
  })

  if (!extracted.hasDatabase || !extracted.hasStorage) {
    throw new Error('النسخة غير مكتملة: يجب أن تحتوي قاعدة البيانات ومجلد storage.')
  }

  const manifestPath = path.join(extractionRoot, 'madar-backup-manifest.json')
  let manifest = null
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(await fs.promises.readFile(manifestPath, 'utf8')) }
    catch { throw new Error('بيان النسخة الاحتياطية غير صالح.') }
    if (manifest?.format !== 'madar-backup' || manifest?.version !== 1
      || manifest?.database !== 'madar.sqlite' || manifest?.storage !== 'storage') {
      throw new Error('إصدار أو بنية النسخة الاحتياطية غير مدعوم.')
    }
    validateBackupVersionMetadata(manifest, require('../package.json').version)
  }

  const storagePath = path.join(extractionRoot, 'storage')
  await fs.promises.mkdir(storagePath, { recursive: true })
  for (const directory of ['Clients', 'Machines', 'Areas', path.join('Uploads', 'Excel')]) {
    await fs.promises.mkdir(path.join(storagePath, directory), { recursive: true })
  }
  await validateDatabaseSnapshot(path.join(extractionRoot, 'madar.sqlite'), { manifest })
  if (manifest?.schemaVersion >= 2) {
    await validateDatabaseStorageConsistency(path.join(extractionRoot, 'madar.sqlite'), storagePath)
  }
  return extracted
}

function safeRelativeStoragePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/')) return null
  const parts = value.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..' || part.includes(':'))) return null
  return parts
}

async function validateDatabaseStorageConsistency(databasePath, storageRoot) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 5000 })
  const files = new Set()
  const directories = new Set()
  try {
    const tableNames = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name))
    const addJsonPaths = (table, column, target, where = '') => {
      if (!tableNames.has(table)) return
      const columns = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name))
      if (!columns.has(column)) return
      for (const record of database.prepare(`SELECT ${column} AS value FROM ${table} WHERE ${column} IS NOT NULL ${where}`).all()) {
        let values
        try { values = JSON.parse(record.value) }
        catch { throw new Error(`بيانات مسارات التخزين في ${table}.${column} غير صالحة.`) }
        if (!Array.isArray(values)) throw new Error(`بيانات مسارات التخزين في ${table}.${column} غير صالحة.`)
        for (const value of values) target.add(value)
      }
    }

    if (tableNames.has('clients')) {
      const columns = new Set(database.prepare('PRAGMA table_info(clients)').all().map((row) => row.name))
      if (columns.has('logo_path')) {
        for (const row of database.prepare('SELECT logo_path FROM clients WHERE deleted_at IS NULL AND logo_path IS NOT NULL AND TRIM(logo_path)<>\'\'').all()) files.add(row.logo_path)
      }
    }
    if (tableNames.has('invoice_attachments') && tableNames.has('invoices')) {
      for (const row of database.prepare(`SELECT a.storage_path FROM invoice_attachments a
        JOIN invoices i ON i.id=a.invoice_id WHERE i.deleted_at IS NULL`).all()) files.add(row.storage_path)
    }
    if (tableNames.has('other_invoice_attachments') && tableNames.has('other_invoices')) {
      for (const row of database.prepare(`SELECT a.storage_path FROM other_invoice_attachments a
        JOIN other_invoices i ON i.id=a.other_invoice_id WHERE i.deleted_at IS NULL`).all()) files.add(row.storage_path)
    }
    if (tableNames.has('orders')) {
      addJsonPaths('order_machines', 'before_photos', files,
        "AND excluded_at IS NULL AND order_id IN (SELECT id FROM orders WHERE deleted_at IS NULL)")
      addJsonPaths('order_machines', 'after_photos', files,
        "AND excluded_at IS NULL AND order_id IN (SELECT id FROM orders WHERE deleted_at IS NULL)")
    }
    const activeAreaFolderOrderFilter = tableNames.has('orders')
      ? 'AND deleted_at IS NULL AND order_id IN (SELECT id FROM orders WHERE deleted_at IS NULL)'
      : 'AND deleted_at IS NULL'
    addJsonPaths('area_folders', 'image_paths', files, activeAreaFolderOrderFilter)
    addJsonPaths('area_folders', 'source_folder_paths', directories, activeAreaFolderOrderFilter)

    for (const [values, expectedKind] of [[files, 'file'], [directories, 'directory']]) {
      for (const relative of values) {
        const parts = safeRelativeStoragePath(relative)
        if (!parts) throw new Error('تحتوي قاعدة البيانات على مسار تخزين غير آمن داخل النسخة.')
        if (expectedKind === 'directory' && parts[0] === 'Areas' && parts[1] === '.incoming') continue
        const absolute = path.resolve(storageRoot, ...parts)
        if (!isPathWithin(storageRoot, absolute)) throw new Error('مسار تخزين داخل قاعدة البيانات يتجاوز جذر النسخة.')
        let current = path.resolve(storageRoot)
        for (const part of parts) {
          current = path.join(current, part)
          const stats = await fs.promises.lstat(current).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
          if (!stats) throw new Error(`عنصر تخزين مطلوب غير موجود في النسخة (${expectedKind}): ${relative}`)
          if (stats.isSymbolicLink()) throw new Error('تحتوي النسخة على رابط رمزي في مسار مرتبط بقاعدة البيانات.')
          if (current !== absolute && !stats.isDirectory()) throw new Error('مسار تخزين قاعدة البيانات يمر عبر عنصر غير مجلد.')
          if (current === absolute && (expectedKind === 'file' ? !stats.isFile() : !stats.isDirectory())) {
            throw new Error(`نوع عنصر التخزين لا يطابق مرجع قاعدة البيانات (${expectedKind}).`)
          }
        }
      }
    }
  } finally {
    database.close()
  }
}

async function validateDatabaseSnapshot(databasePath, { manifest = null } = {}) {
  const stats = await fs.promises.stat(databasePath).catch(() => null)
  if (!stats?.isFile() || stats.size < 100) throw new Error('قاعدة البيانات داخل النسخة غير موجودة أو فارغة.')
  let database
  try {
    database = new Database(databasePath, { readonly: true, fileMustExist: true, timeout: 5000 })
    const integrity = database.pragma('integrity_check', { simple: true })
    if (integrity !== 'ok') throw new Error('فشل فحص سلامة قاعدة البيانات داخل النسخة.')
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name))
    for (const required of ['users', 'clients', 'machines', 'orders', 'schema_migrations', 'audit_log']) {
      if (!tables.has(required)) throw new Error('قاعدة البيانات داخل النسخة ليست قاعدة Madar صالحة.')
    }
    const schemaVersion = database.pragma('user_version', { simple: true })
    const applicationId = database.pragma('application_id', { simple: true })
    validateDatabaseSchemaMetadata(applicationId, schemaVersion)
    if (applicationId !== 0) {
      const migrations = new Set(database.prepare('SELECT name FROM schema_migrations').all().map((row) => row.name))
      if (schemaVersion >= 1 && !migrations.has('schema-version-markers-v1')) {
        throw new Error('قاعدة البيانات تفتقد علامة ترحيل مخطط Madar المطلوبة.')
      }
      if (schemaVersion >= 2 && !migrations.has('filesystem-recovery-and-backup-health-v1')) {
        throw new Error('قاعدة البيانات تفتقد ترحيل الاسترداد والصحة المطلوب.')
      }
      if (schemaVersion >= 3 && !migrations.has('integrated-finance-payroll-stocktaking-v1')) {
        throw new Error('قاعدة البيانات تفتقد ترحيل المحاسبة والرواتب والجرد المطلوب.')
      }
      if (schemaVersion >= 3 && !migrations.has('integrated-finance-followups-v1')) {
        throw new Error('قاعدة البيانات تفتقد ترحيل تصحيحات الفواتير والضرائب المطلوب.')
      }
      if (schemaVersion >= 4 && !migrations.has('work-order-cogs-v1')) {
        throw new Error('قاعدة البيانات تفتقد ترحيل تكلفة مواد أوامر التشغيل المطلوب.')
      }
      if (schemaVersion >= 5 && !migrations.has('manufacturing-account-mappings-v1')) {
        throw new Error('قاعدة البيانات تفتقد ترحيل الحسابات القياسية للتصنيع المطلوب.')
      }
      if (schemaVersion >= 6) {
        if (!migrations.has('other-invoice-attachments-schema-v6')) {
          throw new Error('قاعدة البيانات تفتقد ترحيل مرفقات فواتير المصروفات لمخطط v6.')
        }
        if (!tables.has('other_invoice_attachments')) {
          throw new Error('قاعدة البيانات تفتقد جدول مرفقات فواتير المصروفات المطلوب لمخطط v6.')
        }
      }
      if (schemaVersion >= 7) {
        if (!migrations.has('purchase-invoice-revisions-schema-v7')) {
          throw new Error('قاعدة البيانات تفتقد ترحيل سجل مراجعات فواتير الشراء لمخطط v7.')
        }
        if (!tables.has('purchase_invoice_revisions')) {
          throw new Error('قاعدة البيانات تفتقد جدول مراجعات فواتير الشراء المطلوب لمخطط v7.')
        }
      }
    }
    if (manifest?.schemaVersion !== undefined && manifest.schemaVersion !== schemaVersion) {
      throw new Error('إصدار مخطط قاعدة البيانات لا يطابق بيان النسخة الاحتياطية.')
    }
    const foreignKeyViolations = database.pragma('foreign_key_check')
    if (foreignKeyViolations.length) {
      throw new Error(`قاعدة البيانات داخل النسخة تحتوي على ${foreignKeyViolations.length} مخالفة مفاتيح خارجية.`)
    }
  } catch (error) {
    if (error.message.includes('قاعدة البيانات') || error.message.includes('فشل فحص')
      || error.message.includes('إصدار مخطط') || error.message.includes('مخطط قاعدة البيانات')
      || error.message.includes('إصدار التطبيق') || error.message.includes('تطبيق آخر')
      || error.message.includes('علامات إصدار')) throw error
    throw new Error(`تعذر التحقق من قاعدة البيانات داخل النسخة: ${error.message}`)
  } finally {
    if (database?.open) database.close()
  }
}

function recordRestoreAudit(databasePath, { actorId, username, sourceFile, rollbackFile }) {
  const database = new Database(databasePath, { fileMustExist: true, timeout: 5000 })
  try {
    const actor = database.prepare(`SELECT id FROM users WHERE id=? AND username=? AND active=1 AND deleted_at IS NULL`)
      .get(actorId, username)
    const details = JSON.stringify({ requestedBy: username, sourceFile, rollbackFile })
    const oldValues = JSON.stringify({ database: 'current', storage: 'current' })
    const newValues = JSON.stringify({ restoredFrom: sourceFile, rollbackBackup: rollbackFile })
    database.transaction(() => {
      database.prepare(`INSERT INTO audit_log(user_id,action,entity,entity_id,details,old_values,new_values)
        VALUES (?,'restore','system-backup',?,?,?,?)`)
        .run(actor?.id || null, sourceFile, details, oldValues, newValues)
    })()
  } finally {
    if (database.open) database.close()
  }
}

function buildRestorePlan({ id, databasePath, storageRoot, extractionRoot }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('معرّف الاستعادة غير صالح.')
  const resolvedDatabase = path.resolve(databasePath)
  const resolvedStorage = path.resolve(storageRoot)
  const databaseParent = path.dirname(resolvedDatabase)
  const storageParent = path.dirname(resolvedStorage)
  const databaseName = path.basename(resolvedDatabase)
  const storageName = path.basename(resolvedStorage)
  return {
    id,
    databasePath: resolvedDatabase,
    storageRoot: resolvedStorage,
    databaseStagePath: path.join(databaseParent, `.${databaseName}.madar-restore-stage-${id}`),
    storageStagePath: path.join(storageParent, `.${storageName}.madar-restore-stage-${id}`),
    databaseRollbackPath: path.join(databaseParent, `.${databaseName}.madar-restore-rollback-${id}`),
    storageRollbackPath: path.join(storageParent, `.${storageName}.madar-restore-rollback-${id}`),
    databaseWalExisted: fs.existsSync(`${resolvedDatabase}-wal`),
    databaseShmExisted: fs.existsSync(`${resolvedDatabase}-shm`),
    extractionRoot: path.resolve(extractionRoot),
  }
}

async function stageRestoreFiles(plan) {
  await fs.promises.mkdir(path.dirname(plan.databasePath), { recursive: true })
  await fs.promises.mkdir(path.dirname(plan.storageRoot), { recursive: true })
  await fs.promises.copyFile(path.join(plan.extractionRoot, 'madar.sqlite'), plan.databaseStagePath, fs.constants.COPYFILE_EXCL)
  await fsExtraCopy(path.join(plan.extractionRoot, 'storage'), plan.storageStagePath)
  await validateDatabaseSnapshot(plan.databaseStagePath)
}

async function fsExtraCopy(source, destination) {
  const fsExtra = require('fs-extra')
  await fsExtra.copy(source, destination, { errorOnExist: true, dereference: false, preserveTimestamps: true })
}

function journalPlanIsSafe(journal, { databasePath, storageRoot, journalPath }) {
  if (!journal || journal.version !== 1 || !/^[0-9a-f-]{36}$/i.test(journal.id)) return false
  const expected = buildRestorePlan({
    id: journal.id,
    databasePath,
    storageRoot,
    extractionRoot: path.join(path.dirname(journalPath), `.madar-restore-${journal.id}`),
  })
  return ['databasePath', 'storageRoot', 'databaseStagePath', 'storageStagePath', 'databaseRollbackPath', 'storageRollbackPath', 'extractionRoot']
    .every((key) => journal[key] === expected[key])
}

async function writeRestoreJournal(journalPath, plan) {
  const journal = { ...plan, version: 1 }
  const temporaryPath = `${journalPath}.${plan.id}.tmp`
  await fs.promises.writeFile(temporaryPath, JSON.stringify(journal), { flag: 'wx', mode: 0o600 })
  await fs.promises.rename(temporaryPath, journalPath)
}

function removePathIfPresent(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
}

function recoverInterruptedRestore(journalPath, { databasePath, storageRoot }) {
  if (!fs.existsSync(journalPath)) return false
  let journal
  try { journal = JSON.parse(fs.readFileSync(journalPath, 'utf8')) }
  catch { throw new Error(`ملف استعادة Madar غير قابل للقراءة: ${journalPath}`) }
  if (!journalPlanIsSafe(journal, { databasePath, storageRoot, journalPath })) {
    throw new Error('مسارات سجل استعادة Madar لا تطابق إعدادات التخزين الحالية؛ أوقف التشغيل للمراجعة اليدوية.')
  }

  const databaseRollbackExists = fs.existsSync(journal.databaseRollbackPath)
  const storageRollbackExists = fs.existsSync(journal.storageRollbackPath)
  if (databaseRollbackExists) {
    removePathIfPresent(journal.databasePath)
    fs.renameSync(journal.databaseRollbackPath, journal.databasePath)
    for (const [suffix, existed] of [['-wal', journal.databaseWalExisted], ['-shm', journal.databaseShmExisted]]) {
      const rollbackSidecar = `${journal.databaseRollbackPath}${suffix}`
      const liveSidecar = `${journal.databasePath}${suffix}`
      if (fs.existsSync(rollbackSidecar)) {
        removePathIfPresent(liveSidecar)
        fs.renameSync(rollbackSidecar, liveSidecar)
      } else if (!existed) {
        removePathIfPresent(liveSidecar)
      }
    }
  } else if (!fs.existsSync(journal.databasePath)) {
    throw new Error('تعذر استرجاع قاعدة البيانات السابقة بعد انقطاع عملية الاستعادة.')
  }

  if (storageRollbackExists) {
    removePathIfPresent(journal.storageRoot)
    fs.renameSync(journal.storageRollbackPath, journal.storageRoot)
  } else if (!fs.existsSync(journal.storageRoot)) {
    throw new Error('تعذر استرجاع مجلد التخزين السابق بعد انقطاع عملية الاستعادة.')
  }

  removePathIfPresent(journal.databaseStagePath)
  removePathIfPresent(journal.storageStagePath)
  removePathIfPresent(journal.extractionRoot)
  fs.rmSync(journalPath, { force: true })
  return true
}

async function swapRestoreFiles(journalPath, plan) {
  for (const target of [plan.databasePath, plan.storageRoot]) {
    const stats = await fs.promises.lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (!stats || stats.isSymbolicLink() || (target === plan.storageRoot ? !stats.isDirectory() : !stats.isFile())) {
      throw new Error('مسار قاعدة البيانات أو التخزين الحالي غير صالح للاستعادة.')
    }
  }
  await writeRestoreJournal(journalPath, plan)
  try {
    await fs.promises.rename(plan.storageRoot, plan.storageRollbackPath)
    await fs.promises.rename(plan.databasePath, plan.databaseRollbackPath)
    for (const suffix of ['-wal', '-shm']) {
      const liveSidecar = `${plan.databasePath}${suffix}`
      if (fs.existsSync(liveSidecar)) await fs.promises.rename(liveSidecar, `${plan.databaseRollbackPath}${suffix}`)
    }
    await fs.promises.rename(plan.storageStagePath, plan.storageRoot)
    await fs.promises.rename(plan.databaseStagePath, plan.databasePath)
    await fs.promises.rm(journalPath, { force: true })
  } catch (error) {
    try { recoverInterruptedRestore(journalPath, plan) }
    catch (recoveryError) {
      error.message += `; تعذر التراجع التلقائي: ${recoveryError.message}`
    }
    throw error
  }

  for (const oldPath of [plan.databaseRollbackPath, `${plan.databaseRollbackPath}-wal`, `${plan.databaseRollbackPath}-shm`, plan.storageRollbackPath]) {
    await fs.promises.rm(oldPath, { recursive: true, force: true }).catch((error) => {
      console.error(`Could not remove post-restore rollback path ${oldPath}:`, error.message)
    })
  }
}

module.exports = {
  buildRestorePlan,
  extractBackupArchive,
  recordRestoreAudit,
  recoverInterruptedRestore,
  stageRestoreFiles,
  swapRestoreFiles,
  validateZipEntryName,
  validateDatabaseStorageConsistency,
  validateDatabaseSnapshot,
}
