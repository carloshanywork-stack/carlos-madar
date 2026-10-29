const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const Database = require('better-sqlite3')
const { convertHistoricalLedger } = require('../src/historical-ledger-conversion')

test('historical conversion is dry-run-first, explicit, valued, date-preserving, audited, and writes a separate copy', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-ledger-conversion-test-'))
  const sourcePath = path.join(tempRoot, 'source-v3.sqlite')
  const outputPath = path.join(tempRoot, 'converted.sqlite')
  const setup = `
    const {db}=require('./src/db')
    db.transaction(()=>{
      db.prepare('INSERT INTO users(id,username,password_hash,full_name,role) VALUES (1,?,?,?,?)')
        .run('conversion-admin','hash-only','Conversion Admin','admin')
      db.prepare('INSERT INTO clients(id,code,name) VALUES (1,?,?)').run('C-CONVERT','Conversion client')
      db.prepare("INSERT INTO orders(id,code,client_id,type,status) VALUES (1,'OP-CONVERT',1,'operation','archived')").run()
      db.prepare("INSERT INTO materials(id,code,name,stock) VALUES (1,'MAT-CONVERT','Legacy material',0)").run()
      db.prepare("INSERT INTO inventory_lots(material_id,source_type,source_id,warehouse,received_quantity,remaining_quantity,unit_cost_cents) VALUES (1,'purchase_invoice','legacy','main',2,0,3456)").run()
      db.prepare("INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,created_at,warehouse,source_type,source_id) VALUES (1,'issue',-2,'legacy free-text reference','historical test',1,'2023-01-02 03:04:05','main','inventory_issue','legacy free-text reference')").run()
      db.prepare('INSERT INTO inventory_lot_consumptions(lot_id,movement_id,quantity) VALUES (1,1,2)').run()
      db.exec('DROP INDEX idx_inventory_movements_issue; DROP TABLE inventory_issues; ALTER TABLE inventory_movements DROP COLUMN issue_id;')
      db.prepare("DELETE FROM schema_migrations WHERE name='work-order-cogs-v1'").run()
      db.pragma('user_version = 3')
    })()
    db.close()
  `
  try {
    execFileSync(process.execPath, ['-e', setup], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DB_PATH: sourcePath, DATABASE_URL: `file:${sourcePath}`, NODE_ENV: 'test' },
      stdio: 'pipe',
    })
    const crosswalk = { issues: { '1': { classification: 'order', orderId: 1, offcutCostCents: 512 } } }
    const dryRun = await convertHistoricalLedger({ sourcePath, crosswalk })
    assert.equal(dryRun.dryRun, true)
    assert.equal(dryRun.entries.length, 1)
    assert.equal(dryRun.entries[0].grossCostCents, 6912)
    assert.equal(dryRun.entries[0].offcutCostCents, 512)
    assert.equal(fs.existsSync(outputPath), false)

    const incomplete = await convertHistoricalLedger({ sourcePath, crosswalk: { issues: {} } })
    assert.equal(incomplete.unresolved[0].reason, 'missing_crosswalk_classification')
    await assert.rejects(convertHistoricalLedger({
      sourcePath, outputPath, crosswalk: { issues: {} }, actorUserId: 1, apply: true,
    }), /complete crosswalk/)
    assert.equal(fs.existsSync(outputPath), false)

    const applied = await convertHistoricalLedger({ sourcePath, outputPath, crosswalk, actorUserId: 1, apply: true })
    assert.equal(applied.converted, 1)
    assert.equal(applied.journalEntriesCreated, 2)
    assert.equal(applied.outputPath, outputPath)

    const source = new Database(sourcePath, { readonly: true })
    assert.equal(source.pragma('user_version', { simple: true }), 3)
    assert.equal(source.pragma('table_info(inventory_movements)').some((column) => column.name === 'issue_id'), false)
    source.close()

    const converted = new Database(outputPath, { readonly: true })
    try {
      assert.equal(converted.pragma('user_version', { simple: true }), require('../src/schema-version').CURRENT_SCHEMA_VERSION)
      const issue = converted.prepare('SELECT * FROM inventory_issues').get()
      assert.equal(issue.classification, 'order')
      assert.equal(issue.order_id, 1)
      assert.equal(issue.gross_cost_cents, 6912)
      assert.equal(issue.offcut_cost_cents, 512)
      assert.equal(issue.cogs_cents, 6400)
      assert.equal(issue.created_at, '2023-01-02 03:04:05')
      assert.equal(converted.prepare('SELECT issue_id FROM inventory_movements WHERE id=1').get().issue_id, issue.id)
      const journal = converted.prepare('SELECT * FROM journal_entries WHERE id=?').get(issue.journal_entry_id)
      assert.equal(journal.source_key, 'historical-inventory-issue:1')
      assert.equal(journal.created_at, '2023-01-02 03:04:05')
      assert.equal(journal.status, 'posted')
      const postings = JSON.parse(journal.posting_payload)
      assert.equal(postings.find((line) => line.mappingKey === 'work_order_wip').debitCents, 6400)
      assert.equal(postings.find((line) => line.mappingKey === 'inventory' && line.debitCents).debitCents, 512)
      assert.equal(postings.find((line) => line.mappingKey === 'inventory' && line.creditCents).creditCents, 6912)
      const recognition = converted.prepare("SELECT * FROM journal_entries WHERE source_key=?")
        .get(`work-order-cogs:1:issue:${issue.id}`)
      assert.equal(recognition.source_type, 'work_order_cogs_recognition')
      assert.equal(recognition.status, 'posted')
      const recognitionPostings = JSON.parse(recognition.posting_payload)
      assert.equal(recognitionPostings.find((line) => line.mappingKey === 'work_order_cogs').debitCents, 6400)
      assert.equal(recognitionPostings.find((line) => line.mappingKey === 'work_order_wip').creditCents, 6400)
      assert.deepEqual(converted.prepare("SELECT user_id,action,entity FROM audit_log WHERE action='historical-ledger-conversion'").get(), {
        user_id: 1, action: 'historical-ledger-conversion', entity: 'inventory-issue',
      })
    } finally { converted.close() }

    const secondCopy = path.join(tempRoot, 'converted-again.sqlite')
    const repeated = await convertHistoricalLedger({
      sourcePath: outputPath, outputPath: secondCopy, crosswalk: { issues: {} }, actorUserId: 1, apply: true,
    })
    assert.equal(repeated.converted, 0)
    assert.equal(repeated.alreadyLinked, 1)
    const second = new Database(secondCopy, { readonly: true })
    try {
      assert.equal(second.prepare('SELECT COUNT(*) AS count FROM inventory_issues').get().count, 1)
      assert.equal(second.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE source_type='inventory_issue'").get().count, 1)
      assert.equal(second.prepare("SELECT COUNT(*) AS count FROM journal_entries WHERE source_type='work_order_cogs_recognition'").get().count, 1)
    } finally { second.close() }
    await assert.rejects(convertHistoricalLedger({ sourcePath, outputPath, crosswalk, actorUserId: 1, apply: true }), /already exists/)
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('historical conversion refuses inferred classifications and missing legacy cost evidence', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-ledger-crosswalk-test-'))
  const databasePath = path.join(tempRoot, 'minimal.sqlite')
  const db = new Database(databasePath)
  try {
    db.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY,deleted_at TEXT);
      CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,kind TEXT,quantity REAL,material_id INTEGER,created_at TEXT,issue_id INTEGER);
      INSERT INTO orders(id) VALUES (1);
      INSERT INTO inventory_movements VALUES (1,'issue',-1,1,'2022-01-01',NULL);`)
    const { buildHistoricalConversionPlan } = require('../src/historical-ledger-conversion')
    const plan = buildHistoricalConversionPlan(db, { issues: { '1': { classification: 'general' } } })
    assert.equal(plan.entries.length, 0)
    assert.match(plan.unresolved[0].reason, /grossCostCents/)
  } finally {
    db.close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
