const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const test = require('node:test')
const {
  calculatePayroll,
  materialVariantKey,
  queueJournalEntry,
  salesTaxCents,
  setAccountMapping,
} = require('../src/accounting')

test('material identity is stable across Arabic normalization and distinguishes specification and price', () => {
  const base = { name: '  أَلواح أكريليك ', specification: '  شفاف  ', unit: 'لوح', unitCostCents: 1250 }
  assert.equal(materialVariantKey(base), materialVariantKey({ ...base, name: 'الواح أكريليك', specification: 'شفاف' }))
  assert.notEqual(materialVariantKey(base), materialVariantKey({ ...base, specification: 'ملون' }))
  assert.notEqual(materialVariantKey(base), materialVariantKey({ ...base, unitCostCents: 1251 }))
})

test('sales tax uses basis points and rounds upward to the next EGP 0.10 exactly', () => {
  assert.equal(salesTaxCents(10_000, 1_400), 1_400)
  assert.equal(salesTaxCents(1_400, 10_000), 1_400)
  assert.equal(salesTaxCents(1_401, 10_000), 1_410)
  assert.equal(salesTaxCents(1_410, 10_000), 1_410)
  assert.equal(salesTaxCents(1_411, 10_000), 1_420)
  assert.equal(salesTaxCents(101, 1_400), 20)
  assert.equal(salesTaxCents(103, 1_400), 20)
  assert.equal(salesTaxCents(0, 1_400), 0)
  assert.throws(() => salesTaxCents(100, 100_001))
})

test('payroll applies 150% ordinary and 200% holiday overtime, deductions, advances and overpayments in cents', () => {
  const overtime = calculatePayroll({ baseSalaryCents: 2_700_000,
    ordinaryOvertimeMinutes: 60, holidayOvertimeMinutes: 60 })
  assert.equal(overtime.ordinaryOvertimeCents, 15_000)
  assert.equal(overtime.holidayOvertimeCents, 20_000)
  assert.equal(overtime.netEntitlementCents, 2_735_000)

  const settlement = calculatePayroll({ baseSalaryCents: 270_000, deductionCents: 20_000,
    outstandingAdvanceCents: 100_000, cashPaidCents: 200_000 })
  assert.deepEqual(settlement, {
    ordinaryOvertimeCents: 0, holidayOvertimeCents: 0, netEntitlementCents: 250_000,
    advancesAppliedCents: 50_000, cashPaidCents: 200_000, unpaidSalaryCents: 0,
    overpaymentCents: 0, advanceBalanceCents: 50_000,
  })
  const overpayment = calculatePayroll({ baseSalaryCents: 100_000, cashPaidCents: 125_000 })
  assert.equal(overpayment.overpaymentCents, 25_000)
  assert.equal(overpayment.advanceBalanceCents, 25_000)
  assert.throws(() => calculatePayroll({ baseSalaryCents: 100, deductionCents: 101 }))
})

test('journals remain pending until approved account mappings are supplied, then post once balanced', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-accounting-test-'))
  const db = new Database(path.join(tempRoot, 'accounting.sqlite'))
  try {
    db.exec(`
      CREATE TABLE accounts(id INTEGER PRIMARY KEY, code TEXT, name TEXT, account_type TEXT, active INTEGER DEFAULT 1);
      CREATE TABLE account_mappings(mapping_key TEXT PRIMARY KEY, account_id INTEGER, approved INTEGER, updated_by INTEGER, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE journal_entries(
        id INTEGER PRIMARY KEY, source_type TEXT, source_id TEXT, source_key TEXT UNIQUE, description TEXT,
        status TEXT, posting_payload TEXT, total_debit_cents INTEGER DEFAULT 0, total_credit_cents INTEGER DEFAULT 0,
        reverses_entry_id INTEGER, created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP, posted_at TEXT
      );
      CREATE TABLE journal_lines(
        id INTEGER PRIMARY KEY, journal_entry_id INTEGER, line_number INTEGER, account_id INTEGER,
        description TEXT, debit_cents INTEGER, credit_cents INTEGER, UNIQUE(journal_entry_id,line_number)
      );
      INSERT INTO accounts(id,code,name,account_type) VALUES
        (1,'1000','Cash','asset'),(2,'4000','Sales','revenue'),(3,'5100','Inventory variance','expense');
      INSERT INTO account_mappings(mapping_key,account_id,approved) VALUES
        ('factory_cashbox',NULL,0),('sales_revenue',NULL,0);
    `)
    const entry = queueJournalEntry(db, {
      sourceType: 'test', sourceId: 42, sourceKey: 'test:42',
      postings: [
        { mappingKey: 'factory_cashbox', debitCents: 1000 },
        { mappingKey: 'sales_revenue', creditCents: 1000 },
      ],
    })
    assert.equal(entry.status, 'pending_configuration')
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_lines').get().count, 0)
    setAccountMapping(db, { mappingKey: 'factory_cashbox', accountId: 1, userId: 7 })
    assert.equal(db.prepare('SELECT status FROM journal_entries WHERE id=?').get(entry.id).status, 'pending_configuration')
    setAccountMapping(db, { mappingKey: 'sales_revenue', accountId: 2, userId: 7 })
    assert.deepEqual(db.prepare('SELECT status,total_debit_cents,total_credit_cents FROM journal_entries WHERE id=?').get(entry.id), {
      status: 'posted', total_debit_cents: 1000, total_credit_cents: 1000,
    })
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM journal_lines WHERE journal_entry_id=?').get(entry.id).count, 2)
    assert.throws(() => setAccountMapping(db, { mappingKey: 'inventory_variance', accountId: 1, userId: 7 }), /expense/)
    setAccountMapping(db, { mappingKey: 'inventory_variance', accountId: 3, userId: 7 })
    setAccountMapping(db, { mappingKey: 'work_order_wip', accountId: 1, userId: 7 })
    assert.equal(db.prepare("SELECT approved FROM account_mappings WHERE mapping_key='work_order_wip'").get().approved, 1)
    assert.equal(queueJournalEntry(db, {
      sourceType: 'test', sourceId: 42, sourceKey: 'test:42',
      postings: [{ mappingKey: 'factory_cashbox', debitCents: 1000 }, { mappingKey: 'sales_revenue', creditCents: 1000 }],
    }).replayed, true)
  } finally {
    db.close()
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
