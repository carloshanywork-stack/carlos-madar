if (process.env.NODE_ENV !== 'test') {
  require('dotenv').config({ path: require('node:path').resolve(__dirname, '..', '..', '.env') })
}

const fs = require('node:fs')
const path = require('node:path')
const configuredProjectRoot = path.resolve(__dirname, '..', '..')
const configuredDatabaseSetting = process.env.DB_PATH || process.env.DATABASE_URL || 'file:./system/data/madar.sqlite'
if (!process.env.DB_PATH && !configuredDatabaseSetting.startsWith('file:')) {
  throw new Error('DATABASE_URL must use the SQLite file: URL format in this release.')
}
const configuredDatabasePath = path.resolve(configuredProjectRoot,
  configuredDatabaseSetting.startsWith('file:') ? configuredDatabaseSetting.slice('file:'.length) : configuredDatabaseSetting)
const configuredStorageRoot = path.resolve(configuredProjectRoot, process.env.STORAGE_ROOT_PATH || 'storage')
const configuredBackupRoot = path.resolve(configuredProjectRoot, process.env.BACKUP_ROOT_PATH || 'Backups')
const { recoverInterruptedRestore } = require('./backup-restore')
recoverInterruptedRestore(path.join(configuredBackupRoot, '.madar-restore-journal.json'), {
  databasePath: configuredDatabasePath,
  storageRoot: configuredStorageRoot,
})

const express = require('express')
const helmet = require('helmet')
const compression = require('compression')
const multer = require('multer')
const chokidar = require('chokidar')
const fsExtra = require('fs-extra')
const cron = require('node-cron')
const archiver = require('archiver')
const PDFDocument = require('pdfkit')
const { Server: SocketServer } = require('socket.io')
const bcrypt = require('bcryptjs')
const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')
const { rateLimit } = require('express-rate-limit')
const http = require('node:http')
const XlsxPopulate = require('xlsx-populate')
const XLSX = require('xlsx')
const exifr = require('exifr')
const sharp = require('sharp')
const PptxGenJS = require('pptxgenjs')
const { Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, BorderStyle } = require('docx')
const { parse: parseCsv } = require('csv-parse')
const { db, nextCode, audit, projectRoot, databasePath } = require('./db')
const {
  calculatePayroll,
  materialVariantKey,
  queueInventoryIssueJournal,
  queueJournalEntry,
  recognizeCompletedWorkOrderIssues,
  salesTaxCents,
  setAccountMapping,
  tryPostJournalEntry,
} = require('./accounting')
const { Op, Transaction } = require('sequelize')
const { createSqliteSequelize, defineModels, initializeSqlite } = require('./models')
const { calculateIssue } = require('./inventory')
const { resolvePhotoTimestamp, splitTimedPhotos } = require('./photo-time')
const { renameAreaFolder } = require('./area-folder-rename')
const { currencyAmountFromCents, parseCurrencyAmount, parseCurrencyCents } = require('./money')
const { isLegacyUserImportStoragePath } = require('./legacy-user-imports')
const { CURRENT_SCHEMA_VERSION } = require('./schema-version')
const { createLoginThrottle } = require('./login-throttle')
const {
  completeFilesystemOperation,
  markFilesystemOperationCommitted,
  pendingFilesystemOperationsCount,
  prepareFilesystemOperation,
  recoverPendingFilesystemOperations,
  rollbackFilesystemOperation,
  stageFilesystemOperation,
} = require('./filesystem-recovery')
const { resolveClientBuildDirectory } = require('./startup-checks')
const {
  cleanupAbandonedPhotoUploadWorkspaces,
  cleanupPhotoUploadWorkspace,
  createMultipartRequestLimit,
  createPhotoUploadConcurrencyGuard,
  photoUploadMulterCallback,
  preparePhotoUploadWorkspace,
} = require('./photo-uploads')
const { registerProcessHandlers, setShutdownHandler } = require('./runtime')
const {
  buildRestorePlan,
  extractBackupArchive,
  recordRestoreAudit,
  stageRestoreFiles,
  swapRestoreFiles,
} = require('./backup-restore')

const sequelize = createSqliteSequelize({ storage: databasePath })
const models = defineModels(sequelize)
const sequelizeReady = initializeSqlite(sequelize)
sequelizeReady.catch(() => {})

const app = express()
const port = Number(process.env.PORT || 3100)
const host = process.env.HOST || '127.0.0.1'
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0)
if (!Number.isSafeInteger(trustProxyHops) || trustProxyHops < 0 || trustProxyHops > 5) {
  throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 5; trust only your explicitly configured reverse proxy.')
}
app.set('trust proxy', trustProxyHops)
const storageRoot = path.resolve(projectRoot, process.env.STORAGE_ROOT_PATH || 'storage')
const systemRoot = path.resolve(__dirname, '..')
const applicationVersion = require('../package.json').version
const areasRoot = path.join(storageRoot, 'Areas')
const excelUploadsRoot = path.join(storageRoot, 'Uploads', 'Excel')
const machineReplacementGrants = new Map()
const machineReplacementGrantTtlMs = 10 * 60 * 1000
let machineCatalogWipeInProgress = false
const orderDeleteStagePrefix = '.madar-order-delete-'
const backupsRoot = path.resolve(projectRoot, process.env.BACKUP_ROOT_PATH || 'Backups')
const uploadTemp = path.join(areasRoot, '.incoming')
const missingOrderClientMessage = 'يرجى اختيار العميل أولاً لحفظ البيانات في مسارها الصحيح'
const missingOrderClientUiMessage = 'يجب اختيار العميل لتكوين مسار الحفظ الصحيح'
const thumbnailCacheRoot = path.resolve(projectRoot, process.env.THUMBNAIL_CACHE_PATH || path.join('system', 'data', 'thumbnails'))
const backupRestoreUploadLimit = Number(process.env.BACKUP_RESTORE_MAX_UPLOAD_BYTES || 10 * 1024 ** 3)
const backupRestoreExtractLimit = Number(process.env.BACKUP_RESTORE_MAX_EXTRACTED_BYTES || 100 * 1024 ** 3)
const photoUploadMaxRequestBytes = Number(process.env.PHOTO_UPLOAD_MAX_REQUEST_BYTES || 1024 ** 3)
const photoUploadMaxConcurrent = Number(process.env.PHOTO_UPLOAD_MAX_CONCURRENT || 2)
const photoUploadStaleTempMs = Number(process.env.PHOTO_UPLOAD_STALE_TEMP_MS || 24 * 60 * 60 * 1000)
if (!Number.isSafeInteger(backupRestoreUploadLimit) || backupRestoreUploadLimit < 1024 * 1024
  || !Number.isSafeInteger(backupRestoreExtractLimit) || backupRestoreExtractLimit < 1024 * 1024) {
  throw new Error('Backup restore size limits must be safe integer byte counts of at least 1 MiB.')
}
if (!Number.isSafeInteger(photoUploadMaxRequestBytes) || photoUploadMaxRequestBytes < 1024 * 1024
  || !Number.isSafeInteger(photoUploadMaxConcurrent) || photoUploadMaxConcurrent < 1
  || !Number.isSafeInteger(photoUploadStaleTempMs) || photoUploadStaleTempMs < 60 * 60 * 1000) {
  throw new Error('Photo upload limits must be safe positive values; total bytes must be at least 1 MiB and stale age at least 1 hour.')
}
const photoUploadConcurrencyGuard = createPhotoUploadConcurrencyGuard(photoUploadMaxConcurrent)
const photoUploadRequestLimit = createMultipartRequestLimit(
  photoUploadMaxRequestBytes,
  `إجمالي طلب رفع الصور يتجاوز الحد المسموح (${Math.ceil(photoUploadMaxRequestBytes / 1024 ** 2)} ميجابايت).`,
)
const isProduction = process.env.NODE_ENV === 'production'
const cookieSecure = String(process.env.COOKIE_SECURE || 'false').toLowerCase() === 'true'
const loginThrottle = createLoginThrottle({
  baseDelayMs: Number(process.env.LOGIN_DELAY_BASE_MS || 250),
  maxDelayMs: Number(process.env.LOGIN_DELAY_MAX_MS || 2000),
  windowMs: Number(process.env.LOGIN_DELAY_WINDOW_MS || 15 * 60 * 1000),
})
const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const dummyPasswordHashPromise = bcrypt.hash('madar-invalid-login-timing-padding', 12)
const jwtSecret = String(process.env.JWT_SECRET || '')
if (Buffer.byteLength(jwtSecret) < 32) {
  throw new Error('JWT_SECRET must be configured with at least 32 bytes of random data.')
}
const pathsOverlap = (left, right) => path.resolve(left) === path.resolve(right)
  || pathIsWithin(left, right) || pathIsWithin(right, left)
if (pathsOverlap(storageRoot, backupsRoot) || pathIsWithin(storageRoot, databasePath)) {
  throw new Error('Backup storage, customer storage, and the SQLite database must use separate paths.')
}

for (const directory of ['Clients', 'Machines', 'Areas']) {
  fsExtra.ensureDirSync(path.join(storageRoot, directory))
}
fsExtra.ensureDirSync(uploadTemp)
fsExtra.ensureDirSync(excelUploadsRoot)

app.disable('x-powered-by')
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-site' } }))
app.use(compression())
app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ limit: '50mb', extended: true, parameterLimit: 100000 }))

function sendError(res, status, message) {
  return res.status(status).json({ error: message })
}

function apiError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function parseOptionalCurrencyAmount(value) {
  if (value === undefined || value === null || value === '') return 0
  const cents = parseCurrencyCents(value, { allowZero: true })
  return cents === null ? null : currencyAmountFromCents(cents)
}

function cashboxBalanceCents() {
  const openingBatch = db.prepare(`SELECT id,cutover_date FROM opening_balance_batches
    WHERE status='posted' AND cutover_date<=date('now') ORDER BY cutover_date DESC,id DESC LIMIT 1`).get()
  const rows = openingBatch
    ? db.prepare(`SELECT kind,amount FROM treasury_transactions WHERE created_at>=? ORDER BY id`).all(`${openingBatch.cutover_date} 00:00:00`)
    : db.prepare(`SELECT kind,amount FROM treasury_transactions ORDER BY id`).all()
  const movementBalance = rows.reduce((balance, row) => balance
    + (row.kind === 'income' ? 1 : -1) * Math.round(Number(row.amount || 0) * 100), 0)
  if (!openingBatch) return movementBalance
  const openingCash = db.prepare(`SELECT side,amount_cents FROM opening_balance_lines
    WHERE batch_id=? AND (line_type='cashbox' OR (line_type='account' AND account_id IN (
      SELECT id FROM accounts WHERE system_key='factory_cashbox'
    )))`).all(openingBatch.id)
  return movementBalance + openingCash.reduce((balance, line) => balance
    + (line.side === 'debit' ? 1 : -1) * Number(line.amount_cents), 0)
}

function assertMaterialUnlocked(materialId) {
  const count = db.prepare(`SELECT c.code FROM stock_count_items i JOIN stock_counts c ON c.id=i.count_id
    WHERE i.material_id=? AND i.released_at IS NULL AND c.status='open' LIMIT 1`).get(materialId)
  if (count) throw apiError(409, `الصنف مقفل ضمن جرد مفتوح ${count.code}؛ أكمل الجرد أو ألغِه قبل الحركة.`)
}

function inventoryQuantityUnits(value) {
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('كمية المخزون غير صالحة.')
  const units = Math.round(quantity * 1_000_000)
  if (!Number.isSafeInteger(units) || Math.abs(quantity - units / 1_000_000) > 0.000001) throw new Error('دقة كمية المخزون تتجاوز الحد المدعوم.')
  return units
}

function consumeInventoryLots(materialId, warehouse, quantity, movementId) {
  let remainingUnits = inventoryQuantityUnits(quantity)
  const lots = db.prepare(`SELECT id,remaining_quantity,unit_cost_cents FROM inventory_lots
    WHERE material_id=? AND warehouse=? AND remaining_quantity>0 ORDER BY id`).all(materialId, warehouse)
  const allocations = []
  let totalCostCents = 0
  let lastUnitCostCents = 0
  for (const lot of lots) {
    if (remainingUnits <= 0) break
    const lotUnits = inventoryQuantityUnits(lot.remaining_quantity)
    const consumedUnits = Math.min(remainingUnits, lotUnits)
    if (!consumedUnits) continue
    const remainingLotUnits = lotUnits - consumedUnits
    db.prepare('UPDATE inventory_lots SET remaining_quantity=? WHERE id=?')
      .run(remainingLotUnits / 1_000_000, lot.id)
    const lotCost = Number(lot.unit_cost_cents)
    const consumedQuantity = consumedUnits / 1_000_000
    db.prepare('INSERT INTO inventory_lot_consumptions(lot_id,movement_id,quantity) VALUES (?,?,?)')
      .run(lot.id, movementId, consumedQuantity)
    allocations.push({ lotId: lot.id, quantity: consumedQuantity, unitCostCents: lotCost })
    totalCostCents += Math.round(consumedQuantity * lotCost)
    lastUnitCostCents = lotCost
    remainingUnits -= consumedUnits
  }
  if (remainingUnits > 0) throw apiError(409, 'تعذر إثبات مصدر رصيد الصنف؛ الحركة موقوفة للحفاظ على سجل التتبع.')
  return { allocations, totalCostCents, lastUnitCostCents }
}

function createInventoryLot({ materialId, invoiceId = null, sourceType, sourceId = null, warehouse, quantity, unitCostCents }) {
  if (!(Number(quantity) > 0)) return null
  return db.prepare(`INSERT INTO inventory_lots(material_id,invoice_id,source_type,source_id,warehouse,received_quantity,remaining_quantity,unit_cost_cents)
    VALUES (?,?,?,?,?,?,?,?)`).run(materialId, invoiceId, sourceType, sourceId == null ? null : String(sourceId), warehouse,
    Number(quantity), Number(quantity), unitCostCents).lastInsertRowid
}

function upsertPersistentNotification({ key, kind, title, detail = '', sourceType = '', sourceId = '' }) {
  const previous = db.prepare('SELECT * FROM persistent_notifications WHERE notification_key=?').get(key)
  db.prepare(`INSERT INTO persistent_notifications(notification_key,kind,title,detail,source_type,source_id)
    VALUES (?,?,?,?,?,?) ON CONFLICT(notification_key) DO UPDATE SET
      title=excluded.title,detail=excluded.detail,source_type=excluded.source_type,source_id=excluded.source_id,
      reviewed_at=CASE WHEN persistent_notifications.resolved_at IS NOT NULL THEN NULL ELSE persistent_notifications.reviewed_at END,
      reviewed_by=CASE WHEN persistent_notifications.resolved_at IS NOT NULL THEN NULL ELSE persistent_notifications.reviewed_by END,
      resolved_at=NULL`)
    .run(key, kind, title, detail, sourceType, String(sourceId))
  const notification = db.prepare('SELECT * FROM persistent_notifications WHERE notification_key=?').get(key)
  if (!previous || previous.resolved_at || previous.title !== title || previous.detail !== detail) {
    io.to('role:admin').emit('system:notification', notification)
  }
  return notification
}

function resolvePersistentNotification(key) {
  const notification = db.prepare('SELECT * FROM persistent_notifications WHERE notification_key=?').get(key)
  if (!notification || notification.resolved_at) return false
  db.prepare('UPDATE persistent_notifications SET resolved_at=CURRENT_TIMESTAMP WHERE id=?').run(notification.id)
  io.to('role:admin').emit('system:notification', { ...notification, resolved_at: new Date().toISOString() })
  return true
}

async function syncPersistentNotifications() {
  const lowStock = db.prepare(`SELECT id,code,name,stock,sub_stock,min_stock FROM materials
    WHERE active=1 AND deleted_at IS NULL AND stock+sub_stock<=min_stock ORDER BY id`).all()
  const lowIds = new Set(lowStock.map((material) => String(material.id)))
  const activeLow = db.prepare(`SELECT id,notification_key,source_id FROM persistent_notifications
    WHERE kind='low_stock' AND resolved_at IS NULL`).all()
  for (const material of lowStock) upsertPersistentNotification({
    key: `low_stock:${material.id}`, kind: 'low_stock', title: 'مخزون منخفض',
    detail: `${material.code} · ${material.name} — المتاح ${Number(material.stock) + Number(material.sub_stock)} والحد ${material.min_stock}`,
    sourceType: 'material', sourceId: material.id,
  })
  for (const notification of activeLow) {
    if (!lowIds.has(String(notification.source_id))) resolvePersistentNotification(notification.notification_key)
  }

  const backup = db.prepare('SELECT last_success_at,last_failure_at,last_failure_code FROM backup_health WHERE id=1').get()
  if (backup.last_failure_at && (!backup.last_success_at || backup.last_failure_at > backup.last_success_at)) {
    upsertPersistentNotification({ key: 'backup_failed', kind: 'backup_failed', title: 'فشل النسخ الاحتياطي',
      detail: `${backup.last_failure_code || 'backup_failed'} · ${backup.last_failure_at}`, sourceType: 'backup', sourceId: 'latest' })
  } else {
    resolvePersistentNotification('backup_failed')
  }

  const filesystemOperations = pendingFilesystemOperationsCount(db)
  const orderDeletionStages = await countPendingOrderDeletionStages()
  if (filesystemOperations + orderDeletionStages > 0) {
    upsertPersistentNotification({ key: 'pending_recovery', kind: 'pending_recovery', title: 'استرداد ملفات معلق',
      detail: `${filesystemOperations} عملية ملفات و${orderDeletionStages} مجلد أمر`, sourceType: 'recovery', sourceId: 'pending' })
  } else {
    resolvePersistentNotification('pending_recovery')
  }
  return db.prepare(`SELECT id,notification_key,kind,title,detail,source_type,source_id,created_at,reviewed_at,resolved_at
    FROM persistent_notifications ORDER BY resolved_at IS NULL DESC,created_at DESC,id DESC LIMIT 100`).all()
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('ar')
    .normalize('NFD').replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
}

function safeSegment(value) {
  const cleaned = String(value || 'folder').normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 100)
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'folder'
}

function absoluteStoragePath(relativePath) {
  const normalized = String(relativePath || '').replace(/\\/g, '/')
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)
    || normalized.split('/').some(isOrderDeletionStageSegment)) return null
  const absolute = path.resolve(storageRoot, normalized)
  return pathIsWithin(storageRoot, absolute) ? absolute : null
}

function isOrderDeletionStageSegment(segment) {
  return String(segment || '').toLowerCase().startsWith(orderDeleteStagePrefix)
}

function relativeStoragePath(absolute) {
  return path.relative(storageRoot, absolute).split(path.sep).join('/')
}

function clientRootDirectory(client) {
  const clientName = String(typeof client === 'string' ? client : client?.name || '').trim()
  if (!clientName) throw apiError(400, missingOrderClientMessage)
  return path.resolve(storageRoot, 'Clients', safeSegment(clientName))
}

function clientOrderDirectory(client, order) {
  const clientCode = String(client?.code || '').trim()
  const clientName = String(client?.name || '').trim()
  if (!clientCode || !clientName || !String(order?.code || '').trim()) {
    throw apiError(400, missingOrderClientMessage)
  }
  const typeFolder = order.type === 'maintenance' ? 'Maintenance' : order.type === 'operation' ? 'Operation' : null
  if (!typeFolder) throw apiError(400, 'نوع الأمر غير صالح لتحديد مسار الحفظ.')
  return path.resolve(clientRootDirectory(client), typeFolder, safeSegment(order.code))
}

function getOrderStorageContext(orderId) {
  const row = db.prepare(`SELECT o.*,c.id AS linked_client_id,c.code AS client_code,c.name AS client_name
    FROM orders o LEFT JOIN clients c ON c.id=o.client_id
    WHERE o.id=? AND o.deleted_at IS NULL`).get(orderId)
  if (!row) throw apiError(404, 'الأمر غير موجود.')
  if (!row.client_id || !row.linked_client_id || !String(row.client_code || '').trim() || !String(row.client_name || '').trim()) {
    throw apiError(400, missingOrderClientMessage)
  }
  const client = { id: row.linked_client_id, code: row.client_code, name: row.client_name }
  return {
    order: row,
    client,
    clientRoot: clientRootDirectory(client),
    orderDirectory: clientOrderDirectory(client, row),
  }
}

function orderDeletionStagePath(orderDirectory, orderId) {
  return path.join(path.dirname(orderDirectory), `${orderDeleteStagePrefix}${Number(orderId)}`)
}

function recordOrderDeletionRecovery(userId, orderId, action, details, oldValues, newValues) {
  try {
    db.transaction(() => audit(userId, action, 'order', orderId, details, oldValues, newValues))()
  } catch (error) {
    console.error(`Could not record order-file recovery audit for order ${orderId}:`, error)
  }
}

async function recoverInterruptedOrderFileDeletions() {
  const orders = db.prepare(`SELECT o.id,o.code,o.type,o.deleted_at,c.code AS client_code,c.name AS client_name
    FROM orders o LEFT JOIN clients c ON c.id=o.client_id ORDER BY o.id`).all()

  for (const order of orders) {
    if (!order.client_code || !order.client_name || !order.code) continue
    const client = { code: order.client_code, name: order.client_name }
    const orderDirectory = clientOrderDirectory(client, order)
    const stagedPath = orderDeletionStagePath(orderDirectory, order.id)
    const stagedStats = await fsExtra.lstat(stagedPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (!stagedStats) continue
    if (!stagedStats.isDirectory() || stagedStats.isSymbolicLink() || await storagePathUsesSymlink(stagedPath)) {
      throw new Error(`Order ${order.id} has an unsafe pending deletion stage; inspect ${stagedPath} before starting Madar.`)
    }
    const originalStats = await fsExtra.lstat(orderDirectory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (originalStats) {
      throw new Error(`Both the active order folder and its pending deletion stage exist for order ${order.id}; inspect ${orderDirectory} and ${stagedPath}.`)
    }

    if (order.deleted_at) {
      await fsExtra.remove(stagedPath)
      const remaining = await fsExtra.lstat(stagedPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (remaining) throw new Error(`Could not finish deleting staged files for soft-deleted order ${order.id}.`)
      recordOrderDeletionRecovery(null, order.id, 'physical-file-removal-recovered', 'startup-order-delete-recovery',
        { stagedPath: relativeStoragePath(stagedPath) }, { removed: true, recoveredAt: new Date().toISOString() })
      continue
    }

    await fsExtra.rename(stagedPath, orderDirectory)
    recordOrderDeletionRecovery(null, order.id, 'order-file-delete-rollback-recovered', 'startup-order-delete-recovery',
      { stagedPath: relativeStoragePath(stagedPath) }, { restoredPath: relativeStoragePath(orderDirectory), recoveredAt: new Date().toISOString() })
  }
}

function scheduleOrderDeletionRecoveryRestart(res) {
  orderDeletionRecoveryRequired = true
  backupTask.stop()
  let restartStarted = false
  const restart = () => {
    if (restartStarted) return
    restartStarted = true
    const fallbackExit = setTimeout(() => process.exit(1), 5000)
    shutdownApplicationResources()
      .catch((error) => console.error('Could not shut down after order-file recovery failure:', error))
      .finally(() => {
        clearTimeout(fallbackExit)
        process.exit(1)
      })
  }
  if (res && !res.writableEnded) {
    res.once('finish', restart)
    res.once('close', restart)
  } else {
    setImmediate(restart)
  }
}

function pathIsWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function pathIsWithinOrEqual(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

async function canonicalStoragePath(absolutePath) {
  const candidate = path.resolve(absolutePath)
  if (!pathIsWithinOrEqual(storageRoot, candidate)) return null
  const hasSymlink = await storagePathUsesSymlink(candidate).catch((error) => {
    if (error.code === 'ENOENT') return false
    throw error
  })
  if (hasSymlink) return null
  const canonicalRoot = await fs.promises.realpath(storageRoot).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!canonicalRoot) return null
  const canonicalCandidate = await fs.promises.realpath(candidate).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  return canonicalCandidate && pathIsWithinOrEqual(canonicalRoot, canonicalCandidate) ? canonicalCandidate : null
}

async function safeStorageFile(relativePath) {
  const requestedPath = absoluteStoragePath(relativePath)
  if (!requestedPath) return null
  const canonicalPath = await canonicalStoragePath(requestedPath)
  if (!canonicalPath) return null
  const stats = await fs.promises.lstat(canonicalPath).catch((error) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!stats?.isFile() || stats.isSymbolicLink()) return null
  return { requestedPath, absolutePath: canonicalPath, stats }
}

function requireOrderClient(getOrderId) {
  return asyncRoute(async (req, res, next) => {
    const context = getOrderStorageContext(getOrderId(req))
    req.orderStorageContext = context
    next()
  })
}

async function ensureClientFolders(client) {
  const root = clientRootDirectory(client)
  await Promise.all(['Logo', 'Invoices']
    .map((name) => fs.promises.mkdir(path.join(root, name), { recursive: true })))
}

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie || ''
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === name) {
      try { return decodeURIComponent(value.join('=')) }
      catch { return '' }
    }
  }
  return ''
}

function setSessionCookie(res, token) {
  const options = ['Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}`]
  if (cookieSecure) options.push('Secure')
  res.setHeader('Set-Cookie', `madar_session=${encodeURIComponent(token)}; ${options.join('; ')}`)
}

function clearSessionCookie(res) {
  const options = ['Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0']
  if (cookieSecure) options.push('Secure')
  res.setHeader('Set-Cookie', `madar_session=; ${options.join('; ')}`)
}

function issueAuthToken(user) {
  const token = jwt.sign({ username: user.username, role: user.role }, jwtSecret, {
    algorithm: 'HS256',
    subject: String(user.id),
    jwtid: crypto.randomUUID(),
    issuer: 'madar-erp',
    audience: 'madar-client',
    expiresIn: Math.floor(SESSION_LIFETIME_MS / 1000),
  })
  db.transaction(() => {
    db.prepare("DELETE FROM sessions WHERE datetime(expires_at)<=datetime('now')").run()
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES (?,?,?)')
      .run(crypto.createHash('sha256').update(token).digest('hex'), user.id,
        new Date(Date.now() + SESSION_LIFETIME_MS).toISOString())
  })()
  return token
}

function authenticatedUser(token) {
  if (!token) return null
  try {
    const claims = jwt.verify(token, jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'madar-erp',
      audience: 'madar-client',
    })
    const userId = Number(claims.sub)
    if (!Number.isSafeInteger(userId) || userId <= 0 || typeof claims.jti !== 'string') return null
    const sessionHash = crypto.createHash('sha256').update(token).digest('hex')
    const session = db.prepare('SELECT user_id,expires_at FROM sessions WHERE token_hash=?').get(sessionHash)
    if (!session || Number(session.user_id) !== userId || Date.parse(session.expires_at) <= Date.now()) return null
    const user = db.prepare('SELECT id,username,full_name,role,active,is_master FROM users WHERE id=? AND deleted_at IS NULL').get(userId)
    if (!user || !user.active || user.username !== claims.username || user.role !== claims.role) return null
    return user
  } catch {
    return null
  }
}

function requireAuth(req, res, next) {
  const token = getCookie(req, 'madar_session')
  if (!token) return sendError(res, 401, 'يرجى تسجيل الدخول أولاً.')
  const user = authenticatedUser(token)
  if (!user) return sendError(res, 401, 'انتهت الجلسة، يرجى تسجيل الدخول مجدداً.')
  req.user = user
  req.authToken = token
  next()
}

function allowRoles(...roles) {
  return (req, res, next) => roles.includes(req.user.role)
    ? next()
    : sendError(res, 403, 'ليست لديك صلاحية لتنفيذ هذا الإجراء.')
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

async function nextSequelizeCode(counterName, prefix, transaction) {
  const [counter] = await models.Counter.findOrCreate({
    where: { name: counterName },
    defaults: { value: 1000 },
    transaction,
  })
  await counter.increment('value', { by: 1, transaction })
  await counter.reload({ transaction })
  return `${prefix}-${String(counter.value).padStart(4, '0')}`
}

async function sequelizeAudit({ userId, action, entity, entityId, details = '', oldValues = null, newValues = null, transaction }) {
  return models.AuditLog.create({
    userId: userId || null,
    action,
    entity,
    entityId: String(entityId || ''),
    details,
    oldValues: oldValues == null ? null : JSON.stringify(oldValues),
    newValues: newValues == null ? null : JSON.stringify(newValues),
  }, { transaction })
}

function clientApiRecord(client) {
  const row = client.get({ plain: true })
  return {
    id: row.id, code: row.code, name: row.name, contact_name: row.contactName,
    phone: row.phone, email: row.email, address: row.address,
    primary_color: row.primaryColor, secondary_color: row.secondaryColor,
    logo_path: row.logoPath, created_at: row.created_at, deleted_at: row.deleted_at ?? null,
  }
}

function materialApiRecord(material, role) {
  const row = material.get({ plain: true })
  return {
    id: row.id, code: row.code, name: row.name, specification: row.specification || '', unit: row.unit,
    stock: row.stock, subStock: row.subStock || 0,
    unitCost: ['admin', 'purchasing'].includes(role) ? row.unitCost : 0,
    minStock: row.minStock,
  }
}

async function readCsvRows(filePath, options = {}) {
  const input = fs.createReadStream(filePath, { encoding: 'utf8' })
  const parser = parseCsv({
    columns: true,
    skip_empty_lines: true,
    bom: true,
    trim: true,
    ...options,
  })
  input.once('error', (error) => parser.destroy(error))
  input.pipe(parser)
  const rows = []
  for await (const row of parser) rows.push(row)
  return rows
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => {
      const destination = req.photoUploadDirectory || uploadTemp
      fsExtra.ensureDir(destination).then(() => callback(null, destination)).catch(callback)
    },
    filename: (req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase()
      if (req.photoUploadWorkspace) {
        callback(null, `photo-${crypto.randomUUID()}${/^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '.bin'}`)
      } else {
        callback(null, `${Date.now()}-${crypto.randomUUID()}${extension}`)
      }
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024, files: 500 },
})
function persistentExcelImportUpload(prefix, maxFileSize, extensions, invalidFileMessage) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, callback) => {
        fsExtra.ensureDir(excelUploadsRoot).then(() => callback(null, excelUploadsRoot)).catch(callback)
      },
      filename: (_req, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase()
        const originalBase = path.basename(file.originalname, path.extname(file.originalname))
          .normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80) || prefix
        callback(null, `${prefix}_${originalBase}_${Date.now()}_${crypto.randomUUID()}${extension}`)
      },
    }),
    limits: { fileSize: maxFileSize, files: 1 },
    fileFilter: (_req, file, callback) => {
      if (!extensions.includes(path.extname(file.originalname).toLowerCase())) {
        return callback(apiError(400, invalidFileMessage))
      }
      callback(null, true)
    },
  })
}
const machineImportUpload = persistentExcelImportUpload('Machines_Import', 50 * 1024 * 1024, ['.csv', '.xlsx'], 'اختر ملف CSV أو XLSX صالحًا.')
const inventoryImportUpload = persistentExcelImportUpload('Inventory_Import', 25 * 1024 * 1024, ['.csv', '.xlsx'], 'اختر ملف CSV أو XLSX صالحًا.')
const userImportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!['.xlsx', '.xls'].includes(path.extname(file.originalname).toLowerCase())) {
      return callback(apiError(400, 'ارفع ملف Excel بصيغة .xlsx أو .xls.'))
    }
    callback(null, true)
  },
})
const restoreArchiveUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fsExtra.ensureDir(backupsRoot).then(() => callback(null, backupsRoot)).catch(callback)
    },
    filename: (_req, _file, callback) => callback(null, `.madar-restore-upload-${crypto.randomUUID()}.zip`),
  }),
  limits: { fileSize: backupRestoreUploadLimit, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (path.extname(file.originalname).toLowerCase() !== '.zip') {
      return callback(apiError(400, 'اختر ملف نسخة احتياطية بصيغة ZIP.'))
    }
    callback(null, true)
  },
})
const invoiceEvidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase()
    if (!['.jpg','.jpeg','.png','.webp','.gif','.bmp','.pdf'].includes(extension)) {
      return callback(apiError(400, 'ارفع صورة أو ملف PDF كمرفق للفاتورة.'))
    }
    callback(null, true)
  },
})

function userDto(user) {
  return { id: user.id, username: user.username, fullName: user.full_name, role: user.role, active: Boolean(user.active), isMaster: Boolean(user.is_master) }
}

const employeeUserRoles = { Sales: 'sales', Purchasing: 'purchasing', Operation: 'operations' }
const employeeDepartments = new Set(['Maintenance', 'Sales', 'Purchasing', 'Operation'])

function resolveEmployeeId(value) {
  if (value == null || String(value).trim() === '') return null
  const employeeId = Number(value)
  if (!Number.isInteger(employeeId) || employeeId <= 0) throw apiError(400, 'الموظف المحدد غير صالح.')
  const employee = db.prepare('SELECT id FROM employees WHERE id=? AND active=1 AND deleted_at IS NULL').get(employeeId)
  if (!employee) throw apiError(400, 'الموظف المحدد غير موجود أو غير نشط.')
  return employee.id
}

function resolveOrderEmployeeIds(body) {
  let values = body?.employeeIds ?? body?.assignedEmployeeIds
  if (values === undefined && body?.assignedEmployeeId != null) values = [body.assignedEmployeeId]
  if (values === undefined && body?.assignedWorkerId != null) {
    const linked = db.prepare('SELECT employee_id FROM users WHERE id=? AND deleted_at IS NULL').get(Number(body.assignedWorkerId))
    values = linked?.employee_id ? [linked.employee_id] : []
  }
  if (values == null || values === '') return []
  if (!Array.isArray(values) || values.length > 100
    || values.some((value) => !Number.isSafeInteger(Number(value)) || Number(value) < 1)) {
    throw apiError(400, 'قائمة الموظفين المحددة غير صالحة.')
  }
  const ids = [...new Set(values.map(Number))]
  if (ids.length !== values.length) throw apiError(400, 'قائمة الموظفين تحتوي على عناصر مكررة.')
  if (!ids.length) return []
  const placeholders = ids.map(() => '?').join(',')
  const activeIds = db.prepare(`SELECT id FROM employees WHERE id IN (${placeholders}) AND active=1 AND deleted_at IS NULL`).all(...ids).map((row) => row.id)
  if (activeIds.length !== ids.length) throw apiError(400, 'تحتوي قائمة الفريق على موظف غير موجود أو غير نشط.')
  return ids
}

function employeeDto(employee, user = null, includeAccess = true) {
  return {
    id: employee.id, name: employee.name, department: employee.department, phone: employee.phone,
    jobTitle: employee.jobTitle || '', active: Boolean(employee.active),
    monthlySalaryCents: Number(employee.monthlySalaryCents || 0),
    ...(includeAccess ? {
      username: user?.username || '', userActive: Boolean(user?.active && !user?.deleted_at), userDeleted: Boolean(user?.deleted_at),
    } : {}),
  }
}

async function photoTimestamp(filePath, filename = filePath) {
  let metadata = null
  try { metadata = await exifr.parse(filePath, ['DateTimeOriginal', 'CreateDate']) }
  catch { /* Fall through to filename and file-modification timestamps. */ }
  const stats = await fs.promises.stat(filePath)
  return resolvePhotoTimestamp({ metadata, filePath: filename, mtimeMs: stats.mtimeMs })
}

async function splitPhotosByTime(imagePaths) {
  const timed = await Promise.all(imagePaths.map(async (relativePath) => {
    const absolute = absoluteStoragePath(relativePath)
    return { relativePath, time: absolute ? await photoTimestamp(absolute) : 0 }
  }))
  return splitTimedPhotos(timed)
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

function safeHexColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? value : fallback
}

async function compressedExportImage(filePath) {
  const absolute = path.isAbsolute(filePath) ? filePath : absoluteStoragePath(filePath)
  if (!absolute) return null
  const stats = await fs.promises.stat(absolute).catch(() => null)
  if (!stats?.isFile()) return null
  const { data, info } = await sharp(absolute).rotate().flatten({ background: '#ffffff' })
    .resize({ width: 800, withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer({ resolveWithObject: true })
  return { buffer: data, width: info.width, height: info.height, dataUri: `image/jpeg;base64,${data.toString('base64')}` }
}

function pptxImagePlacement(image, x, y, width, height) {
  const scale = Math.min(width / image.width, height / image.height)
  const renderedWidth = image.width * scale
  const renderedHeight = image.height * scale
  return { x: x + (width - renderedWidth) / 2, y: y + (height - renderedHeight) / 2, w: renderedWidth, h: renderedHeight }
}

function machineMatch(folderName, machines) {
  const candidate = normalize(folderName)
  if (!candidate) return null
  const exactMatch = machines.find((machine) => [machine.code, machine.nameAr ?? machine.name_ar, machine.nameEn ?? machine.name_en]
    .some((value) => value && normalize(value) === candidate))
  if (exactMatch) return exactMatch
  const codePrefix = String(folderName).split(/\s+[-–—]\s+/u, 1)[0]
  return machines.find((machine) => normalize(machine.code) === normalize(codePrefix)) || null
}

function orderSummary(order, includeCogs = false) {
  return {
    id: order.id,
    code: order.code,
    clientId: order.client_id,
    clientName: order.client_name,
    clientCode: order.client_code,
    type: order.type,
    status: order.status,
    notes: order.notes,
    totalCost: order.total_cost ?? null,
    materialCost: order.material_cost ?? null,
    operatingCost: order.operating_cost ?? null,
    sellingPrice: order.selling_price ?? null,
    profit: order.selling_price == null || order.total_cost == null
      ? null : Number(order.selling_price) - Number(order.total_cost),
    assignedWorkerId: order.assigned_worker_id ?? null,
    assignedWorkerName: order.assigned_worker_name || null,
    assignedEmployeeId: order.assigned_employee_id ?? null,
    assignedEmployeeName: order.assigned_employee_name || order.assigned_worker_name || null,
    employeeIds: Array.isArray(order.employee_ids) ? order.employee_ids : String(order.employee_ids || '').split(',').filter(Boolean).map(Number),
    employeeNames: Array.isArray(order.employee_names) ? order.employee_names : String(order.employee_names || '').split('|').filter(Boolean),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    archivedAt: order.archived_at,
    machineCount: Number(order.machine_count || 0),
    ...(includeCogs ? {
      actualMaterialCogsCents: Number(order.actual_material_cogs_cents || 0),
      actualMaterialCogs: Number(order.actual_material_cogs_cents || 0) / 100,
    } : {}),
  }
}

const api = express.Router()

const activeApiRequestTokens = new Set()
const snapshotDrainWaiters = new Set()
let snapshotLock = false
let snapshotLockOwner = null
let orderDeletionRecoveryRequired = false

function checkSnapshotDrainWaiters() {
  for (const check of [...snapshotDrainWaiters]) check()
}

function waitForApiDrain(ownerToken = null) {
  const hasOtherRequests = () => [...activeApiRequestTokens].some((token) => token !== ownerToken)
  if (!hasOtherRequests()) return Promise.resolve()
  return new Promise((resolve) => {
    const check = () => {
      if (hasOtherRequests()) return
      snapshotDrainWaiters.delete(check)
      resolve()
    }
    snapshotDrainWaiters.add(check)
  })
}

async function acquireSnapshotLock(ownerToken = null) {
  if (snapshotLock) throw apiError(409, 'توجد عملية نسخ أو استعادة جارية؛ أعد المحاولة بعد انتهائها.')
  if (orderDeletionRecoveryRequired) throw apiError(503, 'النسخ متوقف مؤقتًا حتى استعادة ملفات أمر معلقة.')
  if (pendingFilesystemOperationsCount(db) > 0) throw apiError(503, 'النسخ والاستعادة متوقفان مؤقتًا حتى اكتمال استرداد ملفات التخزين المعلقة.')
  snapshotLock = true
  snapshotLockOwner = ownerToken
  try {
    await waitForApiDrain(ownerToken)
    if (orderDeletionRecoveryRequired) throw apiError(503, 'النسخ متوقف مؤقتًا حتى استعادة ملفات أمر معلقة.')
    if (pendingFilesystemOperationsCount(db) > 0) throw apiError(503, 'النسخ والاستعادة متوقفان مؤقتًا حتى اكتمال استرداد ملفات التخزين المعلقة.')
    await waitForAreaProcessingJobs()
  } catch (error) {
    snapshotLock = false
    snapshotLockOwner = null
    throw error
  }
  return () => {
    snapshotLock = false
    snapshotLockOwner = null
  }
}

async function waitForAreaProcessingJobs() {
  while (true) {
    const pending = [...areaProcessingJobs.values()]
      .filter((job) => ['starting', 'processing'].includes(job.status))
      .map((job) => job.completionPromise)
      .filter(Boolean)
    if (!pending.length) return
    await Promise.all(pending)
  }
}

api.use((req, res, next) => {
  if (orderDeletionRecoveryRequired) return sendError(res, 503, 'تعذر استعادة مجلد أمر بعد فشل قاعدة البيانات؛ الخدمة تتوقف لإعادة التشغيل والاستعادة تلقائيًا.')
  if (snapshotLock) return sendError(res, 503, 'النظام متوقف مؤقتًا لإنشاء نسخة احتياطية أو استعادة البيانات.')
  const token = Symbol('api-request')
  req.apiActivityToken = token
  activeApiRequestTokens.add(token)
  let released = false
  const release = () => {
    if (released) return
    released = true
    activeApiRequestTokens.delete(token)
    checkSnapshotDrainWaiters()
  }
  res.once('finish', release)
  res.once('close', release)
  next()
})

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function idempotentReplayIsAllowed(req, scope) {
  const key = String(req.get('Idempotency-Key') || '').trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)) return false
  const existing = db.prepare('SELECT created_at_ms FROM idempotency_keys WHERE user_id=? AND scope=? AND key=?')
    .get(req.user.id, scope, key)
  // Existing keys are handled as a cheap replay or conflict by createIdempotently.
  return Boolean(existing && Date.now() - existing.created_at_ms < 5000)
}

function createRateLimiter(scope) {
  return rateLimit({
    windowMs: 1000,
    limit: 1,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const resolution = scope === 'POST /machines/import'
        ? (['true', '1', 'yes'].includes(String(req.query?.replacement || '').toLowerCase())
          ? ':replacement'
          : (['true', '1', 'yes'].includes(String(req.query?.overwrite || '').toLowerCase())
            ? ':overwrite'
            : (['true', '1', 'yes'].includes(String(req.query?.skipExisting || '').toLowerCase()) ? ':skip' : '')))
        : ''
      return `user:${req.user.id}${resolution}`
    },
    skip: (req) => idempotentReplayIsAllowed(req, scope),
    handler: (_req, res) => sendError(res, 429, 'أرسل طلب معالجة واحدًا فقط في الثانية، ثم حاول مجددًا.'),
  })
}

function createIdempotently(req, scope, create) {
  const key = String(req.get('Idempotency-Key') || '').trim().toLowerCase()
  if (!key) return { status: 201, body: db.transaction(create)(), replayed: false }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)) {
    return { error: 'يجب أن تكون قيمة Idempotency-Key بصيغة UUID.' }
  }
  const requestHash = crypto.createHash('sha256').update(stableJson(req.body || {})).digest('hex')
  return db.transaction(() => {
    const existing = db.prepare('SELECT * FROM idempotency_keys WHERE user_id=? AND scope=? AND key=?')
      .get(req.user.id, scope, key)
    const now = Date.now()
    if (existing && now - existing.created_at_ms < 5000) {
      if (existing.request_hash !== requestHash) return { conflict: true }
      return { status: existing.response_status, body: JSON.parse(existing.response_body), replayed: true }
    }
    if (existing) db.prepare('DELETE FROM idempotency_keys WHERE user_id=? AND scope=? AND key=?').run(req.user.id, scope, key)
    db.prepare(`INSERT INTO idempotency_keys(user_id,scope,key,request_hash,response_status,response_body,created_at_ms)
      VALUES (?,?,?,?,201,'{}',?)`).run(req.user.id, scope, key, requestHash, now)
    const body = create()
    db.prepare(`UPDATE idempotency_keys SET response_body=? WHERE user_id=? AND scope=? AND key=?`)
      .run(JSON.stringify(body), req.user.id, scope, key)
    db.prepare('DELETE FROM idempotency_keys WHERE created_at_ms<?').run(now - 86_400_000)
    return { status: 201, body, replayed: false }
  })()
}

function sendIdempotentCreate(req, res, scope, create) {
  const result = createIdempotently(req, scope, create)
  if (result.error) return sendError(res, 400, result.error)
  if (result.conflict) return sendError(res, 409, 'استُخدم مفتاح منع التكرار خلال آخر 5 ثوانٍ لطلب مختلف.')
  res.setHeader('Idempotency-Replayed', String(result.replayed))
  return res.status(result.status).json(result.body)
}

async function runIdempotentlyAsync(req, scope, descriptor, operation) {
  const key = String(req.get('Idempotency-Key') || '').trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)) {
    throw apiError(400, 'يجب إرسال Idempotency-Key بصيغة UUID لمعالجة الصور.')
  }
  const requestHash = crypto.createHash('sha256')
    .update(stableJson({ body: req.body || {}, descriptor })).digest('hex')
  const now = Date.now()
  const claim = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    await models.IdempotencyKey.destroy({
      where: { createdAtMs: { [Op.lt]: now - 86_400_000 } }, transaction,
    })
    const existing = await models.IdempotencyKey.findOne({
      where: { userId: req.user.id, scope, key }, transaction,
    })
    if (existing) {
      const age = now - Number(existing.createdAtMs)
      const expired = existing.responseStatus === 102 ? age >= 900_000 : age >= 86_400_000
      if (!expired && existing.requestHash !== requestHash) return { conflict: true }
      if (!expired && existing.responseStatus !== 102) {
        return { replay: true, status: existing.responseStatus, body: JSON.parse(existing.responseBody) }
      }
      if (!expired && existing.responseStatus === 102) return { inProgress: true }
      await existing.destroy({ transaction })
    }
    await models.IdempotencyKey.create({
      userId: req.user.id,
      scope,
      key,
      requestHash,
      responseStatus: 102,
      responseBody: '{}',
      createdAtMs: now,
    }, { transaction })
    return { claimed: true }
  })

  if (claim.conflict) throw apiError(409, 'استُخدم Idempotency-Key نفسه لطلب مختلف.')
  if (claim.inProgress) throw apiError(409, 'طلب المعالجة بهذا المفتاح ما زال قيد التنفيذ؛ أعد المحاولة بالمفتاح نفسه.')
  if (claim.replay) return { status: claim.status, body: claim.body, replayed: true }

  let completed = false
  const idempotency = {
    complete: async (transaction, body, status = 200) => {
      const [updated] = await models.IdempotencyKey.update({
        responseStatus: status,
        responseBody: JSON.stringify(body),
      }, {
        where: { userId: req.user.id, scope, key, requestHash, responseStatus: 102 },
        transaction,
      })
      if (!updated) throw new Error('تعذر تثبيت نتيجة معالجة الصور بمفتاح منع التكرار.')
      completed = true
    },
  }

  try {
    const body = await operation(idempotency)
    if (!completed) throw new Error('لم تُثبّت نتيجة معالجة الصور في معاملة قاعدة البيانات.')
    return { status: 200, body, replayed: false }
  } catch (error) {
    await models.IdempotencyKey.destroy({
      where: { userId: req.user.id, scope, key, requestHash, responseStatus: 102 },
    }).catch(() => {})
    throw error
  }
}

function sendIdempotentResult(res, result) {
  res.setHeader('Idempotency-Replayed', String(result.replayed))
  return res.status(result.status).json(result.body)
}

function areaProcessingRequestInfo(req, scope, descriptor) {
  const key = String(req.get('Idempotency-Key') || '').trim().toLowerCase()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(key)) {
    throw apiError(400, 'يجب إرسال Idempotency-Key بصيغة UUID لمعالجة الصور.')
  }
  const requestHash = crypto.createHash('sha256')
    .update(stableJson({ body: req.body || {}, descriptor })).digest('hex')
  return { key, requestHash, userId: req.user.id, scope }
}

async function claimAreaProcessingIdempotency(info) {
  const now = Date.now()
  const claim = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    await models.IdempotencyKey.destroy({
      where: { createdAtMs: { [Op.lt]: now - 86_400_000 } }, transaction,
    })
    const existing = await models.IdempotencyKey.findOne({
      where: { userId: info.userId, scope: info.scope, key: info.key }, transaction,
    })
    if (existing) {
      const age = now - Number(existing.createdAtMs)
      const expired = existing.responseStatus === 102 ? age >= 900_000 : age >= 86_400_000
      if (!expired && existing.requestHash !== info.requestHash) return { conflict: true }
      if (!expired && existing.responseStatus !== 102) {
        return { replay: true, status: existing.responseStatus, body: JSON.parse(existing.responseBody) }
      }
      if (!expired && existing.responseStatus === 102) return { inProgress: true }
      await existing.destroy({ transaction })
    }
    await models.IdempotencyKey.create({
      userId: info.userId,
      scope: info.scope,
      key: info.key,
      requestHash: info.requestHash,
      responseStatus: 102,
      responseBody: '{}',
      createdAtMs: now,
    }, { transaction })
    return { claimed: true }
  })

  if (claim.conflict || claim.inProgress || claim.replay) return claim
  return {
    complete: async (transaction, body, status = 200) => {
      const [updated] = await models.IdempotencyKey.update({
        responseStatus: status,
        responseBody: JSON.stringify(body),
      }, {
        where: {
          userId: info.userId, scope: info.scope, key: info.key,
          requestHash: info.requestHash, responseStatus: 102,
        },
        transaction,
      })
      if (!updated) throw new Error('تعذر تثبيت نتيجة معالجة الصور بمفتاح منع التكرار.')
    },
    fail: async () => models.IdempotencyKey.destroy({
      where: {
        userId: info.userId, scope: info.scope, key: info.key,
        requestHash: info.requestHash, responseStatus: 102,
      },
    }),
  }
}

function processingJobResponse(job) {
  return {
    jobId: job.jobId,
    orderId: job.orderId,
    status: job.status === 'starting' ? 'processing' : job.status,
    percentage: job.percentage,
    processedFiles: job.processedFiles,
    totalFiles: job.totalFiles,
    sourceFolder: job.sourceFolder,
    ...(job.status === 'completed' ? { result: job.result } : {}),
    ...(job.status === 'failed' ? { error: job.error } : {}),
  }
}

async function startAreaProcessing(req, res, { orderId, sourceFolder, descriptor, run }) {
  const info = areaProcessingRequestInfo(req, 'POST /process-area', descriptor)
  const previousJob = areaProcessingJobs.get(orderId)
  if (previousJob && ['starting', 'processing'].includes(previousJob.status)) {
    if (previousJob.userId === info.userId && previousJob.idempotencyKey === info.key
      && previousJob.requestHash === info.requestHash) {
      res.setHeader('Idempotency-Replayed', 'true')
      return res.status(202).json(processingJobResponse(previousJob))
    }
    return sendError(res, 409, 'توجد معالجة صور أخرى قيد التنفيذ لهذا الأمر.')
  }

  const job = {
    jobId: crypto.randomUUID(),
    orderId,
    userId: info.userId,
    idempotencyKey: info.key,
    requestHash: info.requestHash,
    status: 'starting',
    percentage: 0,
    processedFiles: 0,
    totalFiles: 0,
    sourceFolder,
    startedAt: new Date().toISOString(),
    updatedAt: Date.now(),
  }
  job.completionPromise = new Promise((resolve) => { job.resolveCompletion = resolve })
  areaProcessingJobs.set(orderId, job)

  let idempotency
  try {
    idempotency = await claimAreaProcessingIdempotency(info)
  } catch (error) {
    if (areaProcessingJobs.get(orderId) === job) {
      if (previousJob) areaProcessingJobs.set(orderId, previousJob)
      else areaProcessingJobs.delete(orderId)
    }
    throw error
  }
  if (idempotency.conflict || idempotency.inProgress || idempotency.replay) {
    if (areaProcessingJobs.get(orderId) === job) {
      if (previousJob) areaProcessingJobs.set(orderId, previousJob)
      else areaProcessingJobs.delete(orderId)
    }
    if (idempotency.conflict) return sendError(res, 409, 'استُخدم Idempotency-Key نفسه لطلب مختلف.')
    if (idempotency.inProgress) return sendError(res, 409, 'طلب المعالجة بهذا المفتاح قيد التنفيذ، لكن لا توجد له مهمة فعالة في الذاكرة.')
    res.setHeader('Idempotency-Replayed', 'true')
    return res.status(idempotency.status).json(idempotency.body)
  }

  job.status = 'processing'
  job.updatedAt = Date.now()
  setImmediate(() => {
    void (async () => {
      try {
        job.result = await run({
          job,
          onProgress: (processedFiles, totalFiles) => {
            job.processedFiles = processedFiles
            job.totalFiles = totalFiles
            job.percentage = totalFiles > 0 ? Math.floor((processedFiles / totalFiles) * 100) : 0
            job.updatedAt = Date.now()
          },
          idempotency,
        })
        job.status = 'completed'
        job.processedFiles = job.totalFiles
        job.percentage = 100
        job.completedAt = new Date().toISOString()
        job.updatedAt = Date.now()
      } catch (error) {
        await idempotency.fail().catch((cleanupError) => {
          console.error('Could not release failed area-processing idempotency key:', cleanupError.message)
        })
        job.status = 'failed'
        job.error = error.message || 'تعذرت معالجة مجلد الصور.'
        job.failedAt = new Date().toISOString()
        job.updatedAt = Date.now()
        console.error(`Background area processing failed for order ${orderId}:`, error)
      } finally {
        job.resolveCompletion()
      }
    })()
  })

  res.setHeader('Idempotency-Replayed', 'false')
  return res.status(202).json(processingJobResponse(job))
}

api.get('/areas', requireAuth, asyncRoute(async (_req, res) => {
  await fsExtra.ensureDir(areasRoot)
  const entries = await fsExtra.readdir(areasRoot)
  const folders = await Promise.all(entries
    .filter((name) => name !== '.incoming')
    .map(async (name) => {
      try {
        const folderPath = path.join(areasRoot, name)
        const stats = await fsExtra.stat(folderPath)
        if (!stats.isDirectory()) return null
        const createdAt = stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime
        return { name, path: name, addedAt: createdAt.toISOString() }
      } catch (error) {
        if (error.code === 'ENOENT') return null
        throw error
      }
    }))
  res.json(folders.filter(Boolean))
}))

api.get('/areas-folders', requireAuth, allowRoles('admin', 'operations'), asyncRoute(async (_req, res) => {
  try {
    await fsExtra.ensureDir(areasRoot)
    const entries = await fsExtra.readdir(areasRoot, { withFileTypes: true })
    const folders = entries
      .filter((entry) => entry.isDirectory() && entry.name !== '.incoming')
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, 'ar'))
    res.json(folders)
  } catch (error) {
    console.error('Could not list server-side area folders:', error)
    sendError(res, 500, 'تعذرت قراءة مجلدات المناطق من الخادم.')
  }
}))

api.get('/storage/explorer', requireAuth, allowRoles('admin', 'operations'), asyncRoute(async (req, res) => {
  const relativePath = String(req.query.path || '').replace(/\\/g, '/')
  const segments = relativePath ? relativePath.split('/') : []
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.startsWith('.') || segment.includes('\0'))) {
    return sendError(res, 400, 'مسار مجلد المناطق غير صالح.')
  }
  const directory = path.resolve(areasRoot, ...segments)
  const relative = path.relative(areasRoot, directory)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return sendError(res, 400, 'مسار مجلد المناطق غير صالح.')
  }
  try {
    if (!relativePath) await fsExtra.ensureDir(areasRoot)
    if (await storagePathUsesSymlink(directory)) return sendError(res, 400, 'لا يمكن استعراض مسار يحتوي على رابط رمزي.')
    const stats = await fsExtra.lstat(directory)
    if (!stats.isDirectory() || stats.isSymbolicLink()) return sendError(res, 400, 'المسار المحدد ليس مجلدًا صالحًا.')
    const entries = await fsExtra.readdir(directory, { withFileTypes: true })
    const folders = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '.incoming')
      .map((entry) => ({ name: entry.name, path: relativePath ? `${relativePath}/${entry.name}` : entry.name }))
      .sort((left, right) => left.name.localeCompare(right.name, 'ar', { numeric: true, sensitivity: 'base' }))
    res.json(folders)
  } catch (error) {
    if (error.code === 'ENOENT') return res.json([])
    if (error.code === 'EACCES' || error.code === 'EPERM') return sendError(res, 403, 'لا توجد صلاحية لقراءة المجلد المحدد.')
    throw error
  }
}))

function storageRelativeSegments(input, { allowRoot = false } = {}) {
  const value = String(input ?? '').replace(/\\/g, '/')
  if (!value) return allowRoot ? [] : null
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return null
  const segments = value.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment === '.incoming'
    || segment === '.madar-recovery' || isOrderDeletionStageSegment(segment) || segment.includes('\0'))) return null
  return segments
}

function resolveStorageManagerPath(input, { allowRoot = false } = {}) {
  const segments = storageRelativeSegments(input, { allowRoot })
  if (!segments) return null
  const absolute = path.resolve(storageRoot, ...segments)
  const relative = path.relative(storageRoot, absolute)
  if (!relative) return allowRoot ? absolute : null
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
  return absolute
}

async function storagePathUsesSymlink(absolutePath) {
  const candidate = path.resolve(absolutePath)
  if (!pathIsWithinOrEqual(storageRoot, candidate)) return true
  const rootStats = await fsExtra.lstat(storageRoot)
  if (rootStats.isSymbolicLink()) return true
  const relative = path.relative(storageRoot, candidate)
  let current = storageRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    if ((await fsExtra.lstat(current)).isSymbolicLink()) return true
  }
  return false
}

api.get('/storage/files', requireAuth, asyncRoute(async (req, res) => {
  const relativePath = String(req.query.path || '')
  const directory = resolveStorageManagerPath(relativePath, { allowRoot: true })
  if (!directory) return sendError(res, 400, 'مسار المجلد غير صالح.')
  try {
    if (await storagePathUsesSymlink(directory)) return sendError(res, 400, 'لا يمكن استعراض مسار يحتوي على رابط رمزي.')
    const canonicalDirectory = await canonicalStoragePath(directory)
    if (!canonicalDirectory) {
      const missing = await fsExtra.lstat(directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (!missing) return res.json([])
      return sendError(res, 400, 'لا يمكن استعراض مسار يقع خارج جذر التخزين أو يحتوي على رابط رمزي.')
    }
    const directoryStats = await fsExtra.lstat(canonicalDirectory)
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      return sendError(res, 400, 'المسار المحدد ليس مجلدًا صالحًا.')
    }
    const entries = await fsExtra.readdir(canonicalDirectory, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      if (entry.name === '.incoming' || entry.name === '.madar-recovery'
        || entry.name.startsWith(orderDeleteStagePrefix) || entry.isSymbolicLink()) continue
      if (!entry.isFile() && !entry.isDirectory()) continue
      const itemPath = relativePath ? `${relativePath}/${entry.name}` : entry.name
      if (isLegacyUserImportStoragePath(itemPath)) continue
      const absolute = await canonicalStoragePath(path.join(directory, entry.name))
      if (!absolute) continue
      const stats = await fsExtra.lstat(absolute)
      if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) continue
      files.push({
        name: entry.name,
        path: itemPath,
        type: entry.isDirectory() ? 'folder' : 'file',
        size: entry.isFile() ? stats.size : 0,
        createdAt: (stats.birthtimeMs > 0 ? stats.birthtime : stats.mtime).toISOString(),
        modifiedAt: stats.mtime.toISOString(),
      })
    }
    files.sort((left, right) => Number(right.type === 'folder') - Number(left.type === 'folder')
      || left.name.localeCompare(right.name, 'ar', { numeric: true, sensitivity: 'base' }))
    res.json(files)
  } catch (error) {
    if (error.code === 'ENOENT') return res.json([])
    if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY') {
      return sendError(res, 409, 'تعذرت قراءة المجلد؛ قد يكون قيد الاستخدام أو لا توجد صلاحية للوصول إليه.')
    }
    throw error
  }
}))

function isMachineExcelArchivePath(relativePath, isDirectory) {
  const segments = String(relativePath || '').replace(/\\/g, '/').split('/').filter(Boolean)
  if (segments.length < 2 || segments[0].toLowerCase() !== 'uploads' || segments[1].toLowerCase() !== 'excel') return false
  if (isDirectory && segments.length === 2) return true
  return !isDirectory && segments.length === 3 && /^machines_import_.+\.(csv|xlsx)$/i.test(segments[2])
}

api.delete('/storage/files', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  if (machineCatalogWipeInProgress) return sendError(res, 409, 'تتم تهيئة قاعدة الماكينات؛ أعد محاولة حذف ملف التخزين بعد اكتمالها.')
  const relativePath = String(req.body?.path || '')
  const target = resolveStorageManagerPath(relativePath)
  if (!target) return sendError(res, 400, 'مسار العنصر غير صالح أو لا يمكن حذف جذر التخزين.')
  try {
    if (await storagePathUsesSymlink(target)) return sendError(res, 400, 'لا يمكن حذف مسار يحتوي على رابط رمزي.')
    const stats = await fsExtra.lstat(target)
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory())) {
      return sendError(res, 400, 'نوع العنصر غير مدعوم للحذف.')
    }
    const affectsMachineImport = isMachineExcelArchivePath(relativePath, stats.isDirectory())
    const machines = affectsMachineImport ? db.prepare('SELECT * FROM machines WHERE deleted_at IS NULL').all() : []
    const stagedResult = await stageStorageDirectories([{
      absolutePath: target,
      allowedRoot: storageRoot,
    }], affectsMachineImport ? 'machine-import-delete' : 'storage-delete')
    const { operation, staged } = stagedResult
    let archivedMachines = 0
    try {
      commitFilesystemMutation(operation, () => {
        if (affectsMachineImport) {
        const archiveMachine = db.prepare('UPDATE machines SET active=0,deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL')
        for (const machine of machines) {
          if (!archiveMachine.run(machine.id).changes) continue
          archivedMachines += 1
          audit(req.user.id, 'archive-machine-import-delete', 'machine', machine.id, relativePath, machine,
            { ...machine, active: 0, deleted_at: new Date().toISOString() })
        }
        }
        audit(req.user.id, 'delete', 'storage-file', relativePath, '',
          { path: relativePath, type: stats.isDirectory() ? 'folder' : 'file', size: stats.isFile() ? stats.size : null },
          { stagedPaths: staged.map((item) => relativeStoragePath(item.stagedPath)) })
      })
    } catch (error) {
      await restoreFilesystemOperation(operation)
      throw error
    }
    let cleanupPending = false
    if (operation) {
      try { await completeFilesystemOperation(db, storageRoot, operation.id) }
      catch (error) {
        cleanupPending = true
        console.error(`Storage deletion ${operation.id} committed; cleanup remains pending:`, error)
      }
    }
    res.json({ ok: true, path: relativePath, archivedMachines, cleanupPending })
  } catch (error) {
    if (error.code === 'ENOENT') return sendError(res, 404, 'العنصر المطلوب غير موجود.')
    if (error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'ENOTEMPTY') {
      return sendError(res, 409, 'تعذر حذف العنصر؛ قد يكون الملف أو المجلد قيد الاستخدام. أغلق الملفات المرتبطة ثم أعد المحاولة.')
    }
    throw error
  }
}))

api.get('/auth/status', (_req, res) => {
  const usersCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count
  const user = authenticatedUser(getCookie(_req, 'madar_session'))
  res.json({ needsSetup: usersCount === 0, user: user ? userDto(user) : null })
})

api.post('/auth/setup', asyncRoute(async (req, res) => {
  if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) return sendError(res, 409, 'تم إعداد النظام بالفعل.')
  const { username, password, fullName } = req.body || {}
  if (!username || String(username).trim().length < 3 || !password || String(password).length < 10 || !fullName) {
    return sendError(res, 400, 'أدخل الاسم واسم مستخدم من 3 أحرف على الأقل وكلمة مرور من 10 أحرف على الأقل.')
  }
  const normalizedUsername = String(username).trim().toLowerCase()
  const normalizedFullName = String(fullName).trim()
  const passwordHash = await bcrypt.hash(String(password), 12)
  let result
  try {
    result = db.transaction(() => {
      if (db.prepare('SELECT COUNT(*) AS count FROM users').get().count !== 0) {
        throw Object.assign(new Error('تم إعداد النظام بالفعل.'), { status: 409 })
      }
      return db.prepare('INSERT INTO users(username,password_hash,full_name,role,is_master) VALUES (?,?,?,?,1)')
        .run(normalizedUsername, passwordHash, normalizedFullName, 'admin')
    })()
  } catch (error) {
    if (error.status === 409) return sendError(res, 409, error.message)
    throw error
  }
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)
  const token = issueAuthToken(user)
  setSessionCookie(res, token)
  audit(result.lastInsertRowid, 'setup', 'user', result.lastInsertRowid, '', null,
    { username: normalizedUsername, fullName: normalizedFullName, role: 'admin' })
  res.status(201).json({ user: userDto(user) })
}))

api.post('/auth/login', loginThrottle.createMiddleware(), asyncRoute(async (req, res) => {
  const username = String(req.body?.username || '').trim().toLowerCase()
  const password = String(req.body?.password || '')
  const user = db.prepare('SELECT * FROM users WHERE username=? AND active=1 AND deleted_at IS NULL').get(username)
  const passwordHash = user?.password_hash || await dummyPasswordHashPromise
  const passwordMatches = await bcrypt.compare(password, passwordHash)
  if (!user || !passwordMatches) return sendError(res, 401, 'اسم المستخدم أو كلمة المرور غير صحيحة.')
  loginThrottle.recordSuccess(req.ip || req.socket?.remoteAddress || 'unknown')
  const token = issueAuthToken(user)
  setSessionCookie(res, token)
  res.json({ user: userDto(user) })
}))

api.post('/auth/logout', requireAuth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token_hash=?')
    .run(crypto.createHash('sha256').update(req.authToken).digest('hex'))
  clearSessionCookie(res)
  res.json({ ok: true })
})

api.get('/bootstrap', requireAuth, (req, res) => {
  const clients = db.prepare('SELECT * FROM clients WHERE deleted_at IS NULL ORDER BY id DESC').all().map((client) => ({
    id: client.id, code: client.code, name: client.name, contactName: client.contact_name, phone: client.phone,
    email: client.email, address: client.address, primaryColor: client.primary_color,
    secondaryColor: client.secondary_color, logoPath: client.logo_path,
  }))
  const machines = db.prepare(`SELECT m.*,(SELECT COUNT(*) FROM order_machines om WHERE om.machine_id=m.id AND om.excluded_at IS NULL) AS order_count
    FROM machines m WHERE m.active=1 AND m.deleted_at IS NULL ORDER BY m.code COLLATE NOCASE`).all().map((machine) => ({
    id: machine.id, code: machine.code, nameAr: machine.name_ar, nameEn: machine.name_en,
    area: machine.area, orderCount: machine.order_count,
  }))
  const orders = db.prepare(`SELECT o.*, c.name AS client_name, c.code AS client_code, u.full_name AS assigned_worker_name,
    e.name AS assigned_employee_name,
    (SELECT COUNT(*) FROM order_machines om WHERE om.order_id=o.id AND om.excluded_at IS NULL) AS machine_count,
    (SELECT COALESCE(SUM(ii.cogs_cents),0) FROM inventory_issues ii WHERE ii.order_id=o.id) AS actual_material_cogs_cents,
    (SELECT group_concat(a.employee_id, ',') FROM order_employee_assignments a WHERE a.order_id=o.id) AS employee_ids,
    (SELECT group_concat(ee.name, '|') FROM order_employee_assignments a JOIN employees ee ON ee.id=a.employee_id WHERE a.order_id=o.id) AS employee_names
    FROM orders o JOIN clients c ON c.id=o.client_id LEFT JOIN users u ON u.id=o.assigned_worker_id
    LEFT JOIN employees e ON e.id=o.assigned_employee_id
    WHERE o.deleted_at IS NULL ORDER BY o.id DESC`).all().map((order) => orderSummary(order, req.user.role === 'admin'))
  const assignedUsers = db.prepare('SELECT id,full_name,role FROM users WHERE active=1 AND deleted_at IS NULL ORDER BY full_name COLLATE NOCASE').all()
    .map((assignedUser) => ({ id: assignedUser.id, fullName: assignedUser.full_name, role: assignedUser.role }))
  const workers = db.prepare(`SELECT id,name,job_title AS jobTitle,phone
    FROM workers WHERE active=1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).all()
  const employees = db.prepare(`SELECT id,name,department,phone,job_title AS jobTitle
    FROM employees WHERE active=1 AND deleted_at IS NULL ORDER BY name COLLATE NOCASE`).all()
  const materials = db.prepare('SELECT * FROM materials WHERE active=1 AND deleted_at IS NULL ORDER BY name').all().map((material) => ({
    id: material.id, code: material.code, name: material.name, unit: material.unit,
    stock: material.stock, subStock: material.sub_stock || 0,
    unitCost: ['admin', 'purchasing'].includes(req.user.role) ? material.unit_cost : 0, minStock: material.min_stock,
  }))
  const reasons = db.prepare('SELECT * FROM maintenance_reasons WHERE active=1 ORDER BY label').all()
    .map((reason) => ({ id: reason.id, label: reason.label }))
  const stats = {
    clients: clients.length,
    activeOrders: db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status!='archived' AND deleted_at IS NULL").get().count,
    machines: machines.length,
    lowStock: materials.filter((material) => material.stock + material.subStock <= material.minStock).length,
    pendingReview: db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status='review' AND deleted_at IS NULL").get().count,
    archived: db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status='archived' AND deleted_at IS NULL").get().count,
    totalProfit: ['admin', 'sales'].includes(req.user.role)
      ? db.prepare('SELECT COALESCE(SUM(selling_price-total_cost),0) AS total FROM orders WHERE deleted_at IS NULL').get().total
      : 0,
  }
  res.json({ user: userDto(req.user), clients, machines, orders, assignedUsers, workers, employees, materials, reasons, stats })
})

api.get('/employees', requireAuth, asyncRoute(async (req, res) => {
  const department = String(req.query.department || '').trim()
  if (department && !employeeDepartments.has(department)) return sendError(res, 400, 'القسم المحدد غير صالح.')
  const where = {}
  if (department) where.department = department
  if (department || ['true', '1'].includes(String(req.query.active || '').toLowerCase())) where.active = true
  const employees = await models.Employee.findAll({
    where,
    include: [{ model: models.User, as: 'user', attributes: ['id', 'username', 'active', 'deleted_at'], required: false, paranoid: false }],
    order: [['name', 'ASC']],
  })
  res.json(employees.map((employee) => employeeDto(employee, employee.user, req.user.role === 'admin')))
}))

api.post('/employees', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const department = String(req.body?.department || '').trim()
  const phone = String(req.body?.phone || '').trim()
  const usernameValue = String(req.body?.username || '').trim().toLocaleLowerCase('en')
  const password = String(req.body?.password || '')
  const monthlySalaryCents = req.body?.monthlyBaseSalary == null || req.body.monthlyBaseSalary === ''
    ? 0 : parseCurrencyCents(req.body.monthlyBaseSalary, { allowZero: true })
  const requiresLogin = Object.hasOwn(employeeUserRoles, department)
  if (!name || name.length > 150 || phone.length > 80 || !employeeDepartments.has(department) || monthlySalaryCents === null) {
    return sendError(res, 400, 'أدخل اسمًا صالحًا واختر قسمًا ورقم هاتف ضمن الحدود المسموحة.')
  }
  if (department === 'Maintenance' && (usernameValue || password)) return sendError(res, 400, 'موظفو الصيانة الميدانيون لا يملكون حسابات دخول.')
  if (requiresLogin && (usernameValue.length < 3 || usernameValue.length > 100 || password.length < 10 || password.length > 200)) {
    return sendError(res, 400, 'موظفو هذا القسم يحتاجون اسم دخول من 3 أحرف وكلمة مرور من 10 أحرف على الأقل.')
  }
  const passwordHash = requiresLogin ? await bcrypt.hash(password, 12) : null
  try {
    const created = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
      const employee = await models.Employee.create({ name, department, phone, monthlySalaryCents }, { transaction })
      let user = null
      if (requiresLogin) {
        user = await models.User.create({
          username: usernameValue, passwordHash, fullName: name, role: employeeUserRoles[department], active: true, employeeId: employee.id,
        }, { transaction })
      }
      await sequelizeAudit({ userId: req.user.id, action: 'create', entity: 'employee', entityId: employee.id,
        newValues: { name, department, phone, monthlySalaryCents, username: user?.username || null, loginRequired: requiresLogin }, transaction })
      return { employee, user }
    })
    res.status(201).json(employeeDto(created.employee, created.user))
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError' || error.original?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return sendError(res, 409, 'اسم المستخدم مرتبط بحساب آخر.')
    }
    throw error
  }
}))

api.patch('/employees/:id', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const employeeId = Number(req.params.id)
  if (!Number.isInteger(employeeId) || employeeId <= 0) return sendError(res, 400, 'رقم الموظف غير صالح.')
  const department = String(req.body?.department || '').trim()
  if (!employeeDepartments.has(department)) return sendError(res, 400, 'القسم المحدد غير صالح.')
  const name = String(req.body?.name || '').trim()
  const phone = String(req.body?.phone || '').trim()
  const usernameValue = String(req.body?.username || '').trim().toLocaleLowerCase('en')
  const password = String(req.body?.password || '')
  const monthlySalaryCents = req.body?.monthlyBaseSalary === undefined
    ? null : parseCurrencyCents(req.body.monthlyBaseSalary, { allowZero: true })
  const requiresLogin = Object.hasOwn(employeeUserRoles, department)
  if (!name || name.length > 150 || phone.length > 80 || (req.body?.monthlyBaseSalary !== undefined && monthlySalaryCents === null)) {
    return sendError(res, 400, 'اسم الموظف مطلوب وتحقق من الهاتف والراتب الأساسي.')
  }
  if (department === 'Maintenance' && (usernameValue || password)) return sendError(res, 400, 'موظفو الصيانة الميدانيون لا يملكون حسابات دخول.')
  if (password && (password.length < 10 || password.length > 200)) return sendError(res, 400, 'كلمة المرور يجب أن تكون بين 10 و200 حرف.')

  try {
    const updated = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
      const employee = await models.Employee.findByPk(employeeId, { transaction })
      if (!employee) return null
      const linkedUser = await models.User.findOne({ where: { employeeId }, paranoid: false, transaction })
      if (department === 'Maintenance' && linkedUser) {
        throw apiError(409, 'لا يمكن نقل حساب مرتبط إلى قسم الصيانة؛ أنشئ سجل صيانة ميدانيًا مستقلًا بدلًا من ذلك.')
      }
       const oldValues = { name: employee.name, department: employee.department, phone: employee.phone,
         monthlySalaryCents: Number(employee.monthlySalaryCents || 0), active: Boolean(employee.active) }
      employee.name = name
      employee.department = department
       employee.phone = phone
       if (monthlySalaryCents !== null) employee.monthlySalaryCents = monthlySalaryCents
      await employee.save({ transaction })

      let user = linkedUser
      if (requiresLogin) {
        const username = usernameValue || linkedUser?.username || ''
        if (username.length < 3 || username.length > 100) throw apiError(400, 'اسم الدخول مطلوب ويجب أن يكون بين 3 و100 حرف.')
        if (!linkedUser && password.length < 10) throw apiError(400, 'أدخل كلمة مرور من 10 أحرف على الأقل لإنشاء حساب الدخول.')
        if (linkedUser?.deleted_at && !password) throw apiError(400, 'أدخل كلمة مرور جديدة لإعادة تفعيل حساب الدخول المحذوف.')
        if (linkedUser) {
          const oldUserValues = { username: linkedUser.username, role: linkedUser.role, active: Boolean(linkedUser.active) }
          linkedUser.username = username
          linkedUser.fullName = name
          linkedUser.role = employeeUserRoles[department]
          if (password) linkedUser.passwordHash = await bcrypt.hash(password, 12)
          if (linkedUser.deleted_at) {
            linkedUser.deleted_at = null
            linkedUser.active = true
          }
          await linkedUser.save({ transaction })
          await sequelizeAudit({ userId: req.user.id, action: password ? 'password-reset' : 'update', entity: 'user', entityId: linkedUser.id,
            oldValues: oldUserValues, newValues: { username, role: linkedUser.role, active: Boolean(linkedUser.active), passwordUpdated: Boolean(password) }, transaction })
          user = linkedUser
        } else {
          user = await models.User.create({ username, passwordHash: await bcrypt.hash(password, 12), fullName: name,
            role: employeeUserRoles[department], active: true, employeeId: employee.id }, { transaction })
          await sequelizeAudit({ userId: req.user.id, action: 'create', entity: 'user', entityId: user.id,
            newValues: { username, role: user.role, active: true, employeeId: employee.id }, transaction })
        }
      }
       await sequelizeAudit({ userId: req.user.id, action: 'update', entity: 'employee', entityId: employee.id,
         oldValues, newValues: { name, department, phone, monthlySalaryCents: Number(employee.monthlySalaryCents || 0), username: user?.username || null }, transaction })
      return { employee, user }
    })
    if (!updated) return sendError(res, 404, 'الموظف غير موجود.')
    res.json(employeeDto(updated.employee, updated.user))
  } catch (error) {
    if (error.name === 'SequelizeUniqueConstraintError' || error.original?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return sendError(res, 409, 'اسم المستخدم مرتبط بحساب آخر.')
    }
    throw error
  }
}))

api.delete('/employees/:id', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const employeeId = Number(req.params.id)
  if (!Number.isInteger(employeeId) || employeeId <= 0) return sendError(res, 400, 'رقم الموظف غير صالح.')
  const deleted = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const employee = await models.Employee.findByPk(employeeId, { transaction })
    if (!employee) return false
    const user = await models.User.findOne({ where: { employeeId }, paranoid: false, transaction })
    const oldValues = { name: employee.name, department: employee.department, phone: employee.phone, active: Boolean(employee.active) }
    employee.active = false
    await employee.save({ transaction })
    await employee.destroy({ transaction })
    if (user) {
      if (user.isMaster) throw apiError(403, 'لا يمكن حذف حساب المدير الرئيسي.')
      user.active = false
      if (!user.deleted_at) await user.destroy({ transaction })
      else await user.save({ transaction })
      await sequelize.query('DELETE FROM sessions WHERE user_id=?', { replacements: [user.id], transaction })
      await sequelizeAudit({ userId: req.user.id, action: 'soft-delete', entity: 'user', entityId: user.id,
        oldValues: { username: user.username, role: user.role, active: true },
        newValues: { username: user.username, role: user.role, active: false, deletedAt: new Date().toISOString() }, transaction })
    }
    await sequelizeAudit({ userId: req.user.id, action: 'soft-delete', entity: 'employee', entityId: employee.id,
      oldValues, newValues: { ...oldValues, active: false, deletedAt: new Date().toISOString() }, transaction })
    return true
  })
  if (!deleted) return sendError(res, 404, 'الموظف غير موجود.')
  res.json({ ok: true })
}))

function employeeHistoryData(employeeId, fromDate = null, toDate = null) {
  const employee = db.prepare(`SELECT e.id,e.name,e.department,e.phone,e.monthly_salary_cents,e.active,e.created_at,e.deleted_at,
      u.username,u.active AS user_active
    FROM employees e LEFT JOIN users u ON u.employee_id=e.id AND u.deleted_at IS NULL
    WHERE e.id=?`).get(employeeId)
  if (!employee) return null
  const from = fromDate ? `${fromDate} 00:00:00` : null
  const to = toDate ? `${toDate} 23:59:59` : null
  const rangeClause = (column) => `(? IS NULL OR ${column}>=?) AND (? IS NULL OR ${column}<=?)`
  const orders = db.prepare(`SELECT DISTINCT o.id,o.code,o.type,o.status,o.created_at,
      COALESCE(a.assigned_at,o.created_at) AS assigned_at,c.name AS client_name
    FROM orders o JOIN clients c ON c.id=o.client_id
      LEFT JOIN order_employee_assignments a ON a.order_id=o.id AND a.employee_id=?
    WHERE (o.assigned_employee_id=? OR a.employee_id IS NOT NULL) AND o.deleted_at IS NULL
      AND ${rangeClause('COALESCE(a.assigned_at,o.created_at)')}
    ORDER BY assigned_at DESC,o.id DESC`).all(employeeId, employeeId, from, from, to, to)
  const payrollRows = db.prepare(`SELECT p.* FROM payroll_records p WHERE p.employee_id=?
      AND ${rangeClause('p.updated_at')} ORDER BY p.period DESC,p.id DESC`)
    .all(employeeId, from, from, to, to)
  const advanceRows = db.prepare(`SELECT a.*,u.full_name AS actor_name,p.period FROM employee_advance_events a
      LEFT JOIN users u ON u.id=a.created_by LEFT JOIN payroll_records p ON p.id=a.payroll_id
    WHERE a.employee_id=? AND ${rangeClause('a.created_at')} ORDER BY a.created_at DESC,a.id DESC`)
    .all(employeeId, from, from, to, to)
  const treasuryRows = db.prepare(`SELECT t.*,u.full_name AS actor_name FROM treasury_transactions t
      LEFT JOIN users u ON u.id=t.created_by WHERE t.employee_id=? AND ${rangeClause('t.created_at')}
    ORDER BY t.created_at DESC,t.id DESC`)
    .all(employeeId, from, from, to, to)
  const auditRows = db.prepare(`SELECT a.*,u.full_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    WHERE ((a.entity='employee' AND a.entity_id=?)
      OR (a.entity='user' AND CAST(a.entity_id AS INTEGER) IN (SELECT id FROM users WHERE employee_id=?))
      OR (a.entity='payroll' AND CAST(a.entity_id AS INTEGER) IN (SELECT id FROM payroll_records WHERE employee_id=?)))
      AND ${rangeClause('a.created_at')} ORDER BY a.created_at DESC,a.id DESC`)
    .all(String(employeeId), employeeId, employeeId, from, from, to, to)

  const events = [
    ...orders.map((row) => ({ id: `order-${row.id}`, type: 'order', date: row.assigned_at,
      title: 'إسناد أمر تشغيل', description: `${row.code} · ${row.client_name} · ${row.type === 'maintenance' ? 'صيانة' : 'تشغيل'} · ${row.status}` })),
    ...payrollRows.map((row) => ({ id: `payroll-${row.id}`, type: 'payroll', date: row.updated_at,
      title: `مسير رواتب ${row.period}`, description: `الحالة: ${row.status === 'finalized' ? 'مقفل' : 'مسودة'} · مستحق ${row.net_entitlement_cents} قرش · مدفوع ${row.cash_paid_cents} قرش · غير مسدد ${row.unpaid_salary_cents} قرش`,
      amountCents: Number(row.net_entitlement_cents), payrollId: row.id, period: row.period })),
    ...advanceRows.map((row) => ({ id: `advance-${row.id}`, type: 'advance', date: row.created_at,
      title: ({ issued: 'صرف سلفة', applied: 'تسوية سلفة من الراتب', overpayment: 'زيادة دفعة راتب' })[row.event_type] || row.event_type,
      description: `${row.notes || '—'}${row.period ? ` · ${row.period}` : ''}${row.actor_name ? ` · ${row.actor_name}` : ''}`,
      amountCents: Number(row.amount_cents), eventType: row.event_type })),
    ...treasuryRows.map((row) => ({ id: `treasury-${row.id}`, type: 'treasury', date: row.created_at,
      title: row.category || (row.kind === 'income' ? 'وارد خزينة' : 'منصرف خزينة'),
      description: `${row.kind === 'income' ? 'وارد' : 'منصرف'} · ${row.reference || '—'} · ${row.notes || '—'}${row.actor_name ? ` · ${row.actor_name}` : ''}`,
      amountCents: Math.round(Number(row.amount) * 100), transactionId: row.id, kind: row.kind })),
    ...auditRows.map((row) => ({ id: `audit-${row.id}`, type: 'audit', date: row.created_at,
      title: `${row.action} · ${row.entity}`, description: `${row.details || ''}${row.actor_name ? ` · ${row.actor_name}` : ''}`,
      oldValues: row.old_values ? JSON.parse(row.old_values) : null,
      newValues: row.new_values ? JSON.parse(row.new_values) : null })),
  ].sort((left, right) => String(right.date).localeCompare(String(left.date)) || right.id.localeCompare(left.id))

  const sum = (rows, field) => rows.reduce((total, row) => total + Number(row[field] || 0), 0)
  const summary = {
    assignedOrderCount: orders.length,
    payrollPeriodCount: payrollRows.length,
    payrollEntitlementCents: sum(payrollRows, 'net_entitlement_cents'),
    payrollCashPaidCents: sum(payrollRows, 'cash_paid_cents'),
    unpaidSalaryCents: sum(payrollRows, 'unpaid_salary_cents'),
    advancesIssuedCents: advanceRows.filter((row) => ['issued', 'overpayment'].includes(row.event_type))
      .reduce((total, row) => total + Number(row.amount_cents), 0),
    advancesAppliedCents: sum(advanceRows.filter((row) => row.event_type === 'applied'), 'amount_cents'),
    treasuryIncomeCents: Math.round(sum(treasuryRows.filter((row) => row.kind === 'income'), 'amount') * 100),
    treasuryExpenseCents: Math.round(sum(treasuryRows.filter((row) => row.kind === 'expense'), 'amount') * 100),
    currentAdvanceBalanceCents: employeeAdvanceBalanceCents(employeeId),
  }
  return { employee, summary, events, from: fromDate, to: toDate }
}

function parseEmployeeHistoryRange(query) {
  const from = parseAnalysisDate(query.from, 'البداية')
  const to = parseAnalysisDate(query.to, 'النهاية')
  if (from && to && from > to) throw apiError(400, 'تاريخ البداية يجب أن يسبق تاريخ النهاية.')
  return { from, to }
}

api.get('/employees/:id/history', requireAuth, allowRoles('admin'), (req, res) => {
  const employeeId = Number(req.params.id)
  if (!Number.isSafeInteger(employeeId) || employeeId < 1) return sendError(res, 400, 'رقم الموظف غير صالح.')
  try {
    const range = parseEmployeeHistoryRange(req.query)
    const history = employeeHistoryData(employeeId, range.from, range.to)
    if (!history) return sendError(res, 404, 'الموظف غير موجود.')
    res.json(history)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.get('/employees/:id/history.xlsx', requireAuth, allowRoles('admin'), (req, res) => {
  const employeeId = Number(req.params.id)
  if (!Number.isSafeInteger(employeeId) || employeeId < 1) return sendError(res, 400, 'رقم الموظف غير صالح.')
  try {
    const range = parseEmployeeHistoryRange(req.query)
    const history = employeeHistoryData(employeeId, range.from, range.to)
    if (!history) return sendError(res, 404, 'الموظف غير موجود.')
    const workbook = XLSX.utils.book_new()
    const summaryRows = [
      ['الموظف', history.employee.name], ['القسم', history.employee.department], ['الهاتف', history.employee.phone || ''],
      ['الحالة', history.employee.deleted_at ? 'موقوف / محذوف منطقيًا' : history.employee.active ? 'نشط' : 'موقوف'],
      ['من', history.from || 'كل الفترات'], ['إلى', history.to || 'كل الفترات'],
      ['أوامر مسندة', history.summary.assignedOrderCount], ['فترات رواتب', history.summary.payrollPeriodCount],
      ['إجمالي الاستحقاقات (ج.م)', history.summary.payrollEntitlementCents / 100],
      ['مدفوع رواتب (ج.م)', history.summary.payrollCashPaidCents / 100],
      ['رواتب غير مسددة (ج.م)', history.summary.unpaidSalaryCents / 100],
      ['سلف وزيادات مصروفة (ج.م)', history.summary.advancesIssuedCents / 100],
      ['سلف مسوّاة (ج.م)', history.summary.advancesAppliedCents / 100],
      ['رصيد السلف الحالي (ج.م)', history.summary.currentAdvanceBalanceCents / 100],
      ['وارد خزينة مرتبط (ج.م)', history.summary.treasuryIncomeCents / 100],
      ['منصرف خزينة مرتبط (ج.م)', history.summary.treasuryExpenseCents / 100],
    ]
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), 'ملخص الموظف')
    const eventRows = [['التاريخ', 'النوع', 'الحدث', 'التفاصيل', 'المبلغ (ج.م)', 'القيم السابقة', 'القيم الجديدة']]
    for (const event of history.events) eventRows.push([
      event.date, event.type, event.title, event.description, event.amountCents == null ? '' : event.amountCents / 100,
      event.oldValues == null ? '' : JSON.stringify(event.oldValues),
      event.newValues == null ? '' : JSON.stringify(event.newValues),
    ])
    const eventSheet = XLSX.utils.aoa_to_sheet(eventRows)
    eventSheet['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 28 }, { wch: 80 }, { wch: 18 }, { wch: 60 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(workbook, eventSheet, 'السجل الوظيفي')
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })
    res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="employee-${employeeId}-history.xlsx"`, 'Cache-Control': 'private, no-store' })
      .send(buffer)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

function buildEmployeeHistoryPdf(history) {
  const fontPath = internalReportFontPath()
  if (!fontPath) throw apiError(500, 'خط عربي صالح لتقرير PDF غير متاح. عيّن MADAR_PDF_FONT_PATH إلى مسار ملف TTF محلي.')
  const boldFontPath = internalReportFontPath(true) || fontPath
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 34, right: 34, bottom: 34, left: 34 } })
    const chunks = []
    pdf.on('data', (chunk) => chunks.push(chunk))
    pdf.on('error', reject)
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right
    const right = pdf.page.width - pdf.page.margins.right
    const bottom = () => pdf.page.height - pdf.page.margins.bottom
    const formatMoney = (amount) => new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount || 0))
    let y = 110
    const heading = () => {
      pdf.font(boldFontPath).fontSize(17).fillColor('#173a66').text('السجل الوظيفي وتحليل الأداء', pdf.page.margins.left, 35,
        { width, align: 'right', features: ['rtla', 'rtlm'] })
      pdf.font(fontPath).fontSize(11).fillColor('#344b62').text(`${history.employee.name} · ${history.employee.department}`,
        pdf.page.margins.left, 62, { width, align: 'right', features: ['rtla', 'rtlm'] })
      pdf.font(fontPath).fontSize(9).fillColor('#60758a').text(`الفترة: ${history.from || 'كل الفترات'} — ${history.to || 'حتى الآن'} · الأحداث: ${history.events.length}`,
        pdf.page.margins.left, 81, { width, align: 'right', features: ['rtla', 'rtlm'] })
      y = 110
    }
    heading()
    const summaryLine = `أوامر مسندة: ${history.summary.assignedOrderCount} · فترات رواتب: ${history.summary.payrollPeriodCount} · `
      + `استحقاقات: ${formatMoney(history.summary.payrollEntitlementCents / 100)} ج.م · مدفوع: ${formatMoney(history.summary.payrollCashPaidCents / 100)} ج.م · `
      + `غير مسدد: ${formatMoney(history.summary.unpaidSalaryCents / 100)} ج.م · رصيد السلف: ${formatMoney(history.summary.currentAdvanceBalanceCents / 100)} ج.م`
    pdf.font(boldFontPath).fontSize(9).fillColor('#173a66').text(summaryLine, pdf.page.margins.left, y,
      { width, align: 'right', lineGap: 3, features: ['rtla', 'rtlm'] })
    y += pdf.heightOfString(summaryLine, { width, font: boldFontPath, fontSize: 9, lineGap: 3 }) + 14
    for (const event of history.events) {
      const detail = `${event.description || '—'}${event.amountCents == null ? '' : ` · ${formatMoney(event.amountCents / 100)} ج.م`}`
      const height = pdf.heightOfString(detail, { width: width - 18, font: fontPath, fontSize: 8, lineGap: 2 }) + 28
      if (y + height > bottom()) { pdf.addPage(); heading() }
      pdf.save().roundedRect(pdf.page.margins.left, y, width, height, 4).fill('#f1f6f8').restore()
      pdf.font(boldFontPath).fontSize(9).fillColor('#173a66').text(`${event.date} · ${event.title}`,
        right - width + 9, y + 5, { width: width - 18, align: 'right', features: ['rtla', 'rtlm'] })
      pdf.font(fontPath).fontSize(8).fillColor('#344b62').text(detail, right - width + 9, y + 20,
        { width: width - 18, align: 'right', lineGap: 2, features: ['rtla', 'rtlm'] })
      y += height + 6
    }
    pdf.end()
  })
}

api.get('/employees/:id/history.pdf', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const employeeId = Number(req.params.id)
  if (!Number.isSafeInteger(employeeId) || employeeId < 1) return sendError(res, 400, 'رقم الموظف غير صالح.')
  const range = parseEmployeeHistoryRange(req.query)
  const history = employeeHistoryData(employeeId, range.from, range.to)
  if (!history) return sendError(res, 404, 'الموظف غير موجود.')
  const buffer = await buildEmployeeHistoryPdf(history)
  res.set({ 'Content-Type': 'application/pdf', 'Content-Length': String(buffer.length),
    'Content-Disposition': `attachment; filename="employee-${employeeId}-history.pdf"`, 'Cache-Control': 'private, no-store' }).send(buffer)
}))

api.get('/workers', requireAuth, allowRoles('admin'), asyncRoute(async (_req, res) => {
  const workers = await models.Worker.findAll({ order: [['name', 'ASC']] })
  res.json(workers.map((worker) => ({
    id: worker.id, name: worker.name, jobTitle: worker.jobTitle, phone: worker.phone,
    active: Boolean(worker.active), createdAt: worker.created_at,
  })))
}))

api.post('/workers', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const name = String(req.body?.name || '').trim()
  const jobTitle = String(req.body?.jobTitle || '').trim()
  const phone = String(req.body?.phone || '').trim()
  if (!name || name.length > 150 || jobTitle.length > 150 || phone.length > 80) {
    return sendError(res, 400, 'اسم العامل مطلوب، وتحقق من حدود طول المسمى الوظيفي ورقم الهاتف.')
  }
  const worker = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const created = await models.Worker.create({ name, jobTitle, phone }, { transaction })
    await sequelizeAudit({ userId: req.user.id, action: 'create', entity: 'worker', entityId: created.id,
      newValues: { name, jobTitle, phone }, transaction })
    return created
  })
  res.status(201).json({ id: worker.id, name: worker.name, jobTitle: worker.jobTitle, phone: worker.phone, active: true })
}))

api.patch('/workers/:id', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const workerId = Number(req.params.id)
  if (!Number.isInteger(workerId) || workerId <= 0) return sendError(res, 400, 'رقم العامل غير صالح.')
  const updated = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const worker = await models.Worker.findByPk(workerId, { transaction })
    if (!worker) return null
    const oldValues = { name: worker.name, jobTitle: worker.jobTitle, phone: worker.phone, active: Boolean(worker.active) }
    const name = String(req.body?.name ?? worker.name).trim()
    const jobTitle = String(req.body?.jobTitle ?? worker.jobTitle).trim()
    const phone = String(req.body?.phone ?? worker.phone).trim()
    const active = req.body?.active === undefined ? Boolean(worker.active) : Boolean(req.body.active)
    if (!name || name.length > 150 || jobTitle.length > 150 || phone.length > 80) throw apiError(400, 'اسم العامل مطلوب، وتحقق من حدود طول المسمى الوظيفي ورقم الهاتف.')
    worker.name = name
    worker.jobTitle = jobTitle
    worker.phone = phone
    worker.active = active
    await worker.save({ transaction })
    await sequelizeAudit({ userId: req.user.id, action: 'update', entity: 'worker', entityId: worker.id,
      oldValues, newValues: { name, jobTitle, phone, active }, transaction })
    return worker
  })
  if (!updated) return sendError(res, 404, 'العامل غير موجود.')
  res.json({ id: updated.id, name: updated.name, jobTitle: updated.jobTitle, phone: updated.phone, active: Boolean(updated.active) })
}))

api.delete('/workers/:id', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const workerId = Number(req.params.id)
  if (!Number.isInteger(workerId) || workerId <= 0) return sendError(res, 400, 'رقم العامل غير صالح.')
  const removed = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const worker = await models.Worker.findByPk(workerId, { transaction })
    if (!worker) return false
    const oldValues = { name: worker.name, jobTitle: worker.jobTitle, phone: worker.phone, active: Boolean(worker.active) }
    worker.active = false
    await worker.save({ transaction })
    await worker.destroy({ transaction })
    await sequelizeAudit({ userId: req.user.id, action: 'soft-delete', entity: 'worker', entityId: worker.id,
      oldValues, newValues: { ...oldValues, active: false, deletedAt: new Date().toISOString() }, transaction })
    return true
  })
  if (!removed) return sendError(res, 404, 'العامل غير موجود.')
  res.json({ ok: true })
}))

api.get('/clients', requireAuth, asyncRoute(async (_req, res) => {
  const clients = await models.Client.findAll({ order: [['name', 'ASC']] })
  res.json(clients.map(clientApiRecord))
}))

api.post('/clients', requireAuth, allowRoles('admin', 'sales'), asyncRoute(async (req, res) => {
  const body = req.body || {}
  const name = String(body.name || '').trim()
  if (!name) return sendError(res, 400, 'اسم العميل مطلوب.')
  const client = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const code = await nextSequelizeCode('client', 'C', transaction)
    const values = {
      code,
      name,
      contactName: String(body.contactName || ''),
      phone: String(body.phone || ''),
      email: String(body.email || ''),
      address: String(body.address || ''),
      primaryColor: String(body.primaryColor || '#173a66'),
      secondaryColor: String(body.secondaryColor || '#f49b36'),
    }
    const created = await models.Client.create(values, { transaction })
    await sequelizeAudit({
      userId: req.user.id, action: 'create', entity: 'client', entityId: created.id,
      details: code, newValues: { code, name, contactName: values.contactName, phone: values.phone, email: values.email }, transaction,
    })
    return { id: created.id, code, name }
  })
  await ensureClientFolders(client)
  res.status(201).json(client)
}))

const updateClientRoute = asyncRoute(async (req, res) => {
  const body = req.body || {}
  const updated = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const client = await models.Client.findByPk(req.params.id, { transaction })
    if (!client) return false
    const fields = {
      name: body.name ?? client.name,
      contactName: body.contactName ?? client.contactName,
      phone: body.phone ?? client.phone,
      email: body.email ?? client.email,
      address: body.address ?? client.address,
      primaryColor: body.primaryColor ?? client.primaryColor,
      secondaryColor: body.secondaryColor ?? client.secondaryColor,
    }
    fields.name = String(fields.name || '').trim()
    if (!fields.name) throw apiError(400, 'اسم العميل مطلوب.')
    const oldValues = {
      name: client.name, contact_name: client.contactName, phone: client.phone, email: client.email,
      address: client.address, primary_color: client.primaryColor, secondary_color: client.secondaryColor,
    }
    const newValues = {
      name: fields.name, contact_name: fields.contactName, phone: fields.phone, email: fields.email,
      address: fields.address, primary_color: fields.primaryColor, secondary_color: fields.secondaryColor,
    }
    await client.update(fields, { transaction })
    await sequelizeAudit({
      userId: req.user.id, action: 'update', entity: 'client', entityId: client.id,
      oldValues, newValues, transaction,
    })
    return true
  })
  if (!updated) return sendError(res, 404, 'العميل غير موجود.')
  res.json({ ok: true })
})

api.put('/clients/:id', requireAuth, allowRoles('admin', 'sales'), updateClientRoute)
api.patch('/clients/:id', requireAuth, allowRoles('admin', 'sales'), updateClientRoute)

api.delete('/clients/:id', requireAuth, allowRoles('admin', 'sales'), asyncRoute(async (req, res) => {
  const deleted = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const client = await models.Client.findByPk(req.params.id, { transaction })
    if (!client) return false
    const oldValues = {
      code: client.code, name: client.name, contact_name: client.contactName, phone: client.phone,
      email: client.email, address: client.address, primary_color: client.primaryColor,
      secondary_color: client.secondaryColor, logo_path: client.logoPath,
    }
    await client.destroy({ transaction })
    await sequelizeAudit({
      userId: req.user.id, action: 'soft-delete', entity: 'client', entityId: client.id,
      oldValues, newValues: { ...oldValues, deleted_at: new Date().toISOString() }, transaction,
    })
    return true
  })
  if (!deleted) return sendError(res, 404, 'العميل غير موجود.')
  res.json({ ok: true })
}))

api.post('/clients/:id/logo', requireAuth, allowRoles('admin', 'sales'), createRateLimiter('POST /clients/:id/logo'), upload.single('logo'), asyncRoute(async (req, res) => {
  const client = await models.Client.findByPk(req.params.id)
  if (!client) {
    if (req.file) await fs.promises.rm(req.file.path, { force: true })
    return sendError(res, 404, 'العميل غير موجود.')
  }
  if (!req.file) return sendError(res, 400, 'اختر ملف شعار.')
  const ext = path.extname(req.file.originalname).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext)) {
    await fs.promises.rm(req.file.path, { force: true })
    return sendError(res, 400, 'صيغة الشعار غير مدعومة.')
  }
  const oldLogoPath = client.logoPath
  const destination = path.join(clientRootDirectory(client), 'Logo', `logo${ext}`)
  await fs.promises.mkdir(path.dirname(destination), { recursive: true })
  await fs.promises.rename(req.file.path, destination)
  const logoPath = relativeStoragePath(destination)
  await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    await client.update({ logoPath }, { transaction })
    await sequelizeAudit({
      userId: req.user.id, action: 'update-logo', entity: 'client', entityId: client.id,
      oldValues: { logo_path: oldLogoPath }, newValues: { logo_path: logoPath }, transaction,
    })
  })
  if (oldLogoPath) {
    const previous = absoluteStoragePath(oldLogoPath)
    if (previous && path.resolve(previous) !== path.resolve(destination)) await fs.promises.rm(previous, { force: true })
  }
  res.json({ logoPath })
}))

api.get('/machines', requireAuth, asyncRoute(async (_req, res) => {
  const machines = db.prepare(`SELECT m.*,(SELECT COUNT(*) FROM order_machines om WHERE om.machine_id=m.id AND om.excluded_at IS NULL) AS order_count
    FROM machines m WHERE m.active=1 AND m.deleted_at IS NULL ORDER BY m.code COLLATE NOCASE`).all()
    .map((machine) => ({
      id: machine.id, code: machine.code, nameAr: machine.name_ar, nameEn: machine.name_en,
      area: machine.area, orderCount: machine.order_count,
    }))
  res.json(machines)
}))

api.get('/machines/by-areas', requireAuth, allowRoles('admin', 'operations'), (req, res) => {
  const rawAreas = req.query.areas ?? req.query.area
  const areas = [...new Set((Array.isArray(rawAreas) ? rawAreas : String(rawAreas || '').split(','))
    .map((area) => String(area || '').trim()).filter(Boolean))]
  if (!areas.length) return sendError(res, 400, 'اختر منطقة واحدة على الأقل.')
  if (areas.length > 100) return sendError(res, 400, 'عدد المناطق المحدد أكبر من الحد المسموح.')
  const placeholders = areas.map(() => '?').join(',')
  const machines = db.prepare(`SELECT m.*,(SELECT COUNT(*) FROM order_machines om WHERE om.machine_id=m.id AND om.excluded_at IS NULL) AS order_count
    FROM machines m WHERE m.active=1 AND m.deleted_at IS NULL AND TRIM(COALESCE(m.area,'')) IN (${placeholders})
    ORDER BY m.code COLLATE NOCASE`).all(...areas).map((machine) => ({
    id: machine.id, code: machine.code, nameAr: machine.name_ar, nameEn: machine.name_en,
    area: machine.area, orderCount: machine.order_count,
  }))
  res.json(machines)
})

api.get(['/machine-areas', '/machines/areas'], requireAuth, allowRoles('admin', 'operations'), asyncRoute(async (_req, res) => {
  const machines = await models.Machine.findAll({ where: { active: true }, attributes: ['area'] })
  const areas = [...new Set(machines.map((machine) => machine.area)
    .map((name) => String(name || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'ar'))
  res.json(areas.map((name) => ({ id: name, name })))
}))

api.post('/machines', requireAuth, allowRoles('admin', 'operations'), asyncRoute(async (req, res) => {
  if (machineCatalogWipeInProgress) return sendError(res, 409, 'تتم تهيئة قاعدة الماكينات الآن؛ أعد المحاولة بعد اكتمالها.')
  const code = String(req.body?.code || '').trim()
  const nameAr = String(req.body?.nameAr || '').trim()
  if (!code || !nameAr) return sendError(res, 400, 'كود الماكينة والاسم العربي مطلوبان.')
  try {
    const result = db.transaction(() => {
      const area = String(req.body.area || '').trim()
      const inserted = db.prepare('INSERT INTO machines(code,name_ar,name_en,area) VALUES (?,?,?,?)')
        .run(code, nameAr, req.body.nameEn || '', area)
      audit(req.user.id, 'create', 'machine', inserted.lastInsertRowid, code, null, { code, nameAr })
      return inserted
    })()
    await fs.promises.mkdir(path.join(storageRoot, 'Machines', safeSegment(code)), { recursive: true })
    res.status(201).json({ id: result.lastInsertRowid, code })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'كود الماكينة مستخدم بالفعل.')
    throw error
  }
}))

function validateMachineReplacementAccess(req, res, next) {
  const isTruthy = (value) => ['true', '1', 'yes'].includes(String(value || '').toLowerCase())
  if (machineCatalogWipeInProgress) return sendError(res, 409, 'تتم تهيئة قاعدة الماكينات الآن؛ أعد المحاولة بعد اكتمالها.')
  if (isTruthy(req.query?.replaceAll) || isTruthy(req.body?.replaceAll)) {
    return sendError(res, 400, 'الاستبدال الكامل متاح من الإعدادات فقط؛ ابدأ العملية من هناك.')
  }
  const requested = isTruthy(req.query?.replacement) || isTruthy(req.body?.replacement)
  const token = String(req.get('X-Machine-Replacement-Token') || '')
  if (requested !== Boolean(token)) return sendError(res, 400, 'بيانات اعتماد استبدال قاعدة الماكينات غير مكتملة.')
  if (!requested) return next()

  const now = Date.now()
  for (const [key, grant] of machineReplacementGrants) {
    if (grant.expiresAt <= now && !grant.inUse) machineReplacementGrants.delete(key)
  }
  const grant = machineReplacementGrants.get(token)
  if (!grant || grant.userId !== req.user.id || grant.expiresAt <= now || grant.inUse) {
    return sendError(res, 403, 'انتهت صلاحية جلسة الاستبدال أو استُخدمت بالفعل. ابدأ الاستبدال مجددًا من الإعدادات.')
  }
  req.machineReplacementToken = token
  next()
}

api.post('/machines/import', requireAuth, allowRoles('admin', 'operations'), validateMachineReplacementAccess, createRateLimiter('POST /machines/import'), machineImportUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return sendError(res, 400, 'اختر ملف CSV أو XLSX.')
  const replacementToken = req.machineReplacementToken || null
  const replacementRequested = Boolean(replacementToken)
  let replacementGrant = null
  let replacementClaimed = false
  let replacementSucceeded = false
  try {
    let rows
    if (path.extname(req.file.originalname).toLowerCase() === '.csv') {
      rows = await readCsvRows(req.file.path)
    } else {
      const workbook = await XlsxPopulate.fromFileAsync(req.file.path)
      const values = workbook.sheet(0)?.usedRange()?.value()
      if (!Array.isArray(values) || !values.length) return sendError(res, 400, 'ملف Excel لا يحتوي على ورقة بيانات.')
      const headers = (Array.isArray(values[0]) ? values[0] : [values[0]]).map((value) => String(value || '').trim())
      rows = values.slice(1).map((valuesRow) => {
        const record = {}
        headers.forEach((header, index) => { record[header] = valuesRow?.[index] ?? '' })
        return record
      })
    }
    const normalizeExcelHeader = (header) => normalize(header)
      .replace(/[^\p{L}\p{N}]/gu, '')
      .replace(/s$/, '')
    const field = (row, matcher) => {
      const found = Object.entries(row).find(([header]) => matcher(normalizeExcelHeader(header)))
      return found ? String(found[1] ?? '').trim() : ''
    }
    const machineCode = (row) => field(row, (header) => (
      /code|كود/.test(header)
      || (/machine|ماكينه/.test(header) && !/name|arabic|english|عربي|الاسم|اسم/.test(header))
    ))
    const arabicMachineName = (row) => field(row, (header) => /arabic|عربي|namear|الاسم|اسم/.test(header))
      || field(row, (header) => /^(name|machinename)$/.test(header))
    const englishMachineName = (row) => field(row, (header) => /english|انجليزي|nameen/.test(header))
    const machineArea = (row) => field(row, (header) => /region|area|المنطقه|منطقه/.test(header))
    const asBoolean = (value) => ['true', '1', 'yes'].includes(String(value || '').toLowerCase())
    const legacyReplaceAll = asBoolean(req.body?.replaceAll ?? req.query?.replaceAll)
    if (legacyReplaceAll) return sendError(res, 400, 'الاستبدال الكامل متاح من الإعدادات فقط؛ ابدأ العملية من هناك.')
    const overwrite = replacementRequested || asBoolean(req.body?.overwrite ?? req.query?.overwrite)
    const skipExisting = !replacementRequested && asBoolean(req.body?.skipExisting ?? req.query?.skipExisting)
    const invalidRows = []
    const recordsByCode = new Map()
    for (const row of rows) {
      const code = machineCode(row)
      const nameAr = arabicMachineName(row)
      if (!code || !nameAr) { invalidRows.push(row); continue }
      recordsByCode.set(code, {
        code, nameAr,
        nameEn: englishMachineName(row),
        area: machineArea(row),
        active: true,
      })
    }
    const records = [...recordsByCode.values()]
    if (replacementRequested && invalidRows.length) {
      return sendError(res, 400, 'تعذر الاستبدال لأن الملف يحتوي على صفوف ناقصة البيانات.')
    }
    if (replacementRequested && !records.length) return sendError(res, 400, 'لا يمكن استبدال قاعدة الماكينات بملف لا يحتوي على بيانات صالحة.')
    const existingMachines = []
    for (let offset = 0; offset < records.length; offset += 900) {
      const batch = records.slice(offset, offset + 900)
      const placeholders = batch.map(() => '?').join(',')
      existingMachines.push(...db.prepare('SELECT * FROM machines WHERE code IN (' + placeholders + ')').all(...batch.map((record) => record.code)))
    }
    const existingByCode = new Map(existingMachines.map((machine) => [machine.code, machine]))
    const activeExistingMachines = existingMachines.filter((machine) => !machine.deleted_at)
    if (replacementRequested && db.prepare('SELECT COUNT(*) AS count FROM machines WHERE deleted_at IS NULL').get().count) {
      return sendError(res, 409, 'تغيرت قاعدة الماكينات بعد التهيئة. أعد عملية المسح من الإعدادات قبل رفع ملف الاستبدال.')
    }
    if (activeExistingMachines.length && !overwrite && !skipExisting) {
      return res.status(409).json({
        error: 'توجد أكواد ماكينات مسجلة بالفعل. اختر تحديث بياناتها أو تخطيها.',
        hasConflicts: true,
        conflictCount: activeExistingMachines.length,
      })
    }
    // skipExisting applies only to active catalog entries. A soft-deleted row
    // owns the unique code but is history to restore, not an import conflict.
    const importRecords = skipExisting
      ? records.filter((record) => !existingByCode.has(record.code) || Boolean(existingByCode.get(record.code).deleted_at))
      : records
    let added = 0
    let updated = 0
    let skipped = invalidRows.length + (skipExisting ? activeExistingMachines.length : 0)
    let deactivated = 0
    const seenCodes = new Set(records.map((record) => record.code))
    if (replacementRequested) {
      replacementGrant = machineReplacementGrants.get(replacementToken)
      if (!replacementGrant || replacementGrant.userId !== req.user.id || replacementGrant.expiresAt <= Date.now() || replacementGrant.inUse) {
        return sendError(res, 403, 'انتهت صلاحية جلسة الاستبدال أو استُخدمت بالفعل. ابدأ الاستبدال مجددًا من الإعدادات.')
      }
      replacementGrant.inUse = true
      replacementClaimed = true
    }
    await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
      if (replacementRequested) {
        const [activeRows] = await sequelize.query('SELECT COUNT(*) AS count FROM machines WHERE deleted_at IS NULL', { transaction })
        if (Number(activeRows[0]?.count || 0)) {
          throw apiError(409, 'تغيرت قاعدة الماكينات بعد التهيئة. أعد عملية المسح من الإعدادات قبل رفع ملف الاستبدال.')
        }
      }
      if (importRecords.length) {
        await models.Machine.bulkCreate(importRecords, {
          transaction,
          ...(overwrite || importRecords.some((record) => existingByCode.get(record.code)?.deleted_at)
            ? { updateOnDuplicate: ['nameAr', 'nameEn', 'area', 'active'] }
            : {}),
        })
        for (let offset = 0; offset < importRecords.length; offset += 900) {
          const batch = importRecords.slice(offset, offset + 900)
          const placeholders = batch.map(() => '?').join(',')
          await sequelize.query('UPDATE machines SET active=1, deleted_at=NULL WHERE code IN (' + placeholders + ')', {
            transaction,
            replacements: batch.map((record) => record.code),
          })
        }
      }
    })
    for (const record of importRecords) {
      const existing = existingByCode.get(record.code)
      if (existing) updated += 1
      else added += 1
      const machine = db.prepare('SELECT id FROM machines WHERE code=?').get(record.code)
      const auditValues = { code: record.code, name_ar: record.nameAr, name_en: record.nameEn, area: record.area, active: 1, deleted_at: null }
      const action = replacementRequested
        ? (existing?.deleted_at ? 'replacement-reactivate' : existing ? 'replacement-import-update' : 'replacement-import-create')
        : (existing?.deleted_at ? 'import-reactivate' : existing ? 'import-update' : 'import-create')
      audit(req.user.id, action, 'machine', machine?.id, '', existing || null, auditValues)
    }
    if (!replacementRequested && asBoolean(req.body?.deactivateMissing) && seenCodes.size) {
      const updateInactive = db.prepare('UPDATE machines SET active=0 WHERE id=? AND active=1 AND deleted_at IS NULL')
      const missing = db.prepare('SELECT * FROM machines WHERE active=1 AND deleted_at IS NULL').all()
        .filter((machine) => !seenCodes.has(machine.code))
      for (const machine of missing) {
        if (!updateInactive.run(machine.id).changes) continue
        deactivated += 1
        audit(req.user.id, 'deactivate-missing', 'machine', machine.id, 'excel-import', machine, { ...machine, active: 0 })
      }
    }
    await Promise.all(importRecords.map(({ code }) => fs.promises.mkdir(
      path.join(storageRoot, 'Machines', safeSegment(code)), { recursive: true },
    )))
    audit(req.user.id, 'import', 'machine', '', 'added=' + added + '; updated=' + updated + '; deactivated=' + deactivated + '; skipped=' + skipped,
      null, { added, updated, deactivated, skipped })
    if (replacementClaimed) {
      machineReplacementGrants.delete(replacementToken)
      replacementSucceeded = true
    }
    res.json({ added, updated, deactivated, skipped })
  } catch (error) {
    if (error.status) return sendError(res, error.status, error.message)
    return sendError(res, 400, 'تعذر قراءة الملف: ' + error.message)
  } finally {
    if (replacementClaimed && !replacementSucceeded && replacementGrant) replacementGrant.inUse = false
  }
}))

function eradicationApiError(error) {
  if (error?.code === 'EPERM') return apiError(409, 'تعذر حذف مجلد الصور لأنه مفتوح في برنامج آخر. أغلق الملفات أو المجلد وحاول مرة أخرى.')
  return error
}

async function existingStorageDirectory(absolutePath, allowedRoot) {
  const target = path.resolve(absolutePath)
  if (!pathIsWithin(storageRoot, target) || !pathIsWithin(allowedRoot, target)) {
    throw apiError(400, 'مسار مجلد الصور خارج نطاق الحذف المسموح.')
  }
  const stats = await fsExtra.lstat(target).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!stats) return false
  if (!stats.isDirectory() || stats.isSymbolicLink() || await storagePathUsesSymlink(target)) {
    throw apiError(409, 'لا يمكن حذف مجلد صور يحتوي مساره على رابط رمزي أو ليس مجلدًا عاديًا.')
  }
  return true
}

function pathOverlapsDirectory(directory, candidate) {
  const resolvedDirectory = path.resolve(directory)
  const resolvedCandidate = path.resolve(candidate)
  return resolvedDirectory === resolvedCandidate
    || pathIsWithin(resolvedDirectory, resolvedCandidate)
    || pathIsWithin(resolvedCandidate, resolvedDirectory)
}

function assertStorageDirectoriesUnshared(directories, { skipAreaFolderIds = [], skipOrderMachineIds = [] } = {}) {
  const areaFolderSkip = new Set(skipAreaFolderIds.map(Number))
  const orderMachineSkip = new Set(skipOrderMachineIds.map(Number))
  const areaFolders = db.prepare('SELECT id,source_folder_paths,image_paths FROM area_folders').all()
  for (const folder of areaFolders) {
    if (areaFolderSkip.has(Number(folder.id))) continue
    for (const value of parseJsonArray(folder.source_folder_paths)) {
      const absolute = absoluteStoragePath(value)
      if (absolute && directories.some((directory) => pathOverlapsDirectory(directory, absolute))) {
        throw apiError(409, 'مجلد المصدر مستخدم في سجل آخر؛ لم يتم حذف أي ملفات.')
      }
    }
    for (const value of parseJsonArray(folder.image_paths)) {
      const absolute = absoluteStoragePath(value)
      if (absolute && directories.some((directory) => pathIsWithin(directory, absolute))) {
        throw apiError(409, 'صور هذا المجلد مرتبطة بسجل آخر؛ لم يتم حذف أي ملفات.')
      }
    }
  }
  const orderMachines = db.prepare('SELECT id,before_photos,after_photos FROM order_machines').all()
  for (const card of orderMachines) {
    if (orderMachineSkip.has(Number(card.id))) continue
    for (const value of [...parseJsonArray(card.before_photos), ...parseJsonArray(card.after_photos)]) {
      const absolute = absoluteStoragePath(value)
      if (absolute && directories.some((directory) => pathIsWithin(directory, absolute))) {
        throw apiError(409, 'صور هذا المجلد مرتبطة ببطاقة ماكينة أخرى؛ لم يتم حذف أي ملفات.')
      }
    }
  }
}

async function stageStorageDirectories(entries, kind = 'image-eradication') {
  const resolved = new Set()
  for (const entry of entries) {
    const directory = path.resolve(entry.absolutePath)
    if (resolved.has(directory)) continue
    if ([...resolved].some((other) => pathOverlapsDirectory(other, directory))) {
      throw apiError(400, 'تتداخل مجلدات الحذف؛ لم يتم تنفيذ العملية.')
    }
    resolved.add(directory)
    if (!pathIsWithin(entry.allowedRoot, directory) || path.resolve(entry.allowedRoot) === directory) {
      throw apiError(400, 'مجلد الحذف خارج المسار المسموح.')
    }
  }
  const existing = []
  for (const directory of resolved) {
    const stats = await fsExtra.lstat(directory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (!stats) continue
    if (stats.isSymbolicLink() || (!stats.isFile() && !stats.isDirectory()) || await storagePathUsesSymlink(directory)) {
      throw apiError(409, 'مسار الحذف غير آمن أو يحتوي على رابط رمزي؛ لم يتم حذف أي ملفات.')
    }
    existing.push(directory)
  }
  if (!existing.length) return { operation: null, staged: [] }
  const operation = await prepareFilesystemOperation(db, storageRoot, kind, existing)
  try {
    const staged = await stageFilesystemOperation(storageRoot, operation)
    return { operation, staged }
  } catch (error) {
    try { await rollbackFilesystemOperation(db, storageRoot, operation.id) }
    catch (rollbackError) {
      console.error('Could not restore staged image paths after a failed filesystem operation:', rollbackError)
      throw apiError(500, 'تعذر استعادة الملفات بعد تعثر العملية؛ أوقف الخدمة وراجع سجل الاسترداد قبل إعادة المحاولة.')
    }
    throw eradicationApiError(error)
  }
}

function commitFilesystemMutation(operation, mutation) {
  db.transaction(() => {
    mutation()
    if (operation) markFilesystemOperationCommitted(db, operation.id)
  })()
}

async function restoreFilesystemOperation(operation) {
  if (operation) await rollbackFilesystemOperation(db, storageRoot, operation.id)
}

async function finishFilesystemOperation(operation, { userId, entity, entityId, details }) {
  if (!operation) return false
  try {
    await completeFilesystemOperation(db, storageRoot, operation.id)
  } catch (error) {
    try {
      db.transaction(() => audit(userId, 'physical-file-removal-incomplete', entity, entityId,
        `${details}; recoveryOperation=${operation.id}`, null,
        { cleanupPending: true, recoveryOperation: operation.id }))()
    } catch (auditError) {
      console.error('Could not record pending filesystem cleanup:', auditError)
    }
    console.error('Physical image removal is committed but cleanup remains pending:', error)
    return true
  }
  try {
    db.transaction(() => audit(userId, 'physical-file-removal-completed', entity, entityId, details,
      { recoveryOperation: operation.id }, { removed: true }))()
  } catch (error) {
    console.error('Image paths were removed but the completion audit could not be written:', error)
  }
  return false
}

async function restoreStagedStorageDirectories(staged) {
  let restoreFailed = false
  for (const item of [...staged].reverse()) {
    await fsExtra.rename(item.stagedPath, item.originalPath).catch((error) => {
      restoreFailed = true
      console.error('Could not restore staged files after database failure:', error)
    })
  }
  if (restoreFailed) throw apiError(500, 'تعذر استعادة الملفات بعد تعثر قاعدة البيانات؛ راجع سجل الاسترداد.')
}

async function finishStagedStorageRemoval(staged, { userId, entity, entityId, details }) {
  try {
    for (const item of staged) {
      await fsExtra.remove(item.stagedPath)
      const remaining = await fsExtra.lstat(item.stagedPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (remaining) throw new Error('Staged path remains after removal.')
    }
  } catch (error) {
    db.transaction(() => audit(userId, 'physical-file-removal-incomplete', entity, entityId,
      `${details}; pending=${staged.map((item) => relativeStoragePath(item.stagedPath)).join(',')}`,
      null, { pendingPaths: staged.map((item) => relativeStoragePath(item.stagedPath)), error: error.message }))()
    console.error('Physical file removal needs cleanup:', error)
    throw apiError(500, 'تم تحديث السجل، لكن تعذر إكمال مسح بعض الملفات. راجع سجل التدقيق ومسارات التنظيف المعلقة.')
  }
  try {
    db.transaction(() => audit(userId, 'physical-file-removal-completed', entity, entityId, details,
      { stagedPaths: staged.map((item) => relativeStoragePath(item.stagedPath)) },
      { removedPaths: staged.map((item) => relativeStoragePath(item.originalPath)) }))()
  } catch (error) {
    console.error('Files were removed but the completion audit could not be written:', error)
  }
}

async function eradicateUnknownAreaFolder(req, orderId, storageContext) {
  const folderId = Number(req.body?.folderId)
  if (!Number.isSafeInteger(folderId) || folderId < 1) throw apiError(400, 'رقم مجلد الصور غير صالح.')
  const folder = db.prepare(`SELECT * FROM area_folders
    WHERE id=? AND order_id=? AND machine_id IS NULL AND deleted_at IS NULL`).get(folderId, orderId)
  if (!folder) throw apiError(404, 'مجلد الصور غير معروف أو تمت إزالته بالفعل.')

  const folderKey = safeSegment(folder.folder_key)
  if (folderKey !== folder.folder_key) throw apiError(400, 'مفتاح مجلد الصور غير صالح؛ لم يتم الحذف.')
  const orderImageDirectory = path.resolve(storageContext.orderDirectory, folderKey)
  if (path.dirname(orderImageDirectory) !== path.resolve(storageContext.orderDirectory)) {
    throw apiError(400, 'مسار مجلد صور الأمر غير صالح؛ لم يتم الحذف.')
  }

  const sourcePaths = parseJsonArray(folder.source_folder_paths)
  if (sourcePaths.some((value) => typeof value !== 'string')) throw apiError(400, 'مسار مجلد المصدر غير صالح.')
  const requestedSourcePath = String(req.body?.folderPath || '').trim()
  if (requestedSourcePath) {
    const requestedAbsolute = absoluteStoragePath(requestedSourcePath)
    if (!requestedAbsolute || !sourcePaths.some((value) => path.resolve(absoluteStoragePath(value) || '') === path.resolve(requestedAbsolute))) {
      throw apiError(400, 'مسار المجلد المحدد لا يطابق مصدر المجلد المسجل.')
    }
  }

  const sourceDirectories = sourcePaths.map((value) => {
    const absolute = absoluteStoragePath(value)
    if (!absolute || !pathIsWithin(areasRoot, absolute) || path.resolve(absolute) === path.resolve(areasRoot)) {
      throw apiError(400, 'مسار مجلد المصدر خارج مجلدات المناطق المسموح بها.')
    }
    const segments = path.relative(areasRoot, absolute).split(path.sep)
    if (segments[0] === '.incoming' && segments.length < 2) throw apiError(400, 'لا يمكن حذف جذر مجلد الاستيراد المؤقت.')
    return absolute
  })
  for (const imagePath of parseJsonArray(folder.image_paths)) {
    if (typeof imagePath !== 'string') throw apiError(400, 'مسار إحدى صور المجلد غير صالح.')
    const absolute = absoluteStoragePath(imagePath)
    if (!absolute || !pathIsWithin(orderImageDirectory, absolute)) {
      throw apiError(400, 'تحتوي بيانات المجلد على صورة خارج مجلد الأمر؛ لم يتم الحذف.')
    }
  }
  const directories = [orderImageDirectory, ...sourceDirectories]
  assertStorageDirectoriesUnshared(directories, { skipAreaFolderIds: [folder.id] })

  const stagedResult = await stageStorageDirectories(directories.map((absolutePath, index) => ({
    absolutePath, allowedRoot: index === 0 ? storageContext.orderDirectory : areasRoot,
  })))
  const { operation, staged } = stagedResult
  const deletedAt = new Date().toISOString()
  try {
    commitFilesystemMutation(operation, () => {
      const currentOrder = db.prepare('SELECT status FROM orders WHERE id=? AND deleted_at IS NULL').get(orderId)
      if (!currentOrder || currentOrder.status === 'archived') throw apiError(409, 'تغيرت حالة الأمر؛ لا يمكن حذف ملفات أمر مؤرشف.')
      const changed = db.prepare(`UPDATE area_folders SET deleted_at=?
        WHERE id=? AND order_id=? AND machine_id IS NULL AND deleted_at IS NULL`).run(deletedAt, folder.id, orderId)
      if (!changed.changes) throw apiError(409, 'تغير سجل مجلد الصور أثناء الحذف؛ أعد المحاولة.')
      db.prepare('UPDATE orders SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(orderId)
      audit(req.user.id, 'soft-delete-with-physical-removal', 'area-folder', folder.id,
        `orderId=${orderId}; folder=${folder.folder_name}`,
        folder,
        { ...folder, deleted_at: deletedAt, stagedPaths: staged.map((item) => relativeStoragePath(item.stagedPath)) })
    })
  } catch (error) {
    await restoreFilesystemOperation(operation)
    throw error
  }
  const cleanupPending = await finishFilesystemOperation(operation, {
    userId: req.user.id, entity: 'area-folder', entityId: folder.id, details: `orderId=${orderId}; folder=${folder.folder_name}`,
  })
  return { ok: true, folderId: folder.id, storageRemoved: staged.length > 0, cleanupPending }
}

async function eradicateOrderMachine(req, orderId, storageContext) {
  const machineCode = String(req.body?.machineCode || '').trim()
  const cardId = Number(req.body?.cardId)
  if (!machineCode || !Number.isSafeInteger(cardId) || cardId < 1) throw apiError(400, 'كود الماكينة أو رقم البطاقة غير صالح.')
  const machine = db.prepare('SELECT * FROM machines WHERE code=?').get(machineCode)
  if (!machine) throw apiError(404, 'الماكينة غير موجودة.')
  const card = db.prepare(`SELECT * FROM order_machines
    WHERE id=? AND order_id=? AND machine_id=? AND excluded_at IS NULL`).get(cardId, orderId, machine.id)
  if (!card) throw apiError(404, 'بطاقة الماكينة غير موجودة أو تمت إزالتها بالفعل.')

  const relatedAreaFolders = db.prepare(`SELECT * FROM area_folders
    WHERE order_id=? AND machine_id=? AND deleted_at IS NULL`).all(orderId, machine.id)
  const beforePhotos = parseJsonArray(card.before_photos)
  const afterPhotos = parseJsonArray(card.after_photos)
  const imagePaths = [...beforePhotos, ...afterPhotos,
    ...relatedAreaFolders.flatMap((folder) => parseJsonArray(folder.image_paths))]
  const directories = new Set([path.resolve(storageContext.orderDirectory, safeSegment(machine.code))])
  for (const imagePath of imagePaths) {
    if (typeof imagePath !== 'string') throw apiError(400, 'قائمة مسارات صور الماكينة غير صالحة.')
    const absolute = absoluteStoragePath(imagePath)
    if (!absolute) throw apiError(400, 'مسار إحدى صور الماكينة غير صالح.')
    if (!pathIsWithin(storageContext.orderDirectory, absolute)) continue
    const relative = path.relative(storageContext.orderDirectory, absolute)
    const firstSegment = relative.split(path.sep)[0]
    if (!firstSegment || firstSegment === '.' || firstSegment === '..') throw apiError(400, 'مسار صورة الماكينة لا يحدد مجلدًا داخل الأمر.')
    const directory = path.resolve(storageContext.orderDirectory, firstSegment)
    if (path.dirname(directory) !== path.resolve(storageContext.orderDirectory)) throw apiError(400, 'مجلد صور الماكينة خارج الأمر.')
    directories.add(directory)
  }

  const directoryList = [...directories]
  const relatedFolderIds = relatedAreaFolders.map((folder) => folder.id)
  assertStorageDirectoriesUnshared(directoryList, {
    skipAreaFolderIds: relatedFolderIds,
    skipOrderMachineIds: [card.id],
  })
  const stagedResult = await stageStorageDirectories(directoryList.map((absolutePath) => ({
    absolutePath, allowedRoot: storageContext.orderDirectory,
  })))
  const { operation, staged } = stagedResult
  const deletedAt = machine.deleted_at || new Date().toISOString()
  const excludedAt = new Date().toISOString()
  try {
    commitFilesystemMutation(operation, () => {
      const currentOrder = db.prepare('SELECT status FROM orders WHERE id=? AND deleted_at IS NULL').get(orderId)
      if (!currentOrder || currentOrder.status === 'archived') throw apiError(409, 'تغيرت حالة الأمر؛ لا يمكن حذف ملفات أمر مؤرشف.')
      if (!machine.deleted_at) db.prepare('UPDATE machines SET active=0,deleted_at=? WHERE id=? AND deleted_at IS NULL').run(deletedAt, machine.id)
      const changed = db.prepare(`UPDATE order_machines SET excluded_at=?,before_photos='[]',after_photos='[]'
        WHERE id=? AND order_id=? AND machine_id=? AND excluded_at IS NULL`).run(excludedAt, card.id, orderId, machine.id)
      if (!changed.changes) throw apiError(409, 'تغيرت بطاقة الماكينة أثناء الحذف؛ أعد المحاولة.')
      if (relatedFolderIds.length) {
        const placeholders = relatedFolderIds.map(() => '?').join(',')
        db.prepare(`UPDATE area_folders SET deleted_at=? WHERE id IN (${placeholders}) AND deleted_at IS NULL`)
          .run(deletedAt, ...relatedFolderIds)
      }
      db.prepare('UPDATE orders SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(orderId)
      audit(req.user.id, machine.deleted_at ? 'remove-order-machine-images' : 'soft-delete-machine-and-remove-order-images',
        'machine', machine.id, `code=${machine.code}; orderId=${orderId}; cardId=${card.id}`,
        machine, { ...machine, active: 0, deleted_at: deletedAt, stagedPaths: staged.map((item) => relativeStoragePath(item.stagedPath)) })
      audit(req.user.id, 'soft-exclude-and-remove-images', 'order-machine', card.id, `orderId=${orderId}; machineCode=${machine.code}`,
        { ...card, before_photos: beforePhotos, after_photos: afterPhotos },
        { ...card, excluded_at: excludedAt, before_photos: [], after_photos: [] })
      for (const folder of relatedAreaFolders) {
        audit(req.user.id, 'soft-delete-with-physical-removal', 'area-folder', folder.id,
          `orderId=${orderId}; machineCode=${machine.code}`, folder, { ...folder, deleted_at: deletedAt })
      }
    })
  } catch (error) {
    await restoreFilesystemOperation(operation)
    throw error
  }
  const cleanupPending = await finishFilesystemOperation(operation, {
    userId: req.user.id, entity: 'order-machine', entityId: card.id,
    details: `orderId=${orderId}; machineCode=${machine.code}`,
  })
  return {
    ok: true, machineId: machine.id, machineCode: machine.code,
    cardId: card.id, excludedCardId: card.id, storageRemoved: staged.length > 0, cleanupPending,
  }
}

api.delete('/machines/eradicate', requireAuth, allowRoles('admin', 'operations'), asyncRoute(async (req, res) => {
  const orderId = Number(req.body?.orderId)
  if (!Number.isSafeInteger(orderId) || orderId < 1) return sendError(res, 400, 'رقم الأمر غير صالح.')
  const storageContext = getOrderStorageContext(orderId)
  if (storageContext.order.status === 'archived') return sendError(res, 409, 'لا يمكن إزالة ملفات من أمر مؤرشف حفاظًا على الأرشيف.')
  const processingJob = areaProcessingJobs.get(orderId)
  if (processingJob && ['starting', 'processing'].includes(processingJob.status)) {
    return sendError(res, 409, 'توجد معالجة صور جارية لهذا الأمر؛ أعد المحاولة بعد اكتمالها.')
  }
  if (orderEradicationLocks.has(orderId)) return sendError(res, 409, 'توجد عملية إزالة أخرى جارية لهذا الأمر.')
  const unknownFolderRequest = req.body?.folderId != null
  const machineCardRequest = req.body?.machineCode != null || req.body?.cardId != null
  if (unknownFolderRequest === machineCardRequest) return sendError(res, 400, 'حدد مجلدًا غير معروف أو بطاقة ماكينة واحدة فقط.')
  orderEradicationLocks.add(orderId)
  try {
    const result = unknownFolderRequest
      ? await eradicateUnknownAreaFolder(req, orderId, storageContext)
      : await eradicateOrderMachine(req, orderId, storageContext)
    res.json(result)
  } finally {
    orderEradicationLocks.delete(orderId)
  }
}))

function machineCatalogWipeLock(req, res, next) {
  if (machineCatalogWipeInProgress) return sendError(res, 409, 'توجد عملية تهيئة لقاعدة الماكينات جارية بالفعل.')
  machineCatalogWipeInProgress = true
  let released = false
  const release = () => {
    if (released) return
    released = true
    machineCatalogWipeInProgress = false
  }
  res.once('finish', release)
  res.once('close', release)
  next()
}

api.delete('/machines/wipe-catalog', requireAuth, allowRoles('admin'), machineCatalogWipeLock, asyncRoute(async (req, res) => {
  const archiveRoot = path.resolve(excelUploadsRoot)
  const machineStorageRoot = path.resolve(storageRoot, 'Machines')
  if (archiveRoot !== path.resolve(storageRoot, 'Uploads', 'Excel') || !pathIsWithin(storageRoot, archiveRoot)
    || path.dirname(machineStorageRoot) !== path.resolve(storageRoot)) {
    return sendError(res, 500, 'مسار تخزين الماكينات أو أرشيف الاستيراد غير آمن؛ لم يتم حذف أي بيانات.')
  }

  await fsExtra.ensureDir(archiveRoot)
  await fsExtra.ensureDir(machineStorageRoot)
  if (await storagePathUsesSymlink(archiveRoot) || await storagePathUsesSymlink(machineStorageRoot)) {
    return sendError(res, 409, 'يحتوي مسار تخزين الماكينات أو ملفات الاستيراد على رابط رمزي؛ لم يتم تنفيذ المسح.')
  }
  const archiveStats = await fsExtra.lstat(archiveRoot)
  const machineStorageStats = await fsExtra.lstat(machineStorageRoot)
  if (!archiveStats.isDirectory() || archiveStats.isSymbolicLink() || !machineStorageStats.isDirectory() || machineStorageStats.isSymbolicLink()) {
    return sendError(res, 409, 'مسار تخزين الماكينات أو أرشيف الاستيراد ليس مجلدًا صالحًا؛ لم يتم تنفيذ المسح.')
  }

  const sourceFiles = []
  for (const entry of await fsExtra.readdir(archiveRoot, { withFileTypes: true })) {
    if (!/^machines_import_.+\.(csv|xlsx)$/i.test(entry.name)) continue
    const absolute = path.resolve(archiveRoot, entry.name)
    if (path.dirname(absolute) !== archiveRoot) return sendError(res, 400, 'اسم أحد ملفات الاستيراد غير صالح.')
    const stats = await fsExtra.lstat(absolute)
    if (stats.isSymbolicLink()) return sendError(res, 409, 'يوجد رابط رمزي بين ملفات استيراد الماكينات؛ لم يتم تنفيذ المسح.')
    if (stats.isFile()) sourceFiles.push({ name: entry.name, absolute })
  }

  const machineEntries = (await fsExtra.readdir(machineStorageRoot, { withFileTypes: true }))
    .map((entry) => path.join(machineStorageRoot, entry.name))
  const sourcePaths = sourceFiles.map((file) => file.absolute)
  const stagedResult = await stageStorageDirectories([
    ...machineEntries.map((absolutePath) => ({ absolutePath, allowedRoot: machineStorageRoot })),
    ...sourcePaths.map((absolutePath) => ({ absolutePath, allowedRoot: archiveRoot })),
  ], 'machine-catalog-wipe')
  const { operation, staged } = stagedResult
  let archivedMachines = 0
  const deletedAt = new Date().toISOString()
  try {
    commitFilesystemMutation(operation, () => {
      const machines = db.prepare('SELECT * FROM machines WHERE deleted_at IS NULL').all()
      const softDelete = db.prepare('UPDATE machines SET active=0,deleted_at=? WHERE id=? AND deleted_at IS NULL')
      for (const machine of machines) {
        if (!softDelete.run(deletedAt, machine.id).changes) continue
        archivedMachines += 1
        audit(req.user.id, 'catalog-wipe-soft-delete', 'machine', machine.id, 'settings-machine-catalog-wipe', machine,
          { ...machine, active: 0, deleted_at: deletedAt })
      }
      audit(req.user.id, 'wipe', 'machine-catalog', '', 'settings-machine-catalog-wipe',
        { activeMachines: machines.length, sourceFiles: sourceFiles.map((file) => file.name), machineStorageRoot: relativeStoragePath(machineStorageRoot) },
        {
          archivedMachines,
          recoveryOperation: operation?.id || null,
          stagedItems: staged.map((entry) => relativeStoragePath(entry.stagedPath)),
        })
    })
  } catch (error) {
    await restoreFilesystemOperation(operation)
    throw error
  }

  let cleanupPending = false
  if (operation) {
    try { await completeFilesystemOperation(db, storageRoot, operation.id) }
    catch (error) {
      cleanupPending = true
      console.error(`Machine catalog wipe ${operation.id} committed; staged cleanup remains pending:`, error)
    }
  }
  db.transaction(() => audit(req.user.id, cleanupPending ? 'physical-removal-incomplete' : 'physical-removal-completed', 'machine-catalog', '',
    'settings-machine-catalog-wipe', null, {
      recoveryOperation: operation?.id || null,
      machineStorageItemsRemoved: machineEntries.length,
      sourceFilesRemoved: sourceFiles.length,
      cleanupPending,
    }))()

  const replacementToken = crypto.randomBytes(32).toString('hex')
  machineReplacementGrants.set(replacementToken, {
    userId: req.user.id, expiresAt: Date.now() + machineReplacementGrantTtlMs, inUse: false,
  })
  res.json({
    ok: true,
    archivedMachines,
    sourceFilesRemoved: sourceFiles.length,
    machineStorageItemsRemoved: machineEntries.length,
    machineFoldersRemoved: true,
    cleanupPending,
    replacementToken,
    replacementTokenExpiresInMs: machineReplacementGrantTtlMs,
  })
}))

api.delete('/machines/:id', requireAuth, allowRoles('admin', 'operations'), (req, res) => {
  if (machineCatalogWipeInProgress) return sendError(res, 409, 'تتم تهيئة قاعدة الماكينات الآن؛ أعد المحاولة بعد اكتمالها.')
  const machine = db.prepare('SELECT * FROM machines WHERE id=? AND deleted_at IS NULL').get(req.params.id)
  if (!machine) return sendError(res, 404, 'الماكينة غير موجودة.')
  db.transaction(() => {
    db.prepare("UPDATE machines SET active=0,deleted_at=CURRENT_TIMESTAMP WHERE id=?").run(machine.id)
    audit(req.user.id, 'soft-delete', 'machine', machine.id, '', machine, { ...machine, active: 0, deleted_at: new Date().toISOString() })
  })()
  res.json({ ok: true })
})

api.post('/orders', requireAuth, allowRoles('admin', 'sales', 'operations'), createRateLimiter('POST /orders'), asyncRoute(async (req, res) => {
  const rawClientId = req.body?.clientId ?? req.body?.client_id
  const clientId = Number(rawClientId)
  const type = req.body?.type === 'maintenance' ? 'maintenance' : 'operation'
  if (!Number.isSafeInteger(clientId) || clientId < 1) return sendError(res, 400, missingOrderClientMessage)
  const client = db.prepare('SELECT * FROM clients WHERE id=? AND deleted_at IS NULL').get(clientId)
  if (!client || !String(client.code || '').trim() || !String(client.name || '').trim()) {
    return sendError(res, 400, missingOrderClientMessage)
  }
  const rawMachineIds = req.body?.machineIds
  let machineIds = []
  if (rawMachineIds !== undefined) {
    if (!Array.isArray(rawMachineIds) || rawMachineIds.length > 500
      || rawMachineIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) < 1)) {
      return sendError(res, 400, 'قائمة الماكينات غير صالحة.')
    }
    machineIds = [...new Set(rawMachineIds.map(Number))]
    if (machineIds.length !== rawMachineIds.length) return sendError(res, 400, 'قائمة الماكينات تحتوي على عناصر مكررة.')
    if (machineIds.length) {
      const placeholders = machineIds.map(() => '?').join(',')
      const availableIds = db.prepare(`SELECT id FROM machines WHERE id IN (${placeholders}) AND active=1 AND deleted_at IS NULL`)
        .all(...machineIds).map((machine) => machine.id)
      if (availableIds.length !== machineIds.length) return sendError(res, 400, 'تحتوي قائمة الماكينات على ماكينة غير موجودة أو غير نشطة.')
    }
  }
  let employeeIds
  try {
    employeeIds = resolveOrderEmployeeIds(req.body)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
  const assignedEmployeeId = employeeIds[0] || null
  const assignedWorkerId = assignedEmployeeId
    ? (db.prepare('SELECT id FROM users WHERE employee_id=? AND active=1 AND deleted_at IS NULL').get(assignedEmployeeId)?.id || null)
    : null
  const materialCost = type === 'operation' ? parseOptionalCurrencyAmount(req.body.materialCost) : null
  const operatingCost = type === 'operation' ? parseOptionalCurrencyAmount(req.body.operatingCost) : null
  const sellingPrice = type === 'operation' ? parseOptionalCurrencyAmount(req.body.sellingPrice) : null
  if (type === 'operation' && [materialCost, operatingCost, sellingPrice].some((amount) => amount === null)) {
    return sendError(res, 400, 'تحقق من قيم التكاليف وسعر البيع؛ استخدم منزلتين عشريتين كحد أقصى.')
  }
  const totalCost = type === 'maintenance' ? null : req.body.materialCost !== undefined || req.body.operatingCost !== undefined
    ? currencyAmountFromCents(Math.round(materialCost * 100) + Math.round(operatingCost * 100))
    : parseOptionalCurrencyAmount(req.body.totalCost)
  if (type === 'operation' && totalCost === null) return sendError(res, 400, 'إجمالي التكلفة غير صالح.')
  const outcome = createIdempotently(req, 'POST /orders', () => {
    const code = nextCode(type === 'maintenance' ? 'maintenance_order' : 'operation_order', type === 'maintenance' ? 'MN' : 'OP')
    const orderDir = clientOrderDirectory(client, { code, type })
    const folderPath = relativeStoragePath(orderDir)
    const result = db.prepare(`INSERT INTO orders(code,client_id,type,notes,total_cost,material_cost,operating_cost,selling_price,created_by,assigned_worker_id,assigned_employee_id,area_path)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(code, clientId, type, String(req.body?.notes || ''), totalCost, materialCost, operatingCost, sellingPrice, req.user.id, assignedWorkerId, assignedEmployeeId, folderPath)
    const assignEmployee = db.prepare('INSERT INTO order_employee_assignments(order_id,employee_id) VALUES (?,?)')
    for (const employeeId of employeeIds) assignEmployee.run(result.lastInsertRowid, employeeId)
    const addMachine = db.prepare('INSERT INTO order_machines(order_id,machine_id) VALUES (?,?)')
    for (const machineId of machineIds) addMachine.run(result.lastInsertRowid, machineId)
    audit(req.user.id, 'create', 'order', result.lastInsertRowid, code, null,
      { code, clientId, type, assignedWorkerId, assignedEmployeeId, employeeIds, machineIds, totalCost, materialCost, operatingCost, sellingPrice })
    return { id: result.lastInsertRowid, code, assignedWorkerId, assignedEmployeeId, employeeIds, machineIds, folderPath }
  })
  if (outcome.error) return sendError(res, 400, outcome.error)
  if (outcome.conflict) return sendError(res, 409, 'استُخدم مفتاح منع التكرار خلال آخر 5 ثوانٍ لطلب مختلف.')
  const orderDir = absoluteStoragePath(outcome.body.folderPath)
  if (!orderDir) throw new Error('تعذر تحديد مسار مجلد الأمر ضمن مساحة التخزين.')
  await fsExtra.ensureDir(orderDir)
  res.setHeader('Idempotency-Replayed', String(outcome.replayed))
  res.status(outcome.status).json(outcome.body)
}))

api.put('/orders/:id', requireAuth, allowRoles('admin', 'sales', 'operations'), asyncRoute(async (req, res) => {
  const order = await models.Order.findByPk(req.params.id)
  if (!order) return sendError(res, 404, 'الأمر غير موجود.')

  const rawClientId = req.body?.clientId ?? req.body?.client_id
  const clientId = Number(rawClientId)
  const type = req.body?.type === 'maintenance' ? 'maintenance' : 'operation'
  if (!Number.isSafeInteger(clientId) || clientId < 1) {
    return sendError(res, 400, missingOrderClientMessage)
  }
  const client = db.prepare('SELECT * FROM clients WHERE id=? AND deleted_at IS NULL').get(clientId)
  if (!client || !String(client.code || '').trim() || !String(client.name || '').trim()) {
    return sendError(res, 400, missingOrderClientMessage)
  }
  const currentEmployeeIds = db.prepare('SELECT employee_id FROM order_employee_assignments WHERE order_id=? ORDER BY employee_id').all(order.id)
    .map((row) => row.employee_id)
  const hasEmployeeInput = ['employeeIds','assignedEmployeeIds','assignedEmployeeId','assignedWorkerId'].some((key) => Object.hasOwn(req.body || {}, key))
  let employeeIds
  try { employeeIds = hasEmployeeInput ? resolveOrderEmployeeIds(req.body) : currentEmployeeIds }
  catch (error) { return sendError(res, error.status || 400, error.message) }
  const assignedEmployeeId = employeeIds[0] || null
  const assignedWorkerId = assignedEmployeeId
    ? (db.prepare('SELECT id FROM users WHERE employee_id=? AND active=1 AND deleted_at IS NULL').get(assignedEmployeeId)?.id || null)
    : null
  const materialCost = type === 'operation' ? parseOptionalCurrencyAmount(req.body?.materialCost) : null
  const operatingCost = type === 'operation' ? parseOptionalCurrencyAmount(req.body?.operatingCost) : null
  const sellingPrice = type === 'operation' ? parseOptionalCurrencyAmount(req.body?.sellingPrice) : null
  if (type === 'operation' && [materialCost, operatingCost, sellingPrice].some((amount) => amount === null)) {
    return sendError(res, 400, 'تحقق من قيم التكاليف وسعر البيع؛ استخدم منزلتين عشريتين كحد أقصى.')
  }
  const totalCost = type === 'maintenance' ? null
    : currencyAmountFromCents(Math.round(materialCost * 100) + Math.round(operatingCost * 100))
  if (type === 'operation' && totalCost === null) {
    return sendError(res, 400, 'إجمالي التكلفة غير صالح.')
  }
  const oldClient = db.prepare('SELECT * FROM clients WHERE id=?').get(order.clientId)
  if (!oldClient || !String(oldClient.code || '').trim() || !String(oldClient.name || '').trim()) {
    return sendError(res, 400, missingOrderClientMessage)
  }
  const newOrderDirectory = clientOrderDirectory(client, { code: order.code, type })
  const storageIdentityChanged = Number(clientId) !== Number(order.clientId) || type !== order.type
  if (storageIdentityChanged && order.status === 'archived') {
    return sendError(res, 409, 'لا يمكن تغيير العميل أو نوع أمر مؤرشف حفاظًا على مسار أرشيفه.')
  }
  if (storageIdentityChanged) {
    const hasStoredImages = db.prepare(`SELECT
      EXISTS(SELECT 1 FROM order_machines WHERE order_id=? AND (before_photos!='[]' OR after_photos!='[]'))
       OR EXISTS(SELECT 1 FROM area_folders WHERE order_id=? AND deleted_at IS NULL AND image_paths!='[]') AS value`).get(order.id, order.id).value
    if (hasStoredImages) return sendError(res, 409, 'لا يمكن تغيير العميل أو نوع الأمر بعد حفظ الصور؛ حفاظًا على مساراتها.')
  }
  await fsExtra.ensureDir(newOrderDirectory)
  const oldValues = {
    clientId: order.clientId, type: order.type, notes: order.notes,
    assignedWorkerId: order.assignedWorkerId, assignedEmployeeId: order.assignedEmployeeId, employeeIds: currentEmployeeIds, totalCost: order.totalCost,
    materialCost: order.materialCost, operatingCost: order.operatingCost, sellingPrice: order.sellingPrice,
    status: order.status, areaPath: order.areaPath,
  }
  const newValues = {
    clientId, type, notes: String(req.body?.notes || ''), assignedWorkerId, assignedEmployeeId, employeeIds,
    totalCost, materialCost, operatingCost, sellingPrice, status: order.status,
    areaPath: relativeStoragePath(newOrderDirectory),
  }
  await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    await order.update({
      clientId, type, notes: newValues.notes, assignedWorkerId, assignedEmployeeId,
      totalCost, materialCost, operatingCost, sellingPrice, areaPath: newValues.areaPath,
    }, { transaction })
    await sequelize.query('DELETE FROM order_employee_assignments WHERE order_id=?', { replacements: [order.id], transaction })
    for (const employeeId of employeeIds) {
      await sequelize.query('INSERT INTO order_employee_assignments(order_id,employee_id) VALUES (?,?)', {
        replacements: [order.id, employeeId], transaction,
      })
    }
    await sequelizeAudit({
      userId: req.user.id, action: 'update', entity: 'order', entityId: order.id,
      details: `code=${order.code}; archived=${order.status === 'archived'}`,
      oldValues, newValues, transaction,
    })
  })
  res.json({ ok: true, id: order.id, code: order.code, ...newValues })
}))

api.get('/orders/:id', requireAuth, (req, res) => {
  const order = db.prepare(`SELECT o.*, c.name AS client_name, c.code AS client_code, c.primary_color,
    c.secondary_color, c.logo_path AS client_logo_path, u.full_name AS assigned_worker_name,e.name AS assigned_employee_name
    FROM orders o JOIN clients c ON c.id=o.client_id LEFT JOIN users u ON u.id=o.assigned_worker_id
    LEFT JOIN employees e ON e.id=o.assigned_employee_id
    WHERE o.id=? AND o.deleted_at IS NULL`).get(req.params.id)
  if (!order) return sendError(res, 404, 'الأمر غير موجود.')
    const cards = db.prepare(`SELECT om.*, m.code AS machine_code, m.name_ar, m.name_en, m.area
    FROM order_machines om JOIN machines m ON m.id=om.machine_id WHERE om.order_id=? AND om.excluded_at IS NULL ORDER BY m.code COLLATE NOCASE`).all(order.id)
    .map((card) => ({
      id: card.id, machineId: card.machine_id, machineCode: card.machine_code, nameAr: card.name_ar,
      nameEn: card.name_en, area: card.area,
      beforePhotos: parseJsonArray(card.before_photos), afterPhotos: parseJsonArray(card.after_photos),
      reasonIds: parseJsonArray(card.reason_ids), note: card.note,
    }))
   const folders = db.prepare('SELECT * FROM area_folders WHERE order_id=? AND machine_id IS NULL AND deleted_at IS NULL').all(order.id)
     .map((folder) => {
       const sourcePaths = parseJsonArray(folder.source_folder_paths)
       return {
         id: folder.id,
         name: folder.folder_name,
         imageCount: parseJsonArray(folder.image_paths).length,
         originalFolderPath: sourcePaths.length === 1 ? sourcePaths[0] : null,
       }
     })
    const employees = db.prepare(`SELECT e.id,e.name,e.department FROM order_employee_assignments a
      JOIN employees e ON e.id=a.employee_id WHERE a.order_id=? ORDER BY e.name COLLATE NOCASE`).all(order.id)
    const allInventoryIssues = db.prepare(`SELECT ii.id,ii.classification,ii.reference,ii.requested_quantity,ii.gross_cost_cents,
        ii.offcut_cost_cents,ii.cogs_cents,ii.created_at,je.status AS journal_status
        ,(SELECT m.code || ' — ' || m.name FROM inventory_movements im JOIN materials m ON m.id=im.material_id
          WHERE im.issue_id=ii.id AND im.kind='issue' ORDER BY im.id LIMIT 1) AS material_label
      FROM inventory_issues ii LEFT JOIN journal_entries je ON je.id=ii.journal_entry_id
      WHERE ii.order_id=? ORDER BY ii.created_at DESC,ii.id DESC`).all(order.id)
    const actualMaterialCogsCents = allInventoryIssues.reduce((sum, issue) => sum + Number(issue.cogs_cents), 0)
    const includeCogs = req.user.role === 'admin'
    const inventoryIssues = includeCogs ? allInventoryIssues : allInventoryIssues.map(({
      id, classification, reference, requested_quantity, created_at, material_label,
    }) => ({ id, classification, reference, requested_quantity, created_at, material_label }))
    res.json({ ...orderSummary({ ...order, machine_count: cards.length, actual_material_cogs_cents: actualMaterialCogsCents }, includeCogs),
      inventoryIssues, employees, employeeIds: employees.map((employee) => employee.id), client: {
    id: order.client_id, name: order.client_name, code: order.client_code,
    primaryColor: order.primary_color, secondaryColor: order.secondary_color, logoPath: order.client_logo_path,
  }, cards, unrecognizedFolders: folders })
})

api.get('/orders/:id/history', requireAuth, allowRoles('admin'), (req, res) => {
  const orderId = Number(req.params.id)
  if (!Number.isSafeInteger(orderId) || orderId < 1) return sendError(res, 400, 'رقم الأمر غير صالح.')
  const order = db.prepare('SELECT id FROM orders WHERE id=?').get(orderId)
  if (!order) return sendError(res, 404, 'الأمر غير موجود.')
  const orderReference = `%orderId=${orderId};%`
  const rows = db.prepare(`SELECT a.id,a.action,a.entity,a.entity_id,a.details,a.old_values,a.new_values,a.created_at,
      u.full_name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id
    WHERE (a.entity='order' AND a.entity_id=?) OR a.details LIKE ?
    ORDER BY a.id DESC LIMIT 100`).all(String(orderId), orderReference)
  const parse = (value) => {
    if (!value) return null
    try { return JSON.parse(value) } catch { return null }
  }
  res.json(rows.map((row) => ({ ...row, old_values: parse(row.old_values), new_values: parse(row.new_values) })))
})

api.get('/orders/:orderId/processing-status', requireAuth, asyncRoute(async (req, res) => {
  const orderId = Number(req.params.orderId)
  if (!Number.isSafeInteger(orderId) || orderId < 1) return sendError(res, 400, 'رقم الأمر غير صالح.')
  getOrderStorageContext(orderId)
  const job = areaProcessingJobs.get(orderId)
  if (!job) return res.json({ orderId, status: 'idle', percentage: 0, processedFiles: 0, totalFiles: 0 })
  if (['completed', 'failed'].includes(job.status) && Date.now() - job.updatedAt > 86_400_000) {
    areaProcessingJobs.delete(orderId)
    return res.json({ orderId, status: 'idle', percentage: 0, processedFiles: 0, totalFiles: 0 })
  }
  return res.json(processingJobResponse(job))
}))

const supportedAreaImageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff'])
const areaImageWrites = new Map()
const areaProcessingJobs = new Map()
const orderEradicationLocks = new Set()
const orderDeletionLocks = new Set()

async function persistCompressedAreaImage(destination, buffer) {
  const pending = areaImageWrites.get(destination)
  if (pending) {
    await pending
    return false
  }
  const write = (async () => {
    try {
      await fs.promises.writeFile(destination, buffer, { flag: 'wx' })
      return true
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const current = await fs.promises.readFile(destination)
      const currentHash = crypto.createHash('sha256').update(current).digest('hex')
      const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex')
      if (currentHash !== expectedHash) await fs.promises.writeFile(destination, buffer)
      return false
    }
  })()
  areaImageWrites.set(destination, write)
  try { return await write }
  finally { if (areaImageWrites.get(destination) === write) areaImageWrites.delete(destination) }
}

function mergeUniquePaths(existing, additions) {
  return [...new Set([...parseJsonArray(existing), ...additions])]
}

function unknownAreaFolderName(directories, areas) {
  const selectedAreaNames = new Set(areas.map(normalize))
  let areaIndex = -1
  directories.forEach((segment, index) => {
    if (selectedAreaNames.has(normalize(segment))) areaIndex = index
  })
  return (areaIndex >= 0 ? directories[areaIndex + 1] : directories.at(-1))
    || directories.at(-1) || 'مجلد غير معروف'
}

function importedSourceFolderPath(file, folderName) {
  if (!file.preserveSource || !folderName) return ''
  const absoluteFile = path.resolve(file.path)
  if (!pathIsWithin(areasRoot, absoluteFile)) return ''
  const sourceSegments = path.relative(areasRoot, absoluteFile).split(path.sep)
  sourceSegments.pop()
  let folderIndex = -1
  sourceSegments.forEach((segment, index) => {
    if (normalize(segment) === normalize(folderName)) folderIndex = index
  })
  if (folderIndex < 0) return ''
  const sourceDirectory = path.resolve(areasRoot, ...sourceSegments.slice(0, folderIndex + 1))
  if (!pathIsWithin(areasRoot, sourceDirectory)) return ''
  return relativeStoragePath(sourceDirectory)
}

async function processAreaUpload(orderId, files, paths, userId, { idempotency, sourceFolder, areaId, areas: requestedAreas, onProgress } = {}) {
  const temporaryPaths = files.filter((file) => !file.preserveSource).map((file) => file.path)
  try {
    const storageContext = getOrderStorageContext(orderId)
    const order = await models.Order.findByPk(storageContext.order.id)
    if (order.status === 'archived') throw apiError(409, 'لا يمكن إضافة صور إلى أمر مؤرشف.')
    await fsExtra.ensureDir(storageContext.orderDirectory)

    const areas = [...new Set((requestedAreas ?? (areaId ? [areaId] : []))
      .map((area) => String(area || '').trim()).filter(Boolean))]
    const machineWhere = { active: true }
    if (areas.length) machineWhere.area = { [Op.in]: areas }
    const machines = await models.Machine.findAll({ where: machineWhere })
    const grouped = new Map()
    let received = 0
    let skipped = 0
    let duplicates = 0
    let processedFiles = 0
    const markProcessed = () => {
      processedFiles += 1
      onProgress?.(processedFiles, files.length)
    }

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const ext = path.extname(file.originalname).toLowerCase()
      if (!supportedAreaImageExtensions.has(ext)) {
        skipped += 1
        markProcessed()
        continue
      }

      let time
      let buffer
      try {
        const stats = await fs.promises.stat(file.path)
        if (!stats.isFile()) throw new Error('ليس ملفًا عاديًا')
        if (stats.size > 25 * 1024 * 1024) throw new Error('حجم الصورة يتجاوز 25 ميجابايت')
        time = await photoTimestamp(file.path, file.originalname)
        buffer = await sharp(file.path, { limitInputPixels: 268_402_689 })
          .rotate()
          .flatten({ background: '#ffffff' })
          .resize({ width: 2400, withoutEnlargement: true })
          .jpeg({ quality: 85, mozjpeg: true })
          .toBuffer()
      } catch (error) {
        skipped += 1
        console.warn(`Skipped unreadable area image "${path.basename(file.originalname)}": ${error.message}`)
        markProcessed()
        continue
      }

      const imageHash = crypto.createHash('sha256').update(buffer).digest('hex')
      const supplied = String(paths[index] || file.originalname).replace(/\\/g, '/')
      const segments = supplied.split('/').filter((segment) => segment && segment !== '.' && segment !== '..')
      const directories = segments.slice(0, -1)
      const matched = directories.map((segment) => machineMatch(segment, machines)).find(Boolean) || null
      const folderName = matched ? matched.code : unknownAreaFolderName(directories, areas)
      const folderKey = safeSegment(matched ? matched.code : folderName)
      const destinationDir = path.join(storageContext.orderDirectory, folderKey)
      await fs.promises.mkdir(destinationDir, { recursive: true })
      const timestampPart = String(Math.max(0, Math.trunc(time))).padStart(13, '0')
      const destination = path.join(destinationDir, `${timestampPart}-${imageHash}.jpg`)
      if (!await persistCompressedAreaImage(destination, buffer)) duplicates += 1
      if (!grouped.has(folderKey)) grouped.set(folderKey, { folderName, machine: matched, photos: [], sourceFolderPaths: [] })
      const group = grouped.get(folderKey)
      if (!matched) {
        const sourceFolderPath = importedSourceFolderPath(file, folderName)
        if (sourceFolderPath && !group.sourceFolderPaths.includes(sourceFolderPath)) group.sourceFolderPaths.push(sourceFolderPath)
      }
      group.photos.push({ relativePath: relativeStoragePath(destination), time })
      received += 1
      markProcessed()
    }

    const partsByFolder = new Map([...grouped].map(([folderKey, group]) => [folderKey, splitTimedPhotos(group.photos)]))
    return await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
      const currentOrder = await models.Order.findByPk(order.id, { transaction })
      if (!currentOrder) throw apiError(404, 'الأمر غير موجود.')
      if (currentOrder.status === 'archived') throw apiError(409, 'لا يمكن إضافة صور إلى أمر مؤرشف.')
      const latestContext = getOrderStorageContext(currentOrder.id)
      if (path.resolve(latestContext.orderDirectory) !== path.resolve(storageContext.orderDirectory)) {
        throw apiError(409, 'تغير مسار حفظ الأمر أثناء رفع الصور؛ أعد المحاولة.')
      }

      const addedCards = new Set()
      for (const [folderKey, group] of grouped) {
        const parts = partsByFolder.get(folderKey)
        if (group.machine) {
          const machine = await models.Machine.findByPk(group.machine.id, { transaction })
          if (!machine || !machine.active) continue
          const [card] = await models.OrderMachine.findOrCreate({
            where: { orderId: currentOrder.id, machineId: machine.id },
            defaults: { beforePhotos: '[]', afterPhotos: '[]', reasonIds: '[]', note: '' },
            transaction,
          })
          if (card.excludedAt) card.excludedAt = null
          card.beforePhotos = JSON.stringify(mergeUniquePaths(card.beforePhotos, parts.before))
          card.afterPhotos = JSON.stringify(mergeUniquePaths(card.afterPhotos, parts.after))
          await card.save({ transaction })
          addedCards.add(card.id)
        } else {
          let folder = await models.AreaFolder.findOne({
            where: { orderId: currentOrder.id, folderKey }, paranoid: false, transaction,
          })
      if (!folder) {
        folder = await models.AreaFolder.create({
          orderId: currentOrder.id, folderKey, folderName: group.folderName,
          imagePaths: '[]', sourceFolderPaths: '[]', machineId: null,
        }, { transaction })
      } else if (folder.deletedAt) {
        await folder.restore({ transaction })
        folder.folderName = group.folderName
        folder.imagePaths = '[]'
        folder.sourceFolderPaths = '[]'
        folder.machineId = null
      }
          folder.imagePaths = JSON.stringify(mergeUniquePaths(folder.imagePaths, group.photos.map((photo) => photo.relativePath)))
          folder.sourceFolderPaths = JSON.stringify(mergeUniquePaths(folder.sourceFolderPaths, group.sourceFolderPaths))
          await folder.save({ transaction })
        }
      }

      const responseBody = {
        received,
        skipped,
        duplicates,
        folders: grouped.size,
        cards: addedCards.size,
        ...(sourceFolder ? { sourceFolder } : {}),
        ...(areas.length ? { areaId: areas[0], areas } : {}),
      }
      if (received > 0) {
        const previousStatus = currentOrder.status
        currentOrder.status = 'in_progress'
        currentOrder.updatedAt = new Date()
        await currentOrder.save({ transaction })
        await sequelizeAudit({
          userId,
          action: 'upload-area',
          entity: 'order',
          entityId: currentOrder.id,
          details: `files=${received}; skipped=${skipped}; duplicates=${duplicates}`,
          oldValues: { status: previousStatus },
          newValues: { status: 'in_progress', files: received, folders: grouped.size, skipped, duplicates },
          transaction,
        })
      }
      if (idempotency) await idempotency.complete(transaction, responseBody)
      return responseBody
    })
  } finally {
    await Promise.all(temporaryPaths.map((filePath) => fs.promises.rm(filePath, { force: true }).catch(() => {})))
  }
}

api.post('/orders/:id/area', requireAuth, allowRoles('admin', 'operations'), requireOrderClient((req) => req.params.id), createRateLimiter('POST /orders/:id/area'), photoUploadConcurrencyGuard, photoUploadRequestLimit, preparePhotoUploadWorkspace(uploadTemp), photoUploadMulterCallback(upload.array('files', 500)), asyncRoute(async (req, res) => {
  try {
  const rawPaths = req.body?.paths || []
  const paths = Array.isArray(rawPaths) ? rawPaths : [rawPaths]
  const files = req.files || []
  const descriptor = files.map((file) => ({ name: file.originalname, size: file.size }))
  const result = await runIdempotentlyAsync(req, 'POST /orders/:id/area', { orderId: req.params.id, files: descriptor },
    (idempotency) => processAreaUpload(req.params.id, files, paths, req.user.id, { idempotency }))
  sendIdempotentResult(res, result)
  } finally {
    await cleanupPhotoUploadWorkspace(req.photoUploadWorkspace).catch((error) => {
      console.error('Could not clean the completed photo upload workspace:', error)
    })
  }
}))

async function importAreaFolder(req, res, orderId) {
  const folderName = String(req.body?.folderPath || req.body?.folderName || '').trim().replace(/\\/g, '/')
  const rawAreas = req.body?.areas ?? req.body?.area_id ?? req.body?.areaId
  const areas = [...new Set((Array.isArray(rawAreas) ? rawAreas : rawAreas == null ? [] : [rawAreas])
    .map((area) => String(area || '').trim()).filter(Boolean))]
  const folderSegments = folderName.split('/')
  const fromIncoming = folderSegments[0] === '.incoming'
  const invalidFolderSegment = folderSegments.some((segment, index) => !segment || segment === '.' || segment === '..'
    || segment.includes('\0') || (segment.startsWith('.') && !(fromIncoming && index === 0)))
  if (!folderName || invalidFolderSegment || (fromIncoming && folderSegments.length < 2)) {
    return sendError(res, 400, 'اسم المجلد المحدد غير صالح.')
  }
  if (!areas.length) return sendError(res, 400, 'اختر منطقة واحدة على الأقل قبل معالجة مجلد الصور.')
  const storageContext = getOrderStorageContext(orderId)
  const order = await models.Order.findByPk(storageContext.order.id)
  if (order.status === 'archived') return sendError(res, 409, 'لا يمكن إضافة صور إلى أمر مؤرشف.')
  const machinesInAreas = await models.Machine.findAll({
    where: { active: true, area: { [Op.in]: areas } },
    attributes: ['id', 'code'],
  })
  if (!machinesInAreas.length) {
    return sendError(res, 400, 'المنطقة المحددة غير موجودة أو لا تحتوي على ماكينات نشطة.')
  }

  const sourceRoot = path.resolve(areasRoot, ...folderSegments)
  const relativeSource = path.relative(areasRoot, sourceRoot)
  if (!relativeSource || relativeSource === '..' || relativeSource.startsWith(`..${path.sep}`) || path.isAbsolute(relativeSource)) {
    return sendError(res, 400, 'اسم المجلد المحدد غير صالح.')
  }
  if (sourceRoot.toLowerCase() === path.resolve(areasRoot, safeSegment(order.code)).toLowerCase()) {
    return sendError(res, 409, 'مجلد هذا الأمر موجود بالفعل داخل منطقة الفرز.')
  }
  if (await storagePathUsesSymlink(sourceRoot).catch((error) => error.code === 'ENOENT' ? false : Promise.reject(error))) {
    return sendError(res, 400, 'لا يمكن معالجة مسار يحتوي على رابط رمزي.')
  }
  const sourceStats = await fsExtra.lstat(sourceRoot).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!sourceStats?.isDirectory() || sourceStats.isSymbolicLink()) return sendError(res, 404, 'مجلد الصور غير موجود على الخادم.')

  return startAreaProcessing(req, res, {
    orderId: order.id,
    sourceFolder: folderName,
    descriptor: { orderId: order.id, folderName, areas },
    run: async ({ job, onProgress, idempotency }) => {
      const files = []
      const paths = []
      const collectImages = async (directory, relativeDirectory = '') => {
        const entries = await fsExtra.readdir(directory, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue
          const absolutePath = path.join(directory, entry.name)
          const relativePath = relativeDirectory ? path.posix.join(relativeDirectory, entry.name) : entry.name
          if (entry.isDirectory()) {
            await collectImages(absolutePath, relativePath.split(path.sep).join('/'))
          } else if (entry.isFile() && supportedAreaImageExtensions.has(path.extname(entry.name).toLowerCase())) {
            const stats = await fsExtra.stat(absolutePath)
            if (stats.size > 25 * 1024 * 1024) throw apiError(413, 'حجم الصورة يتجاوز 25 ميجابايت: ' + entry.name)
            files.push({ path: absolutePath, originalname: relativePath.split(path.sep).join('/'), preserveSource: true })
            paths.push(path.posix.join(folderName, relativePath.split(path.sep).join('/')))
            if (files.length > 500) throw apiError(413, 'لا يمكن معالجة أكثر من 500 صورة في المرة الواحدة.')
          }
        }
      }
      await collectImages(sourceRoot)
      if (!files.length) throw apiError(400, 'المجلد المحدد لا يحتوي على صور مدعومة.')
      job.totalFiles = files.length
      job.updatedAt = Date.now()
      return processAreaUpload(order.id, files, paths, req.user.id, {
        idempotency, sourceFolder: folderName, areas, onProgress,
      })
    },
  })
}

api.post('/orders/:id/area/import-folder', requireAuth, allowRoles('admin', 'operations'), requireOrderClient((req) => req.params.id), createRateLimiter('POST /process-area'), asyncRoute(async (req, res) => {
  await importAreaFolder(req, res, req.params.id)
}))

api.post('/process-area', requireAuth, allowRoles('admin', 'operations'), createRateLimiter('POST /process-area'), asyncRoute(async (req, res) => {
  const orderId = Number(req.body?.orderId ?? req.body?.order_id)
  if (!Number.isSafeInteger(orderId) || orderId < 1) return sendError(res, 400, 'رقم أمر التشغيل غير صالح.')
  await importAreaFolder(req, res, orderId)
}))

async function findLegacyUnknownFolderSources(folder, machine) {
  const expectedFolderName = normalize(folder.folder_name)
  const expectedArea = normalize(machine.area)
  if (!expectedFolderName || !expectedArea) return []
  const matches = []
  const visit = async (directory, relativeSegments = []) => {
    const entries = await fsExtra.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === '.incoming') continue
      const nextSegments = [...relativeSegments, entry.name]
      const entryPath = path.join(directory, entry.name)
      if (normalize(entry.name) === expectedFolderName
        && nextSegments.slice(0, -1).some((segment) => normalize(segment) === expectedArea)) {
        matches.push(relativeStoragePath(entryPath))
      }
      await visit(entryPath, nextSegments)
    }
  }
  await visit(areasRoot)
  if (matches.length > 1) throw apiError(409, 'توجد عدة مجلدات مصدر محتملة بهذا الاسم والمنطقة؛ لم يتم تنفيذ الربط حفاظًا على الملفات.')
  return matches
}

async function bindAreaFolderToMachine({ orderId, folderId, originalFolderName, originalFolderPath, machineCode, machineId, userId }) {
  const storageContext = getOrderStorageContext(orderId)
  const order = storageContext.order
  if (order.status === 'archived') throw apiError(409, 'لا يمكن تعديل أمر مؤرشف.')

  let folder = null
  if (folderId != null && String(folderId).trim()) {
    const parsedFolderId = Number(folderId)
    if (!Number.isSafeInteger(parsedFolderId) || parsedFolderId < 1) throw apiError(400, 'رقم مجلد الصور غير صالح.')
     folder = db.prepare('SELECT * FROM area_folders WHERE id=? AND order_id=? AND deleted_at IS NULL').get(parsedFolderId, order.id)
  } else if (originalFolderName != null && String(originalFolderName).trim()) {
    const baseName = String(originalFolderName).trim().replace(/\\/g, '/').split('/').filter(Boolean).at(-1)
    if (baseName) {
      const key = safeSegment(baseName)
      folder = db.prepare('SELECT * FROM area_folders WHERE order_id=? AND deleted_at IS NULL AND (folder_key=? OR folder_name=?) ORDER BY id DESC LIMIT 1')
       .get(order.id, key, baseName)
    }
  }
  const code = String(machineCode || '').trim()
  const machine = code
    ? db.prepare('SELECT * FROM machines WHERE code=? AND active=1 AND deleted_at IS NULL').get(code)
    : db.prepare('SELECT * FROM machines WHERE id=? AND active=1 AND deleted_at IS NULL').get(machineId)
  if (!folder || !machine) throw apiError(404, 'المجلد أو الماكينة غير موجودة.')

  const existingCard = db.prepare('SELECT * FROM order_machines WHERE order_id=? AND machine_id=?').get(folder.order_id, machine.id)
  if (existingCard && !existingCard.excluded_at) throw apiError(409, 'هذه الماكينة مضافة بالفعل إلى الأمر.')
  const orderArea = storageContext.orderDirectory
  const folderKey = safeSegment(folder.folder_key)
  const canonicalSource = path.resolve(orderArea, folderKey)
  const legacySource = path.resolve(areasRoot, safeSegment(order.code), folderKey)
  const registeredSourcePaths = parseJsonArray(folder.source_folder_paths)
  if (registeredSourcePaths.some((sourcePath) => typeof sourcePath !== 'string')) {
    throw apiError(400, 'مسار مجلد المصدر غير صالح.')
  }

  const allowedSourcePaths = [canonicalSource, legacySource]
  for (const relativeSource of registeredSourcePaths) {
    const source = absoluteStoragePath(relativeSource)
    if (!source || !pathIsWithin(areasRoot, source)) throw apiError(400, 'مسار المصدر خارج مجلدات المناطق المسموح بها.')
    const segments = path.relative(areasRoot, source).split(path.sep)
    if (segments[0] === '.incoming' && segments.length < 2) throw apiError(400, 'لا يمكن ربط جذر مجلد الاستيراد المؤقت نفسه.')
    allowedSourcePaths.push(source)
  }

  let legacySourceMatches = []
  if (!registeredSourcePaths.length) legacySourceMatches = await findLegacyUnknownFolderSources(folder, machine)
  allowedSourcePaths.push(...legacySourceMatches.map(absoluteStoragePath).filter(Boolean))

  let from
  if (originalFolderPath != null && String(originalFolderPath).trim()) {
    from = absoluteStoragePath(originalFolderPath)
    if (!from || !allowedSourcePaths.some((candidate) => path.resolve(candidate) === path.resolve(from))) {
      throw apiError(400, 'مسار المجلد المحدد لا يطابق مصدر هذا المجلد.')
    }
  } else if (registeredSourcePaths.length > 1) {
    throw apiError(409, 'للمجلد أكثر من مسار مصدر؛ حدد originalFolderPath لاختيار المجلد المطلوب دون نقل الملفات.')
  } else if (registeredSourcePaths.length === 1) {
    from = absoluteStoragePath(registeredSourcePaths[0])
  } else if (legacySourceMatches.length === 1) {
    from = absoluteStoragePath(legacySourceMatches[0])
  } else {
    const canonicalStats = await fsExtra.lstat(canonicalSource).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    const legacyStats = canonicalStats ? null : await fsExtra.lstat(legacySource).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    from = canonicalStats ? canonicalSource : legacyStats ? legacySource : null
  }
  if (!from) throw apiError(404, 'مجلد الصور غير موجود في مساره الأصلي.')
  const sourceSegments = path.relative(areasRoot, from).split(path.sep)
  const isAreaSource = pathIsWithin(areasRoot, from)
  if (isAreaSource && sourceSegments[0] === '.incoming' && sourceSegments.length < 2) {
    throw apiError(400, 'لا يمكن إعادة تسمية جذر مجلد الاستيراد المؤقت.')
  }
  if (safeSegment(path.basename(from)) !== folderKey) throw apiError(400, 'اسم المجلد الفعلي لا يطابق مجلد الصور المحدد.')
  if (![canonicalSource, legacySource].some((candidate) => path.resolve(candidate) === path.resolve(from))
    && !registeredSourcePaths.some((relativeSource) => path.resolve(absoluteStoragePath(relativeSource)) === path.resolve(from))
    && !legacySourceMatches.some((relativeSource) => path.resolve(absoluteStoragePath(relativeSource)) === path.resolve(from))) {
    throw apiError(400, 'مسار المجلد ليس مصدرًا معتمدًا لهذا الربط.')
  }
  const sourceStats = await fsExtra.lstat(from).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!sourceStats?.isDirectory() || sourceStats.isSymbolicLink()) throw apiError(404, 'مجلد الصور غير موجود في مساره الأصلي.')
  if (await storagePathUsesSymlink(from)) throw apiError(400, 'لا يمكن ربط مجلد يحتوي مساره على رابط رمزي.')

  const standardizedFolderName = safeSegment(`${machine.code} - ${machine.name_ar}`)
  const parent = path.dirname(from)
  const to = path.join(parent, standardizedFolderName)
  if (path.dirname(to) !== parent || !pathIsWithin(storageRoot, to)) throw apiError(400, 'مسار إعادة التسمية غير صالح.')
  const samePath = path.resolve(from) === path.resolve(to)
  if (!samePath && await fsExtra.lstat(to).catch(() => null)) {
    throw apiError(409, 'يوجد مجلد آخر بهذا الاسم في المسار نفسه؛ لم يتم استبداله.')
  }

  const oldImages = parseJsonArray(folder.image_paths)
  const renamedImages = oldImages.map((file) => {
    if (typeof file !== 'string') throw apiError(400, 'مسار إحدى الصور في المجلد غير صالح.')
    const oldPath = absoluteStoragePath(file)
    if (!oldPath) throw apiError(400, 'مسار إحدى الصور خارج مساحة التخزين المسموح بها.')
    const relativeToFolder = path.relative(from, oldPath)
    return pathIsWithin(from, oldPath) ? relativeStoragePath(path.join(to, relativeToFolder)) : file
  })

  const renamedSourcePaths = registeredSourcePaths.map((relativeSource) => {
    const source = absoluteStoragePath(relativeSource)
    return source && path.resolve(source) === path.resolve(from) ? relativeStoragePath(to) : relativeSource
  })
  if (isAreaSource && !renamedSourcePaths.includes(relativeStoragePath(to))) renamedSourcePaths.push(relativeStoragePath(to))

  let didRename = false
  try {
    if (!samePath) {
      if (path.dirname(from) !== path.dirname(to)) throw apiError(400, 'يجب أن يبقى المجلد في المجلد الأب نفسه أثناء إعادة التسمية.')
      await renameAreaFolder((source, destination) => fsExtra.rename(source, destination), from, to)
      didRename = true
    }
    const targetStats = await fsExtra.lstat(to).catch(() => null)
    if (!targetStats?.isDirectory() || targetStats.isSymbolicLink()) throw apiError(500, 'تعذر التحقق من إعادة تسمية مجلد الماكينة.')
    if (didRename) {
      const oldStats = await fsExtra.lstat(from).catch(() => null)
      if (oldStats) throw apiError(500, 'تعذر التحقق من بقاء المجلد في موضعه بعد إعادة التسمية.')
    }
    const parts = await splitPhotosByTime(renamedImages)
    const result = db.transaction(() => {
      const cardId = existingCard
        ? (db.prepare('UPDATE order_machines SET before_photos=?,after_photos=?,excluded_at=NULL WHERE id=?')
            .run(JSON.stringify(parts.before), JSON.stringify(parts.after), existingCard.id), existingCard.id)
        : db.prepare('INSERT INTO order_machines(order_id,machine_id,before_photos,after_photos) VALUES (?,?,?,?)')
            .run(folder.order_id, machine.id, JSON.stringify(parts.before), JSON.stringify(parts.after)).lastInsertRowid
      db.prepare('UPDATE area_folders SET folder_key=?,folder_name=?,image_paths=?,machine_id=? WHERE id=?')
        .run(standardizedFolderName, standardizedFolderName, JSON.stringify(renamedImages), machine.id, folder.id)
      db.prepare('UPDATE area_folders SET source_folder_paths=? WHERE id=?')
        .run(JSON.stringify(renamedSourcePaths), folder.id)
      audit(userId, existingCard ? 'restore-and-bind-area-folder' : 'bind-area-folder', 'order-machine', cardId, machine.code,
        existingCard ? { excludedAt: existingCard.excluded_at } : null,
        { orderId: order.id, machineId: machine.id, machineCode: machine.code, oldFolderPath: relativeStoragePath(from),
          newFolderPath: relativeStoragePath(to), sourceFolderPaths: registeredSourcePaths,
          updatedSourceFolderPaths: renamedSourcePaths,
          photos: renamedImages.length })
      return { cardId }
    })()
    return {
      ok: true,
      cardId: result.cardId,
      originalFolderName: folder.folder_name,
      originalFolderPath: relativeStoragePath(from),
      updatedFolderPath: relativeStoragePath(to),
      machine: { id: machine.id, code: machine.code, nameAr: machine.name_ar, area: machine.area || '' },
    }
  } catch (error) {
    if (didRename) await fsExtra.rename(to, from).catch((rollbackError) => {
      console.error('Could not roll back in-place machine folder rename after bind failure:', rollbackError.message)
    })
    throw error
  }
}

api.post('/storage/bind-folder', requireAuth, allowRoles('admin', 'operations'), asyncRoute(async (req, res) => {
  const orderId = Number(req.body?.orderId)
  if (!Number.isSafeInteger(orderId) || orderId < 1) return sendError(res, 400, 'رقم الأمر غير صالح.')
  const result = await bindAreaFolderToMachine({
    orderId,
    folderId: req.body?.folderId,
    originalFolderName: req.body?.originalFolderName,
    originalFolderPath: req.body?.originalFolderPath,
    machineCode: req.body?.machineCode,
    machineId: req.body?.machineId,
    userId: req.user.id,
  })
  res.json(result)
}))

api.post('/orders/:id/area-folders/:folderId/bind', requireAuth, allowRoles('admin', 'operations'), asyncRoute(async (req, res) => {
  const result = await bindAreaFolderToMachine({
    orderId: Number(req.params.id),
    folderId: req.params.folderId,
    originalFolderName: req.body?.originalFolderName,
    originalFolderPath: req.body?.originalFolderPath,
    machineCode: req.body?.machineCode,
    machineId: req.body?.machineId,
    userId: req.user.id,
  })
  res.json(result)
}))

api.post('/orders/:id/cards', requireAuth, allowRoles('admin', 'operations'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND deleted_at IS NULL').get(req.params.id)
  const machine = db.prepare('SELECT * FROM machines WHERE id=? AND active=1 AND deleted_at IS NULL').get(req.body?.machineId)
  if (!order || !machine) return sendError(res, 404, 'الأمر أو الماكينة غير موجودة.')
  if (order.status === 'archived') return sendError(res, 409, 'لا يمكن إضافة ماكينة إلى أمر مؤرشف.')
  const existingCard = db.prepare('SELECT * FROM order_machines WHERE order_id=? AND machine_id=?').get(order.id, machine.id)
  if (existingCard && !existingCard.excluded_at) return sendError(res, 409, 'الماكينة موجودة بالفعل في هذا الأمر.')
  if (existingCard) {
    db.prepare('UPDATE order_machines SET excluded_at=NULL WHERE id=?').run(existingCard.id)
    audit(req.user.id, 'restore-excluded-machine', 'order-machine', existingCard.id, '', { excludedAt: existingCard.excluded_at },
      { orderId: order.id, machineId: machine.id, machineCode: machine.code })
    return res.status(201).json({ id: existingCard.id, restored: true })
  }
  try {
    const result = db.prepare('INSERT INTO order_machines(order_id,machine_id) VALUES (?,?)').run(order.id, machine.id)
    audit(req.user.id, 'add-machine', 'order-machine', result.lastInsertRowid, '', null,
      { orderId: order.id, machineId: machine.id, machineCode: machine.code })
    res.status(201).json({ id: result.lastInsertRowid })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'الماكينة موجودة بالفعل في هذا الأمر.')
    throw error
  }
})

api.post('/orders/:id/cards/:cardId/exclude', requireAuth, allowRoles('admin', 'operations'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND deleted_at IS NULL').get(req.params.id)
  if (!order) return sendError(res, 404, 'الأمر غير موجود.')
  if (order.status === 'archived') return sendError(res, 409, 'لا يمكن استبعاد ماكينة من أمر مؤرشف.')
  const card = db.prepare('SELECT * FROM order_machines WHERE id=? AND order_id=? AND excluded_at IS NULL').get(req.params.cardId, req.params.id)
  if (!card) return sendError(res, 404, 'بطاقة الماكينة غير موجودة أو مستبعدة بالفعل.')
  const beforePhotos = parseJsonArray(card.before_photos)
  const afterPhotos = parseJsonArray(card.after_photos)
  const excludedAt = new Date().toISOString()
  db.transaction(() => {
    db.prepare('UPDATE order_machines SET excluded_at=? WHERE id=?').run(excludedAt, card.id)
    db.prepare('UPDATE orders SET updated_at=CURRENT_TIMESTAMP WHERE id=?').run(order.id)
    audit(req.user.id, 'exclude', 'order-machine', card.id, `photos=${beforePhotos.length + afterPhotos.length}`,
      { excludedAt: null, beforePhotos, afterPhotos },
      { excludedAt, orderId: order.id, machineId: card.machine_id })
  })()
  res.json({ ok: true, excludedCardId: card.id, excludedPhotos: beforePhotos.length + afterPhotos.length })
})

api.patch('/orders/:id/cards/:cardId', requireAuth, allowRoles('admin', 'operations'), asyncRoute(async (req, res) => {
  const order = db.prepare('SELECT status FROM orders WHERE id=? AND deleted_at IS NULL').get(req.params.id)
  if (!order) return sendError(res, 404, 'الأمر غير موجود.')
  if (order.status === 'archived') return sendError(res, 409, 'لا يمكن تعديل صور أو بيانات أمر مؤرشف.')
  const card = db.prepare('SELECT * FROM order_machines WHERE id=? AND order_id=? AND excluded_at IS NULL').get(req.params.cardId, req.params.id)
  if (!card) return sendError(res, 404, 'بطاقة الماكينة غير موجودة.')
  const before = req.body.beforePhotos === undefined ? parseJsonArray(card.before_photos) : req.body.beforePhotos
  const after = req.body.afterPhotos === undefined ? parseJsonArray(card.after_photos) : req.body.afterPhotos
  if (!Array.isArray(before) || !Array.isArray(after)) return sendError(res, 400, 'قائمة الصور غير صالحة.')
  const photoPaths = [...before, ...after]
  if (photoPaths.some((file) => typeof file !== 'string' || !absoluteStoragePath(file) || isLegacyUserImportStoragePath(file))) {
    return sendError(res, 400, 'مسار صورة غير صالح أو غير موجود.')
  }
  const photoFiles = await Promise.all(photoPaths.map((file) => safeStorageFile(file)))
  if (photoFiles.some((file) => !file?.stats.isFile()
    || !supportedAreaImageExtensions.has(path.extname(file.absolutePath).toLowerCase()))) {
    return sendError(res, 400, 'مسار صورة غير صالح أو غير موجود.')
  }
  const reasonIds = req.body.reasonIds === undefined ? parseJsonArray(card.reason_ids) : req.body.reasonIds
  if (!Array.isArray(reasonIds)) return sendError(res, 400, 'أسباب الصيانة غير صالحة.')
  const nextNote = req.body.note === undefined ? card.note : String(req.body.note).slice(0, 2000)
  db.prepare('UPDATE order_machines SET before_photos=?,after_photos=?,reason_ids=?,note=? WHERE id=?')
    .run(JSON.stringify(before), JSON.stringify(after), JSON.stringify(reasonIds.map(Number)),
      nextNote, card.id)
  audit(req.user.id, 'update', 'order-machine', card.id, '', card, { ...card, before_photos: JSON.stringify(before), after_photos: JSON.stringify(after), reason_ids: JSON.stringify(reasonIds), note: nextNote })
  res.json({ ok: true })
}))

function getSharedPhotoPaths(files, excludedCardId) {
  const absoluteTargets = new Set(files.map(absoluteStoragePath).filter(Boolean).map((absolute) => path.resolve(absolute)))
  const shared = new Set()
  const checkExact = (values) => {
    for (const value of values) {
      const absolute = absoluteStoragePath(value)
      if (absolute && absoluteTargets.has(path.resolve(absolute))) shared.add(path.resolve(absolute))
    }
  }
  for (const card of db.prepare('SELECT id,before_photos,after_photos FROM order_machines').all()) {
    if (Number(card.id) === Number(excludedCardId)) continue
    checkExact([...parseJsonArray(card.before_photos), ...parseJsonArray(card.after_photos)])
  }
  for (const folder of db.prepare('SELECT image_paths,source_folder_paths FROM area_folders WHERE deleted_at IS NULL').all()) {
    checkExact(parseJsonArray(folder.image_paths))
    for (const folderPath of parseJsonArray(folder.source_folder_paths)) {
      const absoluteFolder = absoluteStoragePath(folderPath)
      if (!absoluteFolder) continue
      for (const target of absoluteTargets) {
        if (pathIsWithin(absoluteFolder, target)) shared.add(target)
      }
    }
  }
  return shared
}

api.delete('/orders/:id/cards/:cardId/photos', requireAuth, allowRoles('admin', 'operations'), asyncRoute(async (req, res) => {
  const storageContext = getOrderStorageContext(req.params.id)
  const order = storageContext.order
  if (order.status === 'archived') return sendError(res, 409, 'لا يمكن حذف صور الأمر بعد أرشفته حفاظًا على الأصل.')
  const card = db.prepare('SELECT * FROM order_machines WHERE id=? AND order_id=? AND excluded_at IS NULL').get(req.params.cardId, req.params.id)
  const requested = req.body?.paths || (req.body?.path ? [req.body.path] : [])
  const files = [...new Set((Array.isArray(requested) ? requested : [requested]).map((file) => String(file || '')).filter(Boolean))]
  if (!card || !files.length || files.length > 500) return sendError(res, 404, 'الصورة أو البطاقة غير موجودة.')
  const before = parseJsonArray(card.before_photos)
  const after = parseJsonArray(card.after_photos)
  if (files.some((file) => !before.includes(file) && !after.includes(file))) return sendError(res, 404, 'إحدى الصور غير مرتبطة بهذه البطاقة.')
  const shared = getSharedPhotoPaths(files, card.id)
  const deletable = []
  for (const file of files) {
    const absolute = absoluteStoragePath(file)
    const storageSegments = absolute ? path.relative(storageRoot, absolute).split(path.sep) : []
    const belongsToOrder = absolute && pathIsWithin(storageContext.orderDirectory, absolute)
    if (absolute && (belongsToOrder || storageSegments[0] === 'Areas') && !shared.has(path.resolve(absolute))) {
      const stats = await fs.promises.lstat(absolute).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
      if (stats) {
        if (!stats.isFile() || stats.isSymbolicLink() || await storagePathUsesSymlink(absolute)) {
          return sendError(res, 409, 'مسار إحدى الصور غير آمن؛ لم يتم حذف أي صورة.')
        }
        deletable.push(absolute)
      }
    }
  }
  const stagedResult = await stageStorageDirectories(deletable.map((absolutePath) => ({
    absolutePath, allowedRoot: storageRoot,
  })), 'storage-delete')
  const { operation, staged } = stagedResult
  const nextBefore = before.filter((image) => !files.includes(image))
  const nextAfter = after.filter((image) => !files.includes(image))
  try {
    commitFilesystemMutation(operation, () => {
      const changed = db.prepare('UPDATE order_machines SET before_photos=?,after_photos=? WHERE id=? AND order_id=?')
        .run(JSON.stringify(nextBefore), JSON.stringify(nextAfter), card.id, order.id)
      if (!changed.changes) throw apiError(409, 'تغيرت بطاقة الماكينة أثناء الحذف؛ أعد المحاولة.')
      audit(req.user.id, 'delete-photos', 'order-machine', card.id, `count=${files.length}`,
        { beforePhotos: before, afterPhotos: after }, { beforePhotos: nextBefore, afterPhotos: nextAfter })
    })
  } catch (error) {
    await restoreFilesystemOperation(operation)
    throw error
  }
  const cleanupPending = await finishFilesystemOperation(operation, {
    userId: req.user.id, entity: 'order-machine', entityId: card.id, details: `delete-photos; count=${files.length}`,
  })
  res.json({ ok: true, removed: files.length, cleanupPending, retainedSharedFiles: shared.size })
}))

api.patch('/orders/:id/status', requireAuth, allowRoles('admin', 'sales', 'operations'), (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id=? AND deleted_at IS NULL').get(req.params.id)
  if (!order) return sendError(res, 404, 'الأمر غير موجود.')
  const status = String(req.body?.status || '')
  if (!['in_progress', 'review'].includes(status) || order.status === 'archived') return sendError(res, 400, 'حالة الأمر غير صالحة.')
  db.transaction(() => {
    db.prepare('UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status, order.id)
    audit(req.user.id, 'status', 'order', order.id, status, { status: order.status }, { status })
  })()
  res.json({ ok: true })
})

api.delete('/orders/:id', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const orderId = Number(req.params.id)
  if (!Number.isSafeInteger(orderId) || orderId < 1) return sendError(res, 400, 'رقم الأمر غير صالح.')
  if (orderDeletionLocks.has(orderId)) return sendError(res, 409, 'توجد عملية حذف أخرى جارية لهذا الأمر.')
  orderDeletionLocks.add(orderId)
  try {
    const order = await models.Order.findByPk(orderId)
    if (!order) return sendError(res, 404, 'الأمر غير موجود.')
    const storageContext = getOrderStorageContext(order.id)
    const orderDirectory = path.resolve(storageContext.orderDirectory)
    const expectedParent = path.join(storageContext.clientRoot, order.type === 'maintenance' ? 'Maintenance' : 'Operation')
    if (!pathIsWithin(storageRoot, orderDirectory)
      || path.resolve(orderDirectory) !== path.resolve(clientOrderDirectory(storageContext.client, storageContext.order))
      || path.dirname(orderDirectory) !== expectedParent
      || path.basename(orderDirectory) !== safeSegment(order.code)) {
      throw apiError(400, 'مسار ملفات الأمر غير صالح؛ لم يتم حذف البيانات.')
    }

    const stagedPath = orderDeletionStagePath(orderDirectory, order.id)
    const storageStats = await fsExtra.lstat(orderDirectory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    const stagedStats = await fsExtra.lstat(stagedPath).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
    if (stagedStats) return sendError(res, 409, 'توجد ملفات حذف معلقة لهذا الأمر؛ أعد تشغيل الخدمة لاستعادة حالتها قبل إعادة المحاولة.')

    const staged = []
    if (storageStats) {
      if (!storageStats.isDirectory() || storageStats.isSymbolicLink()) {
        throw apiError(409, 'مسار ملفات الأمر ليس مجلدًا عاديًا؛ لم يتم حذف البيانات.')
      }
      if (await storagePathUsesSymlink(orderDirectory)) {
        throw apiError(409, 'مسار ملفات الأمر يحتوي على رابط رمزي؛ لم يتم حذف البيانات.')
      }
      try {
        await fsExtra.rename(orderDirectory, stagedPath)
        staged.push({ originalPath: orderDirectory, stagedPath })
      } catch (error) {
        if (['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) {
          throw apiError(409, 'تعذر تجهيز مجلد ملفات الأمر؛ أغلق الملفات المفتوحة وحاول مرة أخرى.')
        }
        throw error
      }
    }

    const restoreStagedOrder = async (reason) => {
      if (!staged.length) return
      try {
        await restoreStagedStorageDirectories(staged)
        recordOrderDeletionRecovery(req.user.id, order.id, 'order-file-delete-rollback', reason,
          { stagedPath: relativeStoragePath(stagedPath) }, { restoredPath: relativeStoragePath(orderDirectory) })
      } catch (restoreError) {
        console.error(`Order ${order.code} remains active with files staged for recovery:`, restoreError)
        scheduleOrderDeletionRecoveryRestart(res)
        throw apiError(500, 'تعذر تسجيل حذف الأمر وإعادة مجلد ملفاته؛ أوقفت الخدمة لإعادة التشغيل واستعادة المجلد تلقائيًا.')
      }
    }

    let deleted
    try {
      deleted = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
        const currentOrder = await models.Order.findByPk(order.id, { transaction })
        if (!currentOrder) return false
        const oldValues = currentOrder.get({ plain: true })
        await currentOrder.destroy({ transaction })
        await sequelizeAudit({
          userId: req.user.id,
          action: 'soft-delete',
          entity: 'order',
          entityId: currentOrder.id,
          details: `code=${currentOrder.code}; status=${currentOrder.status}; storageStagedForRemoval=${staged.length > 0}`,
          oldValues,
          newValues: {
            deletedAt: currentOrder.deletedAt || new Date().toISOString(),
            storageRemoved: false,
            storageStagedForRemoval: staged.length > 0,
            storagePath: relativeStoragePath(orderDirectory),
            stagedPath: staged.length ? relativeStoragePath(stagedPath) : null,
          },
          transaction,
        })
        return true
      })
    } catch (error) {
      await restoreStagedOrder('database-transaction-failed')
      throw error
    }
    if (!deleted) {
      await restoreStagedOrder('order-not-found-during-delete-transaction')
      return sendError(res, 404, 'الأمر غير موجود.')
    }
    await finishStagedStorageRemoval(staged, {
      userId: req.user.id, entity: 'order', entityId: order.id, details: `code=${order.code}; order-file-delete`,
    })
    res.json({ ok: true, storageRemoved: staged.length > 0 })
  } finally {
    orderDeletionLocks.delete(orderId)
  }
}))

api.post('/orders/:id/archive', requireAuth, allowRoles('admin', 'operations'), createRateLimiter('POST /orders/:id/archive'), asyncRoute(async (req, res) => {
  const storageContext = getOrderStorageContext(req.params.id)
  const order = storageContext.order
  if (order.status === 'archived') return sendError(res, 409, 'الأمر مؤرشف بالفعل.')
  const cards = db.prepare('SELECT * FROM order_machines WHERE order_id=? AND excluded_at IS NULL').all(order.id)
  const excludedCards = db.prepare('SELECT * FROM order_machines WHERE order_id=? AND excluded_at IS NOT NULL').all(order.id)
  if (!cards.length) return sendError(res, 400, 'أضف ماكينة واحدة على الأقل قبل الاعتماد والأرشفة.')
  const archiveRoot = path.join(storageContext.orderDirectory, 'Archive')
  const orderDirectoryStats = await fs.promises.lstat(storageContext.orderDirectory).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (!orderDirectoryStats?.isDirectory() || orderDirectoryStats.isSymbolicLink()
    || await storagePathUsesSymlink(storageContext.orderDirectory)) {
    return sendError(res, 409, 'مجلد الأمر غير موجود أو يحتوي مساره على رابط رمزي؛ لم يتم إنشاء الأرشيف.')
  }
  const existingArchive = await fs.promises.lstat(archiveRoot).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))
  if (existingArchive) return sendError(res, 409, 'يوجد عنصر أرشيف بهذا الرقم؛ راجع الملفات قبل المتابعة.')
  try { await fs.promises.mkdir(archiveRoot) }
  catch (error) {
    if (error.code === 'EEXIST') return sendError(res, 409, 'يوجد عنصر أرشيف بهذا الرقم؛ راجع الملفات قبل المتابعة.')
    throw error
  }
  if (await storagePathUsesSymlink(archiveRoot)) {
    await fs.promises.rm(archiveRoot, { recursive: true, force: true }).catch(() => {})
    return sendError(res, 409, 'مسار الأرشيف يحتوي على رابط رمزي؛ لم يتم تنفيذ الأرشفة.')
  }
  const archivedCards = []
  const excludedMachines = []
  const photoUpdates = []
  let committed = false
  try {
    const movePhotoSet = async (list, machineRoot, subfolder) => {
      const moved = []
      for (const [index, relative] of list.entries()) {
        if (isLegacyUserImportStoragePath(relative)) throw apiError(400, 'لا يمكن إرفاق ملف استيراد المستخدمين بأرشيف الصور.')
        if (!supportedAreaImageExtensions.has(path.extname(String(relative)).toLowerCase())) {
          throw apiError(400, `صيغة صورة غير مدعومة للأرشفة: ${relative}`)
        }
        const sourceFile = await safeStorageFile(relative)
        if (!sourceFile?.stats.isFile()) throw apiError(400, `ملف صورة غير موجود أو مساره غير آمن: ${relative}`)
        const source = sourceFile.absolutePath
        const destination = path.join(machineRoot, subfolder, `${String(index + 1).padStart(3, '0')}-${path.basename(source)}`)
        if (!pathIsWithin(archiveRoot, destination)) throw apiError(400, 'مسار الأرشيف غير صالح.')
        await fs.promises.mkdir(path.dirname(destination), { recursive: true })
        if (await storagePathUsesSymlink(path.dirname(destination))) throw apiError(409, 'مسار ملف الأرشيف يحتوي على رابط رمزي.')
        await fs.promises.copyFile(source, destination)
        moved.push(relativeStoragePath(destination))
      }
      return moved
    }
    for (const card of cards) {
      const machine = db.prepare('SELECT code FROM machines WHERE id=?').get(card.machine_id)
      const machineRoot = path.join(archiveRoot, safeSegment(machine.code))
      const before = await movePhotoSet(parseJsonArray(card.before_photos), machineRoot, 'Before')
      const after = await movePhotoSet(parseJsonArray(card.after_photos), machineRoot, 'After')
      photoUpdates.push({ id: card.id, before, after })
      archivedCards.push({ machineCode: machine.code, before, after,
        reasons: parseJsonArray(card.reason_ids).map((id) => db.prepare('SELECT label FROM maintenance_reasons WHERE id=?').get(id)?.label).filter(Boolean),
        note: card.note,
      })
    }
    for (const card of excludedCards) {
      const machine = db.prepare('SELECT code FROM machines WHERE id=?').get(card.machine_id)
      const machineRoot = path.join(archiveRoot, 'Excluded', safeSegment(machine.code))
      const before = await movePhotoSet(parseJsonArray(card.before_photos), machineRoot, 'Before')
      const after = await movePhotoSet(parseJsonArray(card.after_photos), machineRoot, 'After')
      photoUpdates.push({ id: card.id, before, after })
      excludedMachines.push({ machineCode: machine.code, before, after, excludedAt: card.excluded_at, note: card.note })
    }
    const metadata = { code: order.code, type: order.type, clientCode: order.client_code, clientName: order.client_name,
      createdAt: order.created_at, archivedAt: new Date().toISOString(), notes: order.notes, machines: archivedCards, excludedMachines }
    await fs.promises.writeFile(path.join(archiveRoot, 'order.json'), JSON.stringify(metadata, null, 2), 'utf8')
    db.transaction(() => {
      for (const photos of photoUpdates) {
        db.prepare('UPDATE order_machines SET before_photos=?,after_photos=? WHERE id=?')
          .run(JSON.stringify(photos.before), JSON.stringify(photos.after), photos.id)
      }
      db.prepare("UPDATE orders SET status='archived',archived_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id)
      recognizeCompletedWorkOrderIssues(db, { orderId: order.id })
      audit(req.user.id, 'archive', 'order', order.id, order.code, { status: order.status }, { status: 'archived' })
    })()
    committed = true
    res.json({ ok: true, archivePath: relativeStoragePath(archiveRoot) })
  } catch (error) {
    if (!committed) await fs.promises.rm(archiveRoot, { recursive: true, force: true }).catch(() => {})
    return sendError(res, 500, `تعذرت الأرشفة بالكامل؛ راجع الملفات قبل إعادة المحاولة. ${error.message}`)
  }
}))

api.get('/files/thumbnail', requireAuth, asyncRoute(async (req, res) => {
  if (isLegacyUserImportStoragePath(req.query.path)) return sendError(res, 404, 'الصورة غير موجودة.')
  const file = await safeStorageFile(req.query.path)
  const absolute = file?.absolutePath
  const segments = file ? path.relative(storageRoot, file.requestedPath).split(path.sep) : []
  const isAreaImage = segments[0] === 'Areas'
  const isArchivedImage = segments[0] === 'Clients' && segments[2] === 'Archived_Orders'
  const isClientOrderImage = segments[0] === 'Clients' && ['Maintenance', 'Operation'].includes(segments[2]) && segments.length >= 6
  if (!absolute || (!isAreaImage && !isArchivedImage && !isClientOrderImage)) return sendError(res, 404, 'الصورة غير موجودة.')
  const extension = path.extname(absolute).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff'].includes(extension)) return sendError(res, 415, 'صيغة الصورة غير مدعومة.')
  const stats = file.stats

  const relative = relativeStoragePath(file.requestedPath)
  const cacheKey = crypto.createHash('sha256').update(`${relative}\0${stats.size}\0${stats.mtimeMs}`).digest('hex')
  const cachePath = path.join(thumbnailCacheRoot, `${cacheKey}.webp`)
  let thumbnail
  try {
    thumbnail = await fs.promises.readFile(cachePath)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    let lastError
    for (const width of [200, 160, 128, 96, 72, 48, 32]) {
      for (const quality of [70, 50, 35, 20]) {
        try {
          thumbnail = await sharp(absolute, { limitInputPixels: 67_108_864 })
            .rotate()
            .resize({ width, height: 200, fit: 'inside', withoutEnlargement: true })
            .webp({ quality, effort: 4 })
            .toBuffer()
          if (thumbnail.byteLength <= 20 * 1024) break
        } catch (imageError) {
          lastError = imageError
          break
        }
      }
      if (thumbnail?.byteLength <= 20 * 1024 || lastError) break
    }
    if (!thumbnail || thumbnail.byteLength > 20 * 1024) {
      if (lastError) throw lastError
      return sendError(res, 422, 'تعذر إنشاء صورة مصغرة بالحجم المطلوب.')
    }
    await fs.promises.mkdir(thumbnailCacheRoot, { recursive: true })
    const temporaryPath = `${cachePath}.${crypto.randomUUID()}.tmp`
    await fs.promises.writeFile(temporaryPath, thumbnail)
    try { await fs.promises.rename(temporaryPath, cachePath) }
    catch (renameError) {
      await fs.promises.rm(temporaryPath, { force: true })
      if (!['EEXIST', 'EPERM'].includes(renameError.code)) throw renameError
    }
  }
  res.set({ 'Cache-Control': 'private, max-age=300', 'Content-Length': String(thumbnail.byteLength) }).type('image/webp').send(thumbnail)
}))

api.get('/files', requireAuth, asyncRoute(async (req, res) => {
  if (isLegacyUserImportStoragePath(req.query.path)) return sendError(res, 404, 'الملف غير موجود.')
  const file = await safeStorageFile(req.query.path)
  if (!file) return sendError(res, 404, 'الملف غير موجود.')
  res.sendFile(file.absolutePath, { headers: { 'Cache-Control': 'private, max-age=3600' } })
}))

api.get('/reasons', requireAuth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM maintenance_reasons WHERE active=1 ORDER BY label').all())
})

api.post('/reasons', requireAuth, allowRoles('admin'), (req, res) => {
  const label = String(req.body?.label || '').trim()
  if (!label) return sendError(res, 400, 'اكتب سبب الصيانة.')
  try {
    const result = db.prepare('INSERT INTO maintenance_reasons(label) VALUES (?)').run(label)
    audit(req.user.id, 'create', 'maintenance-reason', result.lastInsertRowid, '', null, { label, active: true })
    res.status(201).json({ id: result.lastInsertRowid, label })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'سبب الصيانة موجود بالفعل.')
    throw error
  }
})

api.delete('/reasons/:id', requireAuth, allowRoles('admin'), (req, res) => {
  const reason = db.prepare('SELECT * FROM maintenance_reasons WHERE id=? AND active=1').get(req.params.id)
  if (!reason) return sendError(res, 404, 'سبب الصيانة غير موجود.')
  db.transaction(() => {
    db.prepare('UPDATE maintenance_reasons SET active=0 WHERE id=?').run(reason.id)
    audit(req.user.id, 'deactivate', 'maintenance-reason', reason.id, '', reason, { ...reason, active: 0 })
  })()
  res.json({ ok: true })
})

api.post('/materials', requireAuth, allowRoles('admin', 'purchasing'), asyncRoute(async (req, res) => {
  const body = req.body || {}
  const name = String(body.name || '').trim()
  if (!name) return sendError(res, 400, 'اسم الخامة مطلوب.')
  const specification = String(body.specification || '').trim().slice(0, 300)
  const stock = Number(body.stock || 0)
  const subStock = Number(body.subStock || 0)
  const unitCost = parseOptionalCurrencyAmount(body.unitCost)
  const minStock = Number(body.minStock || 0)
  if (![stock, subStock, unitCost, minStock].every(Number.isFinite) || !Number.isInteger(stock) || stock < 0 || subStock < 0 || unitCost < 0 || minStock < 0) {
    return sendError(res, 400, 'الرصيد الأساسي يجب أن يكون عددًا صحيحًا، وتكلفة الوحدة بحد أقصى منزلتين عشريتين، وباقي القيم غير سالبة.')
  }
  const unit = String(body.unit || 'قطعة').trim() || 'قطعة'
  const variantKey = materialVariantKey({ name, specification, unit, unitCostCents: Math.round(unitCost * 100) })
  const result = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const existing = await sequelize.query('SELECT id FROM materials WHERE variant_key=?', {
      replacements: [variantKey], transaction, type: require('sequelize').QueryTypes.SELECT,
    }).then(([row]) => row)
    if (existing) return { duplicate: true }

    const code = await nextSequelizeCode('material', 'MAT', transaction)
    const material = await models.Material.create({ code, name, specification, unit, variantKey, stock, subStock, unitCost, minStock, active: true }, { transaction })

    if (stock > 0) {
      await models.InventoryMovement.create({
        materialId: material.id, kind: 'adjustment', quantity: stock, reference: 'رصيد افتتاحي',
        notes: `رصيد أساسي افتتاحي: ${stock}`, createdBy: req.user.id, warehouse: 'main',
      }, { transaction })
      await sequelize.query(`INSERT INTO inventory_lots(material_id,source_type,source_id,warehouse,received_quantity,remaining_quantity,unit_cost_cents)
        VALUES (?,'catalog-opening','material-create','main',?,?,?)`, {
        replacements: [material.id, stock, stock, Math.round(unitCost * 100)], transaction,
      })
    }
    if (subStock > 0) {
      await models.InventoryMovement.create({
        materialId: material.id, kind: 'adjustment', quantity: subStock, reference: 'رصيد افتتاحي',
        notes: `رصيد بواقي افتتاحي: ${subStock}`, createdBy: req.user.id, warehouse: 'sub',
      }, { transaction })
      await sequelize.query(`INSERT INTO inventory_lots(material_id,source_type,source_id,warehouse,received_quantity,remaining_quantity,unit_cost_cents)
        VALUES (?,'catalog-opening','material-create','sub',?,?,?)`, {
        replacements: [material.id, subStock, subStock, Math.round(unitCost * 100)], transaction,
      })
    }
    await sequelizeAudit({
      userId: req.user.id, action: 'create', entity: 'material', entityId: material.id, details: code,
      newValues: { code, name, specification, unit, stock, subStock, unitCost, minStock }, transaction,
    })
    return { id: material.id, code }
  })
  if (result.duplicate) return sendError(res, 409, 'اسم الخامة مستخدم بالفعل.')
  res.status(201).json(result)
}))

const updateMaterialRoute = asyncRoute(async (req, res) => {
  const materialId = Number(req.params.id)
  if (!Number.isSafeInteger(materialId) || materialId <= 0) return sendError(res, 400, 'رقم الخامة غير صالح.')

  const updated = db.transaction(() => {
    const material = db.prepare('SELECT * FROM materials WHERE id=? AND active=1 AND deleted_at IS NULL').get(materialId)
    if (!material) return false
    assertMaterialUnlocked(materialId)
    const values = {
      name: req.body?.name === undefined ? material.name : String(req.body.name || '').trim(),
      specification: req.body?.specification === undefined ? material.specification || '' : String(req.body.specification || '').trim().slice(0, 300),
      unit: req.body?.unit === undefined ? material.unit : String(req.body.unit || '').trim(),
      stock: req.body?.stock === undefined ? Number(material.stock) : Number(req.body.stock),
      subStock: req.body?.subStock === undefined ? Number(material.sub_stock) : Number(req.body.subStock),
      unitCost: req.body?.unitCost === undefined ? Number(material.unit_cost) : parseOptionalCurrencyAmount(req.body.unitCost),
      minStock: req.body?.minStock === undefined ? Number(material.min_stock) : Number(req.body.minStock),
    }
    if (!values.name || !values.unit) throw apiError(400, 'اسم الخامة والوحدة مطلوبان.')
    if (![values.stock, values.subStock, values.unitCost, values.minStock].every(Number.isFinite)
      || !Number.isInteger(values.stock) || values.stock < 0 || values.subStock < 0
      || Math.abs(values.subStock * 1_000_000 - Math.round(values.subStock * 1_000_000)) > 0.000001
      || values.unitCost < 0 || values.minStock < 0) {
      throw apiError(400, 'الرصيد الأساسي يجب أن يكون عددًا صحيحًا، وتكلفة الوحدة بحد أقصى منزلتين عشريتين، وباقي القيم غير سالبة.')
    }
    if (Math.round(values.unitCost * 100) !== Math.round(Number(material.unit_cost) * 100)) {
      throw apiError(409, 'سعر الشراء جزء من هوية الصنف؛ لا تغيّر سعره بعد التسجيل. سجّل فاتورة شراء جديدة لإنشاء متغير سعر مستقل.')
    }
    const variantKey = materialVariantKey({ name: values.name, specification: values.specification,
      unit: values.unit, unitCostCents: Math.round(values.unitCost * 100) })
    const duplicate = db.prepare('SELECT id FROM materials WHERE variant_key=? AND id<>?').get(variantKey, materialId)
    if (duplicate) throw apiError(409, 'يوجد صنف مطابق بالمواصفة والوحدة وسعر الشراء نفسيهما.')
    const oldValues = {
      name: material.name, specification: material.specification || '', unit: material.unit,
      stock: Number(material.stock), sub_stock: Number(material.sub_stock),
      unit_cost: Number(material.unit_cost), min_stock: Number(material.min_stock),
    }
    const mainDelta = Number((values.stock - Number(material.stock)).toFixed(6))
    const subDelta = Number((values.subStock - Number(material.sub_stock)).toFixed(6))
    const adjustmentReason = String(req.body?.adjustmentReason || '').trim().slice(0, 1000)
    if ((Math.abs(mainDelta) > 0.000001 || Math.abs(subDelta) > 0.000001) && !adjustmentReason) {
      throw apiError(400, 'اذكر سبب تعديل أرصدة المخزون.')
    }
    const insertMovement = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,source_type,source_id)
      VALUES (?,'adjustment',?,'تعديل رصيد الخامة',?,?,?,'manual_adjustment',?)`)
    const adjustmentMovementIds = []
    const adjustLot = (warehouse, delta, note) => {
      if (Math.abs(delta) <= 0.000001) return null
      const movementNote = `${note}${adjustmentReason ? ` السبب: ${adjustmentReason}` : ''}`
      const movementId = insertMovement.run(materialId, delta, movementNote, req.user.id, warehouse, `material:${materialId}`).lastInsertRowid
      adjustmentMovementIds.push(movementId)
      if (delta > 0) {
        createInventoryLot({ materialId, sourceType: 'manual_adjustment', sourceId: movementId,
          warehouse, quantity: delta, unitCostCents: Math.round(values.unitCost * 100) })
      } else {
        consumeInventoryLots(materialId, warehouse, -delta, movementId)
      }
      return movementId
    }
    adjustLot('main', mainDelta, `تعديل الرصيد الأساسي من ${oldValues.stock} إلى ${values.stock}.`)
    adjustLot('sub', subDelta, `تعديل رصيد البواقي من ${oldValues.sub_stock} إلى ${values.subStock}.`)
    db.prepare(`UPDATE materials SET name=?,specification=?,unit=?,stock=?,sub_stock=?,min_stock=?,variant_key=? WHERE id=?`)
      .run(values.name, values.specification, values.unit, values.stock, values.subStock, values.minStock, variantKey, materialId)
    const totalQuantityDelta = Number((mainDelta + subDelta).toFixed(6))
    const adjustmentCents = Math.abs(Math.round(totalQuantityDelta * Number(material.unit_cost) * 100))
    if (!Number.isSafeInteger(adjustmentCents)) throw apiError(400, 'قيمة تسوية المخزون تتجاوز الدقة المحاسبية المدعومة.')
    let journal = null
    if (adjustmentCents > 0 && adjustmentMovementIds.length && Math.abs(totalQuantityDelta) > 0.000001) {
      const inventoryIncrease = totalQuantityDelta > 0
      const movementId = adjustmentMovementIds[0]
      journal = queueJournalEntry(db, {
        sourceType: 'inventory_adjustment', sourceId: movementId,
        sourceKey: `manual-inventory-adjustment:${movementId}`,
        description: `تسوية مخزون يدوية ${material.code}: ${adjustmentReason}`,
        createdBy: req.user.id,
        postings: inventoryIncrease ? [
          { mappingKey: 'inventory', debitCents: adjustmentCents, description: `زيادة مخزون ${material.code}` },
          { mappingKey: 'inventory_variance', creditCents: adjustmentCents, description: `فائض تسوية ${material.code}` },
        ] : [
          { mappingKey: 'inventory_variance', debitCents: adjustmentCents, description: `عجز تسوية ${material.code}` },
          { mappingKey: 'inventory', creditCents: adjustmentCents, description: `نقص مخزون ${material.code}` },
        ],
      })
    }
    audit(req.user.id, 'update', 'material', materialId, '', oldValues, {
      name: values.name, specification: values.specification, unit: values.unit,
      stock: values.stock, sub_stock: values.subStock, unit_cost: values.unitCost, min_stock: values.minStock,
      ...(adjustmentMovementIds.length ? { adjustmentReason, journalEntryId: journal?.id || null } : {}),
    })
    return true
  })()
  if (!updated) return sendError(res, 404, 'الخامة غير موجودة.')
  res.json({ ok: true })
})

api.put('/materials/:id', requireAuth, allowRoles('admin', 'purchasing'), updateMaterialRoute)

api.delete('/materials/:id', requireAuth, allowRoles('admin', 'purchasing'), asyncRoute(async (req, res) => {
  const materialId = Number(req.params.id)
  if (!Number.isSafeInteger(materialId) || materialId <= 0) return sendError(res, 400, 'رقم الخامة غير صالح.')
  const deleted = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
    const material = await models.Material.findByPk(materialId, { transaction })
    if (!material) return false
    assertMaterialUnlocked(materialId)
    const oldValues = {
      code: material.code, name: material.name, unit: material.unit, stock: material.stock,
      sub_stock: material.subStock, unit_cost: material.unitCost, min_stock: material.minStock,
      active: Boolean(material.active),
    }
    await material.update({ active: false }, { transaction })
    await material.destroy({ transaction })
    await sequelizeAudit({
      userId: req.user.id, action: 'soft-delete', entity: 'material', entityId: material.id,
      oldValues, newValues: { ...oldValues, active: false, deleted_at: new Date().toISOString() }, transaction,
    })
    return true
  })
  if (!deleted) return sendError(res, 404, 'الخامة غير موجودة.')
  res.json({ ok: true })
}))

api.get('/materials', requireAuth, asyncRoute(async (req, res) => {
  const materials = await models.Material.findAll({
    where: { active: true },
    order: [['name', 'ASC']],
  })
  res.json(materials.map((material) => materialApiRecord(material, req.user.role)))
}))

api.post('/inventory/purchases', requireAuth, allowRoles('admin', 'purchasing'), createRateLimiter('POST /inventory/purchases'), (req, res) => {
  let employeeId
  try { employeeId = resolveEmployeeId(req.body?.employeeId) }
  catch (error) { return sendError(res, error.status || 400, error.message) }
  const requestedItems = Array.isArray(req.body?.items) ? req.body.items : []
  const items = requestedItems.map((item) => {
    const unitCostCents = parseCurrencyCents(item?.unitCost, { allowZero: true })
    const rawMaterialId = item?.materialId == null || item.materialId === '' || Number(item.materialId) === 0
      ? null : Number(item.materialId)
    return { ...item, materialId: rawMaterialId, unitCostCents, unitCost: unitCostCents === null ? null : unitCostCents / 100 }
  })
  if (!items.length || items.length > 200 || items.some((item) => (item.materialId !== null
    ? !Number.isSafeInteger(item.materialId) || item.materialId < 1
    : !String(item.name || '').trim() || !String(item.unit || '').trim())
    || !(Number(item.quantity) > 0) || !Number.isSafeInteger(Number(item.quantity)) || item.unitCostCents === null)) {
    return sendError(res, 400, 'أدخل صنفًا واحدًا على الأقل بالاسم والوحدة أو اختر قالبًا، مع كمية صحيحة كاملة وسعر شراء صالح.')
  }
  const totalCentsBig = items.reduce((sum, item) => sum + BigInt(Number(item.quantity)) * BigInt(item.unitCostCents), 0n)
  if (totalCentsBig <= 0n || totalCentsBig > BigInt(Number.MAX_SAFE_INTEGER)) return sendError(res, 400, 'إجمالي الفاتورة يتجاوز الحد المالي المدعوم.')
  const totalCents = Number(totalCentsBig)
  const total = currencyAmountFromCents(totalCents)
  if (total === null) return sendError(res, 400, 'إجمالي الفاتورة يتجاوز دقة المبالغ المالية المدعومة.')
  const supplier = String(req.body?.supplier || '').trim().slice(0, 200)
  const notes = String(req.body?.notes || '').slice(0, 2000)
  try {
    const outcome = createIdempotently(req, 'POST /inventory/purchases', () => {
      if (cashboxBalanceCents() < totalCents) throw apiError(409, 'رصيد صندوق المصنع لا يكفي لسداد الفاتورة بالكامل. سجّل تمويلًا أو رصيدًا افتتاحيًا معتمدًا أولًا.')
      const code = nextCode('invoice', 'INV')
      const invoiceId = db.prepare(`INSERT INTO invoices(code,kind,supplier,total,paid_total,remaining,payment_status,notes,created_by,worker_id,employee_id)
        VALUES (?,'purchase',?,?,?,0,'paid',?,?,NULL,?)`)
        .run(code, supplier, total, total, notes, req.user.id, employeeId).lastInsertRowid
      const outputItems = []
      for (const item of items) {
        const selectedMaterial = item.materialId == null ? null
          : db.prepare('SELECT * FROM materials WHERE id=? AND active=1 AND deleted_at IS NULL').get(item.materialId)
        if (item.materialId !== null && !selectedMaterial) throw apiError(400, `الخامة غير موجودة: ${item.materialId}`)
        if (selectedMaterial) assertMaterialUnlocked(selectedMaterial.id)
        const variant = {
          name: String(item.name ?? selectedMaterial?.name ?? '').trim(),
          specification: String(item.specification ?? selectedMaterial?.specification ?? '').trim().slice(0, 300),
          unit: String(item.unit ?? selectedMaterial?.unit ?? '').trim(),
          unitCostCents: item.unitCostCents,
        }
        if (!variant.name || !variant.unit) throw apiError(400, 'اسم الخامة والمواصفة والوحدة مطلوبة.')
        const variantKey = materialVariantKey(variant)
        let material = db.prepare('SELECT * FROM materials WHERE variant_key=?').get(variantKey)
        if (material) {
          assertMaterialUnlocked(material.id)
          if (material.deleted_at || !material.active) {
            db.prepare('UPDATE materials SET active=1,deleted_at=NULL WHERE id=?').run(material.id)
            material = db.prepare('SELECT * FROM materials WHERE id=?').get(material.id)
          }
        } else {
          const materialCode = nextCode('material', 'MAT')
          const inserted = db.prepare(`INSERT INTO materials(code,name,specification,unit,stock,unit_cost,min_stock,active,sub_stock,variant_key)
            VALUES (?,?,?,?,0,?,?,1,0,?)`).run(materialCode, variant.name, variant.specification, variant.unit,
            item.unitCost, selectedMaterial?.min_stock || 0, variantKey)
          material = db.prepare('SELECT * FROM materials WHERE id=?').get(inserted.lastInsertRowid)
        }
        const quantity = Number(item.quantity)
        db.prepare('INSERT INTO invoice_items(invoice_id,material_id,quantity,unit_cost) VALUES (?,?,?,?)')
          .run(invoiceId, material.id, quantity, item.unitCost)
        db.prepare('UPDATE materials SET stock=stock+? WHERE id=?').run(quantity, material.id)
        const movementId = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,invoice_id,source_type,source_id)
          VALUES (?,'purchase',?,?,?,?, 'main',?,'purchase_invoice',?)`).run(material.id, quantity, code,
          `توريد فاتورة ${code}`, req.user.id, invoiceId, String(invoiceId)).lastInsertRowid
        createInventoryLot({ materialId: material.id, invoiceId, sourceType: 'purchase_invoice', sourceId: invoiceId,
          warehouse: 'main', quantity, unitCostCents: item.unitCostCents })
        outputItems.push({ materialId: material.id, code: material.code, name: material.name,
          specification: material.specification || '', unit: material.unit, quantity, unitCost: item.unitCost,
          lineTotal: currencyAmountFromCents(quantity * item.unitCostCents), movementId })
      }
      const treasuryId = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,invoice_id,created_by,employee_id)
        VALUES ('expense',?,'مشتريات مخزون',?,?,?, ?,?)`).run(total, code, notes, invoiceId, req.user.id, employeeId).lastInsertRowid
      queueJournalEntry(db, {
        sourceType: 'purchase_invoice', sourceId: invoiceId, sourceKey: `purchase-invoice:${invoiceId}`,
        description: `سداد فاتورة شراء ${code}`, createdBy: req.user.id,
        postings: [
          { mappingKey: 'inventory', debitCents: totalCents, description: `مخزون فاتورة ${code}` },
          { mappingKey: 'factory_cashbox', creditCents: totalCents, description: `سداد نقدي ${code}` },
        ],
      })
      audit(req.user.id, 'purchase-paid', 'invoice', invoiceId, `${code}; treasury=${treasuryId}`,
        null, { kind: 'purchase', total, paidTotal: total, remaining: 0, employeeId, supplier, items: outputItems })
      return { id: invoiceId, code, total, paidTotal: total, remaining: 0, paymentStatus: 'paid', items: outputItems }
    })
    if (outcome.error) return sendError(res, 400, outcome.error)
    if (outcome.conflict) return sendError(res, 409, 'استُخدم مفتاح منع التكرار خلال آخر 5 ثوانٍ لطلب مختلف.')
    res.setHeader('Idempotency-Replayed', String(outcome.replayed))
    if (!outcome.replayed) io.to('role:treasury').emit('treasury:invoice-approved', {
      id: outcome.body.id, code: outcome.body.code, kind: 'purchase', total: outcome.body.total,
    })
    res.status(outcome.status).json(outcome.body)
  } catch (error) {
    return sendError(res, error.status || 400, error.message)
  }
})

function currentPurchaseRevision(invoiceId) {
  return db.prepare(`SELECT * FROM purchase_invoice_revisions WHERE invoice_id=?
    ORDER BY revision_number DESC LIMIT 1`).get(invoiceId) || null
}

function currentPurchaseSnapshot(invoice) {
  const revision = currentPurchaseRevision(invoice.id)
  if (revision) return JSON.parse(revision.revised_values)
  const items = db.prepare(`SELECT ii.material_id,m.code,m.name,m.specification,m.unit,ii.quantity,ii.unit_cost
    FROM invoice_items ii JOIN materials m ON m.id=ii.material_id
    WHERE ii.invoice_id=? ORDER BY ii.id`).all(invoice.id).map((item) => {
    const unitCostCents = Math.round(Number(item.unit_cost) * 100)
    return {
      materialId: item.material_id, code: item.code, name: item.name, specification: item.specification || '',
      unit: item.unit, quantity: Number(item.quantity), unitCostCents, unitCost: unitCostCents / 100,
      lineTotalCents: Number(item.quantity) * unitCostCents,
    }
  })
  return {
    supplier: invoice.supplier || '', notes: invoice.notes || '', employeeId: invoice.employee_id || null,
    totalCents: Math.round(Number(invoice.total) * 100), items,
  }
}

function currentPurchaseLotSource(invoiceId) {
  const revision = currentPurchaseRevision(invoiceId)
  return revision
    ? { sourceType: 'purchase_invoice_revision', sourceId: String(revision.id), revisionNumber: revision.revision_number }
    : { sourceType: 'purchase_invoice', sourceId: String(invoiceId), revisionNumber: 0 }
}

function purchaseRevisionEligibility(invoice, snapshot = currentPurchaseSnapshot(invoice)) {
  if (invoice.status === 'corrected' || db.prepare('SELECT 1 FROM purchase_corrections WHERE invoice_id=?').get(invoice.id)) {
    return { eligible: false, reason: 'الفاتورة مصححة ولا يمكن تعديلها مرة أخرى.' }
  }
  if (Math.round(Number(invoice.paid_total || 0) * 100) !== Math.round(Number(invoice.total || 0) * 100)
    || Math.round(Number(invoice.remaining || 0) * 100) !== 0) {
    return { eligible: false, reason: 'تتطلب المراجعة فاتورة شراء مسددة بالكامل.' }
  }
  if (!snapshot.items?.length) return { eligible: false, reason: 'لا توجد بنود موثقة للمراجعة.' }

  const source = currentPurchaseLotSource(invoice.id)
  const expectedByMaterial = new Map()
  for (const item of snapshot.items) {
    const materialId = Number(item.materialId)
    expectedByMaterial.set(materialId, (expectedByMaterial.get(materialId) || 0) + Number(item.quantity))
  }
  const lots = db.prepare(`SELECT l.id,l.material_id,l.received_quantity,l.remaining_quantity,
      COALESCE(SUM(c.quantity),0) AS consumed
    FROM inventory_lots l LEFT JOIN inventory_lot_consumptions c ON c.lot_id=l.id
    WHERE l.invoice_id=? AND l.source_type=? AND l.source_id=? AND l.warehouse='main'
    GROUP BY l.id ORDER BY l.id`).all(invoice.id, source.sourceType, source.sourceId)
  if (!lots.length) return { eligible: false, reason: 'لا يمكن إثبات مصدر دفعات المخزون لهذه الفاتورة.' }

  const receivedByMaterial = new Map()
  let untouched = true
  for (const lot of lots) {
    const materialId = Number(lot.material_id)
    receivedByMaterial.set(materialId, (receivedByMaterial.get(materialId) || 0) + Number(lot.received_quantity))
    if (Math.abs(Number(lot.received_quantity) - Number(lot.remaining_quantity)) > 0.000001
      || Number(lot.consumed) > 0.000001) untouched = false
  }
  const materialsMatch = expectedByMaterial.size === receivedByMaterial.size
    && [...expectedByMaterial].every(([materialId, quantity]) =>
      Math.abs(quantity - (receivedByMaterial.get(materialId) || 0)) <= 0.000001)
  if (!untouched || !materialsMatch) {
    return { eligible: false, reason: 'لا يمكن مراجعة الفاتورة بعد صرف أي جزء من دفعاتها أو تغيّر مصدرها.' }
  }
  return { eligible: true, reason: '', source, lots }
}

function purchaseRevisionHistory(invoiceId) {
  const invoice = db.prepare(`SELECT * FROM invoices WHERE id=? AND kind='purchase' AND deleted_at IS NULL`).get(invoiceId)
  if (!invoice) return null
  const currentValues = currentPurchaseSnapshot(invoice)
  const eligibility = purchaseRevisionEligibility(invoice, currentValues)
  const revisions = db.prepare(`SELECT r.*,u.full_name AS actor_name FROM purchase_invoice_revisions r
    LEFT JOIN users u ON u.id=r.created_by WHERE r.invoice_id=? ORDER BY r.revision_number DESC`).all(invoiceId)
    .map((revision) => ({ ...revision,
      previous_values: JSON.parse(revision.previous_values), revised_values: JSON.parse(revision.revised_values),
      stock_movements: JSON.parse(revision.stock_movements || '[]'),
    }))
  return {
    invoice: { id: invoice.id, code: invoice.code, supplier: invoice.supplier || '', notes: invoice.notes || '',
      total: Number(invoice.total), paidTotal: Number(invoice.paid_total), remaining: Number(invoice.remaining),
      paymentStatus: invoice.payment_status, status: invoice.status, createdAt: invoice.created_at },
    currentValues, revisionNumber: currentPurchaseRevision(invoiceId)?.revision_number || 0,
    canRevise: eligibility.eligible, revisionBlockedReason: eligibility.reason, revisions,
  }
}

api.get('/inventory/purchases/:id', requireAuth, allowRoles('admin', 'purchasing'), (req, res) => {
  const invoiceId = Number(req.params.id)
  if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) return sendError(res, 400, 'رقم الفاتورة غير صالح.')
  const history = purchaseRevisionHistory(invoiceId)
  if (!history) return sendError(res, 404, 'فاتورة الشراء غير موجودة.')
  res.json(history)
})

api.get('/inventory/purchases/:id/revisions', requireAuth, allowRoles('admin', 'purchasing'), (req, res) => {
  const invoiceId = Number(req.params.id)
  if (!Number.isSafeInteger(invoiceId) || invoiceId < 1) return sendError(res, 400, 'رقم الفاتورة غير صالح.')
  const history = purchaseRevisionHistory(invoiceId)
  if (!history) return sendError(res, 404, 'فاتورة الشراء غير موجودة.')
  res.json(history)
})

api.put('/inventory/purchases/:id/revisions', requireAuth, allowRoles('admin'), (req, res) => {
  const invoiceId = Number(req.params.id)
  const reason = String(req.body?.reason || '').trim().slice(0, 1000)
  const expectedRevision = Number(req.body?.expectedRevision)
  const supplier = String(req.body?.supplier || '').trim().slice(0, 200)
  const notes = String(req.body?.notes || '').trim().slice(0, 2000)
  const requestedItems = Array.isArray(req.body?.items) ? req.body.items : []
  const items = requestedItems.map((item) => {
    const unitCostCents = parseCurrencyCents(item?.unitCost, { allowZero: true })
    const rawMaterialId = item?.materialId == null || item.materialId === '' || Number(item.materialId) === 0
      ? null : Number(item.materialId)
    return { ...item, materialId: rawMaterialId, unitCostCents }
  })
  if (!Number.isSafeInteger(invoiceId) || invoiceId < 1 || !reason || !Number.isSafeInteger(expectedRevision)
    || expectedRevision < 0 || !items.length || items.length > 200 || items.some((item) =>
      (item.materialId !== null && (!Number.isSafeInteger(item.materialId) || item.materialId < 1))
      || (item.materialId === null && (!String(item.name || '').trim() || !String(item.unit || '').trim()))
      || !Number.isSafeInteger(Number(item.quantity)) || Number(item.quantity) <= 0 || item.unitCostCents === null)) {
    return sendError(res, 400, 'تحقق من رقم الفاتورة ورقم المراجعة والسبب وبنود المخزون والكميات والأسعار.')
  }
  const totalCentsBig = items.reduce((sum, item) => sum + BigInt(Number(item.quantity)) * BigInt(item.unitCostCents), 0n)
  if (totalCentsBig <= 0n || totalCentsBig > BigInt(Number.MAX_SAFE_INTEGER)) {
    return sendError(res, 400, 'إجمالي الفاتورة المعدّلة يتجاوز الحد المالي المدعوم أو يساوي صفرًا.')
  }
  const totalCents = Number(totalCentsBig)
  const total = currencyAmountFromCents(totalCents)
  if (total === null) return sendError(res, 400, 'إجمالي الفاتورة يتجاوز دقة المبالغ المالية المدعومة.')

  try {
    const revise = db.transaction(() => {
      const invoice = db.prepare(`SELECT * FROM invoices WHERE id=? AND kind='purchase' AND deleted_at IS NULL`).get(invoiceId)
      if (!invoice) throw apiError(404, 'فاتورة الشراء غير موجودة.')
      const currentRevision = currentPurchaseRevision(invoiceId)
      const currentRevisionNumber = currentRevision?.revision_number || 0
      if (expectedRevision !== currentRevisionNumber) throw apiError(409, 'تغيّرت الفاتورة منذ فتح شاشة المراجعة؛ أعد تحميلها قبل الحفظ.')
      const before = currentPurchaseSnapshot(invoice)
      const eligibility = purchaseRevisionEligibility(invoice, before)
      if (!eligibility.eligible) throw apiError(409, eligibility.reason)
      const oldTotalCents = Math.round(Number(invoice.total) * 100)
      const cashDeltaCents = totalCents - oldTotalCents
      if (cashDeltaCents < 0 && req.body?.supplierRefundReceived !== true) {
        throw apiError(400, 'أكد استلام المورد فرق التخفيض قبل حفظ المراجعة.')
      }
      if (cashDeltaCents > 0 && cashboxBalanceCents() < cashDeltaCents) {
        throw apiError(409, 'رصيد صندوق المصنع لا يكفي لسداد فرق الزيادة في الفاتورة.')
      }

      const outputItems = []
      for (const item of items) {
        const selectedMaterial = item.materialId == null ? null
          : db.prepare('SELECT * FROM materials WHERE id=? AND active=1 AND deleted_at IS NULL').get(item.materialId)
        if (item.materialId !== null && !selectedMaterial) throw apiError(400, `الخامة غير موجودة: ${item.materialId}`)
        if (selectedMaterial) assertMaterialUnlocked(selectedMaterial.id)
        const variant = {
          name: String(item.name ?? selectedMaterial?.name ?? '').trim(),
          specification: String(item.specification ?? selectedMaterial?.specification ?? '').trim().slice(0, 300),
          unit: String(item.unit ?? selectedMaterial?.unit ?? '').trim(),
          unitCostCents: item.unitCostCents,
        }
        if (!variant.name || !variant.unit) throw apiError(400, 'اسم الخامة والمواصفة والوحدة مطلوبة.')
        const variantKey = materialVariantKey(variant)
        let material = db.prepare('SELECT * FROM materials WHERE variant_key=?').get(variantKey)
        if (material) {
          assertMaterialUnlocked(material.id)
          if (material.deleted_at || !material.active) {
            db.prepare('UPDATE materials SET active=1,deleted_at=NULL WHERE id=?').run(material.id)
            material = db.prepare('SELECT * FROM materials WHERE id=?').get(material.id)
          }
        } else {
          const materialCode = nextCode('material', 'MAT')
          const inserted = db.prepare(`INSERT INTO materials(code,name,specification,unit,stock,unit_cost,min_stock,active,sub_stock,variant_key)
            VALUES (?,?,?,?,0,?,?,1,0,?)`).run(materialCode, variant.name, variant.specification, variant.unit,
            item.unitCostCents / 100, selectedMaterial?.min_stock || 0, variantKey)
          material = db.prepare('SELECT * FROM materials WHERE id=?').get(inserted.lastInsertRowid)
        }
        outputItems.push({ materialId: material.id, code: material.code, name: material.name,
          specification: material.specification || '', unit: material.unit, quantity: Number(item.quantity),
          unitCostCents: item.unitCostCents, unitCost: item.unitCostCents / 100,
          lineTotalCents: Number(item.quantity) * item.unitCostCents })
      }

      const after = { supplier, notes, employeeId: invoice.employee_id || null, totalCents, items: outputItems }
      const insertedRevision = db.prepare(`INSERT INTO purchase_invoice_revisions(invoice_id,revision_number,reason,
        previous_values,revised_values,cash_delta_cents,created_by) VALUES (?,?,?,?,?,?,?)`)
        .run(invoiceId, currentRevisionNumber + 1, reason, JSON.stringify(before), JSON.stringify(after), cashDeltaCents, req.user.id)
      const revisionId = insertedRevision.lastInsertRowid
      const sourceId = String(revisionId)
      const movementIds = []
      const oldByMaterial = new Map()
      for (const item of before.items) {
        const materialId = Number(item.materialId)
        oldByMaterial.set(materialId, (oldByMaterial.get(materialId) || 0) + Number(item.quantity))
      }
      for (const [materialId, quantity] of oldByMaterial) {
        const material = db.prepare('SELECT stock FROM materials WHERE id=?').get(materialId)
        if (!material || Number(material.stock) + 0.000001 < quantity) throw apiError(409, 'رصيد المخزون لا يطابق دفعات الفاتورة؛ رُفضت المراجعة.')
        const movementId = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,invoice_id,source_type,source_id)
          VALUES (?,'adjustment',?,?,?,?,'main',?,'purchase_invoice_revision',?)`).run(materialId, -quantity,
          invoice.code, `عكس دفعة قبل مراجعة فاتورة ${invoice.code}: ${reason}`, req.user.id, invoiceId, sourceId).lastInsertRowid
        for (const lot of eligibility.lots.filter((row) => Number(row.material_id) === materialId)) {
          // Reversing an untouched receipt is not a stock issue; leave the FIFO
          // consumption ledger reserved for actual issue movements.
          db.prepare('UPDATE inventory_lots SET remaining_quantity=0 WHERE id=?').run(lot.id)
        }
        db.prepare('UPDATE materials SET stock=stock-? WHERE id=?').run(quantity, materialId)
        movementIds.push({ movementId, materialId, quantity: -quantity })
      }

      const newByMaterial = new Map()
      for (const item of outputItems) newByMaterial.set(item.materialId, (newByMaterial.get(item.materialId) || 0) + item.quantity)
      for (const [materialId, quantity] of newByMaterial) {
        db.prepare('UPDATE materials SET stock=stock+? WHERE id=?').run(quantity, materialId)
        const movementId = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,invoice_id,source_type,source_id)
          VALUES (?,'purchase',?,?,?,?, 'main',?,'purchase_invoice_revision',?)`).run(materialId, quantity,
          invoice.code, `توريد دفعة المراجعة ${currentRevisionNumber + 1} للفاتورة ${invoice.code}`, req.user.id, invoiceId, sourceId).lastInsertRowid
        movementIds.push({ movementId, materialId, quantity })
      }
      for (const item of outputItems) {
        createInventoryLot({ materialId: item.materialId, invoiceId, sourceType: 'purchase_invoice_revision', sourceId: revisionId,
          warehouse: 'main', quantity: item.quantity, unitCostCents: item.unitCostCents })
      }

      db.prepare(`UPDATE invoices SET supplier=?,notes=?,total=?,paid_total=?,remaining=0,payment_status='paid' WHERE id=?`)
        .run(supplier, notes, total, total, invoiceId)

      let treasuryTransactionId = null
      let journal = null
      if (cashDeltaCents !== 0) {
        const amountCents = Math.abs(cashDeltaCents)
        const isIncrease = cashDeltaCents > 0
        const amount = currencyAmountFromCents(amountCents)
        treasuryTransactionId = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,invoice_id,created_by,employee_id)
          VALUES (?,?,?,?,?,?,?,?)`).run(isIncrease ? 'expense' : 'income', amount,
          isIncrease ? 'زيادة قيمة فاتورة شراء معدّلة' : 'رد فرق تعديل فاتورة شراء', invoice.code, reason,
          invoiceId, req.user.id, invoice.employee_id).lastInsertRowid
        journal = queueJournalEntry(db, {
          sourceType: 'purchase_invoice_revision', sourceId: revisionId, sourceKey: `purchase-invoice-revision:${revisionId}`,
          description: `تسوية فرق مراجعة فاتورة شراء ${invoice.code}`, createdBy: req.user.id,
          postings: isIncrease ? [
            { mappingKey: 'inventory', debitCents: amountCents, description: `زيادة مخزون ${invoice.code}` },
            { mappingKey: 'factory_cashbox', creditCents: amountCents, description: `سداد فرق ${invoice.code}` },
          ] : [
            { mappingKey: 'factory_cashbox', debitCents: amountCents, description: `استرداد فرق ${invoice.code}` },
            { mappingKey: 'inventory', creditCents: amountCents, description: `تخفيض قيمة مخزون ${invoice.code}` },
          ],
        })
      }
      db.prepare(`UPDATE purchase_invoice_revisions SET stock_movements=?,treasury_transaction_id=?,journal_entry_id=? WHERE id=?`)
        .run(JSON.stringify(movementIds), treasuryTransactionId, journal?.id || null, revisionId)
      audit(req.user.id, 'revise-purchase', 'invoice', invoiceId, `revision=${currentRevisionNumber + 1}; journal=${journal?.id || ''}`,
        before, { ...after, revisionId, revisionNumber: currentRevisionNumber + 1, cashDeltaCents,
          treasuryTransactionId, journalEntryId: journal?.id || null, stockMovements: movementIds })
      return { id: invoiceId, code: invoice.code, revisionId, revisionNumber: currentRevisionNumber + 1,
        total, cashDeltaCents, treasuryTransactionId, journalEntryId: journal?.id || null, items: outputItems }
    })
    const result = revise.immediate()
    io.to('role:treasury').emit('treasury:purchase-revised', result)
    res.status(201).json(result)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.get('/other-invoices', requireAuth, allowRoles('admin', 'purchasing'), (_req, res) => {
  const invoices = db.prepare(`SELECT oi.*,e.name AS employee_name,u.full_name AS created_by_name
    FROM other_invoices oi LEFT JOIN employees e ON e.id=oi.employee_id LEFT JOIN users u ON u.id=oi.created_by
    WHERE oi.deleted_at IS NULL ORDER BY oi.id DESC LIMIT 200`).all()
  const lines = db.prepare(`SELECT it.*,ec.name AS category FROM other_invoice_items it
    JOIN expense_categories ec ON ec.id=it.category_id WHERE it.invoice_id=? ORDER BY it.id`)
  res.json(invoices.map((invoice) => ({ ...invoice, lines: lines.all(invoice.id) })))
})

api.post('/inventory/purchases/:id/correction', requireAuth, allowRoles('admin'), (req, res) => {
  const invoiceId = Number(req.params.id)
  const reason = String(req.body?.reason || '').trim().slice(0, 1000)
  if (!Number.isSafeInteger(invoiceId) || invoiceId < 1 || !reason) return sendError(res, 400, 'رقم الفاتورة وسبب التصحيح مطلوبان.')
  if (req.body?.supplierRefundReceived !== true) return sendError(res, 400, 'أكد استلام رد مبلغ المورد قبل التصحيح.')
  try {
    const correction = db.transaction(() => {
      const invoice = db.prepare(`SELECT * FROM invoices WHERE id=? AND kind='purchase' AND deleted_at IS NULL`).get(invoiceId)
      if (!invoice) throw apiError(404, 'فاتورة الشراء غير موجودة.')
      if (invoice.status === 'corrected' || db.prepare('SELECT 1 FROM purchase_corrections WHERE invoice_id=?').get(invoiceId)) {
        throw apiError(409, 'سبق تصحيح هذه الفاتورة.')
      }
      if (Math.round(Number(invoice.paid_total || 0) * 100) !== Math.round(Number(invoice.total) * 100)) {
        throw apiError(409, 'لا يمكن تصحيح فاتورة شراء قبل استيفاء دفعها بالكامل.')
      }
      const snapshot = currentPurchaseSnapshot(invoice)
      const groupedItems = new Map()
      for (const item of snapshot.items) groupedItems.set(Number(item.materialId),
        (groupedItems.get(Number(item.materialId)) || 0) + Number(item.quantity))
      const items = [...groupedItems].map(([material_id, quantity]) => ({ material_id, quantity }))
      if (!items.length) throw apiError(409, 'لا توجد بنود مخزون لإثبات مصدر الفاتورة.')
      const activeSource = currentPurchaseLotSource(invoiceId)
      for (const item of items) {
        assertMaterialUnlocked(item.material_id)
        const lots = db.prepare(`SELECT COALESCE(SUM(received_quantity),0) AS received,
            COALESCE(SUM(remaining_quantity),0) AS remaining
          FROM inventory_lots WHERE invoice_id=? AND material_id=? AND warehouse='main' AND source_type=? AND source_id=?`)
          .get(invoiceId, item.material_id, activeSource.sourceType, activeSource.sourceId)
        if (Math.abs(Number(lots.received) - Number(item.quantity)) > 0.000001
          || Math.abs(Number(lots.remaining) - Number(item.quantity)) > 0.000001) {
          throw apiError(409, `تعذر إثبات أن كامل رصيد فاتورة ${invoice.code} ما زال غير مصروف؛ رُفض التصحيح.`)
        }
      }
      const totalCents = Math.round(Number(invoice.total) * 100)
      const amount = currencyAmountFromCents(totalCents)
      const refundTransaction = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,invoice_id,created_by,employee_id)
        VALUES ('income',?,'رد مشتريات',?,?,?, ?,?)`).run(amount, invoice.code, reason, invoice.id, req.user.id, invoice.employee_id)
      const inserted = db.prepare(`INSERT INTO purchase_corrections(invoice_id,reason,refunded_cents,treasury_transaction_id,created_by)
        VALUES (?,?,?,?,?)`).run(invoice.id, reason, totalCents, refundTransaction.lastInsertRowid, req.user.id)
      const correctionId = inserted.lastInsertRowid
      const movement = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,invoice_id,source_type,source_id)
        VALUES (?,'adjustment',?,?,?,?,'main',?,'purchase_correction',?)`)
      for (const item of items) {
        const quantity = Number(item.quantity)
        const material = db.prepare('SELECT stock FROM materials WHERE id=?').get(item.material_id)
        if (!material || Number(material.stock) + 0.000001 < quantity) throw apiError(409, 'رصيد المخزون لا يطابق إثبات التوريد؛ رُفض التصحيح.')
        const movementId = movement.run(item.material_id, -quantity, invoice.code, `رد كامل غير مصروف من فاتورة ${invoice.code}: ${reason}`,
          req.user.id, invoice.id, String(correctionId)).lastInsertRowid
        db.prepare(`UPDATE inventory_lots SET remaining_quantity=0 WHERE invoice_id=? AND material_id=? AND warehouse='main' AND source_type=? AND source_id=?`)
          .run(invoice.id, item.material_id, activeSource.sourceType, activeSource.sourceId)
        db.prepare('UPDATE materials SET stock=stock-? WHERE id=?').run(quantity, item.material_id)
        // Keep a consumption link so a correction can never be repeated against the same source lot.
        const lots = db.prepare(`SELECT id,received_quantity FROM inventory_lots WHERE invoice_id=? AND material_id=? AND warehouse='main'
          AND source_type=? AND source_id=? ORDER BY id`)
          .all(invoice.id, item.material_id, activeSource.sourceType, activeSource.sourceId)
        for (const lot of lots) {
          const already = db.prepare('SELECT COALESCE(SUM(quantity),0) AS quantity FROM inventory_lot_consumptions WHERE lot_id=?').get(lot.id).quantity
          const remaining = Math.max(0, Number(lot.received_quantity) - Number(already))
          if (remaining > 0) db.prepare('INSERT INTO inventory_lot_consumptions(lot_id,movement_id,quantity) VALUES (?,?,?)')
            .run(lot.id, movementId, remaining)
        }
      }
      db.prepare(`UPDATE invoices SET status='corrected' WHERE id=?`).run(invoice.id)
      const originalJournal = db.prepare(`SELECT id FROM journal_entries WHERE source_key=?`).get(`purchase-invoice:${invoice.id}`)
      const journal = queueJournalEntry(db, {
        sourceType: 'purchase_correction', sourceId: correctionId, sourceKey: `purchase-correction:${correctionId}`,
        description: `عكس فاتورة شراء ${invoice.code}`, createdBy: req.user.id, reversesEntryId: originalJournal?.id || null,
        postings: [
          { mappingKey: 'factory_cashbox', debitCents: totalCents, description: `استرداد مبلغ ${invoice.code}` },
          { mappingKey: 'inventory', creditCents: totalCents, description: `عكس مخزون ${invoice.code}` },
        ],
      })
      db.prepare('UPDATE purchase_corrections SET journal_entry_id=? WHERE id=?').run(journal.id, correctionId)
      audit(req.user.id, 'correct-purchase', 'invoice', invoice.id, invoice.code,
        { status: invoice.status, total: invoice.total, stockProvenance: 'unissued' },
        { status: 'corrected', refundedAmount: amount, reason, correctionId, journalEntryId: journal.id })
      return { id: correctionId, invoiceId: invoice.id, code: invoice.code, refundedAmount: amount, journalEntryId: journal.id }
    })()
    io.to('role:treasury').emit('treasury:purchase-corrected', correction)
    res.status(201).json(correction)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

function invoiceEvidenceMime(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) return 'application/pdf'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  if (buffer.length >= 6 && ['GIF87a','GIF89a'].includes(buffer.toString('ascii', 0, 6))) return 'image/gif'
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp'
  return null
}

api.get('/inventory/purchases/:id/attachments', requireAuth, allowRoles('admin', 'purchasing'), (req, res) => {
  const invoiceId = Number(req.params.id)
  const invoice = db.prepare(`SELECT id,code FROM invoices WHERE id=? AND kind='purchase' AND deleted_at IS NULL`).get(invoiceId)
  if (!invoice) return sendError(res, 404, 'فاتورة الشراء غير موجودة.')
  res.json(db.prepare(`SELECT id,original_name,mime_type,byte_size,created_at FROM invoice_attachments WHERE invoice_id=? ORDER BY id`)
    .all(invoiceId).map((row) => ({ ...row, downloadUrl: `/api/inventory/purchases/${invoiceId}/attachments/${row.id}` })))
})

api.post('/inventory/purchases/:id/attachments', requireAuth, allowRoles('admin', 'purchasing'), invoiceEvidenceUpload.single('file'), asyncRoute(async (req, res) => {
  const invoiceId = Number(req.params.id)
  if (!req.file?.buffer?.length) return sendError(res, 400, 'اختر ملف صورة أو PDF.')
  const invoice = db.prepare(`SELECT id,code FROM invoices WHERE id=? AND kind='purchase' AND deleted_at IS NULL`).get(invoiceId)
  if (!invoice) return sendError(res, 404, 'فاتورة الشراء غير موجودة.')
  const mimeType = invoiceEvidenceMime(req.file.buffer)
  if (!mimeType) return sendError(res, 415, 'محتوى الملف لا يطابق صورة مدعومة أو PDF.')
  const directoryRelative = `Invoices/${safeSegment(invoice.code)}/evidence`
  const directory = absoluteStoragePath(directoryRelative)
  if (!directory) return sendError(res, 400, 'مسار حفظ المرفق غير صالح.')
  await fsExtra.ensureDir(directory)
  if (await storagePathUsesSymlink(directory)) return sendError(res, 400, 'مسار المرفق يمر عبر رابط رمزي غير مسموح.')
  const extensionByMime = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png',
    'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp' }
  const fileName = `evidence-${crypto.randomUUID()}${extensionByMime[mimeType]}`
  const absolutePath = path.join(directory, fileName)
  const storagePath = relativeStoragePath(absolutePath)
  try {
    await fs.promises.writeFile(absolutePath, req.file.buffer, { flag: 'wx', mode: 0o600 })
    if (await storagePathUsesSymlink(absolutePath)) throw apiError(400, 'تعذر حفظ الملف في مسار آمن.')
    const attachment = db.transaction(() => {
      const inserted = db.prepare(`INSERT INTO invoice_attachments(invoice_id,storage_path,original_name,mime_type,byte_size)
        VALUES (?,?,?,?,?)`).run(invoice.id, storagePath, path.basename(req.file.originalname).slice(0, 200), mimeType, req.file.size)
      audit(req.user.id, 'attach-evidence', 'invoice', invoice.id, invoice.code, null,
        { attachmentId: inserted.lastInsertRowid, fileName: path.basename(req.file.originalname), mimeType, byteSize: req.file.size })
      return { id: inserted.lastInsertRowid, original_name: path.basename(req.file.originalname).slice(0, 200),
        mime_type: mimeType, byte_size: req.file.size, created_at: new Date().toISOString(),
        downloadUrl: `/api/inventory/purchases/${invoice.id}/attachments/${inserted.lastInsertRowid}` }
    })()
    res.status(201).json(attachment)
  } catch (error) {
    await fs.promises.rm(absolutePath, { force: true }).catch(() => {})
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'هذا المرفق مسجل بالفعل.')
    throw error
  }
}))

api.get('/inventory/purchases/:id/attachments/:attachmentId', requireAuth, allowRoles('admin', 'purchasing'), asyncRoute(async (req, res) => {
  const invoiceId = Number(req.params.id)
  const attachmentId = Number(req.params.attachmentId)
  const attachment = db.prepare(`SELECT a.* FROM invoice_attachments a JOIN invoices i ON i.id=a.invoice_id
    WHERE a.id=? AND a.invoice_id=? AND i.kind='purchase' AND i.deleted_at IS NULL`).get(attachmentId, invoiceId)
  if (!attachment) return sendError(res, 404, 'مرفق الفاتورة غير موجود.')
  const file = await safeStorageFile(attachment.storage_path)
  if (!file) return sendError(res, 404, 'ملف المرفق غير موجود.')
  res.set({ 'Content-Type': attachment.mime_type, 'Content-Length': String(attachment.byte_size),
    'Content-Disposition': `attachment; filename="${path.basename(attachment.original_name).replace(/[\r\n"\\]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).sendFile(file.absolutePath)
}))

api.get('/other-invoices/:id/attachments', requireAuth, allowRoles('admin', 'purchasing'), (req, res) => {
  const invoiceId = Number(req.params.id)
  const invoice = db.prepare(`SELECT id FROM other_invoices WHERE id=? AND deleted_at IS NULL`).get(invoiceId)
  if (!invoice) return sendError(res, 404, 'فاتورة المصروفات غير موجودة.')
  res.json(db.prepare(`SELECT id,original_name,mime_type,byte_size,created_at FROM other_invoice_attachments
    WHERE other_invoice_id=? ORDER BY id`).all(invoiceId).map((row) => ({
    ...row, downloadUrl: `/api/other-invoices/${invoiceId}/attachments/${row.id}`,
  })))
})

api.post('/other-invoices/:id/attachments', requireAuth, allowRoles('admin', 'purchasing'), invoiceEvidenceUpload.single('file'), asyncRoute(async (req, res) => {
  const invoiceId = Number(req.params.id)
  if (!req.file?.buffer?.length) return sendError(res, 400, 'اختر ملف صورة أو PDF.')
  const invoice = db.prepare(`SELECT id,code FROM other_invoices WHERE id=? AND deleted_at IS NULL`).get(invoiceId)
  if (!invoice) return sendError(res, 404, 'فاتورة المصروفات غير موجودة.')
  const mimeType = invoiceEvidenceMime(req.file.buffer)
  if (!mimeType) return sendError(res, 415, 'محتوى الملف لا يطابق صورة مدعومة أو PDF.')
  const directory = absoluteStoragePath(`OtherInvoices/${safeSegment(invoice.code)}/evidence`)
  if (!directory) return sendError(res, 400, 'مسار حفظ المرفق غير صالح.')
  await fsExtra.ensureDir(directory)
  if (await storagePathUsesSymlink(directory)) return sendError(res, 400, 'مسار المرفق يمر عبر رابط رمزي غير مسموح.')
  const extensionByMime = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png',
    'image/webp': '.webp', 'image/gif': '.gif', 'image/bmp': '.bmp' }
  const absolutePath = path.join(directory, `evidence-${crypto.randomUUID()}${extensionByMime[mimeType]}`)
  const storagePath = relativeStoragePath(absolutePath)
  try {
    await fs.promises.writeFile(absolutePath, req.file.buffer, { flag: 'wx', mode: 0o600 })
    if (await storagePathUsesSymlink(absolutePath)) throw apiError(400, 'تعذر حفظ الملف في مسار آمن.')
    const attachment = db.transaction(() => {
      const inserted = db.prepare(`INSERT INTO other_invoice_attachments(other_invoice_id,storage_path,original_name,mime_type,byte_size)
        VALUES (?,?,?,?,?)`).run(invoice.id, storagePath, path.basename(req.file.originalname).slice(0, 200), mimeType, req.file.size)
      audit(req.user.id, 'attach-evidence', 'other-invoice', invoice.id, invoice.code, null,
        { attachmentId: inserted.lastInsertRowid, fileName: path.basename(req.file.originalname), mimeType, byteSize: req.file.size })
      return { id: inserted.lastInsertRowid, original_name: path.basename(req.file.originalname).slice(0, 200),
        mime_type: mimeType, byte_size: req.file.size, created_at: new Date().toISOString(),
        downloadUrl: `/api/other-invoices/${invoice.id}/attachments/${inserted.lastInsertRowid}` }
    })()
    res.status(201).json(attachment)
  } catch (error) {
    await fs.promises.rm(absolutePath, { force: true }).catch(() => {})
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'هذا المرفق مسجل بالفعل.')
    throw error
  }
}))

api.get('/other-invoices/:id/attachments/:attachmentId', requireAuth, allowRoles('admin', 'purchasing'), asyncRoute(async (req, res) => {
  const invoiceId = Number(req.params.id)
  const attachmentId = Number(req.params.attachmentId)
  const attachment = db.prepare(`SELECT a.* FROM other_invoice_attachments a JOIN other_invoices i ON i.id=a.other_invoice_id
    WHERE a.id=? AND a.other_invoice_id=? AND i.deleted_at IS NULL`).get(attachmentId, invoiceId)
  if (!attachment) return sendError(res, 404, 'مرفق الفاتورة غير موجود.')
  const file = await safeStorageFile(attachment.storage_path)
  if (!file) return sendError(res, 404, 'ملف المرفق غير موجود.')
  res.set({ 'Content-Type': attachment.mime_type, 'Content-Length': String(attachment.byte_size),
    'Content-Disposition': `attachment; filename="${path.basename(attachment.original_name).replace(/[\r\n"\\]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store' }).sendFile(file.absolutePath)
}))

api.post('/other-invoices', requireAuth, allowRoles('admin', 'purchasing'), createRateLimiter('POST /other-invoices'), (req, res) => {
  let employeeId
  try { employeeId = resolveEmployeeId(req.body?.employeeId) }
  catch (error) { return sendError(res, error.status || 400, error.message) }
  const requestedLines = Array.isArray(req.body?.items) ? req.body.items : []
  const items = requestedLines.map((line) => ({
    description: String(line?.description || '').trim().slice(0, 500),
    category: String(line?.category || '').trim().slice(0, 150),
    amountCents: parseCurrencyCents(line?.amount),
  }))
  if (!items.length || items.length > 100 || items.some((line) => !line.description || !line.category || line.amountCents === null)) {
    return sendError(res, 400, 'أضف سطرًا واحدًا على الأقل بوصف ومبلغ موجب وتصنيف صالح.')
  }
  const totalCents = items.reduce((sum, line) => sum + line.amountCents, 0)
  if (!Number.isSafeInteger(totalCents)) return sendError(res, 400, 'إجمالي الفاتورة يتجاوز الحد المالي المدعوم.')
  const total = currencyAmountFromCents(totalCents)
  const supplier = String(req.body?.supplier || '').trim().slice(0, 200)
  const notes = String(req.body?.notes || '').trim().slice(0, 2000)
  try {
    const outcome = createIdempotently(req, 'POST /other-invoices', () => {
      if (cashboxBalanceCents() < totalCents) throw apiError(409, 'رصيد صندوق المصنع لا يكفي لسداد الفاتورة بالكامل.')
      const code = nextCode('other_invoice', 'EXP')
      const invoiceId = db.prepare(`INSERT INTO other_invoices(code,supplier,employee_id,total_cents,notes,created_by)
        VALUES (?,?,?,?,?,?)`).run(code, supplier, employeeId, totalCents, notes, req.user.id).lastInsertRowid
      const postings = []
      const insertLine = db.prepare('INSERT INTO other_invoice_items(invoice_id,description,amount_cents,category_id) VALUES (?,?,?,?)')
      for (const line of items) {
        const normalizedCategory = normalize(line.category)
        let category = db.prepare('SELECT * FROM expense_categories WHERE normalized_name=?').get(normalizedCategory)
        if (!category) {
          const inserted = db.prepare('INSERT INTO expense_categories(name,normalized_name) VALUES (?,?)').run(line.category, normalizedCategory)
          category = db.prepare('SELECT * FROM expense_categories WHERE id=?').get(inserted.lastInsertRowid)
          const mappingKey = `expense_category:${category.id}`
          db.prepare('INSERT OR IGNORE INTO account_mappings(mapping_key,account_id,approved) VALUES (?,NULL,0)').run(mappingKey)
        }
        insertLine.run(invoiceId, line.description, line.amountCents, category.id)
        postings.push({ mappingKey: `expense_category:${category.id}`, debitCents: line.amountCents,
          description: `${line.category}: ${line.description}` })
      }
      postings.push({ mappingKey: 'factory_cashbox', creditCents: totalCents, description: `سداد ${code}` })
      const treasuryId = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,created_by,employee_id)
        VALUES ('expense',?,'فاتورة مصروفات أخرى',?,?,?,?)`).run(total, code, notes, req.user.id, employeeId).lastInsertRowid
      queueJournalEntry(db, { sourceType: 'other_invoice', sourceId: invoiceId, sourceKey: `other-invoice:${invoiceId}`,
        description: `فاتورة مصروفات ${code}`, createdBy: req.user.id, postings })
      audit(req.user.id, 'other-invoice-paid', 'other-invoice', invoiceId, `${code}; treasury=${treasuryId}`,
        null, { code, supplier, employeeId, total, items })
      return { id: invoiceId, code, total, employeeId, supplier, items }
    })
    if (outcome.error) return sendError(res, 400, outcome.error)
    if (outcome.conflict) return sendError(res, 409, 'استُخدم مفتاح منع التكرار خلال آخر 5 ثوانٍ لطلب مختلف.')
    res.setHeader('Idempotency-Replayed', String(outcome.replayed))
    return res.status(outcome.status).json(outcome.body)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.post('/inventory/sales', requireAuth, allowRoles('admin', 'sales'), createRateLimiter('POST /inventory/sales'), (req, res) => {
  const clientId = Number(req.body?.clientId)
  const hasOrderId = Boolean(String(req.body?.orderId || '').trim())
  const orderId = hasOrderId ? Number(req.body.orderId) : null
  if (hasOrderId && (!Number.isInteger(orderId) || orderId <= 0)) return sendError(res, 400, 'رقم أمر التشغيل غير صالح.')
  const order = orderId ? db.prepare('SELECT * FROM orders WHERE id=? AND deleted_at IS NULL').get(orderId) : null
  const subtotalCents = parseCurrencyCents(req.body?.subtotal ?? req.body?.total ?? order?.selling_price)
  if (!Number.isInteger(clientId) || subtotalCents === null) return sendError(res, 400, 'اختر العميل وأدخل قيمة فاتورة صحيحة أكبر من صفر وبحد أقصى منزلتين عشريتين.')
  const customTaxRate = req.body?.customTaxRate === true
  const taxRateBasisPoints = customTaxRate
    ? parseCurrencyCents(req.body?.customTaxPercent, { allowZero: true })
    : req.body?.taxRateBasisPoints === undefined
      ? (req.body?.taxRate == null || req.body?.taxRate === '' ? 0 : parseCurrencyCents(req.body.taxRate, { allowZero: true }))
      : Number(req.body.taxRateBasisPoints)
  if (!Number.isSafeInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 100_000) {
    return sendError(res, 400, 'نسبة ضريبة المبيعات غير صالحة.')
  }
  if (!customTaxRate && !db.prepare('SELECT id FROM sales_tax_rates WHERE rate_basis_points=? AND active=1').get(taxRateBasisPoints)) {
    return sendError(res, 400, 'نسبة الضريبة غير معتمدة في إعدادات المحاسبة.')
  }
  const taxCents = salesTaxCents(subtotalCents, taxRateBasisPoints)
  const totalCents = subtotalCents + taxCents
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) return sendError(res, 400, 'إجمالي فاتورة المبيعات يتجاوز الدقة المدعومة.')
  const subtotal = currencyAmountFromCents(subtotalCents)
  const tax = currencyAmountFromCents(taxCents)
  const total = currencyAmountFromCents(totalCents)
  const saleType = req.body?.saleType === 'cash' ? 'cash' : 'credit'
  const requestedReceiptCents = req.body?.initialReceipt == null || req.body.initialReceipt === ''
    ? 0 : parseCurrencyCents(req.body.initialReceipt, { allowZero: true })
  if (requestedReceiptCents === null || requestedReceiptCents > 0) {
    return sendError(res, 400, 'يسجل البيع النقدي كامل الإجمالي عند الحفظ؛ أما البيع الآجل فيُحصّل عبر سند قبض مستقل.')
  }
  const client = db.prepare('SELECT id FROM clients WHERE id=? AND deleted_at IS NULL').get(clientId)
  if (!client) return sendError(res, 404, 'العميل غير موجود.')
  if (orderId && (!order || order.client_id !== clientId)) return sendError(res, 400, 'أمر التشغيل المحدد غير موجود أو لا يتبع العميل المختار.')
  try {
    const outcome = createIdempotently(req, 'POST /inventory/sales', () => {
      const code = nextCode('invoice', 'INV')
      const paidCents = saleType === 'cash' ? totalCents : 0
      const remainingCents = totalCents - paidCents
      const paidTotal = currencyAmountFromCents(paidCents)
      const remaining = currencyAmountFromCents(remainingCents)
      const paymentStatus = remainingCents === 0 ? 'paid' : paidCents > 0 ? 'partial' : 'unpaid'
      const invoiceId = db.prepare(`INSERT INTO invoices(code,kind,client_id,total,paid_total,remaining,payment_status,notes,created_by,status,order_id,
          subtotal_cents,tax_cents,tax_rate_basis_points,sale_type)
        VALUES (?,'sales',?,?,?,?,?,?,?,'approved',?,?,?,?,?)`)
        .run(code, clientId, total, paidTotal, remaining, paymentStatus, String(req.body.notes || ''), req.user.id, orderId,
          subtotalCents, taxCents, taxRateBasisPoints, saleType).lastInsertRowid
      let receiptId = null
      if (paidCents > 0) {
        receiptId = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,invoice_id,created_by,worker_id,employee_id)
          VALUES ('income',?,'سند قبض فاتورة',?,?,?, ?,NULL,NULL)`).run(total, code,
          String(req.body.notes || '').slice(0, 2000), invoiceId, req.user.id).lastInsertRowid
      }
      const postings = []
      if (paidCents > 0) postings.push({ mappingKey: 'factory_cashbox', debitCents: paidCents, description: `تحصيل فاتورة ${code}` })
      if (remainingCents > 0) postings.push({ mappingKey: 'customer_receivables', debitCents: remainingCents, description: `ذمم فاتورة ${code}` })
      postings.push({ mappingKey: 'sales_revenue', creditCents: subtotalCents, description: `مبيعات قبل الضريبة ${code}` })
      if (taxCents > 0) postings.push({ mappingKey: 'sales_tax_payable', creditCents: taxCents, description: `ضريبة مبيعات ${code}` })
      queueJournalEntry(db, { sourceType: 'sales_invoice', sourceId: invoiceId, sourceKey: `sales-invoice:${invoiceId}`,
        description: `فاتورة مبيعات ${code}`, createdBy: req.user.id, postings })
      audit(req.user.id, 'sale', 'invoice', invoiceId, code, null, {
        kind: 'sales', subtotal, tax, total, taxRateBasisPoints, saleType, paidTotal, remaining, paymentStatus, receiptId,
      })
      return { id: invoiceId, code, subtotal, tax, taxRateBasisPoints, total, paidTotal, remaining, paymentStatus, saleType, receiptId }
    })
    if (outcome.error) return sendError(res, 400, outcome.error)
    if (outcome.conflict) return sendError(res, 409, 'استُخدم مفتاح منع التكرار خلال آخر 5 ثوانٍ لطلب مختلف.')
    res.setHeader('Idempotency-Replayed', String(outcome.replayed))
    if (!outcome.replayed) io.to('role:treasury').emit('treasury:invoice-approved', {
      id: outcome.body.id, code: outcome.body.code, kind: 'sales', total: outcome.body.total,
    })
    if (!outcome.replayed && outcome.body.receiptId) io.to('role:treasury').emit('treasury:payment-recorded', {
      id: outcome.body.receiptId, invoiceId: outcome.body.id, kind: 'income', amount: outcome.body.total,
      paidTotal: outcome.body.paidTotal, remaining: outcome.body.remaining, paymentStatus: outcome.body.paymentStatus,
    })
    res.status(outcome.status).json(outcome.body)
  } catch (error) {
    return sendError(res, error.status || 400, error.message)
  }
})

api.get('/sales/invoices', requireAuth, allowRoles('admin', 'sales'), (req, res) => {
  const invoices = db.prepare(`SELECT i.id,i.code,i.kind,i.total,i.paid_total,i.remaining,i.payment_status,i.notes,i.status,i.created_at,
    i.subtotal_cents,i.tax_cents,i.tax_rate_basis_points,i.sale_type,
    c.name AS client_name,o.code AS order_code
    FROM invoices i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN orders o ON o.id=i.order_id
    WHERE i.kind='sales' AND i.deleted_at IS NULL ORDER BY i.id DESC LIMIT 200`).all()
  res.json(invoices)
})

api.post('/treasury/invoices/:id/payments', requireAuth, allowRoles('admin', 'sales', 'purchasing'), (req, res) => {
  const amountCents = parseCurrencyCents(req.body?.amount)
  const amount = amountCents === null ? null : currencyAmountFromCents(amountCents)
  if (amount === null) {
    return sendError(res, 400, 'أدخل مبلغًا صحيحًا أكبر من صفر وبحد أقصى منزلتين عشريتين.')
  }
  try {
    const payment = db.transaction(() => {
      const invoice = db.prepare('SELECT * FROM invoices WHERE id=? AND deleted_at IS NULL').get(req.params.id)
      if (!invoice) throw Object.assign(new Error('الفاتورة غير موجودة.'), { status: 404 })
      if ((req.user.role === 'sales' && invoice.kind !== 'sales') || (req.user.role === 'purchasing' && invoice.kind !== 'purchase')) {
        throw Object.assign(new Error('ليست لديك صلاحية لتسجيل دفعة لهذا النوع من الفواتير.'), { status: 403 })
      }
      const employeeId = resolveEmployeeId(req.body?.employeeId ?? invoice.employee_id ?? null)
      const remainingBeforeCents = Math.round(Number(invoice.remaining || 0) * 100)
      if (amountCents > remainingBeforeCents) throw Object.assign(new Error('مبلغ الدفعة أكبر من المبلغ المتبقي على الفاتورة.'), { status: 409 })
      const kind = invoice.kind === 'sales' ? 'income' : 'expense'
      if (kind === 'expense' && cashboxBalanceCents() < amountCents) {
        throw Object.assign(new Error('رصيد صندوق المصنع لا يكفي لتسجيل هذا السداد.'), { status: 409 })
      }
      const category = invoice.kind === 'sales' ? 'سند قبض فاتورة' : 'سند صرف فاتورة'
      const reference = String(req.body?.reference || invoice.code).slice(0, 120)
      const notes = String(req.body?.notes || '').slice(0, 2000)
      const result = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,invoice_id,created_by,worker_id,employee_id)
        VALUES (?,?,?,?,?,?,?,?,?)`).run(kind, amount, category, reference, notes, invoice.id, req.user.id, null, employeeId)
      const paidTotalCents = Math.min(Math.round(Number(invoice.total) * 100), Math.round(Number(invoice.paid_total || 0) * 100) + amountCents)
      const remainingCents = Math.max(0, Math.round(Number(invoice.total) * 100) - paidTotalCents)
      const paidTotal = currencyAmountFromCents(paidTotalCents)
      const remaining = currencyAmountFromCents(remainingCents)
      const paymentStatus = remainingCents === 0 ? 'paid' : paidTotalCents > 0 ? 'partial' : 'unpaid'
      db.prepare('UPDATE invoices SET paid_total=?,remaining=?,payment_status=? WHERE id=?')
        .run(paidTotal, remaining, paymentStatus, invoice.id)
      if (invoice.kind === 'sales') {
        queueJournalEntry(db, {
          sourceType: 'customer_receipt', sourceId: result.lastInsertRowid,
          sourceKey: `customer-receipt:${result.lastInsertRowid}`, description: `تحصيل ${invoice.code}`,
          createdBy: req.user.id,
          postings: [
            { mappingKey: 'factory_cashbox', debitCents: amountCents, description: `قبض ${invoice.code}` },
            { mappingKey: 'customer_receivables', creditCents: amountCents, description: `تسوية ذمم ${invoice.code}` },
          ],
        })
      }
      audit(req.user.id, kind === 'income' ? 'receipt' : 'payment', 'invoice', invoice.id, `voucher=${result.lastInsertRowid}; amount=${amount}`,
        { paidTotal: invoice.paid_total, remaining: invoice.remaining, paymentStatus: invoice.payment_status },
        { paidTotal, remaining, paymentStatus })
      return { id: result.lastInsertRowid, invoiceId: invoice.id, kind, amount, paidTotal, remaining, paymentStatus }
    })()
    io.to('role:treasury').emit('treasury:payment-recorded', payment)
    res.status(201).json(payment)
  } catch (error) {
    return sendError(res, error.status || (error.message.includes('أكبر من') ? 409 : 400), error.message)
  }
})

api.delete('/invoices/:id', requireAuth, allowRoles('admin'), (req, res) => {
  const invoice = db.prepare('SELECT * FROM invoices WHERE id=? AND deleted_at IS NULL').get(req.params.id)
  if (!invoice) return sendError(res, 404, 'الفاتورة غير موجودة.')
  if (invoice.kind === 'purchase' || invoice.kind === 'sales') {
    return sendError(res, 409, 'لا يمكن إخفاء مستند مالي؛ استخدم مسار التصحيح المعتمد للحفاظ على أثر المخزون والخزينة والقيود.')
  }
  db.transaction(() => {
    db.prepare("UPDATE invoices SET deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL").run(invoice.id)
    audit(req.user.id, 'soft-delete', 'invoice', invoice.id, '', invoice, { ...invoice, deleted_at: new Date().toISOString() })
  })()
  res.json({ ok: true })
})

api.get('/accounting/setup', requireAuth, allowRoles('admin'), (_req, res) => {
  const accounts = db.prepare(`SELECT id,code,name,account_type,parent_id,active,system_key FROM accounts ORDER BY code`).all()
  const mappings = db.prepare(`SELECT am.mapping_key,am.account_id,am.approved,am.updated_at,a.code AS account_code,a.name AS account_name,a.account_type
    FROM account_mappings am LEFT JOIN accounts a ON a.id=am.account_id ORDER BY am.mapping_key`).all()
  const pending = db.prepare(`SELECT id,source_type,source_id,source_key,description,created_at
    FROM journal_entries WHERE status='pending_configuration' ORDER BY id DESC LIMIT 200`).all()
  res.json({ accounts, mappings, pending, unconfiguredMappingCount: mappings.filter((mapping) => !mapping.approved || !mapping.account_id).length })
})

api.get('/accounting/tax-rates', requireAuth, allowRoles('admin', 'sales'), (_req, res) => {
  res.json(db.prepare('SELECT id,label,rate_basis_points FROM sales_tax_rates WHERE active=1 ORDER BY rate_basis_points,label').all())
})

api.post('/accounting/tax-rates', requireAuth, allowRoles('admin'), (req, res) => {
  const label = String(req.body?.label || '').trim().slice(0, 100)
  const rateBasisPoints = Number(req.body?.rateBasisPoints)
  if (!label || !Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 100_000) {
    return sendError(res, 400, 'أدخل مسمى ونسبة ضريبية صالحة بوحدة 1/100 من النسبة المئوية (مثال 1400 = 14%).')
  }
  try {
    const rate = db.transaction(() => {
      const inserted = db.prepare('INSERT INTO sales_tax_rates(label,rate_basis_points,created_by) VALUES (?,?,?)')
        .run(label, rateBasisPoints, req.user.id)
      const result = db.prepare('SELECT id,label,rate_basis_points FROM sales_tax_rates WHERE id=?').get(inserted.lastInsertRowid)
      audit(req.user.id, 'create', 'sales-tax-rate', result.id, label, null, result)
      return result
    })()
    res.status(201).json(rate)
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'توجد نسبة ضريبية نشطة بالاسم أو النسبة نفسيهما.')
    throw error
  }
})

api.delete('/accounting/tax-rates/:id', requireAuth, allowRoles('admin'), (req, res) => {
  const id = Number(req.params.id)
  const rate = db.prepare('SELECT * FROM sales_tax_rates WHERE id=? AND active=1').get(id)
  if (!rate) return sendError(res, 404, 'النسبة الضريبية غير موجودة.')
  if (rate.rate_basis_points === 0) return sendError(res, 409, 'لا يمكن تعطيل خيار عدم فرض الضريبة.')
  const used = db.prepare('SELECT 1 FROM invoices WHERE tax_rate_basis_points=? LIMIT 1').get(rate.rate_basis_points)
  db.transaction(() => {
    db.prepare('UPDATE sales_tax_rates SET active=0 WHERE id=?').run(id)
    audit(req.user.id, 'deactivate', 'sales-tax-rate', id, rate.label, rate,
      { ...rate, active: 0, hasHistoricalInvoices: Boolean(used) })
  })()
  res.json({ ok: true })
})

function validateOpeningBalanceLines(rawLines) {
  if (!Array.isArray(rawLines) || rawLines.length < 2 || rawLines.length > 500) {
    throw apiError(400, 'يتطلب الرصيد الافتتاحي سطرين على الأقل وبحد أقصى 500 سطر.')
  }
  return rawLines.map((line) => {
    const amountCents = line?.amountCents === undefined ? parseCurrencyCents(line?.amount, { allowZero: true }) : Number(line.amountCents)
    const accountId = Number(line?.accountId)
    const side = String(line?.side || '')
    const lineType = String(line?.lineType || 'account')
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !Number.isSafeInteger(accountId) || accountId < 1
      || !['debit','credit'].includes(side) || !['account','cashbox','inventory','receivable','payable','employee_advance'].includes(lineType)) {
      throw apiError(400, 'تحقق من نوع السطر والحساب والجانب والمبلغ في جدول الأرصدة الافتتاحية.')
    }
    const account = db.prepare('SELECT id,account_type,active FROM accounts WHERE id=?').get(accountId)
    if (!account?.active) throw apiError(400, 'الحساب المحدد غير نشط أو غير موجود.')
    if (lineType === 'cashbox') {
      const cashboxMapping = db.prepare(`SELECT account_id,approved FROM account_mappings WHERE mapping_key='factory_cashbox'`).get()
      const cashboxAccount = db.prepare('SELECT system_key FROM accounts WHERE id=?').get(accountId)
      if (account.account_type !== 'asset' || (cashboxAccount?.system_key !== 'factory_cashbox'
        && !(cashboxMapping?.approved === 1 && cashboxMapping.account_id === accountId))) {
        throw apiError(400, 'سطر الصندوق يجب أن يستخدم حساب صندوق المصنع المعرّف والمعتمد.')
      }
    }
    const clientId = line?.clientId == null || line.clientId === '' ? null : Number(line.clientId)
    const materialId = line?.materialId == null || line.materialId === '' ? null : Number(line.materialId)
    const employeeId = line?.employeeId == null || line.employeeId === '' ? null : Number(line.employeeId)
    let quantity = line?.quantity == null || line.quantity === '' ? null : Number(line.quantity)
    const invoiceCode = String(line?.invoiceCode || '').trim().slice(0, 120)
    const originalDate = line?.originalDate ? String(line.originalDate).slice(0, 10) : null
    const dueDate = line?.dueDate ? String(line.dueDate).slice(0, 10) : null
    const description = String(line?.description || '').trim().slice(0, 1000)
    if (lineType === 'inventory') {
      if (!Number.isSafeInteger(materialId) || !Number.isFinite(quantity) || quantity < 0
        || account.account_type !== 'asset') throw apiError(400, 'سطر المخزون الافتتاحي يتطلب صنفًا ورصيد كمية وحساب أصل.')
      const material = db.prepare(`SELECT stock,sub_stock FROM materials WHERE id=? AND active=1 AND deleted_at IS NULL`).get(materialId)
      if (!material || Math.abs(Number(material.stock) + Number(material.sub_stock) - quantity) > 0.000001) {
        throw apiError(409, 'كمية جدول المخزون الافتتاحي لا تطابق رصيد الصنف الحالي.')
      }
    }
    if (lineType === 'cashbox' && account.account_type !== 'asset') {
      throw apiError(400, 'سطر صندوق المصنع يتطلب حساب أصل.')
    }
    if (lineType === 'receivable') {
      if (!Number.isSafeInteger(clientId) || !db.prepare('SELECT id FROM clients WHERE id=? AND deleted_at IS NULL').get(clientId)
        || !invoiceCode || account.account_type !== 'asset') throw apiError(400, 'سطر الذمم المدينة يتطلب عميلًا وفاتورة وحساب أصل.')
    }
    if (lineType === 'payable') {
      if (!invoiceCode || account.account_type !== 'liability') throw apiError(400, 'سطر الذمم الدائنة يتطلب مرجع فاتورة وحساب التزام.')
    }
    if (lineType === 'employee_advance') {
      if (!Number.isSafeInteger(employeeId) || !db.prepare('SELECT id FROM employees WHERE id=?').get(employeeId)
        || account.account_type !== 'asset') throw apiError(400, 'سطر سلفة الموظف يتطلب موظفًا وحساب أصل.')
    }
    if (originalDate && !/^\d{4}-\d{2}-\d{2}$/.test(originalDate)) throw apiError(400, 'تاريخ المستند الأصلي غير صالح.')
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw apiError(400, 'تاريخ الاستحقاق غير صالح.')
    return { lineType, accountId, side, clientId, materialId, invoiceCode, employeeId, quantity,
      amountCents, originalDate, dueDate, description }
  })
}

function writeOpeningBalanceLines(batchId, lines) {
  const insert = db.prepare(`INSERT INTO opening_balance_lines(batch_id,line_type,account_id,material_id,client_id,invoice_code,
    employee_id,quantity,amount_cents,original_date,due_date,description,side) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  for (const line of lines) insert.run(batchId, line.lineType, line.accountId, line.materialId, line.clientId,
    line.invoiceCode, line.employeeId, line.quantity, line.amountCents, line.originalDate, line.dueDate, line.description, line.side)
}

api.get('/accounting/opening-balances', requireAuth, allowRoles('admin'), (_req, res) => {
  const batches = db.prepare(`SELECT b.*,u.full_name AS created_by_name,je.status AS journal_status
    FROM opening_balance_batches b LEFT JOIN users u ON u.id=b.created_by
      LEFT JOIN journal_entries je ON je.id=b.journal_entry_id ORDER BY b.cutover_date DESC`).all()
  const lines = db.prepare(`SELECT l.*,a.code AS account_code,a.name AS account_name,c.name AS client_name,
      m.code AS material_code,e.name AS employee_name FROM opening_balance_lines l
    LEFT JOIN accounts a ON a.id=l.account_id LEFT JOIN clients c ON c.id=l.client_id
    LEFT JOIN materials m ON m.id=l.material_id LEFT JOIN employees e ON e.id=l.employee_id
    WHERE l.batch_id=? ORDER BY l.id`)
  res.json(batches.map((batch) => ({ ...batch, lines: lines.all(batch.id) })))
})

api.post('/accounting/opening-balances', requireAuth, allowRoles('admin'), (req, res) => {
  const cutoverDate = String(req.body?.cutoverDate || '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoverDate) || Number.isNaN(Date.parse(`${cutoverDate}T00:00:00Z`))) {
    return sendError(res, 400, 'حدد تاريخ القطع بصيغة YYYY-MM-DD.')
  }
  try {
    const lines = validateOpeningBalanceLines(req.body?.lines)
    const result = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM opening_balance_batches WHERE cutover_date=?').get(cutoverDate)
      if (existing?.status === 'posted') throw apiError(409, 'سبق ترحيل أرصدة هذا التاريخ ولا يمكن تعديلها.')
      const postedCutover = db.prepare(`SELECT cutover_date FROM opening_balance_batches
        WHERE status='posted' AND cutover_date<>? LIMIT 1`).get(cutoverDate)
      if (postedCutover) throw apiError(409, `يوجد تاريخ قطع مرحّل بالفعل (${postedCutover.cutover_date})؛ أضف كل الجداول إلى مسودة تاريخ قطع واحدة.`)
      let batchId = existing?.id
      const existingLines = existing
        ? db.prepare('SELECT * FROM opening_balance_lines WHERE batch_id=? ORDER BY id').all(existing.id)
        : []
      if (existing) {
        db.prepare('DELETE FROM opening_balance_lines WHERE batch_id=?').run(batchId)
      } else {
        batchId = db.prepare(`INSERT INTO opening_balance_batches(cutover_date,created_by) VALUES (?,?)`)
          .run(cutoverDate, req.user.id).lastInsertRowid
      }
      writeOpeningBalanceLines(batchId, lines)
      const totals = lines.reduce((acc, line) => {
        acc[`${line.side}Cents`] += line.amountCents
        return acc
      }, { debitCents: 0, creditCents: 0 })
      const savedLines = db.prepare('SELECT * FROM opening_balance_lines WHERE batch_id=? ORDER BY id').all(batchId)
      audit(req.user.id, existing ? 'update-draft' : 'create-draft', 'opening-balance', batchId, cutoverDate,
        existing ? { status: existing.status, cutoverDate: existing.cutover_date, lines: existingLines } : null,
        { status: 'draft', cutoverDate, lineCount: savedLines.length, lines: savedLines, ...totals })
      return { id: batchId, cutoverDate, status: 'draft', lineCount: lines.length, ...totals,
        balanced: totals.debitCents === totals.creditCents }
    })()
    res.status(201).json(result)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.post('/accounting/opening-balances/:id/post', requireAuth, allowRoles('admin'), (req, res) => {
  const id = Number(req.params.id)
  try {
    const result = db.transaction(() => {
      const batch = db.prepare("SELECT * FROM opening_balance_batches WHERE id=? AND status='draft'").get(id)
      if (!batch) throw apiError(404, 'مسودة الرصيد الافتتاحي غير موجودة أو سبق ترحيلها.')
      const postedCutover = db.prepare(`SELECT cutover_date FROM opening_balance_batches
        WHERE status='posted' AND id<>? LIMIT 1`).get(id)
      if (postedCutover) throw apiError(409, `يوجد تاريخ قطع مرحّل بالفعل (${postedCutover.cutover_date})؛ لا يمكن ترحيل افتتاح ثانٍ.`)
      const lines = db.prepare(`SELECT l.*,a.active,a.account_type FROM opening_balance_lines l
        JOIN accounts a ON a.id=l.account_id WHERE l.batch_id=? ORDER BY l.id`).all(id)
      if (lines.length < 2 || lines.some((line) => !line.active || line.amount_cents <= 0)) throw apiError(400, 'المسودة تفتقد سطورًا صالحة أو حسابات نشطة.')
      const totals = lines.reduce((acc, line) => {
        acc[`${line.side}Cents`] += Number(line.amount_cents)
        return acc
      }, { debitCents: 0, creditCents: 0 })
      if (!totals.debitCents || totals.debitCents !== totals.creditCents) {
        throw apiError(409, `الأرصدة الافتتاحية غير متوازنة (مدين ${totals.debitCents}، دائن ${totals.creditCents} سنتًا).`)
      }
      const postings = lines.map((line) => ({
        accountId: line.account_id,
        description: line.description || `رصيد افتتاحي ${batch.cutover_date}`,
        debitCents: line.side === 'debit' ? Number(line.amount_cents) : 0,
        creditCents: line.side === 'credit' ? Number(line.amount_cents) : 0,
      }))
      const journal = queueJournalEntry(db, { sourceType: 'opening_balance', sourceId: id,
        sourceKey: `opening-balance:${id}`, description: `أرصدة افتتاحية حتى ${batch.cutover_date}`,
        createdBy: req.user.id, postings })
      if (journal.status !== 'posted') throw apiError(409, 'تعذر ترحيل القيد؛ راجع الحسابات النشطة.')
      db.prepare('UPDATE journal_entries SET created_at=? WHERE id=?').run(`${batch.cutover_date} 00:00:00`, journal.id)
      db.prepare(`UPDATE opening_balance_batches SET status='posted',journal_entry_id=?,posted_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(journal.id, id)
      audit(req.user.id, 'post', 'opening-balance', id, batch.cutover_date,
        { status: 'draft' }, { status: 'posted', journalEntryId: journal.id, ...totals })
      return { id, status: 'posted', journalEntryId: journal.id, ...totals }
    })()
    res.json(result)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.post('/accounting/accounts', requireAuth, allowRoles('admin'), (req, res) => {
  const code = String(req.body?.code || '').trim()
  const name = String(req.body?.name || '').trim()
  const accountType = String(req.body?.accountType || '')
  if (!/^[A-Za-z0-9.-]{1,24}$/.test(code) || !name || name.length > 150
    || !['asset','liability','equity','revenue','expense'].includes(accountType)) {
    return sendError(res, 400, 'أدخل كودًا واسمًا ونوع حساب صالحًا.')
  }
  try {
    const account = db.transaction(() => {
      const inserted = db.prepare('INSERT INTO accounts(code,name,account_type) VALUES (?,?,?)').run(code, name, accountType)
      audit(req.user.id, 'create', 'account', inserted.lastInsertRowid, code, null, { code, name, accountType })
      return db.prepare('SELECT id,code,name,account_type,parent_id,active,system_key FROM accounts WHERE id=?').get(inserted.lastInsertRowid)
    })()
    res.status(201).json(account)
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'كود الحساب مستخدم بالفعل.')
    throw error
  }
})

api.patch('/accounting/accounts/:id', requireAuth, allowRoles('admin'), (req, res) => {
  const id = Number(req.params.id)
  const account = db.prepare('SELECT * FROM accounts WHERE id=?').get(id)
  if (!account) return sendError(res, 404, 'الحساب غير موجود.')
  const name = req.body?.name === undefined ? account.name : String(req.body.name || '').trim()
  const active = req.body?.active === undefined ? account.active : (req.body.active ? 1 : 0)
  const accountType = req.body?.accountType === undefined ? account.account_type : String(req.body.accountType)
  if (!name || name.length > 150 || ![0,1].includes(Number(active))
    || !['asset','liability','equity','revenue','expense'].includes(accountType)) return sendError(res, 400, 'بيانات الحساب غير صالحة.')
  const used = db.prepare(`SELECT 1 FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
    WHERE jl.account_id=? AND je.status IN ('posted','reversed') LIMIT 1`).get(id)
  if (used && (Number(active) !== Number(account.active) || accountType !== account.account_type)) {
    return sendError(res, 409, 'لا يمكن تعطيل حساب أو تغيير تصنيفه بعد استخدامه في قيود مرحّلة.')
  }
  db.transaction(() => {
    db.prepare('UPDATE accounts SET name=?,account_type=?,active=? WHERE id=?').run(name, accountType, active, id)
    audit(req.user.id, 'update', 'account', id, account.code,
      { name: account.name, accountType: account.account_type, active: account.active },
      { name, accountType, active: Number(active) })
  })()
  res.json({ ok: true })
})

api.put('/accounting/mappings/:mappingKey', requireAuth, allowRoles('admin'), (req, res) => {
  const accountId = Number(req.body?.accountId)
  if (!Number.isSafeInteger(accountId) || accountId < 1) return sendError(res, 400, 'اختر حسابًا صالحًا.')
  try {
    const result = db.transaction(() => {
      const old = db.prepare('SELECT * FROM account_mappings WHERE mapping_key=?').get(req.params.mappingKey)
      const postedPending = setAccountMapping(db, { mappingKey: req.params.mappingKey, accountId, userId: req.user.id })
      const mapping = db.prepare('SELECT * FROM account_mappings WHERE mapping_key=?').get(req.params.mappingKey)
      audit(req.user.id, 'approve-mapping', 'account-mapping', req.params.mappingKey, '', old || null, mapping)
      return { mapping, postedPending }
    })()
    res.json(result)
  } catch (error) { return sendError(res, 400, error.message) }
})

function journalSourceHref(entry) {
  const sourceId = String(entry.source_id || '')
  const numericId = Number(sourceId)
  if (!Number.isSafeInteger(numericId) || numericId < 1) return null
  switch (entry.source_type) {
    case 'purchase_invoice': return `/finance#purchase-invoice-${numericId}`
    case 'purchase_invoice_revision': {
      const revision = db.prepare('SELECT invoice_id FROM purchase_invoice_revisions WHERE id=?').get(numericId)
      return revision ? `/finance#purchase-invoice-${revision.invoice_id}` : '/finance'
    }
    case 'purchase_correction': {
      const correction = db.prepare('SELECT invoice_id FROM purchase_corrections WHERE id=?').get(numericId)
      return correction ? `/finance#purchase-invoice-${correction.invoice_id}` : '/finance'
    }
    case 'sales_invoice': return `/finance#sales-invoice-${numericId}`
    case 'other_invoice': return `/finance#other-invoice-${numericId}`
    case 'customer_receipt': {
      const transaction = db.prepare('SELECT invoice_id FROM treasury_transactions WHERE id=?').get(numericId)
      return transaction?.invoice_id ? `/finance#sales-invoice-${transaction.invoice_id}` : `/finance#treasury-entry-${numericId}`
    }
    case 'treasury_transaction':
    case 'company_funding':
    case 'payroll_payment': return `/finance#treasury-entry-${numericId}`
    case 'inventory_issue': {
      const issue = db.prepare('SELECT order_id FROM inventory_issues WHERE id=?').get(numericId)
      if (issue?.order_id) return `/orders/${issue.order_id}`
      const movement = db.prepare(`SELECT id FROM inventory_movements WHERE issue_id=? ORDER BY id LIMIT 1`).get(numericId)
      return movement ? `/inventory#inventory-movement-${movement.id}` : '/inventory'
    }
    case 'work_order_cogs_recognition': return `/orders/${numericId}`
    case 'inventory_adjustment': return `/inventory#inventory-movement-${numericId}`
    case 'stock_count': return `/inventory#stock-count-${numericId}`
    case 'payroll': return `/accounting#payroll-record-${numericId}`
    case 'employee_advance': {
      const event = db.prepare('SELECT employee_id FROM employee_advance_events WHERE id=?').get(numericId)
      return event ? `/employees#employee-record-${event.employee_id}` : '/employees'
    }
    case 'opening_balance': return `/accounting#opening-balance-${numericId}`
    default: return null
  }
}

api.get('/accounting/journal', requireAuth, allowRoles('admin'), (req, res) => {
  const conditions = []
  const params = []
  if (req.query.from) { conditions.push('je.created_at>=?'); params.push(`${String(req.query.from).slice(0,10)} 00:00:00`) }
  if (req.query.to) { conditions.push("je.created_at<datetime(?,'+1 day')"); params.push(String(req.query.to).slice(0,10)) }
  if (req.query.sourceType) { conditions.push('je.source_type=?'); params.push(String(req.query.sourceType).slice(0,80)) }
  if (req.query.sourceId) { conditions.push('je.source_id=?'); params.push(String(req.query.sourceId).trim().slice(0,100)) }
  if (req.query.accountId && Number.isSafeInteger(Number(req.query.accountId))) {
    conditions.push('EXISTS(SELECT 1 FROM journal_lines f WHERE f.journal_entry_id=je.id AND f.account_id=?)')
    params.push(Number(req.query.accountId))
  }
  const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit, 10) || 200))
  const entries = db.prepare(`SELECT je.*,u.full_name AS actor_name FROM journal_entries je
    LEFT JOIN users u ON u.id=je.created_by ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY je.id DESC LIMIT ?`).all(...params, limit)
  const lines = db.prepare(`SELECT jl.*,a.code AS account_code,a.name AS account_name FROM journal_lines jl
    JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_entry_id=? ORDER BY jl.line_number`)
  res.json(entries.map((entry) => ({ ...entry, source_href: journalSourceHref(entry), lines: lines.all(entry.id) })))
})

api.get('/accounting/ledger', requireAuth, allowRoles('admin'), (req, res) => {
  const accountId = Number(req.query.accountId)
  if (!Number.isSafeInteger(accountId) || accountId < 1) return sendError(res, 400, 'اختر حسابًا صالحًا للاستعلام.')
  const account = db.prepare('SELECT id,code,name,account_type FROM accounts WHERE id=?').get(accountId)
  if (!account) return sendError(res, 404, 'الحساب غير موجود.')
  const from = req.query.from ? `${String(req.query.from).slice(0,10)} 00:00:00` : null
  const to = req.query.to ? `${String(req.query.to).slice(0,10)} 23:59:59` : null
  const rows = db.prepare(`SELECT jl.*,je.source_type,je.source_id,je.source_key,je.description AS journal_description,je.created_at,
      je.status,a.account_type
    FROM journal_lines jl JOIN journal_entries je ON je.id=jl.journal_entry_id
      JOIN accounts a ON a.id=jl.account_id
    WHERE jl.account_id=? AND je.status='posted' ORDER BY je.created_at,je.id,jl.line_number`).all(accountId)
  let runningCents = 0
  const normalDebit = ['asset','expense'].includes(account.account_type)
  const transactions = []
  for (const row of rows) {
    const delta = Number(row.debit_cents) - Number(row.credit_cents)
    runningCents += normalDebit ? delta : -delta
    if ((!from || row.created_at >= from) && (!to || row.created_at <= to)) transactions.push({
      ...row, balanceCents: runningCents,
    })
  }
  res.json({ account, transactions, balanceCents: runningCents })
})

api.get('/accounting/trial-balance', requireAuth, allowRoles('admin'), (req, res) => {
  const from = req.query.from ? `${String(req.query.from).slice(0,10)} 00:00:00` : null
  const to = req.query.to ? `${String(req.query.to).slice(0,10)} 23:59:59` : null
  const rows = db.prepare(`SELECT a.id,a.code,a.name,a.account_type,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit_cents ELSE 0 END),0) AS debit_cents,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit_cents ELSE 0 END),0) AS credit_cents
    FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id
    LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.status='posted'
      AND (? IS NULL OR je.created_at>=?) AND (? IS NULL OR je.created_at<=?)
    WHERE a.active=1 GROUP BY a.id ORDER BY a.code`).all(from, from, to, to)
  const totals = rows.reduce((result, row) => ({
    debitCents: result.debitCents + Number(row.debit_cents), creditCents: result.creditCents + Number(row.credit_cents),
  }), { debitCents: 0, creditCents: 0 })
  res.json({ rows, totals, balanced: totals.debitCents === totals.creditCents })
})

function workOrderFinancialSummary(from, to) {
  const cogs = Number(db.prepare(`SELECT COALESCE(SUM(cogs_cents),0) AS cents FROM inventory_issues
    WHERE classification='order' AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?)`).get(from, from, to, to).cents)
  const revenue = Number(db.prepare(`SELECT COALESCE(SUM(COALESCE(subtotal_cents,ROUND(total*100))),0) AS cents FROM invoices
    WHERE kind='sales' AND order_id IS NOT NULL AND deleted_at IS NULL
      AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?)`).get(from, from, to, to).cents)
  const unclassifiedIssues = Number(db.prepare(`SELECT COUNT(*) AS count FROM inventory_movements
    WHERE kind='issue' AND quantity<0 AND issue_id IS NULL
      AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?)`).get(from, from, to, to).count)
  const pendingJournalEntries = Number(db.prepare(`SELECT COUNT(*) AS count FROM inventory_issues ii
    JOIN journal_entries je ON je.id=ii.journal_entry_id WHERE ii.classification='order' AND je.status<>'posted'
      AND (? IS NULL OR ii.created_at>=?) AND (? IS NULL OR ii.created_at<=?)`).get(from, from, to, to).count)
  return {
    revenueCents: revenue,
    cogsCents: cogs,
    grossProfitCents: revenue - cogs,
    unclassifiedHistoricalIssueCount: unclassifiedIssues,
    pendingJournalEntries,
    profitStatus: unclassifiedIssues
      ? 'incomplete_unclassified_historical_issues'
      : pendingJournalEntries ? 'pending_work_order_cogs_journals' : 'complete',
  }
}

api.get('/accounting/reports', requireAuth, allowRoles('admin'), (req, res) => {
  const from = req.query.from ? `${String(req.query.from).slice(0,10)} 00:00:00` : null
  const to = req.query.to ? `${String(req.query.to).slice(0,10)} 23:59:59` : null
  const balanceSheetRows = db.prepare(`SELECT a.id,a.code,a.name,a.account_type,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit_cents ELSE 0 END),0) AS debit_cents,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit_cents ELSE 0 END),0) AS credit_cents
    FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id
    LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.status='posted'
      AND (? IS NULL OR je.created_at<=?)
    WHERE a.active=1 GROUP BY a.id ORDER BY a.code`).all(to,to)
  const incomeRows = db.prepare(`SELECT a.id,a.code,a.name,a.account_type,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.debit_cents ELSE 0 END),0) AS debit_cents,
      COALESCE(SUM(CASE WHEN je.id IS NOT NULL THEN jl.credit_cents ELSE 0 END),0) AS credit_cents
    FROM accounts a LEFT JOIN journal_lines jl ON jl.account_id=a.id
    LEFT JOIN journal_entries je ON je.id=jl.journal_entry_id AND je.status='posted'
      AND (? IS NULL OR je.created_at>=?) AND (? IS NULL OR je.created_at<=?)
    WHERE a.active=1 GROUP BY a.id ORDER BY a.code`).all(from,from,to,to)
  const normalizeBalance = (row) => ['asset','expense'].includes(row.account_type)
    ? Number(row.debit_cents) - Number(row.credit_cents) : Number(row.credit_cents) - Number(row.debit_cents)
  const balanceSheet = balanceSheetRows.map((row) => ({ ...row, balance_cents: normalizeBalance(row) }))
  const incomeStatement = incomeRows.map((row) => ({ ...row, balance_cents: normalizeBalance(row) }))
  const receivables = db.prepare(`SELECT i.id,i.code,i.total,i.paid_total,i.remaining,i.created_at,c.id AS client_id,c.name AS client_name
    FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.kind='sales' AND i.remaining>0 AND i.deleted_at IS NULL ORDER BY i.created_at,i.id`).all()
  const taxConditions = ["kind='sales'", 'deleted_at IS NULL']
  const taxParams = []
  if (req.query.from) { taxConditions.push('created_at>=?'); taxParams.push(`${String(req.query.from).slice(0,10)} 00:00:00`) }
  if (req.query.to) { taxConditions.push("created_at<datetime(?,'+1 day')"); taxParams.push(String(req.query.to).slice(0,10)) }
  const taxSummary = db.prepare(`SELECT tax_rate_basis_points,COALESCE(SUM(subtotal_cents),0) AS subtotal_cents,
      COALESCE(SUM(tax_cents),0) AS tax_cents,COUNT(*) AS invoice_count
    FROM invoices WHERE ${taxConditions.join(' AND ')}
    GROUP BY tax_rate_basis_points ORDER BY tax_rate_basis_points`).all(...taxParams)
  const accountMappings = db.prepare(`SELECT COUNT(*) AS pending FROM account_mappings WHERE account_id IS NULL OR approved=0`).get().pending
  const pendingEntries = db.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE status='pending_configuration'").get().count
  const workOrderFinancials = workOrderFinancialSummary(from, to)
  res.json({
    from: req.query.from || null, to: req.query.to || null,
    balanceSheet: balanceSheet.filter((row) => ['asset','liability','equity'].includes(row.account_type)),
    incomeStatement: incomeStatement.filter((row) => ['revenue','expense'].includes(row.account_type)),
    receivables, taxSummary,
    cashboxBalanceCents: cashboxBalanceCents(),
    grossProfit: workOrderFinancials.grossProfitCents / 100,
    grossProfitCents: workOrderFinancials.grossProfitCents,
    workOrderRevenueCents: workOrderFinancials.revenueCents,
    workOrderCogsCents: workOrderFinancials.cogsCents,
    unclassifiedHistoricalIssueCount: workOrderFinancials.unclassifiedHistoricalIssueCount,
    pendingWorkOrderCogsEntries: workOrderFinancials.pendingJournalEntries,
    profitStatus: workOrderFinancials.profitStatus,
    unconfiguredMappingCount: accountMappings, pendingJournalEntries: pendingEntries,
    companyBankTracked: false,
  })
})

function employeeAdvanceBalanceCents(employeeId) {
  return Number(db.prepare(`SELECT COALESCE(SUM(CASE
    WHEN event_type IN ('issued','overpayment') THEN amount_cents
    WHEN event_type='applied' THEN -amount_cents ELSE 0 END),0) AS balance
    FROM employee_advance_events WHERE employee_id=?`).get(employeeId).balance)
}

function parsePayrollInputs(body, employee, outstandingAdvanceCents) {
  const baseSalaryCents = body.baseSalary === undefined
    ? Number(employee.monthly_salary_cents || 0)
    : parseCurrencyCents(body.baseSalary, { allowZero: true })
  const ordinaryOvertimeMinutes = Number(body.ordinaryOvertimeMinutes || 0)
  const holidayOvertimeMinutes = Number(body.holidayOvertimeMinutes || 0)
  const bonusCents = body.bonus === undefined || body.bonus === '' ? 0 : parseCurrencyCents(body.bonus, { allowZero: true })
  const deductionCents = body.deduction === undefined || body.deduction === '' ? 0 : parseCurrencyCents(body.deduction, { allowZero: true })
  if (![baseSalaryCents, bonusCents, deductionCents].every(Number.isSafeInteger)
    || !Number.isSafeInteger(ordinaryOvertimeMinutes) || ordinaryOvertimeMinutes < 0
    || !Number.isSafeInteger(holidayOvertimeMinutes) || holidayOvertimeMinutes < 0) {
    throw apiError(400, 'تحقق من الراتب والإضافي والخصم؛ الساعات الإضافية تُدخل بالدقائق كأعداد صحيحة.')
  }
  const calculated = calculatePayroll({ baseSalaryCents, ordinaryOvertimeMinutes, holidayOvertimeMinutes,
    bonusCents, deductionCents, outstandingAdvanceCents, cashPaidCents: 0 })
  return { baseSalaryCents, ordinaryOvertimeMinutes, holidayOvertimeMinutes, bonusCents, deductionCents, calculated }
}

api.get('/payroll', requireAuth, allowRoles('admin'), (req, res) => {
  const period = req.query.period == null ? null : String(req.query.period)
  if (period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return sendError(res, 400, 'صيغة الفترة يجب أن تكون YYYY-MM.')
  const employees = db.prepare(`SELECT e.id,e.name,e.department,e.monthly_salary_cents,
      COALESCE((SELECT SUM(CASE WHEN a.event_type IN ('issued','overpayment') THEN a.amount_cents ELSE -a.amount_cents END)
        FROM employee_advance_events a WHERE a.employee_id=e.id),0) AS advance_balance_cents
    FROM employees e WHERE e.active=1 AND e.deleted_at IS NULL ORDER BY e.name COLLATE NOCASE`).all()
  const records = db.prepare(`SELECT p.*,e.name AS employee_name,e.department FROM payroll_records p
    JOIN employees e ON e.id=p.employee_id ${period ? 'WHERE p.period=?' : ''}
    ORDER BY p.period DESC,e.name COLLATE NOCASE`).all(...(period ? [period] : []))
  res.json({ employees, records })
})

api.post('/payroll', requireAuth, allowRoles('admin'), (req, res) => {
  const employeeId = Number(req.body?.employeeId)
  const period = String(req.body?.period || '')
  if (!Number.isSafeInteger(employeeId) || employeeId < 1 || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
    return sendError(res, 400, 'اختر موظفًا نشطًا وحدد فترة شهرية بصيغة YYYY-MM.')
  }
  try {
    const result = db.transaction(() => {
      const employee = db.prepare(`SELECT id,monthly_salary_cents FROM employees
        WHERE id=? AND active=1 AND deleted_at IS NULL`).get(employeeId)
      if (!employee) throw apiError(404, 'الموظف غير موجود أو غير نشط.')
      const existing = db.prepare('SELECT * FROM payroll_records WHERE employee_id=? AND period=?').get(employeeId, period)
      if (existing?.status === 'finalized') throw apiError(409, 'تم إقفال مسير هذا الموظف للشهر المحدد.')
      const outstandingAdvanceCents = employeeAdvanceBalanceCents(employeeId)
      const inputs = parsePayrollInputs(req.body || {}, employee, outstandingAdvanceCents)
      const c = inputs.calculated
      if (existing) {
        db.prepare(`UPDATE payroll_records SET base_salary_cents=?,ordinary_overtime_minutes=?,holiday_overtime_minutes=?,
          ordinary_overtime_cents=?,holiday_overtime_cents=?,bonus_cents=?,deduction_cents=?,net_entitlement_cents=?,
          advances_applied_cents=?,cash_paid_cents=0,unpaid_salary_cents=?,advance_balance_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(inputs.baseSalaryCents, inputs.ordinaryOvertimeMinutes, inputs.holidayOvertimeMinutes,
            c.ordinaryOvertimeCents, c.holidayOvertimeCents, inputs.bonusCents, inputs.deductionCents,
            c.netEntitlementCents, c.advancesAppliedCents, c.unpaidSalaryCents, c.advanceBalanceCents, existing.id)
        audit(req.user.id, 'update-draft', 'payroll', existing.id, period, existing, { ...inputs, calculated: c })
        return db.prepare('SELECT * FROM payroll_records WHERE id=?').get(existing.id)
      }
      const inserted = db.prepare(`INSERT INTO payroll_records(employee_id,period,base_salary_cents,ordinary_overtime_minutes,holiday_overtime_minutes,
        ordinary_overtime_cents,holiday_overtime_cents,bonus_cents,deduction_cents,advances_applied_cents,net_entitlement_cents,
        cash_paid_cents,unpaid_salary_cents,advance_balance_cents,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`).run(employeeId, period, inputs.baseSalaryCents,
        inputs.ordinaryOvertimeMinutes, inputs.holidayOvertimeMinutes, c.ordinaryOvertimeCents, c.holidayOvertimeCents,
        inputs.bonusCents, inputs.deductionCents, c.advancesAppliedCents, c.netEntitlementCents,
        c.unpaidSalaryCents, c.advanceBalanceCents, req.user.id)
      audit(req.user.id, 'create-draft', 'payroll', inserted.lastInsertRowid, period, null,
        { employeeId, period, ...inputs, calculated: c })
      return db.prepare('SELECT * FROM payroll_records WHERE id=?').get(inserted.lastInsertRowid)
    })()
    res.status(201).json(result)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.post('/payroll/:id/finalize', requireAuth, allowRoles('admin'), (req, res) => {
  const id = Number(req.params.id)
  const cashPaidCents = req.body?.cashPaid === undefined || req.body.cashPaid === ''
    ? 0 : parseCurrencyCents(req.body.cashPaid, { allowZero: true })
  if (!Number.isSafeInteger(id) || id < 1 || cashPaidCents === null) return sendError(res, 400, 'بيانات إقفال الرواتب غير صالحة.')
  try {
    const record = db.transaction(() => {
      const payroll = db.prepare('SELECT * FROM payroll_records WHERE id=?').get(id)
      if (!payroll) throw apiError(404, 'سجل الرواتب غير موجود.')
      if (payroll.status !== 'draft') throw apiError(409, 'تم إقفال هذا المسير مسبقًا.')
      const outstanding = employeeAdvanceBalanceCents(payroll.employee_id)
      const settlement = calculatePayroll({
        baseSalaryCents: payroll.base_salary_cents,
        ordinaryOvertimeMinutes: payroll.ordinary_overtime_minutes,
        holidayOvertimeMinutes: payroll.holiday_overtime_minutes,
        bonusCents: payroll.bonus_cents,
        deductionCents: payroll.deduction_cents,
        outstandingAdvanceCents: outstanding,
        cashPaidCents,
      })
      if (cashPaidCents > 0 && cashboxBalanceCents() < cashPaidCents) throw apiError(409, 'رصيد صندوق المصنع لا يكفي لسداد الجزء النقدي من الرواتب.')
      let treasuryId = null
      if (cashPaidCents > 0) {
        treasuryId = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,created_by,employee_id)
          VALUES ('expense',?,'رواتب',?,?,?,?)`).run(currencyAmountFromCents(cashPaidCents), `PAY-${payroll.period}`, '', req.user.id, payroll.employee_id).lastInsertRowid
      }
      const insertEvent = db.prepare(`INSERT INTO employee_advance_events(employee_id,payroll_id,event_type,amount_cents,created_by,notes)
        VALUES (?,?,?,?,?,?)`)
      if (settlement.advancesAppliedCents > 0) insertEvent.run(payroll.employee_id, id, 'applied', settlement.advancesAppliedCents, req.user.id, `تسوية سلفة شهر ${payroll.period}`)
      if (settlement.overpaymentCents > 0) insertEvent.run(payroll.employee_id, id, 'overpayment', settlement.overpaymentCents, req.user.id, `زيادة دفعة رواتب شهر ${payroll.period}`)
      db.prepare(`UPDATE payroll_records SET advances_applied_cents=?,net_entitlement_cents=?,cash_paid_cents=?,
        unpaid_salary_cents=?,advance_balance_cents=?,status='finalized',updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(settlement.advancesAppliedCents, settlement.netEntitlementCents, cashPaidCents,
          settlement.unpaidSalaryCents, settlement.advanceBalanceCents, id)
      const postings = []
      if (settlement.netEntitlementCents > 0) postings.push({ mappingKey: 'payroll_expense', debitCents: settlement.netEntitlementCents, description: `رواتب ${payroll.period}` })
      if (settlement.overpaymentCents > 0) postings.push({ mappingKey: 'employee_advances', debitCents: settlement.overpaymentCents, description: `سلفة موظف من زيادة دفع ${payroll.period}` })
      if (settlement.advancesAppliedCents > 0) postings.push({ mappingKey: 'employee_advances', creditCents: settlement.advancesAppliedCents, description: `تسوية سلف ${payroll.period}` })
      if (settlement.unpaidSalaryCents > 0) postings.push({ mappingKey: 'salary_payable', creditCents: settlement.unpaidSalaryCents, description: `رواتب مستحقة ${payroll.period}` })
      if (cashPaidCents > 0) postings.push({ mappingKey: 'factory_cashbox', creditCents: cashPaidCents, description: `صرف رواتب ${payroll.period}` })
      let journal = null
      if (postings.length > 1) journal = queueJournalEntry(db, { sourceType: 'payroll', sourceId: id,
        sourceKey: `payroll:${id}`, description: `مسير رواتب ${payroll.period}`, createdBy: req.user.id, postings })
      audit(req.user.id, 'finalize', 'payroll', id, `period=${payroll.period}; treasury=${treasuryId || ''}`,
        { status: payroll.status, advanceBalanceCents: outstanding }, { ...settlement, status: 'finalized', treasuryId, journalEntryId: journal?.id || null })
      return { ...db.prepare('SELECT * FROM payroll_records WHERE id=?').get(id), treasuryId, journalEntryId: journal?.id || null }
    })()
    res.json(record)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.post('/payroll/:id/payments', requireAuth, allowRoles('admin'), (req, res) => {
  const id = Number(req.params.id)
  const amountCents = parseCurrencyCents(req.body?.amount)
  if (!Number.isSafeInteger(id) || id < 1 || amountCents === null) return sendError(res, 400, 'أدخل مبلغًا صحيحًا أكبر من صفر.')
  try {
    const result = db.transaction(() => {
      const payroll = db.prepare(`SELECT * FROM payroll_records WHERE id=? AND status='finalized'`).get(id)
      if (!payroll) throw apiError(404, 'مسير الرواتب غير موجود أو غير مقفل.')
      if (amountCents > payroll.unpaid_salary_cents) throw apiError(409, 'المبلغ أكبر من الراتب غير المسدد.')
      if (cashboxBalanceCents() < amountCents) throw apiError(409, 'رصيد صندوق المصنع لا يكفي لهذا السداد.')
      const treasury = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,created_by,employee_id)
        VALUES ('expense',?,'سداد رواتب مستحقة',?,?,?,?)`).run(currencyAmountFromCents(amountCents), `PAY-${payroll.period}`,
        String(req.body?.notes || '').slice(0, 1000), req.user.id, payroll.employee_id)
      const remaining = payroll.unpaid_salary_cents - amountCents
      db.prepare(`UPDATE payroll_records SET cash_paid_cents=cash_paid_cents+?,unpaid_salary_cents=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(amountCents, remaining, id)
      const journal = queueJournalEntry(db, { sourceType: 'payroll_payment', sourceId: treasury.lastInsertRowid,
        sourceKey: `payroll-payment:${treasury.lastInsertRowid}`, description: `سداد راتب ${payroll.period}`, createdBy: req.user.id,
        postings: [
          { mappingKey: 'salary_payable', debitCents: amountCents, description: `تسوية رواتب مستحقة ${payroll.period}` },
          { mappingKey: 'factory_cashbox', creditCents: amountCents, description: `سداد راتب ${payroll.period}` },
        ],
      })
      audit(req.user.id, 'salary-payment', 'payroll', id, `treasury=${treasury.lastInsertRowid}`,
        { unpaidSalaryCents: payroll.unpaid_salary_cents }, { unpaidSalaryCents: remaining, amountCents, journalEntryId: journal.id })
      return { payrollId: id, treasuryId: treasury.lastInsertRowid, amountCents, unpaidSalaryCents: remaining }
    })()
    res.status(201).json(result)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.post('/payroll/advances', requireAuth, allowRoles('admin'), (req, res) => {
  const employeeId = Number(req.body?.employeeId)
  const amountCents = parseCurrencyCents(req.body?.amount)
  if (!Number.isSafeInteger(employeeId) || employeeId < 1 || amountCents === null) return sendError(res, 400, 'اختر موظفًا وأدخل مبلغ سلفة صحيحًا.')
  try {
    const result = db.transaction(() => {
      const employee = db.prepare(`SELECT id FROM employees WHERE id=? AND active=1 AND deleted_at IS NULL`).get(employeeId)
      if (!employee) throw apiError(404, 'الموظف غير موجود أو غير نشط.')
      if (cashboxBalanceCents() < amountCents) throw apiError(409, 'رصيد صندوق المصنع لا يكفي لصرف السلفة.')
      const notes = String(req.body?.notes || '').trim().slice(0, 1000)
      const treasury = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,created_by,employee_id)
        VALUES ('expense',?,'سلفة موظف',?,?,?,?)`).run(currencyAmountFromCents(amountCents),
        String(req.body?.reference || '').slice(0, 120), notes, req.user.id, employeeId)
      const event = db.prepare(`INSERT INTO employee_advance_events(employee_id,event_type,amount_cents,created_by,notes)
        VALUES (?,'issued',?,?,?)`).run(employeeId, amountCents, req.user.id, notes)
      const journal = queueJournalEntry(db, { sourceType: 'employee_advance', sourceId: event.lastInsertRowid,
        sourceKey: `employee-advance:${event.lastInsertRowid}`, description: 'سلفة موظف', createdBy: req.user.id,
        postings: [
          { mappingKey: 'employee_advances', debitCents: amountCents, description: 'سلفة موظف' },
          { mappingKey: 'factory_cashbox', creditCents: amountCents, description: 'صرف سلفة' },
        ],
      })
      audit(req.user.id, 'advance-issued', 'employee', employeeId, `event=${event.lastInsertRowid}; treasury=${treasury.lastInsertRowid}`,
        null, { amountCents, outstandingAdvanceCents: employeeAdvanceBalanceCents(employeeId), journalEntryId: journal.id })
      return { id: event.lastInsertRowid, employeeId, amountCents, outstandingAdvanceCents: employeeAdvanceBalanceCents(employeeId) }
    })()
    res.status(201).json(result)
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.get('/finance/dashboard', requireAuth, allowRoles('admin'), (req, res) => {
  const from = req.query.from ? `${String(req.query.from).slice(0,10)} 00:00:00` : null
  const to = req.query.to ? `${String(req.query.to).slice(0,10)} 23:59:59` : null
  const totals = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN kind='income' AND category<>'تمويل الشركة — غير إيراد' THEN amount ELSE 0 END),0) AS income,
    COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) AS expense,
    COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE -amount END),0) AS cash_balance,
    COALESCE(SUM(CASE WHEN category='تمويل الشركة — غير إيراد' THEN amount ELSE 0 END),0) AS owner_funding
    FROM treasury_transactions WHERE (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?)`).get(from, from, to, to)
  const inventoryValue = db.prepare('SELECT COALESCE(SUM((stock+sub_stock)*unit_cost),0) AS total FROM materials WHERE active=1 AND deleted_at IS NULL').get().total
  const workOrderFinancials = workOrderFinancialSummary(from, to)
  const monthRows = db.prepare(`SELECT strftime('%Y-%m',created_at) AS month,
    COALESCE(SUM(CASE WHEN kind='income' AND category<>'تمويل الشركة — غير إيراد' THEN amount ELSE 0 END),0) AS income,
    COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) AS expense
    FROM treasury_transactions WHERE created_at>=datetime('now','start of month','-5 months')
      AND (? IS NULL OR created_at>=?) AND (? IS NULL OR created_at<=?)
    GROUP BY strftime('%Y-%m',created_at) ORDER BY month`).all(from, from, to, to)
  const byMonth = new Map(monthRows.map((row) => [row.month, row]))
  const monthly = []
  const cursor = new Date()
  cursor.setDate(1)
  cursor.setHours(0, 0, 0, 0)
  cursor.setMonth(cursor.getMonth() - 5)
  for (let index = 0; index < 6; index += 1) {
    const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`
    const row = byMonth.get(key) || { income: 0, expense: 0 }
    monthly.push({ month: key, label: new Intl.DateTimeFormat('ar-EG', { month: 'short' }).format(cursor), income: row.income, expense: row.expense })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  const entries = db.prepare(`SELECT t.*,u.full_name AS user_name,i.code AS invoice_code,e.name AS employee_name
    FROM treasury_transactions t LEFT JOIN users u ON u.id=t.created_by LEFT JOIN invoices i ON i.id=t.invoice_id
    LEFT JOIN employees e ON e.id=t.employee_id
    WHERE (? IS NULL OR t.created_at>=?) AND (? IS NULL OR t.created_at<=?)
    ORDER BY t.id DESC LIMIT 100`).all(from, from, to, to)
  const invoices = db.prepare(`SELECT i.id,i.code,i.kind,i.total,i.paid_total,i.remaining,i.payment_status,i.notes,i.status,i.created_at,i.supplier,
      i.subtotal_cents,i.tax_cents,i.tax_rate_basis_points,i.sale_type,
      (SELECT COUNT(*) FROM purchase_invoice_revisions pr WHERE pr.invoice_id=i.id) AS revision_count,
    c.name AS client_name,o.code AS order_code,e.name AS employee_name
    FROM invoices i LEFT JOIN clients c ON c.id=i.client_id LEFT JOIN orders o ON o.id=i.order_id
    LEFT JOIN employees e ON e.id=i.employee_id
    WHERE i.deleted_at IS NULL AND (? IS NULL OR i.created_at>=?) AND (? IS NULL OR i.created_at<=?) ORDER BY i.id DESC LIMIT 50`).all(from, from, to, to)
  const otherInvoices = db.prepare(`SELECT oi.*,e.name AS employee_name FROM other_invoices oi
    LEFT JOIN employees e ON e.id=oi.employee_id WHERE oi.deleted_at IS NULL
      AND (? IS NULL OR oi.created_at>=?) AND (? IS NULL OR oi.created_at<=?) ORDER BY oi.id DESC LIMIT 50`).all(from, from, to, to)
  const receivables = db.prepare(`SELECT i.id,i.code,i.total,i.paid_total,i.remaining,i.payment_status,i.created_at,c.name AS client_name
    FROM invoices i JOIN clients c ON c.id=i.client_id WHERE i.kind='sales' AND i.remaining>0 AND i.deleted_at IS NULL
    ORDER BY i.created_at,i.id LIMIT 100`).all()
  const totalReceivableCents = Number(db.prepare(`SELECT COALESCE(SUM(ROUND(remaining*100)),0) AS cents FROM invoices
    WHERE kind='sales' AND remaining>0 AND deleted_at IS NULL`).get().cents)
  res.json({
    summary: { income: totals.income, expense: totals.expense, cashBalance: currencyAmountFromCents(cashboxBalanceCents()),
      ownerFunding: totals.owner_funding, inventoryValue,
      grossProfit: workOrderFinancials.grossProfitCents / 100,
      grossProfitCents: workOrderFinancials.grossProfitCents,
      workOrderRevenueCents: workOrderFinancials.revenueCents,
      workOrderCogsCents: workOrderFinancials.cogsCents,
      profitStatus: workOrderFinancials.profitStatus,
      unclassifiedHistoricalIssueCount: workOrderFinancials.unclassifiedHistoricalIssueCount,
      pendingWorkOrderCogsEntries: workOrderFinancials.pendingJournalEntries,
       expectedProfit: workOrderFinancials.grossProfitCents / 100, totalReceivableCents },
    monthly, entries, invoices, otherInvoices, receivables,
  })
})

api.post('/treasury/entries', requireAuth, allowRoles('admin'), (req, res) => {
  const kind = req.body?.kind
  const amountCents = parseCurrencyCents(req.body?.amount)
  const amount = amountCents === null ? null : currencyAmountFromCents(amountCents)
  const category = String(req.body?.category || '').trim()
  let employeeId
  try { employeeId = resolveEmployeeId(req.body?.employeeId) }
  catch (error) { return sendError(res, error.status || 400, error.message) }
  if (!['income', 'expense'].includes(kind) || amount === null || !category) {
    return sendError(res, 400, 'اختر نوع الحركة واكتب تصنيفًا ومبلغًا صحيحًا أكبر من صفر.')
  }
  const result = db.transaction(() => {
    if (kind === 'expense' && cashboxBalanceCents() < amountCents) throw apiError(409, 'رصيد صندوق المصنع لا يكفي لهذا المصروف.')
    const inserted = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,created_by,worker_id,employee_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(kind, amount, category, String(req.body.reference || ''), String(req.body.notes || ''), req.user.id, null, employeeId)
    const mappingKey = `treasury_${kind}:${inserted.lastInsertRowid}`
    db.prepare('INSERT OR IGNORE INTO account_mappings(mapping_key,account_id,approved) VALUES (?,NULL,0)').run(mappingKey)
    const postings = kind === 'income'
      ? [
        { mappingKey: 'factory_cashbox', debitCents: amountCents, description: category },
        { mappingKey, creditCents: amountCents, description: category },
      ]
      : [
        { mappingKey, debitCents: amountCents, description: category },
        { mappingKey: 'factory_cashbox', creditCents: amountCents, description: category },
      ]
    queueJournalEntry(db, { sourceType: 'treasury_transaction', sourceId: inserted.lastInsertRowid,
      sourceKey: `treasury-entry:${inserted.lastInsertRowid}`, description: category, createdBy: req.user.id, postings })
    audit(req.user.id, kind, 'treasury', inserted.lastInsertRowid, category, null,
      { kind, amount, category, reference: req.body.reference || '', employeeId })
    return inserted
  })()
  res.status(201).json({ id: result.lastInsertRowid })
})

api.post('/treasury/funding', requireAuth, allowRoles('admin'), (req, res) => {
  const amountCents = parseCurrencyCents(req.body?.amount)
  if (amountCents === null) return sendError(res, 400, 'أدخل مبلغ تمويل صحيحًا أكبر من صفر وبحد أقصى منزلتين عشريتين.')
  const amount = currencyAmountFromCents(amountCents)
  const reference = String(req.body?.reference || '').trim().slice(0, 120)
  const notes = String(req.body?.notes || '').trim().slice(0, 2000)
  const result = db.transaction(() => {
    const inserted = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,created_by)
      VALUES ('income',?,'تمويل الشركة — غير إيراد',?,?,?)`).run(amount, reference, notes, req.user.id)
    queueJournalEntry(db, { sourceType: 'company_funding', sourceId: inserted.lastInsertRowid,
      sourceKey: `company-funding:${inserted.lastInsertRowid}`, description: 'تمويل صندوق المصنع', createdBy: req.user.id,
      postings: [
        { mappingKey: 'factory_cashbox', debitCents: amountCents, description: 'تمويل صندوق المصنع' },
        { mappingKey: 'owner_funding', creditCents: amountCents, description: 'مقابل التمويل — يتطلب اعتماد المحاسب' },
      ],
    })
    audit(req.user.id, 'funding', 'treasury', inserted.lastInsertRowid, 'factory-cashbox', null, { amount, reference, notes })
    return inserted
  })()
  res.status(201).json({ id: result.lastInsertRowid, amount, classification: 'non_revenue' })
})

api.get('/audit', requireAuth, allowRoles('admin'), (req, res) => {
  const conditions = []
  const params = []
  for (const field of ['entity', 'action']) {
    if (req.query[field]) { conditions.push(`a.${field}=?`); params.push(String(req.query[field]).slice(0, 100)) }
  }
  if (req.query.userId && Number.isInteger(Number(req.query.userId))) {
    conditions.push('a.user_id=?'); params.push(Number(req.query.userId))
  }
  if (req.query.from) { conditions.push('a.created_at>=?'); params.push(String(req.query.from).slice(0, 30)) }
  if (req.query.to) { conditions.push("a.created_at<datetime(?,'+1 day')"); params.push(String(req.query.to).slice(0, 10)) }
  const limit = Math.max(1, Math.min(200, Number.parseInt(req.query.limit, 10) || 100))
  const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0)
  const rows = db.prepare(`SELECT a.*,u.username,u.full_name AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id=a.user_id ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
  res.json(rows.map((row) => ({ ...row,
    old_values: row.old_values ? JSON.parse(row.old_values) : null,
    new_values: row.new_values ? JSON.parse(row.new_values) : null,
  })))
})

api.post('/backup/create', requireAuth, allowRoles('admin'), createRateLimiter('POST /backup/create'), asyncRoute(async (req, res) => {
  const backupPath = await runBackup(req.apiActivityToken)
  res.download(backupPath, path.basename(backupPath), (error) => {
    if (!error) return
    if (res.headersSent) return res.destroy(error)
    sendError(res, error.status || 500, 'تعذر تنزيل ملف النسخة الاحتياطية.')
  })
}))

async function availableDiskMiB(directory) {
  try {
    const stats = await fs.promises.statfs(directory)
    const availableBytes = stats.bavail * stats.bsize
    return Number.isFinite(availableBytes) && availableBytes >= 0
      ? Math.floor(availableBytes / (1024 * 1024))
      : null
  } catch {
    return null
  }
}

async function countPendingOrderDeletionStages() {
  const orders = db.prepare(`SELECT o.id,o.code,o.type,c.code AS client_code,c.name AS client_name
    FROM orders o LEFT JOIN clients c ON c.id=o.client_id`).all()
  let count = 0
  for (const order of orders) {
    if (!order.client_code || !order.client_name || !order.code) continue
    const orderDirectory = clientOrderDirectory({ code: order.client_code, name: order.client_name }, order)
    if (await fsExtra.lstat(orderDeletionStagePath(orderDirectory, order.id)).catch((error) => error.code === 'ENOENT' ? null : Promise.reject(error))) count += 1
  }
  return count
}

api.get('/operations/status', requireAuth, asyncRoute(async (_req, res) => {
  const backup = db.prepare(`SELECT last_success_at,last_success_bytes,last_failure_at,last_failure_code,last_duration_ms
    FROM backup_health WHERE id=1`).get()
  const [storageAvailableMiB, backupAvailableMiB, orderDeletionStages] = await Promise.all([
    availableDiskMiB(storageRoot), availableDiskMiB(backupsRoot), countPendingOrderDeletionStages(),
  ])
  const filesystemOperations = pendingFilesystemOperationsCount(db)
  const totalPendingRecovery = filesystemOperations + orderDeletionStages
  if (totalPendingRecovery > 0) {
    upsertPersistentNotification({ key: 'pending_recovery', kind: 'pending_recovery', title: 'استرداد ملفات معلق',
      detail: `${filesystemOperations} عملية ملفات و${orderDeletionStages} مجلد أمر`, sourceType: 'recovery', sourceId: 'pending' })
  } else {
    resolvePersistentNotification('pending_recovery')
  }
  res.json({
    ready: totalPendingRecovery === 0,
    backup: {
      lastSuccessAt: backup.last_success_at,
      lastSuccessBytes: backup.last_success_bytes,
      lastFailureAt: backup.last_failure_at,
      lastFailureCode: backup.last_failure_code,
      lastDurationMs: backup.last_duration_ms,
    },
    freeSpaceMiB: { storage: storageAvailableMiB, backups: backupAvailableMiB },
    pendingRecovery: {
      filesystemOperations,
      orderDeletionStages,
      total: totalPendingRecovery,
    },
  })
}))

api.get('/notifications', requireAuth, allowRoles('admin'), asyncRoute(async (_req, res) => {
  res.json(await syncPersistentNotifications())
}))

api.post('/notifications/:id/review', requireAuth, allowRoles('admin'), (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id < 1) return sendError(res, 400, 'رقم الإشعار غير صالح.')
  const notification = db.prepare('SELECT * FROM persistent_notifications WHERE id=?').get(id)
  if (!notification) return sendError(res, 404, 'الإشعار غير موجود.')
  db.transaction(() => {
    db.prepare(`UPDATE persistent_notifications SET reviewed_at=COALESCE(reviewed_at,CURRENT_TIMESTAMP),reviewed_by=? WHERE id=?`)
      .run(req.user.id, id)
    audit(req.user.id, 'review', 'notification', id, notification.notification_key,
      { reviewedAt: notification.reviewed_at }, { reviewedAt: new Date().toISOString() })
  })()
  res.json({ ok: true })
})

api.post('/backup/restore', requireAuth, allowRoles('admin'), createRateLimiter('POST /backup/restore'), restoreArchiveUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return sendError(res, 400, 'اختر ملف النسخة الاحتياطية بصيغة ZIP.')
  if (req.body?.confirmation !== 'RESTORE MADAR') {
    await fs.promises.rm(req.file.path, { force: true })
    return sendError(res, 400, 'اكتب RESTORE MADAR لتأكيد الاستعادة.')
  }

  const restoreId = crypto.randomUUID()
  const extractionRoot = path.join(backupsRoot, `.madar-restore-${restoreId}`)
  const journalPath = path.join(backupsRoot, '.madar-restore-journal.json')
  const plan = buildRestorePlan({ id: restoreId, databasePath, storageRoot, extractionRoot })
  let releaseSnapshot = null
  let restoreAccepted = false
  try {
    await extractBackupArchive(req.file.path, extractionRoot, { maxExtractedBytes: backupRestoreExtractLimit })
    releaseSnapshot = await acquireSnapshotLock(req.apiActivityToken)
    const rollbackBackup = await createBackup()
    await stageRestoreFiles(plan)
    recordRestoreAudit(plan.databaseStagePath, {
      actorId: req.user.id,
      username: req.user.username,
      sourceFile: path.basename(req.file.originalname),
      rollbackFile: path.basename(rollbackBackup),
    })
    await fs.promises.rm(req.file.path, { force: true })
    restoreAccepted = true
    res.status(202).json({
      ok: true,
      restarting: true,
      rollbackBackup: path.basename(rollbackBackup),
      message: 'تم التحقق من النسخة. سيعاد تشغيل الخادم لإتمام الاستعادة.',
    })
    res.once('finish', () => {
      setImmediate(() => { void activatePreparedRestore({ plan, journalPath }) })
    })
  } catch (error) {
    if (releaseSnapshot) releaseSnapshot()
    if (!restoreAccepted) {
      await Promise.all([
        fs.promises.rm(req.file.path, { force: true }).catch(() => {}),
        fs.promises.rm(extractionRoot, { recursive: true, force: true }).catch(() => {}),
        fs.promises.rm(plan.databaseStagePath, { force: true }).catch(() => {}),
        fs.promises.rm(plan.storageStagePath, { recursive: true, force: true }).catch(() => {}),
      ])
    }
    if (res.headersSent) return res.destroy(error)
    return sendError(res, error.status || 400, error.message || 'تعذرت استعادة النسخة الاحتياطية.')
  }
}))

api.post('/system/backups', requireAuth, allowRoles('admin'), createRateLimiter('POST /system/backups'), asyncRoute(async (req, res) => {
  const backupPath = await runBackup(req.apiActivityToken)
  res.status(201).json({ file: path.basename(backupPath) })
}))

api.post('/inventory/import', requireAuth, allowRoles('admin', 'purchasing'), createRateLimiter('POST /inventory/import'), inventoryImportUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return sendError(res, 400, 'اختر ملف CSV أو XLSX.')
  try {
    let rows
    const extension = path.extname(req.file.originalname).toLowerCase()
    if (extension === '.csv') {
      rows = await readCsvRows(req.file.path)
    } else if (extension === '.xlsx') {
      const workbook = await XlsxPopulate.fromFileAsync(req.file.path)
      const values = workbook.sheet(0)?.usedRange()?.value()
      if (!Array.isArray(values) || !values.length) return sendError(res, 400, 'ملف Excel لا يحتوي على ورقة بيانات.')
      const headers = (Array.isArray(values[0]) ? values[0] : [values[0]]).map((value) => String(value || '').trim())
      rows = values.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header, row?.[index] ?? ''])))
    } else return sendError(res, 400, 'صيغة الملف غير مدعومة؛ استخدم CSV أو XLSX.')

    const field = (row, keys) => {
      const match = Object.entries(row).find(([header]) => keys.some((key) => normalize(header).includes(normalize(key))))
      return match ? String(match[1] ?? '').trim() : ''
    }
    const counts = { added: 0, updated: 0, deactivated: 0, skipped: 0 }
    const seenCodes = new Set()
    const selectByCode = db.prepare('SELECT * FROM materials WHERE code=?')
    const insert = db.prepare(`INSERT INTO materials(code,name,specification,unit,stock,sub_stock,unit_cost,min_stock,active,deleted_at,variant_key)
      VALUES (?,?,?,?,?,?,?,?,1,NULL,?)`)
    const movement = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,source_type,source_id)
      VALUES (?,'adjustment',?,'استيراد جرد',?,?,?,'inventory_import',?)`)
    const importRows = db.transaction(() => {
      for (const row of rows) {
        const name = field(row, ['اسم الخامة', 'اسم الصنف', 'name', 'material'])
        const code = field(row, ['كود الخامة', 'كود الصنف', 'كود', 'code'])
        const stockValue = field(row, ['المخزن الأساسي', 'الرصيد الأساسي', 'الرصيد الحالي', 'الكمية', 'stock', 'main stock'])
        const subStockValue = field(row, ['مخزن البواقي', 'الرصيد الفرعي', 'البواقي', 'offcuts', 'sub stock'])
        const unitCostValue = field(row, ['تكلفة الوحدة', 'التكلفة', 'unit cost', 'cost'])
        const specification = field(row, ['المواصفة', 'المواصفات', 'specification', 'spec'])
        const minStockValue = field(row, ['حد إعادة الطلب', 'الحد الأدنى', 'min stock'])
        const unit = field(row, ['الوحدة', 'unit']) || 'قطعة'
        const stock = stockValue === '' ? 0 : Number(stockValue)
        const subStock = subStockValue === '' ? 0 : Number(subStockValue)
        const unitCost = parseOptionalCurrencyAmount(unitCostValue)
        const minStock = minStockValue === '' ? 0 : Number(minStockValue)
        if (!name || !code || ![stock, subStock, unitCost, minStock].every(Number.isFinite) || !Number.isInteger(stock) || stock < 0 || subStock < 0 || unitCost < 0 || minStock < 0) {
          counts.skipped += 1
          continue
        }
        seenCodes.add(code)
        const variantKey = materialVariantKey({ name, specification, unit,
          unitCostCents: Math.round(unitCost * 100) })
        const existing = selectByCode.get(code)
        if (!existing) {
          if (db.prepare('SELECT 1 FROM materials WHERE variant_key=?').get(variantKey)) {
            counts.skipped += 1
            continue
          }
          const materialId = insert.run(code, name, specification, unit, stock, subStock, unitCost, minStock, variantKey).lastInsertRowid
          if (stock) {
            const movementId = movement.run(materialId, stock, `رصيد أساسي افتتاحي من الاستيراد: ${name}`, req.user.id, 'main', code).lastInsertRowid
            createInventoryLot({ materialId, sourceType: 'inventory_import', sourceId: movementId, warehouse: 'main',
              quantity: stock, unitCostCents: Math.round(unitCost * 100) })
          }
          if (subStock) {
            const movementId = movement.run(materialId, subStock, `رصيد بواقي افتتاحي من الاستيراد: ${name}`, req.user.id, 'sub', code).lastInsertRowid
            createInventoryLot({ materialId, sourceType: 'inventory_import', sourceId: movementId, warehouse: 'sub',
              quantity: subStock, unitCostCents: Math.round(unitCost * 100) })
          }
          audit(req.user.id, 'import-create', 'material', materialId, 'excel-import', null,
            { code, name, specification, unit, stock, subStock, unitCost, minStock, active: 1 })
          counts.added += 1
          continue
        }
        assertMaterialUnlocked(existing.id)
        const duplicateVariant = db.prepare('SELECT id FROM materials WHERE variant_key=? AND id<>?').get(variantKey, existing.id)
        if (duplicateVariant) throw apiError(409, `يتعارض كود ${code} مع متغير صنف آخر مطابق.`)
        const mainDelta = stock - existing.stock
        const subDelta = subStock - existing.sub_stock
        const adjustImportLot = (warehouse, delta, label) => {
          if (Math.abs(delta) <= 0.000001) return
          const movementId = movement.run(existing.id, delta, label, req.user.id, warehouse, code).lastInsertRowid
          if (delta > 0) createInventoryLot({ materialId: existing.id, sourceType: 'inventory_import', sourceId: movementId,
            warehouse, quantity: delta, unitCostCents: Math.round(unitCost * 100) })
          else consumeInventoryLots(existing.id, warehouse, -delta, movementId)
        }
        adjustImportLot('main', mainDelta, `تسوية رصيد أساسي عبر الاستيراد: ${name}`)
        adjustImportLot('sub', subDelta, `تسوية رصيد بواقي عبر الاستيراد: ${name}`)
        db.prepare(`UPDATE materials SET name=?,specification=?,unit=?,stock=?,sub_stock=?,unit_cost=?,min_stock=?,active=1,deleted_at=NULL,variant_key=? WHERE id=?`)
          .run(name, specification, unit, stock, subStock, unitCost, minStock, variantKey, existing.id)
        audit(req.user.id, 'import-update', 'material', existing.id, 'excel-import', existing,
          { code, name, specification, unit, stock, subStock, unitCost, minStock, active: 1, deleted_at: null })
        counts.updated += 1
      }
      if (['true', '1', 'yes'].includes(String(req.body?.deactivateMissing || '').toLowerCase()) && seenCodes.size) {
        const placeholders = [...seenCodes].map(() => '?').join(',')
        const missing = db.prepare(`SELECT * FROM materials WHERE active=1 AND deleted_at IS NULL AND code NOT IN (${placeholders})`).all(...seenCodes)
        counts.deactivated = db.prepare(`UPDATE materials SET active=0 WHERE active=1 AND deleted_at IS NULL AND code NOT IN (${placeholders})`)
          .run(...seenCodes).changes
        for (const material of missing) audit(req.user.id, 'deactivate-missing', 'material', material.id, 'excel-import', material, { ...material, active: 0 })
      }
    })
    importRows()
    audit(req.user.id, 'import', 'inventory', '', `added=${counts.added}; updated=${counts.updated}; deactivated=${counts.deactivated}; skipped=${counts.skipped}`,
      null, counts)
    res.json(counts)
  } catch (error) {
    return sendError(res, 400, `تعذر قراءة الملف أو استيراد الأرصدة: ${error.message}`)
  }
}))

api.get('/inventory/export.xlsx', requireAuth, allowRoles('admin', 'purchasing'), createRateLimiter('GET /inventory/export.xlsx'), asyncRoute(async (_req, res) => {
  const workbook = await XlsxPopulate.fromBlankAsync()
  const sheet = workbook.sheet(0).name('جرد المخزون')
  const rows = [
    ['كود الخامة', 'اسم الخامة', 'الوحدة', 'المخزن الأساسي', 'مخزن البواقي', 'تكلفة الوحدة', 'حد إعادة الطلب'],
    ...db.prepare('SELECT code,name,unit,stock,sub_stock,unit_cost,min_stock FROM materials WHERE active=1 AND deleted_at IS NULL ORDER BY name').all()
      .map((item) => [item.code, item.name, item.unit, item.stock, item.sub_stock, item.unit_cost, item.min_stock]),
  ]
  sheet.cell(1, 1).value(rows)
  sheet.row(1).style({ bold: true, fill: 'EAF2FB' })
  sheet.column(1).width(18); sheet.column(2).width(34); sheet.column(3).width(14)
  for (let column = 4; column <= 7; column += 1) sheet.column(column).width(20)
  const buffer = await workbook.outputAsync()
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="Madar-Inventory.xlsx"')
  res.send(buffer)
}))

api.post('/inventory/issue', requireAuth, allowRoles('admin', 'purchasing', 'operations'), (req, res) => {
  const materialId = Number(req.body?.materialId)
  const quantity = Number(req.body?.quantity)
  if (!Number.isInteger(materialId) || !(quantity > 0) || !Number.isFinite(quantity)) return sendError(res, 400, 'اختر خامة وأدخل كمية صحيحة.')
  const warehouse = String(req.body?.warehouse || 'auto')
  if (!['auto', 'sub', 'main'].includes(warehouse)) return sendError(res, 400, 'مصدر الصرف غير صالح.')
  const classification = String(req.body?.classification || '')
  const rawOrderId = req.body?.orderId
  const orderId = rawOrderId == null || rawOrderId === '' ? null : Number(rawOrderId)
  if (!['order', 'general'].includes(classification)) return sendError(res, 400, 'صنّف الصرف كأمر تشغيل أو استهلاك عام.')
  if ((classification === 'order' && (!Number.isSafeInteger(orderId) || orderId < 1))
    || (classification === 'general' && orderId !== null)) {
    return sendError(res, 400, 'اختر أمرًا صحيحًا للصرف المرتبط به، أو صنّف الصرف كاستهلاك عام فقط.')
  }
  const issue = db.transaction(() => {
    const material = db.prepare('SELECT * FROM materials WHERE id=? AND active=1 AND deleted_at IS NULL').get(materialId)
    if (!material) throw apiError(404, 'الخامة غير موجودة.')
    assertMaterialUnlocked(materialId)
    const order = classification === 'order'
      ? db.prepare("SELECT id,code FROM orders WHERE id=? AND deleted_at IS NULL AND status<>'archived'").get(orderId)
      : null
    if (classification === 'order' && !order) throw apiError(404, 'أمر التشغيل المحدد غير موجود.')
    const result = calculateIssue({ mainStock: material.stock, subStock: material.sub_stock || 0, quantity, warehouse })
    const reference = String(req.body.reference || order?.code || '').trim().slice(0, 120)
    const notes = String(req.body.notes || '').trim().slice(0, 1000)
    const issueId = db.prepare(`INSERT INTO inventory_issues(classification,order_id,reference,requested_quantity,created_by)
      VALUES (?,?,?,?,?)`).run(classification, orderId, reference, quantity, req.user.id).lastInsertRowid
    db.prepare('UPDATE materials SET stock=?,sub_stock=? WHERE id=?').run(result.stock, result.subStock, material.id)
    const insertMovement = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,source_type,source_id,issue_id)
      VALUES (?,?,?,?,?,?,?,'inventory_issue',?,?)`)
    const remaining = Math.max(0, quantity - result.subUsed)
    let grossCostCents = 0
    let offcutCostCents = 0
    if (result.mainDeducted) {
      const movementId = insertMovement.run(material.id, 'issue', -result.mainDeducted, reference,
        `استهلاك فعلي ${remaining} ${material.unit}. ${notes}`.trim(), req.user.id, 'main', issueId, issueId).lastInsertRowid
      const consumption = consumeInventoryLots(material.id, 'main', result.mainDeducted, movementId)
      grossCostCents += consumption.totalCostCents
      if (result.offcutCreated > 0) {
        offcutCostCents = Math.min(consumption.totalCostCents,
          Math.round(result.offcutCreated * consumption.lastUnitCostCents))
      }
    }
    if (result.subUsed) {
      const movementId = insertMovement.run(material.id, 'issue', -result.subUsed, reference,
        `استخدام بواقي ${result.subUsed} ${material.unit}. ${notes}`.trim(), req.user.id, 'sub', issueId, issueId).lastInsertRowid
      const consumption = consumeInventoryLots(material.id, 'sub', result.subUsed, movementId)
      grossCostCents += consumption.totalCostCents
    }
    if (result.offcutCreated > 0) {
      const offcutMovementId = insertMovement.run(material.id, 'adjustment', result.offcutCreated, reference,
        `باقٍ صالح لإعادة الاستخدام بعد صرف ${quantity} ${material.unit}.`, req.user.id, 'sub', issueId, issueId).lastInsertRowid
      const mainMovementId = db.prepare(`SELECT id FROM inventory_movements WHERE issue_id=? AND kind='issue' AND warehouse='main' ORDER BY id DESC LIMIT 1`).get(issueId)?.id
      const lastConsumption = mainMovementId
        ? db.prepare(`SELECT l.unit_cost_cents FROM inventory_lot_consumptions c JOIN inventory_lots l ON l.id=c.lot_id
            WHERE c.movement_id=? ORDER BY c.id DESC LIMIT 1`).get(mainMovementId)
        : null
      createInventoryLot({ materialId: material.id, sourceType: 'issue_offcut', sourceId: offcutMovementId,
        warehouse: 'sub', quantity: result.offcutCreated, unitCostCents: Number(lastConsumption?.unit_cost_cents || 0) })
    }
    const cogsCents = Math.max(0, grossCostCents - offcutCostCents)
    db.prepare('UPDATE inventory_issues SET gross_cost_cents=?,offcut_cost_cents=?,cogs_cents=? WHERE id=?')
      .run(grossCostCents, offcutCostCents, cogsCents, issueId)
    const journal = queueInventoryIssueJournal(db, {
      issueId, classification, grossCostCents, offcutCostCents,
      description: `${classification === 'order' ? `تكلفة مواد ${order.code}` : 'استهلاك مخزون عام'} — ${material.code}`,
      createdBy: req.user.id,
    })
    if (journal.id) db.prepare('UPDATE inventory_issues SET journal_entry_id=? WHERE id=?').run(journal.id, issueId)
    audit(req.user.id, 'issue', 'inventory-issue', issueId,
      `material=${materialId}; quantity=${quantity}; classification=${classification}; orderId=${orderId || ''}; journal=${journal.id || ''}`,
      null, { materialId, quantity, warehouse, classification, orderId, grossCostCents, offcutCostCents, cogsCents, journalEntryId: journal.id })
    audit(req.user.id, 'issue', 'material', materialId, `quantity=${quantity}; warehouse=${warehouse}; main=${result.mainDeducted}; offcut=${result.offcutCreated}`,
      { stock: material.stock, subStock: material.sub_stock || 0 }, { stock: result.stock, subStock: result.subStock })
    return { ...result, issueId, orderId, classification, grossCostCents, offcutCostCents, cogsCents, journalStatus: journal.status }
  })
  try {
    const result = issue()
    res.json({ ok: true, ...result })
  } catch (error) {
    return sendError(res, error.status || (error.message.includes('لا يكفي') || error.message.includes('مصدر رصيد') ? 409 : 400), error.message)
  }
})

api.get('/inventory/movements', requireAuth, allowRoles('admin', 'purchasing', 'operations'), (_req, res) => {
  res.json(db.prepare(`SELECT im.*,m.code AS material_code,m.name AS material_name,u.full_name AS user_name,
      ii.classification AS issue_classification,o.code AS order_code
    FROM inventory_movements im JOIN materials m ON m.id=im.material_id LEFT JOIN users u ON u.id=im.created_by
    LEFT JOIN inventory_issues ii ON ii.id=im.issue_id LEFT JOIN orders o ON o.id=ii.order_id
    ORDER BY im.id DESC LIMIT 300`).all())
})

api.get('/inventory/stock-counts', requireAuth, allowRoles('admin'), (_req, res) => {
  res.json(db.prepare(`SELECT c.*,u.full_name AS created_by_name,au.full_name AS approved_by_name,
      COUNT(i.id) AS item_count,SUM(CASE WHEN i.counted_stock IS NULL OR i.counted_sub_stock IS NULL THEN 1 ELSE 0 END) AS uncounted
    FROM stock_counts c LEFT JOIN stock_count_items i ON i.count_id=c.id
      LEFT JOIN users u ON u.id=c.created_by LEFT JOIN users au ON au.id=c.approved_by
    GROUP BY c.id ORDER BY c.id DESC LIMIT 100`).all())
})

api.get('/inventory/stock-counts/:id', requireAuth, allowRoles('admin'), (req, res) => {
  const countId = Number(req.params.id)
  const count = db.prepare('SELECT * FROM stock_counts WHERE id=?').get(countId)
  if (!count) return sendError(res, 404, 'محضر الجرد غير موجود.')
  const items = db.prepare(`SELECT i.*,m.code,m.name,m.specification,m.unit,m.unit_cost FROM stock_count_items i
    JOIN materials m ON m.id=i.material_id WHERE i.count_id=? ORDER BY m.name COLLATE NOCASE,m.code`).all(countId)
  res.json({ ...count, items })
})

api.post('/inventory/stock-counts', requireAuth, allowRoles('admin'), (req, res) => {
  const reason = String(req.body?.reason || '').trim().slice(0, 1000)
  if (!reason) return sendError(res, 400, 'اذكر سبب الجرد قبل فتح المحضر.')
  const requestedIds = req.body?.materialIds
  if (requestedIds !== undefined && (!Array.isArray(requestedIds) || requestedIds.length > 5000
    || requestedIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) < 1))) {
    return sendError(res, 400, 'قائمة الأصناف للجرد غير صالحة.')
  }
  const ids = requestedIds === undefined ? null : [...new Set(requestedIds.map(Number))]
  if (ids && ids.length !== requestedIds.length) return sendError(res, 400, 'قائمة الأصناف تحتوي على تكرار.')
  try {
    const count = db.transaction(() => {
      const materials = ids
        ? db.prepare(`SELECT id,stock,sub_stock FROM materials WHERE active=1 AND deleted_at IS NULL AND id IN (${ids.map(() => '?').join(',')})`).all(...ids)
        : db.prepare('SELECT id,stock,sub_stock FROM materials WHERE active=1 AND deleted_at IS NULL ORDER BY id').all()
      if (ids && materials.length !== ids.length) throw apiError(400, 'تحتوي قائمة الجرد على صنف غير نشط أو غير موجود.')
      if (!materials.length) throw apiError(400, 'لا توجد أصناف نشطة لفتح محضر الجرد.')
      const code = nextCode('stock_count', 'CNT')
      const inserted = db.prepare(`INSERT INTO stock_counts(code,reason,created_by) VALUES (?,?,?)`).run(code, reason, req.user.id)
      const insertItem = db.prepare(`INSERT INTO stock_count_items(count_id,material_id,recorded_stock,recorded_sub_stock)
        VALUES (?,?,?,?)`)
      for (const material of materials) {
        assertMaterialUnlocked(material.id)
        insertItem.run(inserted.lastInsertRowid, material.id, material.stock, material.sub_stock)
      }
      audit(req.user.id, 'open', 'stock-count', inserted.lastInsertRowid, code, null,
        { reason, itemCount: materials.length, locksInventory: true })
      return { id: inserted.lastInsertRowid, code, status: 'open', itemCount: materials.length }
    })()
    res.status(201).json(count)
  } catch (error) { return sendError(res, error.status || 409, error.message) }
})

api.put('/inventory/stock-counts/:id/items', requireAuth, allowRoles('admin'), (req, res) => {
  const countId = Number(req.params.id)
  const requested = Array.isArray(req.body?.items) ? req.body.items : []
  if (!Number.isSafeInteger(countId) || countId < 1 || !requested.length || requested.length > 5000) {
    return sendError(res, 400, 'أدخل كميات الجرد لمحضر صالح.')
  }
  const counts = requested.map((item) => ({ materialId: Number(item?.materialId), stock: Number(item?.stock), subStock: Number(item?.subStock) }))
  if (counts.some((item) => !Number.isSafeInteger(item.materialId) || item.materialId < 1
    || !Number.isFinite(item.stock) || !Number.isInteger(item.stock) || item.stock < 0
    || !Number.isFinite(item.subStock) || item.subStock < 0 || Math.abs(item.subStock * 1_000_000 - Math.round(item.subStock * 1_000_000)) > 0.000001)
    || new Set(counts.map((item) => item.materialId)).size !== counts.length) {
    return sendError(res, 400, 'الرصيد الأساسي يجب أن يكون عددًا صحيحًا، ورصيد البواقي غير سالب وبحد أقصى ست منازل عشرية.')
  }
  try {
    db.transaction(() => {
      const count = db.prepare("SELECT * FROM stock_counts WHERE id=? AND status='open'").get(countId)
      if (!count) throw apiError(409, 'محضر الجرد غير مفتوح للتعديل.')
      const update = db.prepare(`UPDATE stock_count_items SET counted_stock=?,counted_sub_stock=? WHERE count_id=? AND material_id=?`)
      const beforeItems = []
      for (const item of counts) {
        const existing = db.prepare(`SELECT i.material_id,m.code,i.recorded_stock,i.recorded_sub_stock,i.counted_stock,i.counted_sub_stock
          FROM stock_count_items i JOIN materials m ON m.id=i.material_id WHERE i.count_id=? AND i.material_id=?`)
          .get(countId, item.materialId)
        if (!existing) {
          throw apiError(400, 'يوجد صنف خارج محضر الجرد المحدد.')
        }
        beforeItems.push(existing)
        update.run(item.stock, item.subStock, countId, item.materialId)
      }
      const newItems = counts.map((item) => ({ material_id: item.materialId, counted_stock: item.stock,
        counted_sub_stock: item.subStock }))
      audit(req.user.id, 'count-items', 'stock-count', countId, count.code,
        { items: beforeItems }, { items: newItems })
    })()
    res.json({ ok: true, updated: counts.length })
  } catch (error) { return sendError(res, error.status || 400, error.message) }
})

api.post('/inventory/stock-counts/:id/approve', requireAuth, allowRoles('admin'), (req, res) => {
  const countId = Number(req.params.id)
  try {
    const result = db.transaction(() => {
      const count = db.prepare("SELECT * FROM stock_counts WHERE id=? AND status='open'").get(countId)
      if (!count) throw apiError(409, 'محضر الجرد غير مفتوح للاعتماد.')
      const items = db.prepare(`SELECT i.*,m.stock,m.sub_stock,m.unit_cost,m.code FROM stock_count_items i
        JOIN materials m ON m.id=i.material_id WHERE i.count_id=? ORDER BY i.material_id`).all(countId)
      if (!items.length || items.some((item) => item.counted_stock === null || item.counted_sub_stock === null)) {
        throw apiError(409, 'يجب إدخال الكميات الفعلية لكل صنف قبل اعتماد المحضر.')
      }
      const movement = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,source_type,source_id)
        VALUES (?,'adjustment',?,?,?,?,?,'stock_count',?)`)
      const postings = []
      let varianceCents = 0
      for (const item of items) {
        const deltas = [
          ['main', Number((item.counted_stock - item.recorded_stock).toFixed(6))],
          ['sub', Number((item.counted_sub_stock - item.recorded_sub_stock).toFixed(6))],
        ]
        for (const [warehouse, delta] of deltas) {
          if (Math.abs(delta) <= 0.000001) continue
          const movementId = movement.run(item.material_id, delta, count.code,
            `تسوية الجرد ${count.code}; ${warehouse === 'main' ? 'المخزن الأساسي' : 'مخزن البواقي'}`,
            req.user.id, warehouse, String(countId)).lastInsertRowid
          if (delta > 0) createInventoryLot({ materialId: item.material_id, sourceType: 'stock_count', sourceId: movementId,
            warehouse, quantity: delta, unitCostCents: Math.round(Number(item.unit_cost) * 100) })
          else consumeInventoryLots(item.material_id, warehouse, -delta, movementId)
          db.prepare(`UPDATE materials SET ${warehouse === 'main' ? 'stock' : 'sub_stock'}=${warehouse === 'main' ? 'stock' : 'sub_stock'}+? WHERE id=?`)
            .run(delta, item.material_id)
          const amountCents = Math.abs(Math.round(delta * Number(item.unit_cost) * 100))
          if (amountCents > 0) {
            varianceCents += (delta > 0 ? 1 : -1) * amountCents
            if (delta > 0) {
              postings.push({ mappingKey: 'inventory', debitCents: amountCents, description: `زيادة جرد ${item.code}` })
              postings.push({ mappingKey: 'inventory_variance', creditCents: amountCents, description: `فائض جرد ${item.code}` })
            } else {
              postings.push({ mappingKey: 'inventory_variance', debitCents: amountCents, description: `عجز جرد ${item.code}` })
              postings.push({ mappingKey: 'inventory', creditCents: amountCents, description: `نقص مخزون ${item.code}` })
            }
          }
        }
        db.prepare(`UPDATE stock_count_items SET variance=? WHERE count_id=? AND material_id=?`)
          .run(Number(((item.counted_stock + item.counted_sub_stock) - (item.recorded_stock + item.recorded_sub_stock)).toFixed(6)), countId, item.material_id)
      }
      let journal = null
      if (postings.length) journal = queueJournalEntry(db, { sourceType: 'stock_count', sourceId: countId,
        sourceKey: `stock-count:${countId}`, description: `فروقات جرد ${count.code}`, createdBy: req.user.id, postings })
      db.prepare(`UPDATE stock_count_items SET released_at=CURRENT_TIMESTAMP WHERE count_id=? AND released_at IS NULL`).run(countId)
      db.prepare(`UPDATE stock_counts SET status='approved',approved_by=?,closed_at=CURRENT_TIMESTAMP WHERE id=?`).run(req.user.id, countId)
      audit(req.user.id, 'approve', 'stock-count', countId, count.code,
        { status: count.status, items: items.map((item) => ({ material_id: item.material_id,
          stock: Number(item.stock), sub_stock: Number(item.sub_stock) })) },
        { status: 'approved', reason: count.reason, items: items.map((item) => ({ material_id: item.material_id,
          recorded_stock: Number(item.recorded_stock), recorded_sub_stock: Number(item.recorded_sub_stock),
          counted_stock: Number(item.counted_stock), counted_sub_stock: Number(item.counted_sub_stock),
          variance: Number(((item.counted_stock + item.counted_sub_stock)
            - (item.recorded_stock + item.recorded_sub_stock)).toFixed(6)) })),
        varianceCents, journalEntryId: journal?.id || null })
      return { id: countId, status: 'approved', varianceCents, journalEntryId: journal?.id || null }
    })()
    res.json(result)
  } catch (error) { return sendError(res, error.status || (error.message.includes('مصدر رصيد') ? 409 : 400), error.message) }
})

api.post('/inventory/stock-counts/:id/cancel', requireAuth, allowRoles('admin'), (req, res) => {
  const countId = Number(req.params.id)
  const count = db.prepare("SELECT * FROM stock_counts WHERE id=? AND status='open'").get(countId)
  if (!count) return sendError(res, 409, 'محضر الجرد غير مفتوح للإلغاء.')
  db.transaction(() => {
    db.prepare(`UPDATE stock_count_items SET released_at=CURRENT_TIMESTAMP WHERE count_id=? AND released_at IS NULL`).run(countId)
    db.prepare(`UPDATE stock_counts SET status='cancelled',approved_by=?,closed_at=CURRENT_TIMESTAMP WHERE id=?`).run(req.user.id, countId)
    audit(req.user.id, 'cancel', 'stock-count', countId, count.code, { status: count.status }, { status: 'cancelled' })
  })()
  res.json({ ok: true })
})

function normalizeExcelHeader(value) {
  return normalize(String(value || '')).replace(/[\s_-]+/g, '')
}

function parseImportedUserRole(value) {
  const aliases = {
    admin: 'admin', المديرالعام: 'admin', مديرعام: 'admin',
    sales: 'sales', المبيعات: 'sales',
    operations: 'operations', التشغيلوالصيانة: 'operations', التشغيل: 'operations',
    purchasing: 'purchasing', المشتريات: 'purchasing', المشترياتوالمخازن: 'purchasing',
  }
  const roleKey = normalizeExcelHeader(value)
  return Object.hasOwn(aliases, roleKey) ? aliases[roleKey] : null
}

function parseImportedUserActive(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null
  const normalized = normalizeExcelHeader(value)
  if (['1', 'true', 'yes', 'active', 'نشط', 'نشطه', 'فعال'].includes(normalized)) return true
  if (['0', 'false', 'no', 'inactive', 'معطل', 'معطله', 'غيرنشط'].includes(normalized)) return false
  return undefined
}

function parseUsersExcel(buffer) {
  let workbook
  try { workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false }) }
  catch { throw apiError(400, 'تعذر قراءة ملف Excel؛ تحقق من سلامة الملف.') }
  const sheetName = workbook.SheetNames?.[0]
  if (!sheetName) throw apiError(400, 'ملف Excel لا يحتوي على ورقة بيانات.')
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1, defval: '', raw: false, blankrows: false,
  })
  if (!rows.length) throw apiError(400, 'ملف Excel فارغ.')

  const headers = rows[0].map(normalizeExcelHeader)
  const column = (names) => headers.findIndex((header) => names.some((name) => header === normalizeExcelHeader(name)))
  const columns = {
    fullName: column(['fullName', 'full name', 'name', 'الاسم الكامل', 'اسم الموظف', 'الاسم']),
    username: column(['username', 'login', 'اسم المستخدم', 'اسم الدخول']),
    password: column(['password', 'كلمة المرور']),
    role: column(['role', 'الدور', 'الصلاحية']),
    active: column(['active', 'status', 'الحالة']),
  }
  const missing = ['fullName', 'username', 'password', 'role'].filter((key) => columns[key] < 0)
  if (missing.length) throw apiError(400, 'تأكد من وجود أعمدة الاسم الكامل واسم المستخدم وكلمة المرور والدور.')

  const imported = []
  const usernames = new Set()
  for (let index = 1; index < rows.length; index += 1) {
    const row = rows[index]
    if (row.every((cell) => String(cell ?? '').trim() === '')) continue
    const rowNumber = index + 1
    const cell = (key) => columns[key] < 0 ? '' : row[columns[key]] ?? ''
    const fullName = String(cell('fullName')).trim()
    const username = String(cell('username')).trim().toLocaleLowerCase('en')
    const password = String(cell('password') ?? '')
    const role = parseImportedUserRole(cell('role'))
    const active = parseImportedUserActive(cell('active'))
    if (!fullName || fullName.length > 150) throw apiError(400, `الصف ${rowNumber}: الاسم الكامل مطلوب وبحد أقصى 150 حرفًا.`)
    if (username.length < 3 || username.length > 100) throw apiError(400, `الصف ${rowNumber}: اسم المستخدم يجب أن يكون بين 3 و100 حرف.`)
    if (!role) throw apiError(400, `الصف ${rowNumber}: الدور غير صالح.`)
    if (active === undefined) throw apiError(400, `الصف ${rowNumber}: حالة الحساب يجب أن تكون نشط أو معطل.`)
    if (password.trim() && password.length < 10) throw apiError(400, `الصف ${rowNumber}: كلمة المرور يجب ألا تقل عن 10 أحرف.`)
    if (usernames.has(username)) throw apiError(400, `اسم المستخدم ${username} مكرر في ملف Excel.`)
    usernames.add(username)
    imported.push({ fullName, username, password, role, active, rowNumber })
    if (imported.length > 500) throw apiError(413, 'لا يمكن استيراد أكثر من 500 مستخدم في المرة الواحدة.')
  }
  if (!imported.length) throw apiError(400, 'لا توجد صفوف مستخدمين صالحة في ملف Excel.')
  return imported
}

api.get('/users', requireAuth, allowRoles('admin'), (_req, res) => {
  res.json(db.prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY id').all().map(userDto))
})

api.get(['/users/export', '/users/export.xlsx'], requireAuth, allowRoles('admin'), asyncRoute(async (_req, res) => {
  const users = db.prepare('SELECT full_name,username,role,active FROM users WHERE deleted_at IS NULL ORDER BY id').all()
  const rows = [
    ['الاسم الكامل', 'اسم المستخدم', 'كلمة المرور', 'الدور', 'الحالة'],
    ...users.map((user) => [user.full_name, user.username, '', user.role, user.active ? 'نشط' : 'معطل']),
  ]
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'المستخدمون')
  const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="Madar-Users.xlsx"')
  res.send(buffer)
}))

api.post('/users/import', requireAuth, allowRoles('admin'), userImportUpload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return sendError(res, 400, 'اختر ملف Excel لاستيراده.')
  try {
    const imported = parseUsersExcel(req.file.buffer)
    let nextIndex = 0
    await Promise.all(Array.from({ length: Math.min(4, imported.length) }, async () => {
      while (nextIndex < imported.length) {
        const row = imported[nextIndex++]
        row.passwordHash = row.password.trim() ? await bcrypt.hash(row.password, 12) : null
        delete row.password
      }
    }))

    const result = await sequelize.transaction({ type: Transaction.TYPES.IMMEDIATE }, async (transaction) => {
      let added = 0
      let updated = 0
      for (const row of imported) {
        if (row.username === req.user.username && row.active === false) {
          throw apiError(400, 'لا يمكنك تعطيل حسابك الحالي من خلال الاستيراد.')
        }
        const existing = await models.User.findOne({ where: { username: row.username }, paranoid: false, transaction })
        if (existing?.isMaster && (row.active === false || row.role !== 'admin')) {
          throw apiError(400, 'لا يمكن تعطيل المدير الرئيسي أو تغيير دوره من خلال الاستيراد.')
        }
        if (!existing && !row.passwordHash) {
          throw apiError(400, `الصف ${row.rowNumber}: كلمة المرور مطلوبة لإنشاء مستخدم جديد.`)
        }
        const [user, created] = await models.User.findOrCreate({
          where: { username: row.username },
          defaults: {
            fullName: row.fullName,
            passwordHash: row.passwordHash || '',
            role: row.role,
            active: row.active ?? true,
          },
          paranoid: false,
          transaction,
        })
        const oldValues = created ? null : {
          fullName: user.fullName,
          role: user.role,
          active: Boolean(user.active),
        }
        if (!created) {
          user.fullName = row.fullName
          user.role = row.role
          if (user.deleted_at) user.deleted_at = null
          if (row.passwordHash) user.passwordHash = row.passwordHash
          if (row.active !== null) user.active = row.active
          await user.save({ transaction })
          updated += 1
        } else {
          added += 1
        }
        if (employeeUserRoles[row.role]) {
          let employee = user.employeeId
            ? await models.Employee.findByPk(user.employeeId, { paranoid: false, transaction })
            : null
          if (!employee) {
            employee = await models.Employee.create({ name: row.fullName, department: employeeUserRoles[row.role] }, { transaction })
            user.employeeId = employee.id
          } else {
            employee.name = row.fullName
            employee.department = employeeUserRoles[row.role]
            employee.active = row.active ?? Boolean(user.active)
            if (employee.deleted_at) employee.deleted_at = null
            await employee.save({ transaction })
          }
          if (user.employeeId !== employee.id) user.employeeId = employee.id
          await user.save({ transaction })
        }
        await sequelizeAudit({
          userId: req.user.id,
          action: created ? 'import-create' : 'import-update',
          entity: 'user',
          entityId: user.id,
          details: `username=${row.username}; passwordUpdated=${Boolean(row.passwordHash)}`,
          oldValues,
          newValues: {
            fullName: user.fullName,
            role: user.role,
            active: Boolean(user.active),
            passwordUpdated: Boolean(row.passwordHash),
          },
          transaction,
        })
      }
      return { added, updated, total: added + updated }
    })
    res.json(result)
  } catch (error) {
    if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
      return sendError(res, error.status, error.message)
    }
    throw error
  } finally {
    req.file.buffer?.fill(0)
  }
}))

api.post('/users', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const { username, password, fullName, role } = req.body || {}
  if (!username || String(username).trim().length < 3 || !password || String(password).length < 10 || !fullName || !['admin', 'sales', 'operations', 'purchasing'].includes(role)) {
    return sendError(res, 400, 'تحقق من الاسم واسم المستخدم وكلمة المرور والدور.')
  }
  try {
    const created = db.transaction(() => {
      const employeeDepartment = employeeUserRoles[role]
      const employeeId = employeeDepartment
        ? db.prepare('INSERT INTO employees(name,department) VALUES (?,?)').run(String(fullName).trim(), employeeDepartment).lastInsertRowid
        : null
      const result = db.prepare('INSERT INTO users(username,password_hash,full_name,role,employee_id) VALUES (?,?,?,?,?)')
        .run(String(username).trim().toLowerCase(), bcrypt.hashSync(String(password), 12), String(fullName).trim(), role, employeeId)
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(result.lastInsertRowid)
      audit(req.user.id, 'create', 'user', user.id, '', null,
        { username: user.username, fullName: user.full_name, role: user.role, active: Boolean(user.active), employeeId })
      return user
    })()
    res.status(201).json(userDto(created))
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return sendError(res, 409, 'اسم المستخدم مستخدم بالفعل.')
    throw error
  }
}))

api.patch('/users/:id', requireAuth, allowRoles('admin'), asyncRoute(async (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=? AND deleted_at IS NULL').get(req.params.id)
  if (!user) return sendError(res, 404, 'المستخدم غير موجود.')
  if (user.id === req.user.id && req.body.active === false) return sendError(res, 400, 'لا يمكنك تعطيل حسابك الحالي.')
  if (user.is_master && req.body.active === false) return sendError(res, 403, 'لا يمكن تعطيل حساب المدير الرئيسي.')
  const active = req.body.active === undefined ? user.active : Number(Boolean(req.body.active))
  const role = req.body.role || user.role
  if (!['admin', 'sales', 'operations', 'purchasing'].includes(role)) return sendError(res, 400, 'الدور غير صالح.')
  if (user.is_master && role !== 'admin') return sendError(res, 403, 'لا يمكن تغيير دور المدير الرئيسي.')
  if (user.role === 'admin' && role !== 'admin' && user.active
    && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL").get().count <= 1) {
    return sendError(res, 409, 'لا يمكن تغيير دور آخر حساب مدير نشط.')
  }
  if (user.role === 'admin' && active === 0
    && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL").get().count <= 1) {
    return sendError(res, 409, 'لا يمكن تعطيل آخر حساب مدير نشط.')
  }
  const password = req.body?.password
  if (password !== undefined && (typeof password !== 'string' || password.length < 10 || password.length > 200)) {
    return sendError(res, 400, 'كلمة المرور الجديدة يجب أن تكون بين 10 و200 حرف.')
  }
  const passwordHash = password === undefined ? user.password_hash : await bcrypt.hash(password, 12)
  db.transaction(() => {
    let employeeId = user.employee_id
    if (employeeUserRoles[role]) {
      if (employeeId) {
        db.prepare(`UPDATE employees SET name=?,department=?,active=?,deleted_at=NULL WHERE id=?`)
          .run(user.full_name, employeeUserRoles[role], active, employeeId)
      } else {
        employeeId = db.prepare('INSERT INTO employees(name,department,active) VALUES (?,?,?)')
          .run(user.full_name, employeeUserRoles[role], active).lastInsertRowid
      }
    }
    db.prepare('UPDATE users SET active=?,role=?,password_hash=?,employee_id=? WHERE id=?')
      .run(active, role, passwordHash, employeeId, user.id)
    audit(req.user.id, password === undefined ? 'update' : 'password-reset', 'user', user.id, '',
      { active: user.active, role: user.role, employeeId: user.employee_id }, { active, role, employeeId, passwordUpdated: password !== undefined })
  })()
  res.json({ ok: true })
}))

api.delete('/users/:id', requireAuth, allowRoles('admin'), (req, res) => {
  const userId = Number(req.params.id)
  if (!Number.isInteger(userId) || userId <= 0) return sendError(res, 400, 'رقم المستخدم غير صالح.')
  const user = db.prepare('SELECT * FROM users WHERE id=? AND deleted_at IS NULL').get(userId)
  if (!user) return sendError(res, 404, 'المستخدم غير موجود.')
  if (user.is_master) return sendError(res, 403, 'لا يمكن حذف المدير الرئيسي.')
  if (user.id === req.user.id) return sendError(res, 400, 'لا يمكنك حذف حسابك الحالي.')
  if (user.role === 'admin' && user.active
    && db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='admin' AND active=1 AND deleted_at IS NULL").get().count <= 1) {
    return sendError(res, 409, 'لا يمكن حذف آخر حساب مدير نشط.')
  }
  db.transaction(() => {
    db.prepare('UPDATE users SET active=0,deleted_at=CURRENT_TIMESTAMP WHERE id=?').run(user.id)
    if (user.employee_id) db.prepare('UPDATE employees SET active=0,deleted_at=CURRENT_TIMESTAMP WHERE id=? AND deleted_at IS NULL').run(user.employee_id)
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id)
    audit(req.user.id, 'soft-delete', 'user', user.id, '',
      { username: user.username, fullName: user.full_name, role: user.role, active: Boolean(user.active) },
      { username: user.username, fullName: user.full_name, role: user.role, active: false, deletedAt: new Date().toISOString() })
  })()
  res.json({ ok: true })
})

api.get('/reports/archive', requireAuth, allowRoles('admin'), (req, res) => {
  const conditions = ["o.status='archived'", 'o.deleted_at IS NULL']
  const params = []
  if (req.query.clientId) { conditions.push('o.client_id=?'); params.push(Number(req.query.clientId)) }
  if (req.query.area) {
    conditions.push(`EXISTS (SELECT 1 FROM order_machines om JOIN machines m ON m.id=om.machine_id
      WHERE om.order_id=o.id AND om.excluded_at IS NULL AND m.area LIKE ?)`)
    params.push(`%${req.query.area}%`)
  }
  if (req.query.reason) {
    conditions.push(`EXISTS (SELECT 1 FROM order_machines om JOIN json_each(om.reason_ids) r
      JOIN maintenance_reasons mr ON mr.id=CAST(r.value AS INTEGER)
      WHERE om.order_id=o.id AND om.excluded_at IS NULL AND mr.label LIKE ?)`)
    params.push(`%${req.query.reason}%`)
  }
  const rows = db.prepare(`SELECT o.*,c.name AS client_name,c.code AS client_code,
    (SELECT COUNT(*) FROM order_machines om WHERE om.order_id=o.id AND om.excluded_at IS NULL) AS machine_count
    FROM orders o JOIN clients c ON c.id=o.client_id WHERE ${conditions.join(' AND ')} ORDER BY o.archived_at DESC`).all(...params)
  res.json(rows.map(orderSummary))
})

function parseAnalysisDate(value, fieldName) {
  if (value == null || value === '') return null
  const text = String(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))
    || new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) !== text) {
    throw apiError(400, `تاريخ ${fieldName} غير صالح؛ استخدم YYYY-MM-DD.`)
  }
  return text
}

function archiveDateConditions(fromDate, toDate, orderAlias = 'o') {
  const conditions = []
  const params = []
  if (fromDate) { conditions.push(`${orderAlias}.archived_at>=?`); params.push(`${fromDate} 00:00:00`) }
  if (toDate) { conditions.push(`${orderAlias}.archived_at<=?`); params.push(`${toDate} 23:59:59`) }
  return { conditions, params }
}

api.get('/analysis/areas', requireAuth, allowRoles('admin'), (req, res) => {
  try {
    const fromDate = parseAnalysisDate(req.query.from, 'البداية')
    const toDate = parseAnalysisDate(req.query.to, 'النهاية')
    if (fromDate && toDate && fromDate > toDate) return sendError(res, 400, 'تاريخ البداية يجب أن يسبق تاريخ النهاية.')
    const dateRange = archiveDateConditions(fromDate, toDate)
    const completionConditions = [
      'om.machine_id=m.id', 'om.excluded_at IS NULL', "o.type='maintenance'", "o.status='archived'",
      'o.deleted_at IS NULL', ...dateRange.conditions,
    ]
    const machines = db.prepare(`SELECT m.id,m.code,m.name_ar,m.name_en,COALESCE(NULLIF(TRIM(m.area),''),'غير محدد') AS area,
      EXISTS(SELECT 1 FROM order_machines om JOIN orders o ON o.id=om.order_id
        WHERE ${completionConditions.join(' AND ')}) AS completed
      FROM machines m WHERE m.active=1 AND m.deleted_at IS NULL ORDER BY area COLLATE NOCASE,m.code COLLATE NOCASE`)
      .all(...dateRange.params)
    const groups = new Map()
    for (const machine of machines) {
      const area = machine.area
      if (!groups.has(area)) groups.set(area, { area, total_count: 0, completed_count: 0, completion_ratio: 0, missing_machines: [] })
      const group = groups.get(area)
      group.total_count += 1
      if (machine.completed) group.completed_count += 1
      else group.missing_machines.push({ id: machine.id, code: machine.code, name_ar: machine.name_ar, name_en: machine.name_en, area })
    }
    const areas = [...groups.values()].map((group) => ({
      ...group,
      completion_ratio: group.total_count ? Math.round((group.completed_count / group.total_count) * 10000) / 100 : 0,
    }))
    res.json({ from: fromDate, to: toDate, areas })
  } catch (error) {
    if (Number.isInteger(error.status)) return sendError(res, error.status, error.message)
    throw error
  }
})

function queryBulkMaintenanceRecords({ area, reasonId, fromDate, toDate }) {
  const conditions = ["o.type='maintenance'", "o.status='archived'", 'o.deleted_at IS NULL', 'om.excluded_at IS NULL']
  const params = []
  if (area) { conditions.push("COALESCE(NULLIF(TRIM(m.area),''),'غير محدد')=?"); params.push(area) }
  if (reasonId) {
    conditions.push(`EXISTS(SELECT 1 FROM json_each(om.reason_ids) selected_reason
      WHERE CAST(selected_reason.value AS INTEGER)=?)`)
    params.push(reasonId)
  }
  const dateRange = archiveDateConditions(fromDate, toDate)
  conditions.push(...dateRange.conditions)
  params.push(...dateRange.params)
  const rows = db.prepare(`SELECT o.id AS order_id,o.code AS order_code,o.archived_at,o.type,
      c.name AS client_name,c.code AS client_code,c.primary_color,c.secondary_color,c.logo_path,
       om.id AS card_id,om.before_photos,om.after_photos,om.reason_ids,
      m.id AS machine_id,m.code AS machine_code,m.name_ar,m.name_en,COALESCE(NULLIF(TRIM(m.area),''),'غير محدد') AS area
    FROM orders o JOIN clients c ON c.id=o.client_id
      JOIN order_machines om ON om.order_id=o.id
      JOIN machines m ON m.id=om.machine_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY area COLLATE NOCASE,o.archived_at,o.id,m.code COLLATE NOCASE,m.id`).all(...params)
  return rows.map((row) => ({
    order: {
      id: row.order_id, code: row.order_code, archived_at: row.archived_at, type: row.type,
      client_name: row.client_name, client_code: row.client_code, primary_color: row.primary_color,
      secondary_color: row.secondary_color, logo_path: row.logo_path,
    },
    card: {
      id: row.card_id, machine_id: row.machine_id, machine_code: row.machine_code,
      name_ar: row.name_ar, name_en: row.name_en, area: row.area, before_photos: row.before_photos,
       after_photos: row.after_photos, reason_ids: row.reason_ids,
    },
    before: parseJsonArray(row.before_photos),
    after: parseJsonArray(row.after_photos),
    reasons: parseJsonArray(row.reason_ids)
      .map((id) => db.prepare('SELECT label FROM maintenance_reasons WHERE id=?').get(id)?.label).filter(Boolean),
  }))
}

function queryInternalNotesRecords({ area, reasonId, fromDate, toDate }) {
  const conditions = ["o.type='maintenance'", "o.status='archived'", 'o.deleted_at IS NULL', 'om.excluded_at IS NULL']
  const params = []
  if (area) { conditions.push("COALESCE(NULLIF(TRIM(m.area),''),'غير محدد')=?"); params.push(area) }
  if (reasonId) {
    conditions.push(`EXISTS(SELECT 1 FROM json_each(om.reason_ids) selected_reason
      WHERE CAST(selected_reason.value AS INTEGER)=?)`)
    params.push(reasonId)
  }
  const dateRange = archiveDateConditions(fromDate, toDate)
  conditions.push(...dateRange.conditions)
  params.push(...dateRange.params)
  return db.prepare(`SELECT m.code AS machine_code,m.name_ar,m.name_en,
      COALESCE(NULLIF(TRIM(m.area),''),'غير محدد') AS area,COALESCE(om.note,'') AS notes
    FROM orders o JOIN order_machines om ON om.order_id=o.id
      JOIN machines m ON m.id=om.machine_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY area COLLATE NOCASE,
      m.code COLLATE NOCASE,o.archived_at,o.id,m.id`).all(...params)
}

function queryMachineMasterListRecords() {
  const records = db.prepare(`SELECT m.code AS machine_code,m.name_ar,m.name_en,
      COALESCE(NULLIF(TRIM(m.area),''),'غير محدد') AS area,
      COALESCE((SELECT om.note
        FROM order_machines om JOIN orders o ON o.id=om.order_id
        WHERE om.machine_id=m.id AND o.type='maintenance' AND o.deleted_at IS NULL
          AND TRIM(COALESCE(om.note,''))<>''
        ORDER BY COALESCE(o.updated_at,o.archived_at,o.created_at) DESC,o.id DESC,om.id DESC
        LIMIT 1),'') AS notes
    FROM machines m
    WHERE m.active=1 AND m.deleted_at IS NULL`).all()
  const arabicCollator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' })
  records.sort((left, right) => arabicCollator.compare(left.area, right.area)
    || arabicCollator.compare(left.name_ar || '', right.name_ar || '')
    || String(left.machine_code).localeCompare(String(right.machine_code), 'en', { numeric: true, sensitivity: 'base' }))
  return records
}

function groupInternalNotesRecords(records) {
  const groups = new Map()
  for (const record of records) {
    const area = String(record.area || '').trim() || 'غير محدد'
    if (!groups.has(area)) groups.set(area, [])
    groups.get(area).push(record)
  }
  const arabicCollator = new Intl.Collator('ar', { numeric: true, sensitivity: 'base' })
  return [...groups.entries()]
    .map(([area, groupRecords]) => [area, groupRecords.sort((left, right) => arabicCollator.compare(left.name_ar || '', right.name_ar || '')
      || String(left.machine_code).localeCompare(String(right.machine_code), 'en', { numeric: true, sensitivity: 'base' }))])
    .sort(([areaA], [areaB]) => arabicCollator.compare(areaA, areaB))
}

const internalReportHeaders = [
  'كود الماكينة (Machine Code)',
  'الاسم بالعربي (Arabic Name)',
  'الاسم بالإنجليزي (English Name)',
  'ملاحظات (Notes)',
]

function internalReportFontPath(bold = false) {
  const windowsFonts = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts')
  const candidates = bold ? [
    process.env.MADAR_PDF_BOLD_FONT_PATH,
    path.join(windowsFonts, 'arialbd.ttf'),
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf',
  ] : [
    process.env.MADAR_PDF_FONT_PATH,
    path.join(windowsFonts, 'arial.ttf'),
    '/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/msttcorefonts/Arial.ttf',
  ]
  if (bold && process.env.MADAR_PDF_FONT_PATH) candidates.push(process.env.MADAR_PDF_FONT_PATH)
  return candidates.find((candidate) => fs.existsSync(candidate)) || null
}

function buildInternalNotesPdf(areaGroups, recordCount, fullList = false) {
  const fontPath = internalReportFontPath()
  if (!fontPath) throw apiError(500, 'خط عربي صالح لتقرير PDF غير متاح. عيّن MADAR_PDF_FONT_PATH إلى مسار ملف TTF محلي.')
  const boldFontPath = internalReportFontPath(true) || fontPath
  const reportTitle = fullList ? 'قائمة الماكينات للطباعة' : 'تقرير الملاحظات الفنية الداخلي'
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 30, right: 28, bottom: 30, left: 28 } })
    const chunks = []
    pdf.on('data', (chunk) => chunks.push(chunk))
    pdf.on('error', reject)
    pdf.on('end', () => resolve(Buffer.concat(chunks)))
    pdf.font(fontPath).fillColor('#172d43')

    const tableX = pdf.page.margins.left
    const tableWidth = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right
    const columnWidths = [0.15, 0.21, 0.21, 0.43].map((ratio) => tableWidth * ratio)
    const columnX = columnWidths.map((_, index) => tableX + columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0))
    const areaHeaderHeight = 30
    const headerHeight = 38
    const fontSize = 9
    const pageBottom = () => pdf.page.height - pdf.page.margins.bottom
    const reportTop = () => 75

    const drawPageHeading = (pageNumber) => {
      pdf.font(boldFontPath).fontSize(16).fillColor('#173a66').text(reportTitle, tableX, 30, {
        width: tableWidth, align: 'right', features: ['rtla', 'rtlm'],
      })
      pdf.font(fontPath).fontSize(9).fillColor('#60758a').text(`عدد السجلات: ${recordCount} · صفحة ${pageNumber}`, tableX, 53, {
        width: tableWidth, align: 'right', features: ['rtla', 'rtlm'],
      })
      return reportTop()
    }

    const drawAreaBanner = (area, continuation = false) => {
      pdf.save().roundedRect(tableX, y, tableWidth, areaHeaderHeight, 4).fill('#2b8991').restore()
      pdf.font(boldFontPath).fontSize(12).fillColor('#ffffff').text(`المنطقة: ${area}${continuation ? ' (تابع)' : ''}`, tableX + 10, y + 7, {
        width: tableWidth - 20, height: areaHeaderHeight - 10, align: 'right', features: ['rtla', 'rtlm'],
      })
      y += areaHeaderHeight
    }

    const drawColumnHeaders = () => {
      const headerY = y
      internalReportHeaders.forEach((header, index) => {
        pdf.save().rect(columnX[index], headerY, columnWidths[index], headerHeight).fill('#173a66').restore()
        pdf.save().rect(columnX[index], headerY, columnWidths[index], headerHeight).lineWidth(0.5).stroke('#c5d4d9').restore()
        pdf.font(boldFontPath).fontSize(8).fillColor('#ffffff').text(header, columnX[index] + 5, headerY + 5, {
          width: columnWidths[index] - 10, height: headerHeight - 10, align: 'center', features: ['rtla', 'rtlm'],
        })
      })
      y += headerHeight
    }

    const measureRowHeight = (record) => {
      const values = [record.machine_code, record.name_ar, record.name_en || '', record.notes || '']
      const heights = values.map((value, index) => pdf.heightOfString(String(value || '—'), {
        width: columnWidths[index] - 12, fontSize, features: ['rtla', 'rtlm'],
      }))
      return Math.max(34, ...heights.map((height) => height + 12))
    }

    let pageNumber = 1
    let y = drawPageHeading(pageNumber)
    const startNextPage = (area) => {
      pdf.addPage({ size: 'A4', layout: 'landscape', margins: { top: 30, right: 28, bottom: 30, left: 28 } })
      pageNumber += 1
      y = drawPageHeading(pageNumber)
      drawAreaBanner(area, true)
      drawColumnHeaders()
    }

    for (const [area, areaRecords] of areaGroups) {
      const firstRowHeight = measureRowHeight(areaRecords[0])
      if (y + areaHeaderHeight + headerHeight + firstRowHeight > pageBottom()) {
        pdf.addPage({ size: 'A4', layout: 'landscape', margins: { top: 30, right: 28, bottom: 30, left: 28 } })
        pageNumber += 1
        y = drawPageHeading(pageNumber)
      }
      drawAreaBanner(area)
      drawColumnHeaders()
      for (const [rowIndex, record] of areaRecords.entries()) {
        const rowHeight = measureRowHeight(record)
        if (y + rowHeight > pageBottom()) startNextPage(area)
        const values = [record.machine_code, record.name_ar, record.name_en || '', record.notes || '']
        values.forEach((value, index) => {
          pdf.save().rect(columnX[index], y, columnWidths[index], rowHeight)
            .fillAndStroke(rowIndex % 2 ? '#f2f6fa' : '#ffffff', '#d7e0e8').restore()
          const isArabic = index === 1 || index === 3
          pdf.font(fontPath).fontSize(fontSize).fillColor('#20364c').text(String(value || '—'), columnX[index] + 6, y + 6, {
            width: columnWidths[index] - 12, height: rowHeight - 12,
            align: isArabic ? 'right' : 'left', features: ['rtla', 'rtlm'],
          })
        })
        y += rowHeight
      }
    }
    pdf.end()
  })
}

api.post('/analysis/export-internal-report', requireAuth, allowRoles('admin'), createRateLimiter('POST /analysis/export-internal-report'), asyncRoute(async (req, res) => {
  const format = String(req.body?.format || 'xlsx').toLowerCase()
  if (!['xlsx', 'pdf'].includes(format)) return sendError(res, 400, 'صيغة التقرير الداخلي يجب أن تكون xlsx أو pdf.')
  const fullList = ['true', '1', 'yes'].includes(String(req.body?.fullList ?? req.query?.fullList ?? '').toLowerCase())
  let records
  if (fullList) {
    records = queryMachineMasterListRecords()
  } else {
  let fromDate
  let toDate
  try {
    fromDate = parseAnalysisDate(req.body?.from, 'البداية')
    toDate = parseAnalysisDate(req.body?.to, 'النهاية')
  } catch (error) { return sendError(res, error.status || 400, error.message) }
  if (fromDate && toDate && fromDate > toDate) return sendError(res, 400, 'تاريخ البداية يجب أن يسبق تاريخ النهاية.')
  const area = String(req.body?.area || '').trim().slice(0, 120)
  const reasonId = req.body?.reasonId ? Number(req.body.reasonId) : null
  if (req.body?.reasonId && (!Number.isSafeInteger(reasonId) || reasonId < 1
    || !db.prepare('SELECT id FROM maintenance_reasons WHERE id=?').get(reasonId))) {
    return sendError(res, 400, 'سبب الصيانة المحدد غير صالح.')
  }
    records = queryInternalNotesRecords({ area, reasonId, fromDate, toDate })
  }
  if (!records.length) {
    return sendError(res, 404, fullList
      ? 'لا توجد ماكينات نشطة لإضافتها إلى القائمة.'
      : 'لا توجد ملاحظات صيانة مؤرشفة تطابق معايير التصفية.')
  }
  const areaGroups = groupInternalNotesRecords(records)
  if (format === 'xlsx') {
    const workbook = await XlsxPopulate.fromBlankAsync()
    const worksheet = workbook.sheet(0).name(fullList ? 'Machine Master List' : 'Internal Notes')
    worksheet.rightToLeft(false)
    ;[22, 32, 32, 64].forEach((width, index) => worksheet.column(index + 1).width(width))
    let row = 1
    for (const [groupIndex, [groupArea, groupRecords]] of areaGroups.entries()) {
      if (groupIndex) row += 1
      worksheet.range(`A${row}:D${row}`).merged(true)
      worksheet.cell(row, 1).value(`المنطقة: ${groupArea}`)
      worksheet.range(`A${row}:D${row}`).style({
        bold: true, fontSize: 14, fontColor: 'FFFFFF', fill: '2B8991',
        horizontalAlignment: 'center', verticalAlignment: 'center',
      })
      worksheet.row(row).height(30)
      row += 1

      worksheet.cell(row, 1).value([internalReportHeaders])
      worksheet.range(`A${row}:D${row}`).style({
        bold: true, fontColor: '173A66', fill: 'DCE8EA', wrapText: true,
        horizontalAlignment: 'center', verticalAlignment: 'center', border: true, borderColor: 'C5D4D9',
      })
      worksheet.row(row).height(34)
      row += 1

      for (const record of groupRecords) {
        worksheet.cell(row, 1).value([[record.machine_code, record.name_ar, record.name_en || '', record.notes || '']])
        worksheet.range(`A${row}:D${row}`).style({
          wrapText: true, verticalAlignment: 'center', border: true, borderColor: 'D7E0E8',
        })
        row += 1
      }
    }
    const buffer = await workbook.outputAsync()
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="${fullList ? 'Madar-Machine-Master-List' : 'Madar-Internal-Maintenance-Notes'}.xlsx"`)
    return res.send(buffer)
  }
  const buffer = await buildInternalNotesPdf(areaGroups, records.length, fullList)
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `attachment; filename="${fullList ? 'Madar-Machine-Master-List' : 'Madar-Internal-Maintenance-Notes'}.pdf"`)
  res.send(buffer)
}))

async function buildBulkMaintenancePptx(records, criteria) {
  const pptx = new PptxGenJS()
  const primary = '01509F'
  const groupedByArea = new Map()
  for (const record of records) {
    const area = String(record.card.area || '').trim() || 'غير محدد'
    if (!groupedByArea.has(area)) groupedByArea.set(area, [])
    groupedByArea.get(area).push({ ...record, card: { ...record.card, area } })
  }
  const areaGroups = [...groupedByArea.entries()].sort(([areaA], [areaB]) => areaA.localeCompare(areaB, 'ar'))
  const indexRowsPerSlide = 20
  const indexPageStartByArea = new Map()
  let nextIndexPage = 2
  for (const [area, machines] of areaGroups) {
    indexPageStartByArea.set(area, nextIndexPage)
    nextIndexPage += Math.ceil(machines.length / indexRowsPerSlide)
  }
  const machinePageStart = nextIndexPage
  const indexedRecords = []
  const reportPageByCard = new Map()
  areaGroups.forEach(([area, machines]) => {
    machines.forEach((record, indexWithinArea) => {
      const reportPage = machinePageStart + indexedRecords.length
      reportPageByCard.set(`${record.order.id}:${record.card.id}`, reportPage)
      indexedRecords.push({ ...record, areaNumber: indexWithinArea + 1, reportPage })
    })
  })
  const totalIndexPages = machinePageStart - 2
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Madar ERP'
  pptx.subject = 'تقرير صيانة مجمع'
  pptx.title = 'تقرير الصيانة المجمع'
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'ar-EG' }
  pptx.defineSlideMaster({ title: 'BULK_MASTER', background: { color: 'FFFFFF' }, objects: [
    { rect: { x: 0, y: 0, w: 13.333, h: 7.5, line: { color: 'FFFFFF', transparency: 100 }, fill: { color: 'FFFFFF' } } },
  ] })

  const index = pptx.addSlide('BULK_MASTER')
  index.addText('تقرير الصيانة المجمع  |  Bulk Maintenance Report', {
    x: 0.5, y: 0.3, w: 12.3, h: 0.65, fontFace: 'Arial', fontSize: 25, bold: true, color: primary, align: 'center',
  })
  const firstLogoPath = records.find(({ order }) => order.logo_path)?.order.logo_path
  const logo = firstLogoPath ? await compressedExportImage(firstLogoPath).catch(() => null) : null
  if (logo) index.addImage({ data: logo.dataUri, ...pptxImagePlacement(logo, 0.65, 1.15, 2.1, 0.85) })
  index.addText(`عدد السجلات: ${records.length}\n${criteria.reasonLabel ? `سبب الصيانة: ${criteria.reasonLabel}\n` : ''}${criteria.fromDate || criteria.toDate ? `الفترة: ${criteria.fromDate || '—'} إلى ${criteria.toDate || '—'}` : 'كل الفترات'}`, {
    x: 0.65, y: 2.15, w: 3.4, h: 1.45, fontFace: 'Arial', fontSize: 15, color: '29445F', valign: 'mid',
  })
  index.addText('فهرس المناطق  |  Index of Areas', {
    x: 4.1, y: 1.05, w: 8.55, h: 0.45, fontFace: 'Arial', fontSize: 18, bold: true, color: primary, align: 'center',
  })
  areaGroups.forEach(([area, machines], i) => {
    const y = 1.7 + i * Math.min(0.65, 4.7 / Math.max(areaGroups.length, 1))
    const h = Math.min(0.48, 4.7 / Math.max(areaGroups.length, 1))
    index.addShape(pptx.ShapeType.roundRect, { x: 4.5, y, w: 7.6, h, rectRadius: 0.06,
      line: { color: primary, transparency: 100 }, fill: { color: primary } })
    index.addText(`${area}  ·  ${machines.length} ماكينة  ·  فهرس ص ${indexPageStartByArea.get(area)}`, {
      x: 4.75, y: y + 0.015, w: 7.1, h: h - 0.03, fontFace: 'Arial', fontSize: Math.min(15, Math.max(8, h * 28)),
      bold: true, color: 'FFFFFF', valign: 'mid', align: 'right',
    })
  })

  let indexSlideNumber = 2
  for (const [area, machines] of areaGroups) {
    const pageCount = Math.ceil(machines.length / indexRowsPerSlide)
    for (let pageInArea = 0; pageInArea < pageCount; pageInArea += 1) {
      const slide = pptx.addSlide('BULK_MASTER')
      const pageRecords = machines.slice(pageInArea * indexRowsPerSlide, (pageInArea + 1) * indexRowsPerSlide)
      const areaOffset = pageInArea * indexRowsPerSlide
      slide.addText(`فهرس الماكينات · ${area}${pageCount > 1 ? ` (${pageInArea + 1}/${pageCount})` : ''}`, {
        x: 0.5, y: 0.28, w: 10.2, h: 0.62, fontFace: 'Arial', fontSize: 23, bold: true, color: primary, align: 'center',
      })
      if (logo) slide.addImage({ data: logo.dataUri, ...pptxImagePlacement(logo, 10.75, 0.2, 2.0, 0.85) })
      slide.addShape(pptx.ShapeType.rect, { x: 0.55, y: 1.18, w: 12.2, h: 0.46,
        line: { color: primary }, fill: { color: primary } })
      const columns = [
        { text: 'No.', x: 0.65, w: 0.85, align: 'center' },
        { text: 'Machine', x: 1.65, w: 6.2, align: 'left' },
        { text: 'Code / Order', x: 7.95, w: 3.45, align: 'center' },
        { text: 'Page', x: 11.45, w: 1.1, align: 'center' },
      ]
      for (const column of columns) slide.addText(column.text, {
        x: column.x, y: 1.22, w: column.w, h: 0.36, fontFace: 'Arial', fontSize: 11, bold: true,
        color: 'FFFFFF', align: column.align, valign: 'mid',
      })
      const rowHeight = Math.min(0.245, 5.15 / Math.max(pageRecords.length, 1))
      pageRecords.forEach((record, rowIndex) => {
        const y = 1.67 + rowIndex * rowHeight
        const number = areaOffset + rowIndex + 1
        const reportPage = reportPageByCard.get(`${record.order.id}:${record.card.id}`)
        slide.addShape(pptx.ShapeType.rect, { x: 0.55, y, w: 12.2, h: rowHeight,
          line: { color: 'D8E0E8', width: 0.45 }, fill: { color: rowIndex % 2 ? 'F4F7FA' : 'FFFFFF' } })
        const values = [
          { text: String(number), x: 0.65, w: 0.85, align: 'center' },
          { text: record.card.name_en || record.card.name_ar, x: 1.65, w: 6.2, align: 'left' },
          { text: `${record.card.machine_code} · ${record.order.code}`, x: 7.95, w: 3.45, align: 'center' },
          { text: String(reportPage), x: 11.45, w: 1.1, align: 'center' },
        ]
        for (const value of values) slide.addText(value.text, {
          x: value.x, y: y + 0.01, w: value.w, h: Math.max(0.04, rowHeight - 0.02), fontFace: 'Arial',
          fontSize: 10, color: '173A66', align: value.align, valign: 'mid', fit: 'shrink',
        })
      })
      slide.addText(`صفحة الفهرس ${indexSlideNumber} من ${totalIndexPages}`, {
        x: 9.9, y: 7.08, w: 2.8, h: 0.22, fontFace: 'Arial', fontSize: 8, color: '718295', align: 'right',
      })
      indexSlideNumber += 1
    }
  }

  for (const [i, record] of indexedRecords.entries()) {
    const slide = pptx.addSlide('BULK_MASTER')
    const blue = '01509F'
    const accent = String(record.order.secondary_color || '#F49B36').replace('#', '').toUpperCase()
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 3.15, h: 7.5, line: { color: blue }, fill: { color: blue } })
    const logoImage = record.order.logo_path ? await compressedExportImage(record.order.logo_path).catch(() => null) : null
    if (logoImage) slide.addImage({ data: logoImage.dataUri, ...pptxImagePlacement(logoImage, 0.45, 0.35, 2.25, 1.05) })
    else slide.addText(record.order.client_name, { x: 0.35, y: 0.5, w: 2.45, h: 0.55, fontFace: 'Arial', fontSize: 18, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid' })
    slide.addText(record.card.name_en || record.card.name_ar, { x: 0.35, y: 1.75, w: 2.45, h: 0.8, fontFace: 'Arial', fontSize: 22, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid', fit: 'shrink' })
    slide.addText(`#${record.card.machine_code}`, { x: 0.35, y: 2.55, w: 2.45, h: 0.4, fontFace: 'Arial', fontSize: 17, color: 'FFFFFF', align: 'center' })
    slide.addText(`الأمر: ${record.order.code}\nالمنطقة: ${record.card.area || 'غير محدد'}`, { x: 0.35, y: 3.0, w: 2.45, h: 0.75, fontFace: 'Arial', fontSize: 13, color: 'FFFFFF', align: 'center' })
    const comments = record.reasons
    slide.addText(comments.length ? comments.map((comment, index) => `${index + 1}- ${comment}`).join('\n') : '—', {
      x: 0.4, y: 4.05, w: 2.35, h: 2.9, fontFace: 'Arial', fontSize: 12, color: 'FFFFFF', valign: 'top',
    })
    slide.addText(record.card.area || 'غير محدد', { x: 3.35, y: 0.18, w: 9.7, h: 0.46, fontFace: 'Arial', fontSize: 20, bold: true, color: blue, align: 'center' })
    for (const [photos, label, y] of [[record.before, 'Before', 0.82], [record.after, 'After', 4.12]]) {
      slide.addText(label, { x: 3.35, y, w: 9.7, h: 0.35, fontFace: 'Arial', fontSize: 16, bold: true, color: blue, align: 'center' })
      const photoY = y + 0.43
      const photoH = 2.35
      if (!photos.length) {
        slide.addShape(pptx.ShapeType.rect, { x: 3.48, y: photoY, w: 9.25, h: photoH, line: { color: 'D9E1EA', dash: 'dash' }, fill: { color: 'F8FAFC' } })
        slide.addText('لا توجد صور', { x: 3.6, y: photoY + 0.9, w: 9, h: 0.4, fontFace: 'Arial', fontSize: 15, color: '7A8998', align: 'center' })
        continue
      }
      const gap = 0.12
      const colW = (9.25 - gap * (photos.length - 1)) / photos.length
      for (const [photoIndex, photo] of photos.entries()) {
        const image = await compressedExportImage(photo).catch(() => null)
        const x = 3.48 + photoIndex * (colW + gap)
        slide.addShape(pptx.ShapeType.rect, { x, y: photoY, w: colW, h: photoH, line: { color: 'D9E1EA', width: 0.5 }, fill: { color: 'FFFFFF' } })
        if (!image) continue
        const { data, info } = await sharp(image.buffer).rotate(90).jpeg({ quality: 75 }).toBuffer({ resolveWithObject: true })
        const rotatedImage = { buffer: data, width: info.width, height: info.height, dataUri: `image/jpeg;base64,${data.toString('base64')}` }
        slide.addImage({ data: rotatedImage.dataUri, ...pptxImagePlacement(rotatedImage, x + 0.04, photoY + 0.04, colW - 0.08, photoH - 0.08) })
      }
    }
    slide.addShape(pptx.ShapeType.rect, { x: 12.22, y: 6.83, w: 0.72, h: 0.48, line: { color: accent }, fill: { color: accent } })
    slide.addText(String(record.reportPage), { x: 12.25, y: 6.88, w: 0.65, h: 0.34, fontFace: 'Arial', fontSize: 15, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid' })
  }
  return pptx.write({ outputType: 'nodebuffer' })
}

async function buildBulkMaintenanceDocx(records, criteria) {
  const children = [
    new Paragraph({ text: 'تقرير الصيانة المجمع', heading: HeadingLevel.TITLE, alignment: AlignmentType.RIGHT, bidirectional: true }),
    new Paragraph({ text: `عدد السجلات: ${records.length}${criteria.reasonLabel ? ` · سبب الصيانة: ${criteria.reasonLabel}` : ''}`, alignment: AlignmentType.RIGHT, bidirectional: true }),
    new Paragraph({ text: `الفترة: ${criteria.fromDate || '—'} إلى ${criteria.toDate || '—'}`, alignment: AlignmentType.RIGHT, bidirectional: true }),
    new Paragraph({ text: 'فهرس المناطق', heading: HeadingLevel.HEADING_1, alignment: AlignmentType.RIGHT, bidirectional: true }),
  ]
  const areas = [...new Set(records.map(({ card }) => card.area || 'غير محدد'))]
  for (const area of areas) children.push(new Paragraph({ text: `${area} — ${records.filter(({ card }) => (card.area || 'غير محدد') === area).length} ماكينة`, alignment: AlignmentType.RIGHT, bidirectional: true }))
  for (const record of records) {
    children.push(new Paragraph({ text: `المنطقة: ${record.card.area || 'غير محدد'} · ${record.order.code}`, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.RIGHT, bidirectional: true, pageBreakBefore: true }))
    children.push(new Paragraph({ text: `${record.card.name_en || record.card.name_ar} — #${record.card.machine_code}`, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.RIGHT, bidirectional: true }))
    children.push(new Paragraph({ text: record.order.client_name, alignment: AlignmentType.RIGHT, bidirectional: true }))
    const comments = record.reasons
    if (comments.length) children.push(new Paragraph({ text: `أسباب الصيانة: ${comments.join('، ')}`, alignment: AlignmentType.RIGHT, bidirectional: true }))
    for (const [photos, label] of [[record.before, 'Before'], [record.after, 'After']]) {
      children.push(new Paragraph({ text: label, alignment: AlignmentType.CENTER, bidirectional: true }))
      const images = []
      for (const photo of photos) {
        const absolute = absoluteStoragePath(photo)
        if (!absolute) continue
        try {
          const image = await compressedExportImage(absolute)
          if (!image) continue
          const scale = Math.min(300 / image.width, 180 / image.height, 1)
          images.push(new Paragraph({ children: [new ImageRun({ data: image.buffer, type: 'jpg', transformation: {
            width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)),
          } })], alignment: AlignmentType.CENTER }))
        } catch { /* missing/bad files are skipped; source archive is never altered */ }
      }
      children.push(...(images.length ? images : [new Paragraph({ text: 'لا توجد صور', alignment: AlignmentType.CENTER })]))
    }
  }
  const document = new Document({ creator: 'Madar ERP', title: 'تقرير الصيانة المجمع',
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ properties: { page: { size: { orientation: 'landscape' }, margin: { top: 720, right: 800, bottom: 720, left: 800 } } }, children }],
  })
  return Packer.toBuffer(document)
}

api.post('/export/bulk-maintenance', requireAuth, allowRoles('admin'), createRateLimiter('POST /export/bulk-maintenance'), asyncRoute(async (req, res) => {
  const format = String(req.body?.format || 'pptx').toLowerCase()
  if (!['pptx', 'docx'].includes(format)) return sendError(res, 400, 'صيغة التصدير يجب أن تكون pptx أو docx.')
  let fromDate
  let toDate
  try {
    fromDate = parseAnalysisDate(req.body?.from, 'البداية')
    toDate = parseAnalysisDate(req.body?.to, 'النهاية')
  } catch (error) { return sendError(res, error.status || 400, error.message) }
  if (fromDate && toDate && fromDate > toDate) return sendError(res, 400, 'تاريخ البداية يجب أن يسبق تاريخ النهاية.')
  const area = String(req.body?.area || '').trim().slice(0, 120)
  const reasonId = req.body?.reasonId ? Number(req.body.reasonId) : null
  if (req.body?.reasonId && (!Number.isSafeInteger(reasonId) || reasonId < 1
    || !db.prepare('SELECT id FROM maintenance_reasons WHERE id=?').get(reasonId))) {
    return sendError(res, 400, 'سبب الصيانة المحدد غير صالح.')
  }
  const reasonLabel = reasonId ? db.prepare('SELECT label FROM maintenance_reasons WHERE id=?').get(reasonId).label : ''
  const criteria = { area, reasonId, reasonLabel, fromDate, toDate }
  const records = queryBulkMaintenanceRecords(criteria)
  if (!records.length) return sendError(res, 404, 'لا توجد سجلات صيانة مؤرشفة تطابق معايير التصفية.')
  const buffer = format === 'pptx'
    ? await buildBulkMaintenancePptx(records, criteria)
    : await buildBulkMaintenanceDocx(records, criteria)
  const mime = format === 'pptx'
    ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  res.setHeader('Content-Type', mime)
  res.setHeader('Content-Disposition', `attachment; filename="Madar-Bulk-Maintenance-${format}.${format}"`)
  res.send(buffer)
}))

api.get('/reports/export.pptx', requireAuth, allowRoles('admin'), createRateLimiter('GET /reports/export.pptx'), asyncRoute(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter((id) => id > 0)
  if (!ids.length) return sendError(res, 400, 'حدد أمرًا واحدًا على الأقل للتصدير.')
  const placeholders = ids.map(() => '?').join(',')
  const orders = db.prepare(`SELECT o.*,c.name AS client_name,c.code AS client_code,c.primary_color,c.secondary_color,c.logo_path
    FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.status='archived' AND o.deleted_at IS NULL AND o.id IN (${placeholders}) ORDER BY o.archived_at`).all(...ids)
  if (!orders.length) return sendError(res, 404, 'لا توجد أوامر مؤرشفة مطابقة للتصدير.')
  const reportMachines = []
  for (const order of orders) {
    const cards = db.prepare(`SELECT om.id,om.before_photos,om.after_photos,om.reason_ids,
        m.code AS machine_code,m.name_ar,m.name_en,m.area
      FROM order_machines om JOIN machines m ON m.id=om.machine_id WHERE om.order_id=? AND om.excluded_at IS NULL`).all(order.id)
    for (const card of cards) {
      reportMachines.push({ order, card,
        before: parseJsonArray(card.before_photos), after: parseJsonArray(card.after_photos),
        reasons: parseJsonArray(card.reason_ids).map((id) => db.prepare('SELECT label FROM maintenance_reasons WHERE id=?').get(id)?.label).filter(Boolean),
      })
    }
  }
  const areaName = (item) => item.card.area || 'غير محدد'
  reportMachines.sort((a, b) => areaName(a).localeCompare(areaName(b), 'ar') || a.card.machine_code.localeCompare(b.card.machine_code))
  const areas = [...new Set(reportMachines.map(areaName))]
  const areaPosition = new Map(areas.map((area, index) => [area, index]))
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Madar ERP'
  pptx.subject = `تقرير أوامر ${orders.map((order) => order.code).join('، ')}`
  pptx.title = 'تقرير التشغيل والصيانة'
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'ar-EG' }
  pptx.defineSlideMaster({ title: 'MASTER', background: { color: 'FFFFFF' }, objects: [
    { rect: { x: 0, y: 0, w: 13.333, h: 7.5, line: { color: 'FFFFFF', transparency: 100 }, fill: { color: 'FFFFFF' } } },
  ] })
  const blue = () => '01509F'
  const orange = (value) => String(value || '#F49B36').replace('#', '').toUpperCase()
  const firstClient = orders[0]
  const primary = blue()
  const slideOne = pptx.addSlide('MASTER')
  slideOne.background = { color: 'FFFFFF' }
  slideOne.addText('فهرس المناطق  |  Index of Areas', { x: 0.6, y: 0.35, w: 12.1, h: 0.65, fontFace: 'Arial', fontSize: 26, bold: true, color: primary, align: 'center', breakLine: false })
  slideOne.addText(orders.map((order) => `${order.code} — ${order.client_name}`).join('\n'), { x: 0.7, y: 1.2, w: 3.5, h: 0.9, fontFace: 'Arial', fontSize: 12, color: '29445F', valign: 'mid' })
  const coverLogo = firstClient.logo_path ? await compressedExportImage(firstClient.logo_path).catch(() => null) : null
  if (coverLogo) slideOne.addImage({ data: coverLogo.dataUri, ...pptxImagePlacement(coverLogo, 0.7, 2.35, 3.7, 2.2) })
  else slideOne.addText(firstClient.client_name, { x: 0.85, y: 3.1, w: 3.4, h: 0.55, fontFace: 'Arial', fontSize: 24, bold: true, color: primary, align: 'center', valign: 'mid' })
  const areaCounts = areas.map((area, index) => ({ area, page: 2 + index, index }))
  areaCounts.forEach((item, index) => {
    const step = Math.min(0.78, 4.45 / Math.max(areas.length, 1))
    const height = Math.min(0.56, step * 0.82)
    const y = 2.15 + index * step
    slideOne.addShape(pptx.ShapeType.roundRect, { x: 5.1, y, w: 7.5, h: height, rectRadius: 0.08, line: { color: primary, transparency: 100 }, fill: { color: primary } })
    slideOne.addText(item.area, { x: 5.35, y: y + 0.025, w: 5.8, h: height - 0.05, fontFace: 'Arial', fontSize: Math.min(16, Math.max(9, height * 27)), bold: true, color: 'FFFFFF', valign: 'mid' })
    slideOne.addShape(pptx.ShapeType.ellipse, { x: 11.55, y: y + (height - Math.min(0.45, height - 0.04)) / 2, w: 0.85, h: Math.min(0.45, height - 0.04), line: { color: '173A66' }, fill: { color: '173A66' } })
    slideOne.addText(String(item.page), { x: 11.58, y: y + 0.025, w: 0.78, h: height - 0.05, fontFace: 'Arial', fontSize: Math.min(14, Math.max(8, height * 25)), bold: true, color: 'FFFFFF', align: 'center', valign: 'mid' })
  })
  areas.forEach((area, areaIndex) => {
    const slide = pptx.addSlide('MASTER')
    slide.background = { color: 'FFFFFF' }
    slide.addText(area, { x: 0.5, y: 0.35, w: 12.3, h: 0.7, fontFace: 'Arial', fontSize: 26, bold: true, color: primary, align: 'center' })
    slide.addText('Machine Index  |  فهرس الماكينات', { x: 0.6, y: 1.12, w: 12.1, h: 0.35, fontFace: 'Arial', fontSize: 15, color: primary, align: 'center' })
    if (coverLogo) slide.addImage({ data: coverLogo.dataUri, ...pptxImagePlacement(coverLogo, 10.6, 0.25, 2.1, 0.85) })
    const list = reportMachines.filter((item) => areaName(item) === area)
    const columnSize = Math.ceil(list.length / 2)
    for (let column = 0; column < 2; column += 1) {
      const columnItems = list.slice(column * columnSize, (column + 1) * columnSize)
      const x = column === 0 ? 0.5 : 6.75
      const width = 6.05
      const rowHeight = Math.min(0.55, 5.4 / Math.max(columnItems.length, 1))
      const headerY = 1.65
      slide.addShape(pptx.ShapeType.rect, { x, y: headerY, w: width, h: 0.52, line: { color: primary }, fill: { color: primary } })
      const numberWidth = 0.65
      const pageWidth = 1.0
      const nameWidth = width - numberWidth - pageWidth
      slide.addText('Number', { x: x + 0.04, y: headerY + 0.04, w: numberWidth - 0.08, h: 0.4, fontFace: 'Arial', fontSize: 9, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid' })
      slide.addText('Machine Name', { x: x + numberWidth, y: headerY + 0.04, w: nameWidth, h: 0.4, fontFace: 'Arial', fontSize: 11, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid' })
      slide.addText('Page Number', { x: x + numberWidth + nameWidth, y: headerY + 0.04, w: pageWidth - 0.04, h: 0.4, fontFace: 'Arial', fontSize: 8, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid' })
      columnItems.forEach((item, rowIndex) => {
        const globalIndex = reportMachines.indexOf(item)
        const y = headerY + 0.54 + rowIndex * rowHeight
        slide.addShape(pptx.ShapeType.rect, { x, y, w: width, h: rowHeight, line: { color: 'D8E0E8', width: 0.5 }, fill: { color: rowIndex % 2 ? 'F4F7FA' : 'FFFFFF' } })
        const textY = y + Math.max(0.025, (rowHeight - Math.min(rowHeight - 0.04, 0.34)) / 2)
        const textH = Math.max(0.04, Math.min(rowHeight - 0.04, 0.34))
        slide.addText(String(column * columnSize + rowIndex + 1), { x: x + 0.04, y: textY, w: numberWidth - 0.08, h: textH, fontFace: 'Arial', fontSize: 10, color: '173A66', valign: 'mid', align: 'center' })
        slide.addText(item.card.name_en || item.card.name_ar, { x: x + numberWidth + 0.08, y: textY, w: nameWidth - 0.16, h: textH, fontFace: 'Arial', fontSize: 10, color: '173A66', valign: 'mid', align: 'left', fit: 'shrink' })
        slide.addText(String(2 + areas.length + globalIndex), { x: x + numberWidth + nameWidth, y: textY, w: pageWidth - 0.04, h: textH, fontFace: 'Arial', fontSize: 10, color: '173A66', valign: 'mid', align: 'center' })
      })
    }
    slide.addNotes(`فهرس المنطقة ${area} — ${areaIndex + 1}`)
  })
  for (const [machineIndex, item] of reportMachines.entries()) {
    const slide = pptx.addSlide('MASTER')
    const itemBlue = blue()
    const itemAccent = orange(item.order.secondary_color)
    slide.background = { color: 'FFFFFF' }
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 3.15, h: 7.5, line: { color: itemBlue }, fill: { color: itemBlue } })
    const logoAbs = item.order.logo_path && absoluteStoragePath(item.order.logo_path)
    if (logoAbs && path.extname(logoAbs).toLowerCase() !== '.svg') {
      const logoImage = await compressedExportImage(logoAbs)
      if (logoImage) slide.addImage({ data: logoImage.dataUri, ...pptxImagePlacement(logoImage, 0.45, 0.35, 2.25, 1.05) })
      else slide.addText(item.order.client_name, { x: 0.35, y: 0.5, w: 2.45, h: 0.55, fontFace: 'Arial', fontSize: 18, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid' })
    } else {
      slide.addText(item.order.client_name, { x: 0.35, y: 0.5, w: 2.45, h: 0.55, fontFace: 'Arial', fontSize: 18, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid' })
    }
    slide.addText(item.card.name_en || item.card.name_ar, { x: 0.35, y: 1.75, w: 2.45, h: 0.8, fontFace: 'Arial', fontSize: 23, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid', fit: 'shrink' })
    slide.addText(`#${item.card.machine_code}`, { x: 0.35, y: 2.55, w: 2.45, h: 0.4, fontFace: 'Arial', fontSize: 18, color: 'FFFFFF', align: 'center' })
    slide.addText('Comment', { x: 0.4, y: 3.45, w: 2.35, h: 0.35, fontFace: 'Arial', fontSize: 16, bold: true, color: itemAccent, align: 'left' })
    const comments = item.reasons
    slide.addText(comments.length ? comments.map((comment, index) => `${index + 1}- ${comment}`).join('\n') : '', {
      x: 0.4, y: 3.88, w: 2.35, h: 3.1, fontFace: 'Arial', fontSize: 13, color: 'FFFFFF', valign: 'top', breakLine: false,
    })
    slide.addText(areaName(item), { x: 3.35, y: 0.18, w: 9.7, h: 0.46, fontFace: 'Arial', fontSize: 20, bold: true, color: itemBlue, align: 'center' })
    await addPhotoRow(slide, pptx, item.before, 'Before', 0.82, itemBlue)
    await addPhotoRow(slide, pptx, item.after, 'After', 4.12, itemBlue)
    slide.addShape(pptx.ShapeType.rect, { x: 12.22, y: 6.83, w: 0.72, h: 0.48, line: { color: itemAccent }, fill: { color: itemAccent } })
    slide.addText(String(2 + areas.length + machineIndex), { x: 12.25, y: 6.88, w: 0.65, h: 0.34, fontFace: 'Arial', fontSize: 15, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid' })
  }
  const buffer = await pptx.write({ outputType: 'nodebuffer' })
  const filename = `Madar-Report-${orders.map((order) => order.code).join('-')}.pptx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(buffer)
}))

api.get('/reports/export.docx', requireAuth, allowRoles('admin'), createRateLimiter('GET /reports/export.docx'), asyncRoute(async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter((id) => id > 0)
  if (!ids.length) return sendError(res, 400, 'حدد أمرًا واحدًا على الأقل للتصدير.')
  const placeholders = ids.map(() => '?').join(',')
  const orders = db.prepare(`SELECT o.*,c.name AS client_name,c.code AS client_code,c.primary_color,c.secondary_color,c.logo_path
    FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.status='archived' AND o.deleted_at IS NULL AND o.id IN (${placeholders}) ORDER BY o.archived_at`).all(...ids)
  if (!orders.length) return sendError(res, 404, 'لا توجد أوامر مؤرشفة مطابقة للتصدير.')
  const machines = []
  for (const order of orders) {
    const cards = db.prepare(`SELECT om.id,om.before_photos,om.after_photos,om.reason_ids,
        m.code AS machine_code,m.name_ar,m.name_en,m.area
      FROM order_machines om JOIN machines m ON m.id=om.machine_id WHERE om.order_id=? AND om.excluded_at IS NULL`).all(order.id)
    for (const card of cards) machines.push({ order, card,
      before: parseJsonArray(card.before_photos), after: parseJsonArray(card.after_photos),
      reasons: parseJsonArray(card.reason_ids).map((id) => db.prepare('SELECT label FROM maintenance_reasons WHERE id=?').get(id)?.label).filter(Boolean),
    })
  }
   const areas = [...new Set(machines.map(({ card }) => card.area || 'غير محدد'))]
  const children = [
    new Paragraph({ text: 'تقرير التشغيل والصيانة', heading: HeadingLevel.TITLE, alignment: AlignmentType.RIGHT, bidirectional: true }),
    new Paragraph({ text: orders.map((order) => `${order.code} — ${order.client_name}`).join('   |   '), alignment: AlignmentType.RIGHT, bidirectional: true }),
    new Paragraph({ text: `عدد الماكينات: ${machines.length}`, alignment: AlignmentType.RIGHT, bidirectional: true }),
  ]
  const photoCell = async (photos, heading) => {
    const content = [new Paragraph({ children: [new TextRun({ text: heading, bold: true, color: '173A66', size: 22 })], alignment: AlignmentType.CENTER })]
    for (const photo of photos) {
      const absolute = absoluteStoragePath(photo)
      if (!absolute) continue
      try {
        const image = await compressedExportImage(absolute)
        if (!image) continue
        const scale = Math.min(250 / image.width, 145 / image.height, 1)
        content.push(new Paragraph({ children: [new ImageRun({ data: image.buffer, type: 'jpg', transformation: {
          width: Math.max(1, Math.round(image.width * scale)), height: Math.max(1, Math.round(image.height * scale)),
        } })], alignment: AlignmentType.CENTER }))
      } catch {
        content.push(new Paragraph({ text: path.basename(absolute), alignment: AlignmentType.CENTER }))
      }
    }
    if (!photos.length) content.push(new Paragraph({ text: 'لا توجد صور', alignment: AlignmentType.CENTER }))
    return new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: content, verticalAlign: 'center' })
  }
  for (const area of areas) {
    children.push(new Paragraph({ text: `المنطقة: ${area}`, heading: HeadingLevel.HEADING_1, alignment: AlignmentType.RIGHT, bidirectional: true, pageBreakBefore: true }))
    for (const item of machines.filter(({ card }) => (card.area || 'غير محدد') === area)) {
      const machineName = item.card.name_en || item.card.name_ar
      children.push(new Paragraph({ text: `${machineName}  —  #${item.card.machine_code}`, heading: HeadingLevel.HEADING_2, alignment: AlignmentType.RIGHT, bidirectional: true, keepNext: true }))
      children.push(new Paragraph({ text: `${item.order.code} · ${item.order.client_name}`, alignment: AlignmentType.RIGHT, bidirectional: true }))
      const comments = item.reasons
      if (comments.length) children.push(new Paragraph({ text: `أسباب الصيانة: ${comments.join('، ')}`, alignment: AlignmentType.RIGHT, bidirectional: true }))
      const borders = { top: { style: BorderStyle.SINGLE, size: 2, color: 'DDE5EC' }, bottom: { style: BorderStyle.SINGLE, size: 2, color: 'DDE5EC' }, left: { style: BorderStyle.SINGLE, size: 2, color: 'DDE5EC' }, right: { style: BorderStyle.SINGLE, size: 2, color: 'DDE5EC' }, insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: 'DDE5EC' }, insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'DDE5EC' } }
      const beforeCell = await photoCell(item.before, 'Before')
      const afterCell = await photoCell(item.after, 'After')
      children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, columnWidths: [4680, 4680], borders,
        rows: [new TableRow({ children: [beforeCell, afterCell] })],
      }))
      children.push(new Paragraph({ text: '' }))
    }
  }
  const document = new Document({ creator: 'Madar ERP', title: 'تقرير التشغيل والصيانة', description: orders.map((order) => order.code).join(', '),
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ properties: { page: { size: { orientation: 'landscape' }, margin: { top: 720, right: 800, bottom: 720, left: 800 } } }, children }],
  })
  const buffer = await Packer.toBuffer(document)
  const filename = `Madar-Report-${orders.map((order) => order.code).join('-')}.docx`
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
  res.send(buffer)
}))

api.get('/reports/print', requireAuth, allowRoles('admin'), (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(Number).filter((id) => id > 0)
  if (!ids.length) return sendError(res, 400, 'حدد أمرًا واحدًا على الأقل للطباعة.')
  const placeholders = ids.map(() => '?').join(',')
  const orders = db.prepare(`SELECT o.*,c.name AS client_name,c.code AS client_code,c.primary_color,c.secondary_color,c.logo_path
    FROM orders o JOIN clients c ON c.id=o.client_id WHERE o.status='archived' AND o.deleted_at IS NULL AND o.id IN (${placeholders}) ORDER BY o.archived_at`).all(...ids)
  if (!orders.length) return sendError(res, 404, 'لا توجد أوامر مؤرشفة مطابقة للطباعة.')
  const machines = []
  for (const order of orders) {
    for (const card of db.prepare(`SELECT om.id,om.before_photos,om.after_photos,om.reason_ids,
      m.code AS machine_code,m.name_ar,m.name_en,m.area
      FROM order_machines om JOIN machines m ON m.id=om.machine_id WHERE om.order_id=? AND om.excluded_at IS NULL`).all(order.id)) {
      machines.push({ order, card, before: parseJsonArray(card.before_photos), after: parseJsonArray(card.after_photos),
        reasons: parseJsonArray(card.reason_ids).map((id) => db.prepare('SELECT label FROM maintenance_reasons WHERE id=?').get(id)?.label).filter(Boolean),
      })
    }
  }
  const areaName = ({ card }) => card.area || 'غير محدد'
  const areas = [...new Set(machines.map(areaName))]
  const fileLink = (relative) => `/api/files?path=${encodeURIComponent(relative)}`
  const areaIndex = `<section class="index-page"><h1>فهرس المناطق</h1><div class="orders-list">${orders.map((order) => `<span>${escapeHtml(order.code)} · ${escapeHtml(order.client_name)}</span>`).join('')}</div><ol>${areas.map((area, index) => `<li><span>${escapeHtml(area)}</span><b>${index + 2}</b></li>`).join('')}</ol></section>`
  const sheets = machines.map((item) => {
    const primary = safeHexColor(item.order.primary_color, '#173a66')
    const accent = safeHexColor(item.order.secondary_color, '#f49b36')
    const logo = item.order.logo_path ? `<img class="logo" src="${fileLink(item.order.logo_path)}" alt="${escapeHtml(item.order.client_name)}"/>` : `<strong class="client-name">${escapeHtml(item.order.client_name)}</strong>`
    const photoSection = (photos, label) => `<section class="photo-section"><h3 style="color:${primary}">${label}</h3><div class="photos">${photos.map((photo) => `<img src="${fileLink(photo)}" alt="${label}"/>`).join('') || '<span class="no-photos">لا توجد صور</span>'}</div></section>`
    const comments = item.reasons
    return `<article class="machine-sheet"><aside style="background:${primary}">${logo}<h2>${escapeHtml(item.card.name_en || item.card.name_ar)}</h2><strong class="machine-code">#${escapeHtml(item.card.machine_code)}</strong><div class="comment-title" style="color:${accent}">Comment</div><ul>${comments.map((comment) => `<li>${escapeHtml(comment)}</li>`).join('')}</ul><small>${escapeHtml(item.order.code)}</small></aside><div class="machine-main"><h2>${escapeHtml(areaName(item))}</h2>${photoSection(item.before, 'Before')}${photoSection(item.after, 'After')}<span class="page-number" style="background:${accent}">${2 + areas.length + machines.indexOf(item)}</span></div></article>`
  }).join('')
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تقرير مَدَار</title><style>
    *{box-sizing:border-box}body{margin:0;color:#20344a;font:14px Tahoma,Arial,sans-serif;background:#fff}@page{size:A4 landscape;margin:12mm}.index-page{min-height:180mm;padding:14mm;color:#fff;background:#173a66;page-break-after:always}.index-page h1{text-align:center;font-size:28px}.orders-list{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;color:#d5e2ef;font-size:12px}.index-page ol{max-width:760px;margin:22px auto;padding:0;list-style:none}.index-page li{display:flex;align-items:center;justify-content:space-between;margin:8px 0;padding:10px 14px;border-radius:7px;color:white;background:#f49b36}.index-page li b{min-width:35px;padding:5px;border-radius:20px;color:white;background:#173a66;text-align:center}.machine-sheet{display:grid;grid-template-columns:27% 73%;min-height:180mm;page-break-after:always;direction:ltr}.machine-sheet aside{display:flex;align-items:center;flex-direction:column;padding:12mm 7mm;color:#fff;text-align:center;direction:rtl}.logo{width:58mm;height:22mm;object-fit:contain}.client-name{font-size:19px}.machine-sheet aside h2{margin:18mm 0 4mm;font-size:23px}.machine-code{font-size:17px}.comment-title{align-self:flex-start;margin-top:18mm;font-weight:bold}.machine-sheet aside ul{align-self:stretch;padding-right:20px;text-align:right;line-height:1.9}.machine-sheet aside small{margin-top:auto;align-self:flex-start;color:#d2dce5}.machine-main{position:relative;padding:5mm 8mm;direction:rtl}.machine-main>h2{height:12mm;margin:0;text-align:center;font-size:20px}.photo-section{margin:4mm 0 7mm}.photo-section h3{margin:0 0 3mm;text-align:center;font-size:17px}.photos{min-height:62mm;display:flex;align-items:center;justify-content:center;gap:3mm;flex-wrap:wrap}.photos img{width:auto;max-width:48%;height:60mm;object-fit:contain}.no-photos{color:#8795a1}.page-number{position:absolute;bottom:4mm;left:4mm;width:12mm;height:9mm;display:grid;place-items:center;color:white;font-weight:bold}.machine-sheet:last-child{page-break-after:auto}@media screen{body{background:#e9edf1}.index-page,.machine-sheet{width:277mm;min-height:190mm;margin:12px auto;background-clip:padding-box;box-shadow:0 4px 20px #0002}.machine-sheet aside{min-height:190mm}.machine-main{background:#fff}}@media print{.index-page,.machine-sheet{min-height:180mm}}
    </style></head><body>${areaIndex}${sheets}<script>window.addEventListener('load',()=>{const images=[...document.images];Promise.all(images.map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.onload=resolve;image.onerror=resolve}))).then(()=>setTimeout(()=>window.print(),350))})</script></body></html>`
  res.type('html').send(html)
})

async function addPhotoRow(slide, pptx, photos, label, y, blueHex) {
  slide.addText(label, { x: 3.35, y, w: 9.7, h: 0.35, fontFace: 'Arial', fontSize: 16, bold: true, color: blueHex, align: 'center' })
  const photoY = y + 0.43
  const photoH = 2.35
  const photoCount = photos.length
  if (!photoCount) {
    slide.addShape(pptx.ShapeType.rect, { x: 3.48, y: photoY, w: 9.25, h: photoH, line: { color: 'D9E1EA', dash: 'dash' }, fill: { color: 'F8FAFC' } })
    slide.addText('لا توجد صور', { x: 3.6, y: photoY + 0.9, w: 9, h: 0.4, fontFace: 'Arial', fontSize: 15, color: '7A8998', align: 'center' })
    return
  }
  const gap = 0.12
  const colW = (9.25 - gap * (photoCount - 1)) / photoCount
  for (const [index, photo] of photos.entries()) {
    const x = 3.48 + index * (colW + gap)
    const image = await compressedExportImage(photo).catch(() => null)
    if (image) {
      const { data, info } = await sharp(image.buffer).rotate(90).jpeg({ quality: 75 }).toBuffer({ resolveWithObject: true })
      const rotatedImage = { buffer: data, width: info.width, height: info.height, dataUri: `image/jpeg;base64,${data.toString('base64')}` }
      slide.addShape(pptx.ShapeType.rect, { x, y: photoY, w: colW, h: photoH, line: { color: 'D9E1EA', width: 0.5 }, fill: { color: 'FFFFFF' } })
      slide.addImage({ data: rotatedImage.dataUri, ...pptxImagePlacement(rotatedImage, x + 0.04, photoY + 0.04, colW - 0.08, photoH - 0.08) })
    } else {
      slide.addShape(pptx.ShapeType.rect, { x, y: photoY, w: colW, h: photoH, line: { color: 'D9E1EA' }, fill: { color: 'F8FAFC' } })
    }
  }
}

app.use('/api', api)

const clientBuild = resolveClientBuildDirectory(systemRoot, process.env)
const clientEntry = path.join(clientBuild, 'index.html')
if (fs.existsSync(clientEntry)) {
  app.use(express.static(clientBuild, { index: false, maxAge: '1d' }))
  app.get('*', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next()
    res.sendFile(clientEntry, (error) => error && next(error))
  })
} else if (isProduction) {
  app.get('/', (_req, res) => sendError(res, 503, 'واجهة النظام غير مبنية؛ نفّذ npm run build داخل مجلد system.'))
} else {
  app.get('*', (req, res, next) => {
    if (req.path === '/api' || req.path.startsWith('/api/')) return next()
    res.redirect(302, `http://localhost:5173${req.originalUrl}`)
  })
}

app.use((error, req, res, _next) => {
  console.error(error)
  if (error instanceof multer.MulterError) {
    const isBackupRestore = req.path === '/api/backup/restore'
    const maxSize = req.path === '/api/machines/import' ? '50' : isBackupRestore
      ? String(Math.ceil(backupRestoreUploadLimit / 1024 ** 3)) : '25'
    const unit = isBackupRestore ? 'جيجابايت' : 'ميجابايت'
    return sendError(res, 400, error.code === 'LIMIT_FILE_SIZE' ? `حجم الملف يتجاوز ${maxSize} ${unit}.` : 'تعذر استقبال الملفات.')
  }
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 600) return sendError(res, error.status, error.message)
  const sqliteCode = error.original?.code || error.parent?.code || error.code
  if (sqliteCode?.startsWith('SQLITE_BUSY') || sqliteCode?.startsWith('SQLITE_LOCKED')) {
    return sendError(res, 503, 'قاعدة البيانات مشغولة مؤقتًا؛ أعد المحاولة بعد لحظات.')
  }
  if (error.name === 'SequelizeUniqueConstraintError' || error.name === 'SequelizeValidationError'
    || (sqliteCode && sqliteCode.startsWith('SQLITE_CONSTRAINT'))) {
    const status = error.name === 'SequelizeValidationError' ? 400 : 409
    return sendError(res, status, status === 400 ? 'تحقق من البيانات المدخلة.' : 'توجد بيانات متعارضة أو مكررة.')
  }
  sendError(res, 500, isProduction ? 'حدث خطأ داخلي. راجع سجل الخادم.' : (error.message || 'حدث خطأ داخلي.'))
})

const httpServer = http.createServer(app)
const io = new SocketServer(httpServer)
io.use((socket, next) => {
  const user = authenticatedUser(getCookie(socket.request, 'madar_session'))
  if (!user) return next(new Error('unauthorized'))
  socket.data.user = user
  next()
})
io.on('connection', (socket) => {
  const { role } = socket.data.user
  if (role === 'operations' || role === 'admin') socket.join('role:operations')
  if (role === 'admin') socket.join(['role:treasury', 'role:admin'])
})
registerProcessHandlers(projectRoot)

async function createBackup() {
  const startedAt = Date.now()
  let snapshotPath = null
  let archivePath = null
  try {
    await fsExtra.ensureDir(backupsRoot)
    const legacyUserImportIgnore = []
    const pendingExcelDirectories = ['Uploads/Excel']
    while (pendingExcelDirectories.length) {
      const relativeDirectory = pendingExcelDirectories.pop()
      const absoluteDirectory = path.join(storageRoot, ...relativeDirectory.split('/'))
      const entries = await fs.promises.readdir(absoluteDirectory, { withFileTypes: true }).catch((error) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      for (const entry of entries) {
        const relativePath = `${relativeDirectory}/${entry.name}`
        if (entry.isDirectory()) pendingExcelDirectories.push(relativePath)
        else if (entry.isFile() && isLegacyUserImportStoragePath(relativePath)) legacyUserImportIgnore.push(relativePath)
      }
    }
    const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15)
    snapshotPath = path.join(backupsRoot, `.madar-${crypto.randomUUID()}.sqlite`)
    archivePath = path.join(backupsRoot, `madar_backup_${timestamp}.zip`)
    let duplicateIndex = 1
    while (fs.existsSync(archivePath)) {
      archivePath = path.join(backupsRoot, `madar_backup_${timestamp}_${String(duplicateIndex).padStart(2, '0')}.zip`)
      duplicateIndex += 1
    }
    await db.backup(snapshotPath)
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(archivePath, { flags: 'wx' })
      const archive = new archiver.ZipArchive({ zlib: { level: 9 } })
      output.once('close', resolve)
      output.once('error', reject)
      archive.once('error', reject)
      archive.once('warning', (error) => error.code === 'ENOENT' ? console.warn('Backup skipped a missing file:', error.message) : reject(error))
      archive.pipe(output)
      archive.file(snapshotPath, { name: 'madar.sqlite' })
      archive.append(JSON.stringify({
        format: 'madar-backup', version: 1, createdAt: new Date().toISOString(),
        applicationVersion, schemaVersion: CURRENT_SCHEMA_VERSION,
        database: 'madar.sqlite', storage: 'storage',
      }), { name: 'madar-backup-manifest.json' })
      archive.append('', { name: 'storage/.madar-backup-v1-marker' })
      archive.glob('**/*', {
        cwd: storageRoot, dot: true,
        ignore: [
          '**/.incoming/**',
          '**/.madar-order-delete-*',
          '**/.madar-order-delete-*/**',
          '**/.madar-recovery/**',
          '**/.madar-recovery-operation.json',
          '**/.madar-backup-v1-marker',
          ...legacyUserImportIgnore,
        ],
      }, { prefix: 'storage' })
      Promise.resolve(archive.finalize()).catch(reject)
    })
    const stats = await fs.promises.stat(archivePath)
    try {
      db.prepare(`UPDATE backup_health SET last_success_at=?,last_success_bytes=?,last_failure_at=NULL,
        last_failure_code=NULL,last_duration_ms=? WHERE id=1`)
        .run(new Date().toISOString(), stats.size, Date.now() - startedAt)
      resolvePersistentNotification('backup_failed')
    } catch (healthError) {
      console.error('Backup completed but its health record could not be updated:', healthError)
    }
    console.log(`Madar backup created: ${archivePath}`)
    return archivePath
  } catch (error) {
    if (archivePath) await fs.promises.rm(archivePath, { force: true }).catch(() => {})
    try {
      db.prepare(`UPDATE backup_health SET last_failure_at=?,last_failure_code='backup_failed',last_duration_ms=? WHERE id=1`)
        .run(new Date().toISOString(), Date.now() - startedAt)
      upsertPersistentNotification({ key: 'backup_failed', kind: 'backup_failed', title: 'فشل النسخ الاحتياطي',
        detail: String(error.message || 'backup_failed').slice(0, 500), sourceType: 'backup', sourceId: 'latest' })
    } catch (healthError) {
      console.error('Backup failed and its health record could not be updated:', healthError)
    }
    throw error
  } finally {
    if (snapshotPath) await fs.promises.rm(snapshotPath, { force: true }).catch(() => {})
  }
}

let activeBackup = null
function runBackup(ownerToken = null) {
  if (activeBackup) return Promise.reject(apiError(409, 'توجد عملية نسخ احتياطي جارية بالفعل.'))
  activeBackup = (async () => {
    const release = await acquireSnapshotLock(ownerToken)
    try { return await createBackup() }
    finally { release() }
  })().finally(() => { activeBackup = null })
  return activeBackup
}

const backupTask = cron.schedule(process.env.BACKUP_CRON || '0 2 * * *', () => {
  runBackup().catch((error) => console.error('Scheduled backup failed:', error))
})
backupTask.stop()

async function areaFolderSnapshot(root) {
  const records = []
  const walk = async (directory) => {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      if (directory === root && entry.name === '.incoming') continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        const stats = await fs.promises.stat(absolute)
        records.push(`${path.relative(root, absolute)}|dir|${stats.mtimeMs}`)
        await walk(absolute)
      } else if (entry.isFile()) {
        const stats = await fs.promises.stat(absolute)
        records.push(`${path.relative(root, absolute)}|${stats.size}|${stats.mtimeMs}`)
      }
    }
  }
  await walk(root)
  return records.sort().join('\n')
}

async function waitForStableAreaFolder(folderPath) {
  let previousSnapshot = null
  let stableSince = Date.now()
  while (Date.now() - stableSince < 3000) {
    try {
      const snapshot = await areaFolderSnapshot(folderPath)
      if (snapshot !== previousSnapshot) {
        previousSnapshot = snapshot
        stableSince = Date.now()
      }
    } catch (error) {
      if (error.code === 'ENOENT') return false
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return fs.promises.stat(folderPath).then((stats) => stats.isDirectory()).catch(() => false)
}

const pendingAreaNotifications = new Map()
const areaWatcher = chokidar.watch(areasRoot, {
  ignoreInitial: true,
  depth: 0,
  awaitWriteFinish: { stabilityThreshold: 3000, pollInterval: 500 },
  ignored: (watchedPath) => {
    const relative = path.relative(areasRoot, path.resolve(watchedPath))
    return relative === '.incoming' || relative.startsWith(`.incoming${path.sep}`)
  },
})

areaWatcher.on('addDir', (folderPath) => {
  const relativePath = path.relative(areasRoot, folderPath)
  if (!relativePath || relativePath === '.' || relativePath === '..' || relativePath.startsWith(`..${path.sep}`)) return
  const pathParts = relativePath.split(path.sep)
  if (pathParts.length !== 1 || pathParts[0] === '.incoming') return

  if (pendingAreaNotifications.has(folderPath)) return
  const notification = waitForStableAreaFolder(folderPath).then((ready) => {
    if (!ready) return
    const event = {
      name: path.basename(folderPath),
      path: pathParts[0],
      addedAt: new Date().toISOString(),
    }
    console.log(`تم اكتشاف فولدر جديد: ${event.name} (${event.path})`)
    const operationsRoom = io.to('role:operations')
    operationsRoom.emit('newAreaFolder', event)
    operationsRoom.emit('areas:folder-added', event)
  }).catch((error) => console.error('Could not confirm area folder readiness:', error))
    .finally(() => pendingAreaNotifications.delete(folderPath))
  pendingAreaNotifications.set(folderPath, notification)
})

areaWatcher.on('error', (error) => {
  console.error('Areas folder watcher error:', error)
})

areaWatcher.once('ready', () => {
  void (async () => {
    try {
      await sequelizeReady
      const filesystemRecovery = await recoverPendingFilesystemOperations(db, storageRoot)
      if (filesystemRecovery.recovered) {
        console.log(`Recovered ${filesystemRecovery.recovered} interrupted filesystem operation(s).`)
      }
      if (filesystemRecovery.pending) {
        console.warn(`${filesystemRecovery.pending} committed filesystem cleanup operation(s) remain pending.`)
      }
      await recoverInterruptedOrderFileDeletions()
      const stalePhotoUploads = await cleanupAbandonedPhotoUploadWorkspaces(uploadTemp, {
        maxAgeMs: photoUploadStaleTempMs,
      })
      if (stalePhotoUploads.removed) {
        console.log(`Removed ${stalePhotoUploads.removed} abandoned app-owned photo upload workspace(s).`)
      }
      backupTask.start()
      httpServer.listen(port, host, () => {
        console.log(`Madar ERP listening on http://${host}:${port}`)
        console.log(`Storage root: ${storageRoot}`)
        console.log(`Watching area folders: ${areasRoot}`)
      })
    } catch (error) {
      console.error('Could not initialize Madar or recover pending order-file deletions; the API was not started.', error)
      backupTask.stop()
      await areaWatcher.close().catch(() => {})
      await new Promise((resolve) => io.close(resolve))
      await sequelize.close().catch(() => {})
      if (db.open) db.close()
      process.exitCode = 1
    }
  })()
})

async function shutdownApplicationResources() {
  backupTask.stop()
  if (activeBackup) await activeBackup.catch(() => {})
  await areaWatcher.close()
  await new Promise((resolve) => io.close(resolve))
  if (httpServer.listening) await new Promise((resolve) => httpServer.close(() => resolve()))
  await sequelizeReady.catch(() => {})
  await sequelize.close()
  if (db.open) db.close()
}

async function activatePreparedRestore({ plan, journalPath }) {
  try {
    await shutdownApplicationResources()
    await swapRestoreFiles(journalPath, plan)
    await fs.promises.rm(plan.extractionRoot, { recursive: true, force: true })
    console.log('Madar restore completed. The process will exit for supervisor restart.')
    process.exit(0)
  } catch (error) {
    console.error('Madar restore activation failed; the previous data will be retained when possible:', error)
    if (fs.existsSync(journalPath)) {
      try { recoverInterruptedRestore(journalPath, { databasePath, storageRoot }) }
      catch (recoveryError) { console.error('Madar restore recovery also failed:', recoveryError) }
    }
    process.exit(1)
  }
}

setShutdownHandler(shutdownApplicationResources)
