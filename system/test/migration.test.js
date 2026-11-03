const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Database = require('better-sqlite3')
const test = require('node:test')

test('migrates legacy fractional balances into offcuts and backfills invoice cash movements', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-migration-test-'))
  const databasePath = path.join(tempRoot, 'legacy.sqlite')
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousDbPath = process.env.DB_PATH
  const legacy = new Database(databasePath)
  legacy.exec(`
    CREATE TABLE materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'قطعة', stock REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0, min_stock REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, material_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('purchase','issue','adjustment')), quantity REAL NOT NULL,
      reference TEXT DEFAULT '', notes TEXT DEFAULT '', created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL, supplier TEXT DEFAULT '', client_id INTEGER,
       total REAL NOT NULL DEFAULT 0, notes TEXT DEFAULT '', created_by INTEGER, worker_id INTEGER REFERENCES workers(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE treasury_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, amount REAL NOT NULL,
      category TEXT NOT NULL DEFAULT '', reference TEXT DEFAULT '', notes TEXT DEFAULT '',
        invoice_id INTEGER UNIQUE, created_by INTEGER, worker_id INTEGER REFERENCES workers(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL, role TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
       created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
    );
    CREATE TABLE clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL,
      name_en TEXT DEFAULT '', governorate TEXT DEFAULT '', region TEXT DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, deleted_at TEXT
    );
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, client_id INTEGER NOT NULL,
      title TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'in_progress',
      notes TEXT DEFAULT '', total_cost REAL NOT NULL DEFAULT 0, material_cost REAL NOT NULL DEFAULT 0,
      operating_cost REAL NOT NULL DEFAULT 0, selling_price REAL NOT NULL DEFAULT 0, area_path TEXT DEFAULT '',
       created_by INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
       updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, archived_at TEXT, deleted_at TEXT,
       assigned_worker_id INTEGER REFERENCES users(id)
    );
    CREATE TABLE order_machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      machine_id INTEGER NOT NULL REFERENCES machines(id), before_photos TEXT NOT NULL DEFAULT '[]',
      after_photos TEXT NOT NULL DEFAULT '[]', reason_ids TEXT NOT NULL DEFAULT '[]'
    );
  `)
  legacy.prepare('INSERT INTO clients(code,name) VALUES (?,?)').run('C-OLD', 'Existing client')
  legacy.prepare('INSERT INTO users(username,password_hash,full_name,role) VALUES (?,?,?,?)')
    .run('legacy-admin', 'hash-only', 'Legacy Admin', 'admin')
  legacy.prepare('INSERT INTO users(username,password_hash,full_name,role) VALUES (?,?,?,?)')
    .run('legacy-operations', 'hash-only', 'Legacy Operations', 'operations')
  legacy.exec(`CREATE TABLE workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,job_title TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT
  )`)
  legacy.prepare('INSERT INTO workers(id,name,job_title,phone) VALUES (?,?,?,?)').run(22, 'Legacy technician', 'Technician', '555-0222')
  legacy.prepare('INSERT INTO machines(code,name_ar,governorate,region) VALUES (?,?,?,?)')
    .run('M-OLD-EMPTY', 'Legacy machine', 'Hurghada', '')
  legacy.prepare('INSERT INTO machines(code,name_ar,governorate,region) VALUES (?,?,?,?)')
    .run('M-OLD-REGION', 'Machine with region', 'Cairo', 'Fifth Settlement')
  legacy.prepare('INSERT INTO orders(code,client_id,title,type,assigned_worker_id) VALUES (?,?,?,?,?)')
    .run('OP-OLD', 1, 'Legacy title removed by V1.5 migration', 'operation', 2)
  legacy.prepare('INSERT INTO order_machines(order_id,machine_id) VALUES (?,?)').run(1, 1)
  legacy.prepare('INSERT INTO materials(code,name,stock,unit_cost) VALUES (?,?,?,?)').run('MAT-OLD', 'Legacy sheet', 5.75, 20)
  legacy.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes)
    VALUES (1,'adjustment',5.75,'رصيد افتتاحي','')`).run()
  legacy.prepare(`INSERT INTO invoices(code,kind,supplier,total,notes,worker_id) VALUES ('INV-OLD','purchase','Legacy supplier',100,'old bill',22)`).run()
  legacy.close()

  let migrated
  try {
    process.env.DATABASE_URL = `file:${databasePath}`
    delete process.env.DB_PATH
    delete require.cache[require.resolve('../src/db')]
    migrated = require('../src/db').db

    const material = migrated.prepare('SELECT stock,sub_stock FROM materials WHERE code=?').get('MAT-OLD')
    assert.deepEqual(material, { stock: 5, sub_stock: 0.75 })
    assert.equal(migrated.prepare('SELECT area FROM machines WHERE code=?').get('M-OLD-EMPTY').area, 'Hurghada')
    assert.equal(migrated.prepare('SELECT area FROM machines WHERE code=?').get('M-OLD-REGION').area, 'Fifth Settlement')
    const machineColumns = migrated.pragma('table_info(machines)').map((column) => column.name)
    assert.ok(machineColumns.includes('area'))
    assert.equal(machineColumns.includes('region'), false)
    assert.equal(machineColumns.includes('governorate'), false)
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('machine-governorate-to-region-v1'))
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('order-machine-private-notes-v1'))
    assert.equal(migrated.pragma('table_info(order_machines)').find((column) => column.name === 'note').dflt_value, "''")
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('area-folder-source-paths-v1'))
    assert.ok(migrated.pragma('table_info(area_folders)').some((column) => column.name === 'source_folder_paths'))
    assert.ok(migrated.pragma('table_info(area_folders)').some((column) => column.name === 'deleted_at'))
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('area-folder-soft-delete-v1'))
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('v15-area-and-order-financial-nullability-v1'))
    assert.deepEqual(migrated.pragma('index_info("idx_machines_area")').map((column) => column.name), ['area'])
    const correction = migrated.prepare(`SELECT quantity,warehouse FROM inventory_movements
      WHERE reference='ترحيل المخزن الفرعي' ORDER BY id`).all()
    assert.deepEqual(correction, [{ quantity: -0.75, warehouse: 'main' }, { quantity: 0.75, warehouse: 'sub' }])
    assert.equal(migrated.prepare('SELECT status FROM invoices WHERE code=?').get('INV-OLD').status, 'approved')
    assert.deepEqual(migrated.prepare('SELECT paid_total,remaining,payment_status FROM invoices WHERE code=?').get('INV-OLD'),
      { paid_total: 100, remaining: 0, payment_status: 'paid' })
    assert.deepEqual(migrated.prepare(`SELECT kind,amount,category,invoice_id FROM treasury_transactions`).get(), {
      kind: 'expense', amount: 100, category: 'مشتريات مخزون', invoice_id: 1,
    })
    assert.deepEqual(migrated.prepare('SELECT id,code,assigned_worker_id,assigned_employee_id FROM orders WHERE code=?').get('OP-OLD'), {
      id: 1, code: 'OP-OLD', assigned_worker_id: 2,
      assigned_employee_id: migrated.prepare('SELECT employee_id FROM users WHERE id=2').get().employee_id,
    })
    const orderColumns = migrated.pragma('table_info(orders)')
    assert.equal(orderColumns.some((column) => column.name === 'title'), false)
    for (const name of ['total_cost', 'material_cost', 'operating_cost', 'selling_price']) {
      assert.equal(orderColumns.find((column) => column.name === name).notnull, 0)
    }
    assert.equal(migrated.prepare('SELECT COUNT(*) AS count FROM order_machines WHERE order_id=?').get(1).count, 1)
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('orders-assigned-worker-v1'))
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('workers-financial-links-and-user-controls-v1'))
    assert.equal(Boolean(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workers'").get()), false)
    assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_worker_history'").get())
    assert.equal(migrated.prepare('SELECT name FROM legacy_worker_history WHERE id=22').get().name, 'Legacy technician')
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('retire-legacy-workers-table-v12'))
    assert.ok(migrated.pragma('foreign_key_list(invoices)').some((foreignKey) => foreignKey.table === 'legacy_worker_history'))
    assert.ok(migrated.pragma('table_info(invoices)').some((column) => column.name === 'worker_id'))
    assert.ok(migrated.pragma('table_info(treasury_transactions)').some((column) => column.name === 'worker_id'))
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('employees-users-orders-financial-links-v1'))
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('schema-version-markers-v1'))
    assert.equal(migrated.pragma('application_id', { simple: true }), require('../src/schema-version').MADAR_APPLICATION_ID)
    assert.equal(migrated.pragma('user_version', { simple: true }), require('../src/schema-version').CURRENT_SCHEMA_VERSION)
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('work-order-cogs-v1'))
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('manufacturing-account-mappings-v1'))
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('other-invoice-attachments-schema-v6'))
    assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='other_invoice_attachments'").get())
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('purchase-invoice-revisions-schema-v7'))
    assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='purchase_invoice_revisions'").get())
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('payroll-attendance-schema-v8'))
    assert.ok(migrated.pragma('table_info(payroll_records)').some((column) => column.name === 'absence_days'))
    assert.ok(migrated.pragma('table_info(payroll_records)').some((column) => column.name === 'absence_deduction_cents'))
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?')
      .get('operational-domains-secondary-warehouse-schema-v9'))
    for (const table of ['maintenance_orders', 'manufacturing_orders', 'secondary_warehouse_offcuts',
      'secondary_warehouse_scrap_sales', 'secondary_warehouse_scrap_sale_items']) {
      assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `missing ${table}`)
    }
    assert.deepEqual(migrated.prepare('SELECT id,name,department,base_salary,standard_daily_hours,standard_monthly_days,can_login,is_active FROM employees WHERE id=22').get(), {
      id: 22, name: 'Legacy technician', department: 'Maintenance', base_salary: 0,
      standard_daily_hours: 9, standard_monthly_days: 26, can_login: 0, is_active: 1,
    })
    assert.deepEqual(migrated.prepare('SELECT id,code,type FROM orders WHERE id=1').get(), {
      id: 1, code: 'OP-OLD', type: 'operation',
    })
    const scrapTreasuryId = migrated.prepare(`INSERT INTO treasury_transactions(kind,amount,category)
      VALUES ('income',15,'')`).run().lastInsertRowid
    migrated.prepare(`INSERT INTO secondary_warehouse_scrap_sales(amount_cents,treasury_transaction_id)
      VALUES (?,?)`).run(1500, scrapTreasuryId)
    assert.equal(migrated.prepare('SELECT category FROM treasury_transactions WHERE id=?').get(scrapTreasuryId).category,
      'إيرادات بيع خردة ومخلفات تشغيل')
    const expenseTreasuryId = migrated.prepare(`INSERT INTO treasury_transactions(kind,amount,category)
      VALUES ('expense',15,'')`).run().lastInsertRowid
    assert.throws(() => migrated.prepare(`INSERT INTO secondary_warehouse_scrap_sales(amount_cents,treasury_transaction_id)
      VALUES (?,?)`).run(1500, expenseTreasuryId), /scrap sale must link an income/)
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('staff-attendance-tool-custody-schema-v10'))
    for (const table of ['employee_daily_attendance', 'employee_tool_custody']) {
      assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `missing ${table}`)
    }
    assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('secondary-warehouse-stock-count-schema-v11'))
    assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='stock_count_offcut_items'").get())
    const staffId = migrated.prepare(`INSERT INTO employees(name,department) VALUES ('Custody test','Maintenance')`).run().lastInsertRowid
    migrated.prepare(`INSERT INTO employee_daily_attendance(employee_id,attendance_date,status,overtime_minutes)
      VALUES (?,?,?,?)`).run(staffId, '2026-10-01', 'present', 60)
    assert.equal(migrated.prepare('SELECT overtime_minutes FROM employee_daily_attendance WHERE employee_id=?').get(staffId).overtime_minutes, 60)
    const custodyId = migrated.prepare(`INSERT INTO employee_tool_custody(employee_id,tool_name,serial_number)
      VALUES (?,'Drill','DR-TEST-1')`).run(staffId).lastInsertRowid
    assert.throws(() => migrated.prepare('UPDATE employees SET active=0 WHERE id=?').run(staffId), /employee has outstanding tool custody/)
    migrated.prepare(`UPDATE employee_tool_custody SET return_status='returned',returned_at=CURRENT_TIMESTAMP WHERE id=?`).run(custodyId)
    assert.equal(migrated.prepare('UPDATE employees SET active=0 WHERE id=?').run(staffId).changes, 1)
    assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='inventory_issues'").get())
    assert.ok(migrated.pragma('table_info(inventory_movements)').some((column) => column.name === 'issue_id'))
    const manufacturingMappings = migrated.prepare(`SELECT am.mapping_key,am.account_id,am.approved,a.system_key
      FROM account_mappings am JOIN accounts a ON a.id=am.account_id
      WHERE am.mapping_key IN ('inventory','work_order_wip','work_order_cogs','inventory_consumption')
      ORDER BY am.mapping_key`).all()
    assert.deepEqual(manufacturingMappings.map(({ mapping_key, approved, system_key }) => [mapping_key, approved, system_key]), [
      ['inventory', 1, 'inventory'],
      ['inventory_consumption', 1, 'inventory_consumption'],
      ['work_order_cogs', 1, 'work_order_cogs'],
      ['work_order_wip', 1, 'work_order_wip'],
    ])
    assert.deepEqual(migrated.prepare('SELECT id,name,department FROM employees WHERE id=22').get(), {
      id: 22, name: 'Legacy technician', department: 'Maintenance',
    })
    assert.deepEqual(migrated.prepare('SELECT employee_id FROM invoices WHERE code=?').get('INV-OLD'), { employee_id: 22 })
    assert.deepEqual(migrated.prepare(`SELECT e.department FROM users u JOIN employees e ON e.id=u.employee_id
      WHERE u.username=?`).get('legacy-operations'), { department: 'Operation' })
    assert.ok(migrated.pragma('foreign_key_list(orders)').some((key) => key.from === 'assigned_employee_id' && key.table === 'employees'))
    const migratedMaster = migrated.prepare('SELECT is_master,deleted_at FROM users ORDER BY id LIMIT 1').get()
    assert.equal(migratedMaster.is_master, 1)
    assert.equal(migratedMaster.deleted_at, null)
    assert.ok(migrated.pragma('foreign_key_list(orders)').some((key) => key.from === 'assigned_worker_id' && key.table === 'users'))
    const uniqueInvoiceIndex = migrated.pragma('index_list(treasury_transactions)')
      .filter((index) => index.unique)
      .some((index) => migrated.pragma(`index_info("${index.name}")`).some((column) => column.name === 'invoice_id'))
    assert.equal(uniqueInvoiceIndex, false)
  } finally {
    if (migrated?.open) migrated.close()
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousDbPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = previousDbPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('manufacturing account migration preserves existing custom mapping choices', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-manufacturing-mapping-test-'))
  const databasePath = path.join(tempRoot, 'mapping.sqlite')
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousDbPath = process.env.DB_PATH
  let migrated
  try {
    process.env.DB_PATH = databasePath
    delete process.env.DATABASE_URL
    delete require.cache[require.resolve('../src/db')]
    const initial = require('../src/db').db
    const customAccountId = initial.prepare('INSERT INTO accounts(code,name,account_type) VALUES (?,?,?)')
      .run('5290', 'Custom manufacturing cost', 'expense').lastInsertRowid
    initial.prepare("UPDATE account_mappings SET account_id=?,approved=0 WHERE mapping_key='work_order_cogs'")
      .run(customAccountId)
    initial.prepare("DELETE FROM schema_migrations WHERE name='manufacturing-account-mappings-v1'").run()
    initial.close()

    delete require.cache[require.resolve('../src/db')]
    migrated = require('../src/db').db
    assert.deepEqual(migrated.prepare("SELECT account_id,approved FROM account_mappings WHERE mapping_key='work_order_cogs'").get(), {
      account_id: customAccountId, approved: 0,
    })
    assert.equal(migrated.prepare("SELECT approved FROM account_mappings WHERE mapping_key='work_order_wip'").get().approved, 1)
  } finally {
    if (migrated?.open) migrated.close()
    delete require.cache[require.resolve('../src/db')]
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousDbPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = previousDbPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})

test('manufacturing migration moves pending order issues to WIP and recognizes archived work orders', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'madar-wip-migration-test-'))
  const databasePath = path.join(tempRoot, 'wip.sqlite')
  const previousDatabaseUrl = process.env.DATABASE_URL
  const previousDbPath = process.env.DB_PATH
  let migrated
  try {
    process.env.DB_PATH = databasePath
    delete process.env.DATABASE_URL
    delete require.cache[require.resolve('../src/db')]
    const initial = require('../src/db').db
    initial.prepare('INSERT INTO clients(id,code,name) VALUES (1,?,?)').run('C-WIP', 'WIP client')
    initial.prepare(`INSERT INTO orders(id,code,client_id,type,status,archived_at)
      VALUES (1,'OP-WIP',1,'operation','archived','2024-03-04 05:06:07')`).run()
    const issueId = initial.prepare(`INSERT INTO inventory_issues(classification,order_id,reference,requested_quantity,
      gross_cost_cents,offcut_cost_cents,cogs_cents,created_at) VALUES ('order',1,'legacy issue',1,500,0,500,'2024-03-03 04:05:06')`)
      .run().lastInsertRowid
    const oldPayload = JSON.stringify([
      { mappingKey: 'work_order_cogs', debitCents: 500, description: 'old direct COGS issue' },
      { mappingKey: 'inventory', creditCents: 500, description: 'inventory issue' },
    ])
    const journalId = initial.prepare(`INSERT INTO journal_entries(source_type,source_id,source_key,description,status,posting_payload)
      VALUES ('inventory_issue',?,?,?,'pending_configuration',?)`).run(String(issueId), `inventory-issue:${issueId}`, 'legacy issue', oldPayload).lastInsertRowid
    initial.prepare('UPDATE inventory_issues SET journal_entry_id=? WHERE id=?').run(journalId, issueId)
    initial.prepare("DELETE FROM schema_migrations WHERE name='manufacturing-account-mappings-v1'").run()
    initial.close()

    delete require.cache[require.resolve('../src/db')]
    migrated = require('../src/db').db
    const migratedIssueJournal = migrated.prepare('SELECT * FROM journal_entries WHERE id=?').get(journalId)
    assert.equal(migratedIssueJournal.status, 'posted')
    assert.ok(JSON.parse(migratedIssueJournal.posting_payload).some((line) => line.mappingKey === 'work_order_wip'
      && line.debitCents === 500))
    const issueWipLine = migrated.prepare(`SELECT a.system_key,jl.debit_cents FROM journal_lines jl
      JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_entry_id=? AND jl.debit_cents>0`).get(journalId)
    assert.deepEqual(issueWipLine, { system_key: 'work_order_wip', debit_cents: 500 })

    const recognition = migrated.prepare("SELECT * FROM journal_entries WHERE source_key=?")
      .get(`work-order-cogs:1:issue:${issueId}`)
    assert.equal(recognition.status, 'posted')
    assert.equal(recognition.created_at, '2024-03-04 05:06:07')
    const recognitionLines = migrated.prepare(`SELECT a.system_key,jl.debit_cents,jl.credit_cents FROM journal_lines jl
      JOIN accounts a ON a.id=jl.account_id WHERE jl.journal_entry_id=? ORDER BY jl.line_number`).all(recognition.id)
    assert.deepEqual(recognitionLines, [
      { system_key: 'work_order_cogs', debit_cents: 500, credit_cents: 0 },
      { system_key: 'work_order_wip', debit_cents: 0, credit_cents: 500 },
    ])
  } finally {
    if (migrated?.open) migrated.close()
    delete require.cache[require.resolve('../src/db')]
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
    if (previousDbPath === undefined) delete process.env.DB_PATH
    else process.env.DB_PATH = previousDbPath
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
})
