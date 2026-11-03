const fs = require('node:fs')
const path = require('node:path')
const Database = require('better-sqlite3')
const { randomUUID } = require('node:crypto')
const { queueInventoryIssueJournal, recognizeCompletedWorkOrderIssues } = require('./accounting')

function assertSafeIntegerCents(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer number of cents.`)
  return value
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))
}

function tableColumns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name))
}

function getRecordedMovementCost(db, movementId) {
  if (!tableExists(db, 'inventory_lot_consumptions') || !tableExists(db, 'inventory_lots')) return null
  const allocations = db.prepare(`SELECT c.quantity,l.unit_cost_cents FROM inventory_lot_consumptions c
    JOIN inventory_lots l ON l.id=c.lot_id WHERE c.movement_id=? ORDER BY c.id`).all(movementId)
  if (!allocations.length) return null
  return allocations.reduce((total, allocation) => total
    + Math.round(Number(allocation.quantity) * Number(allocation.unit_cost_cents)), 0)
}

function validateCrosswalkEntry(entry, movement, db) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`Crosswalk entry for movement ${movement.id} must be an object.`)
  if (!['order', 'general'].includes(entry.classification)) {
    throw new Error(`Movement ${movement.id} must be explicitly classified as "order" or "general".`)
  }
  let orderId = null
  if (entry.classification === 'order') {
    orderId = Number(entry.orderId)
    if (!Number.isSafeInteger(orderId) || orderId < 1
      || !db.prepare('SELECT id FROM orders WHERE id=?').get(orderId)) {
      throw new Error(`Movement ${movement.id} references an invalid order; provide a valid orderId.`)
    }
  } else if (entry.orderId != null && entry.orderId !== '') {
    throw new Error(`General movement ${movement.id} cannot also specify an orderId.`)
  }

  const recordedGrossCostCents = getRecordedMovementCost(db, movement.id)
  let grossCostCents
  if (recordedGrossCostCents !== null) {
    grossCostCents = recordedGrossCostCents
    if (entry.grossCostCents !== undefined
      && assertSafeIntegerCents(entry.grossCostCents, `grossCostCents for movement ${movement.id}`) !== recordedGrossCostCents) {
      throw new Error(`Movement ${movement.id} has FIFO lot evidence totaling ${recordedGrossCostCents} cents; an override is not allowed.`)
    }
  } else {
    if (entry.grossCostCents === undefined) {
      throw new Error(`Movement ${movement.id} has no recorded FIFO lot cost; add grossCostCents to its crosswalk entry.`)
    }
    grossCostCents = assertSafeIntegerCents(entry.grossCostCents, `grossCostCents for movement ${movement.id}`)
  }
  const offcutCostCents = entry.offcutCostCents === undefined
    ? 0
    : assertSafeIntegerCents(entry.offcutCostCents, `offcutCostCents for movement ${movement.id}`)
  if (offcutCostCents > grossCostCents) throw new Error(`offcutCostCents cannot exceed grossCostCents for movement ${movement.id}.`)
  return { classification: entry.classification, orderId, grossCostCents, offcutCostCents }
}

function buildHistoricalConversionPlan(db, crosswalk) {
  if (!crosswalk || typeof crosswalk !== 'object' || Array.isArray(crosswalk)
    || !crosswalk.issues || typeof crosswalk.issues !== 'object' || Array.isArray(crosswalk.issues)) {
    throw new Error('Crosswalk JSON must contain an "issues" object keyed by inventory movement ID.')
  }
  if (!tableExists(db, 'inventory_movements') || !tableExists(db, 'orders')) {
    throw new Error('Source database is missing orders or inventory_movements; it is not a supported Madar ledger.')
  }
  const movementColumns = tableColumns(db, 'inventory_movements')
  for (const required of ['id', 'kind', 'quantity', 'material_id', 'created_at']) {
    if (!movementColumns.has(required)) throw new Error(`Source inventory_movements is missing required column ${required}.`)
  }
  const rows = db.prepare(`SELECT * FROM inventory_movements WHERE kind='issue' AND quantity<0 ORDER BY created_at,id`).all()
  const entries = []
  const unresolved = []
  let alreadyLinked = 0
  for (const movement of rows) {
    if (movementColumns.has('issue_id') && movement.issue_id != null) {
      alreadyLinked += 1
      continue
    }
    const crosswalkEntry = crosswalk.issues[String(movement.id)]
    if (crosswalkEntry === undefined) {
      unresolved.push({ movementId: movement.id, reason: 'missing_crosswalk_classification' })
      continue
    }
    try {
      entries.push({ movement, ...validateCrosswalkEntry(crosswalkEntry, movement, db) })
    } catch (error) {
      unresolved.push({ movementId: movement.id, reason: error.message })
    }
  }
  const unusedCrosswalkIds = Object.keys(crosswalk.issues)
    .filter((movementId) => !rows.some((row) => String(row.id) === movementId))
  return { entries, unresolved, alreadyLinked, totalHistoricalIssues: rows.length, unusedCrosswalkIds }
}

function validateActor(db, actorUserId) {
  const id = Number(actorUserId)
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('An active Admin actorUserId is required to record the conversion audit.')
  const actor = db.prepare("SELECT id FROM users WHERE id=? AND role='admin' AND active=1 AND deleted_at IS NULL").get(id)
  if (!actor) throw new Error(`User ${id} is not an active Admin and cannot be recorded as the conversion actor.`)
  return id
}

function applyHistoricalConversion(db, plan, actorUserId) {
  if (plan.unresolved.length) throw new Error(`Conversion stopped: ${plan.unresolved.length} legacy issue(s) need a complete classification/cost crosswalk.`)
  const actorId = validateActor(db, actorUserId)
  const updateMovement = db.prepare('UPDATE inventory_movements SET issue_id=? WHERE id=? AND issue_id IS NULL')
  const updateIssueJournal = db.prepare('UPDATE inventory_issues SET journal_entry_id=? WHERE id=?')
  const insertIssue = db.prepare(`INSERT INTO inventory_issues(classification,order_id,reference,requested_quantity,
      gross_cost_cents,offcut_cost_cents,cogs_cents,created_by,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
  const insertAudit = db.prepare(`INSERT INTO audit_log(user_id,action,entity,entity_id,details,old_values,new_values)
    VALUES (?,'historical-ledger-conversion','inventory-issue',?,?,?,?)`)
  const selectExistingJournal = db.prepare('SELECT id FROM journal_entries WHERE source_key=?')
  let converted = 0
  let journalEntriesCreated = 0
  let journalEntriesReused = 0
  for (const entry of plan.entries) {
    const { movement, classification, orderId, grossCostCents, offcutCostCents } = entry
    const cogsCents = grossCostCents - offcutCostCents
    const historicalActorId = movement.created_by != null
      && db.prepare('SELECT id FROM users WHERE id=?').get(movement.created_by) ? movement.created_by : null
    const issueId = insertIssue.run(classification, orderId, String(movement.reference || ''),
      Math.abs(Number(movement.quantity)), grossCostCents, offcutCostCents, cogsCents,
      historicalActorId, movement.created_at).lastInsertRowid
    updateMovement.run(issueId, movement.id)
    const sourceKey = `historical-inventory-issue:${movement.id}`
    let journal
    const existing = selectExistingJournal.get(sourceKey)
    if (existing) {
      journal = { id: existing.id, status: 'existing', replayed: true }
      journalEntriesReused += 1
    } else {
      journal = queueInventoryIssueJournal(db, {
        issueId, sourceKey, classification, grossCostCents, offcutCostCents,
        description: `ترحيل تكلفة حركة المخزون التاريخية ${movement.id}`,
        createdBy: historicalActorId,
        createdAt: movement.created_at,
      })
      if (journal.id) journalEntriesCreated += 1
    }
    if (journal.id) updateIssueJournal.run(journal.id, issueId)
    insertAudit.run(actorId, String(issueId), `movementId=${movement.id}; historicalAt=${movement.created_at}`,
      JSON.stringify({ movementId: movement.id, issueId: null }),
      JSON.stringify({ movementId: movement.id, issueId, classification, orderId, grossCostCents, offcutCostCents, cogsCents, journalEntryId: journal.id }))
    converted += 1
  }
  journalEntriesCreated += recognizeCompletedWorkOrderIssues(db)
  return { converted, journalEntriesCreated, journalEntriesReused, actorUserId: actorId }
}

function removeSqliteFile(filePath) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(`${filePath}${suffix}`, { force: true }) } catch {}
  }
}

async function convertHistoricalLedger({ sourcePath, outputPath, crosswalk, actorUserId, apply = false }) {
  const source = path.resolve(sourcePath)
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error('Source database file does not exist.')
  let sourceDb
  try {
    sourceDb = new Database(source, { readonly: true, fileMustExist: true, timeout: 5000 })
    const sourcePlan = buildHistoricalConversionPlan(sourceDb, crosswalk)
    if (!apply) {
      sourceDb.close()
      return { dryRun: true, ...sourcePlan }
    }
  } finally {
    if (sourceDb?.open) sourceDb.close()
  }

  if (!outputPath) throw new Error('--output is required with --apply.')
  const output = path.resolve(outputPath)
  if (output.toLocaleLowerCase() === source.toLocaleLowerCase()) throw new Error('Output must be a separate database file; the source is read-only.')
  if (fs.existsSync(output)) throw new Error('Output path already exists; refusing to overwrite a database or backup.')
  const actorValue = Number(actorUserId)
  if (!Number.isSafeInteger(actorValue) || actorValue < 1) throw new Error('--actor-user-id must identify an active Admin in the copied database.')
  fs.mkdirSync(path.dirname(output), { recursive: true })
  const staging = `${output}.converting-${process.pid}-${randomUUID()}`
  let sourceForBackup
  try {
    sourceForBackup = new Database(source, { readonly: true, fileMustExist: true, timeout: 5000 })
    await sourceForBackup.backup(staging)
    sourceForBackup.close()
    sourceForBackup = null

    const previousDbPath = process.env.DB_PATH
    const previousDatabaseUrl = process.env.DATABASE_URL
    const dbModule = path.resolve(__dirname, 'db.js')
    let migratedDb
    try {
      process.env.DB_PATH = staging
      delete process.env.DATABASE_URL
      delete require.cache[require.resolve(dbModule)]
      migratedDb = require(dbModule).db
    } finally {
      if (previousDbPath === undefined) delete process.env.DB_PATH
      else process.env.DB_PATH = previousDbPath
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = previousDatabaseUrl
    }

    if (!migratedDb) throw new Error('Could not initialize the isolated output database.')
    const outputPlan = buildHistoricalConversionPlan(migratedDb, crosswalk)
    if (outputPlan.unresolved.length) {
      migratedDb.close()
      const error = new Error(`Conversion stopped: ${outputPlan.unresolved.length} issue(s) need a complete crosswalk.`)
      error.plan = outputPlan
      throw error
    }
    validateActor(migratedDb, actorValue)
    const conversionResult = migratedDb.transaction(() => applyHistoricalConversion(migratedDb, outputPlan, actorValue))()
    const integrity = migratedDb.pragma('integrity_check', { simple: true })
    const foreignKeyViolations = migratedDb.pragma('foreign_key_check')
    if (integrity !== 'ok' || foreignKeyViolations.length) {
      migratedDb.close()
      throw new Error(`Output validation failed (integrity=${integrity}, foreignKeyViolations=${foreignKeyViolations.length}).`)
    }
    migratedDb.pragma('wal_checkpoint(TRUNCATE)')
    migratedDb.close()
    // Same-directory hard-link publication is atomic and fails rather than replacing a path
    // created by another process after the initial existence check.
    fs.linkSync(staging, output)
    fs.unlinkSync(staging)
    return { dryRun: false, outputPath: output, ...conversionResult, ...outputPlan, entries: undefined }
  } catch (error) {
    if (sourceForBackup?.open) sourceForBackup.close()
    removeSqliteFile(staging)
    throw error
  }
}

function readCrosswalk(filePath) {
  const resolved = path.resolve(filePath)
  const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Crosswalk file must contain a JSON object.')
  return parsed
}

module.exports = {
  applyHistoricalConversion,
  buildHistoricalConversionPlan,
  convertHistoricalLedger,
  getRecordedMovementCost,
  readCrosswalk,
}
