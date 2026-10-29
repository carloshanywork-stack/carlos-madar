const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const Database = require('better-sqlite3')
const {
  CURRENT_SCHEMA_VERSION,
  MADAR_APPLICATION_ID,
  validateDatabaseSchemaMetadata,
} = require('./schema-version')

const projectRoot = path.resolve(__dirname, '..', '..')
const rawDatabaseUrl = process.env.DATABASE_URL || 'file:./system/data/madar.sqlite'
const configuredDbPath = process.env.DB_PATH
if (!configuredDbPath && !rawDatabaseUrl.startsWith('file:')) {
  throw new Error('DATABASE_URL must use the SQLite file: URL format in this release.')
}
const rawDatabasePath = configuredDbPath
  ? (configuredDbPath.startsWith('file:') ? configuredDbPath.slice('file:'.length) : configuredDbPath)
  : rawDatabaseUrl.slice('file:'.length)
const databasePath = path.resolve(projectRoot, rawDatabasePath)
fs.mkdirSync(path.dirname(databasePath), { recursive: true })

const db = new Database(databasePath)
try {
  validateDatabaseSchemaMetadata(
    db.pragma('application_id', { simple: true }),
    db.pragma('user_version', { simple: true }),
  )
} catch (error) {
  db.close()
  throw error
}
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','sales','operations','purchasing')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 1000
);
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  address TEXT DEFAULT '',
  primary_color TEXT NOT NULL DEFAULT '#173a66',
  secondary_color TEXT NOT NULL DEFAULT '#f49b36',
  logo_path TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT DEFAULT '',
  area TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  type TEXT NOT NULL CHECK(type IN ('operation','maintenance')),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','review','archived')),
  notes TEXT DEFAULT '',
  total_cost REAL DEFAULT 0,
  material_cost REAL DEFAULT 0,
  operating_cost REAL DEFAULT 0,
  selling_price REAL DEFAULT 0,
  area_path TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TEXT,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS order_machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  before_photos TEXT NOT NULL DEFAULT '[]',
  after_photos TEXT NOT NULL DEFAULT '[]',
  reason_ids TEXT NOT NULL DEFAULT '[]',
  note TEXT NOT NULL DEFAULT '',
  UNIQUE(order_id, machine_id)
);
CREATE TABLE IF NOT EXISTS area_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  folder_name TEXT NOT NULL,
  folder_key TEXT NOT NULL,
  image_paths TEXT NOT NULL DEFAULT '[]',
  source_folder_paths TEXT NOT NULL DEFAULT '[]',
  machine_id INTEGER REFERENCES machines(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(order_id, folder_key)
);
CREATE TABLE IF NOT EXISTS maintenance_reasons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'قطعة',
  stock REAL NOT NULL DEFAULT 0,
  unit_cost REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  sub_stock REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('purchase','sales')),
  supplier TEXT DEFAULT '',
  client_id INTEGER REFERENCES clients(id),
  total REAL NOT NULL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'approved',
  order_id INTEGER REFERENCES orders(id),
  paid_total REAL NOT NULL DEFAULT 0,
  remaining REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  quantity REAL NOT NULL,
  unit_cost REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  material_id INTEGER NOT NULL REFERENCES materials(id),
  kind TEXT NOT NULL CHECK(kind IN ('purchase','issue','adjustment')),
  quantity REAL NOT NULL,
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  warehouse TEXT NOT NULL DEFAULT 'main'
);
CREATE TABLE IF NOT EXISTS treasury_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
  amount REAL NOT NULL CHECK(amount >= 0),
  category TEXT NOT NULL DEFAULT '',
  reference TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  invoice_id INTEGER REFERENCES invoices(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT DEFAULT '',
  details TEXT DEFAULT '',
  old_values TEXT,
  new_values TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id INTEGER NOT NULL REFERENCES users(id),
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(user_id, scope, key)
);
CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_order_machines_order ON order_machines(order_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
`)

function ensureColumn(table, name, declaration) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name))
  if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${declaration}`)
}

db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)')
ensureColumn('materials', 'sub_stock', 'REAL NOT NULL DEFAULT 0')
ensureColumn('invoices', 'status', "TEXT NOT NULL DEFAULT 'approved'")
ensureColumn('invoices', 'order_id', 'INTEGER REFERENCES orders(id)')
ensureColumn('inventory_movements', 'warehouse', "TEXT NOT NULL DEFAULT 'main'")
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('area-folder-source-paths-v1')) {
  db.transaction(() => {
    ensureColumn('area_folders', 'source_folder_paths', "TEXT NOT NULL DEFAULT '[]'")
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('area-folder-source-paths-v1')
  })()
}
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('area-folder-soft-delete-v1')) {
  db.transaction(() => {
    ensureColumn('area_folders', 'deleted_at', 'TEXT')
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('area-folder-soft-delete-v1')
  })()
}
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('machine-governorate-to-region-v1')) {
  db.transaction(() => {
    const machineColumns = new Set(db.prepare('PRAGMA table_info(machines)').all().map((column) => column.name))
    const legacyAreaColumn = machineColumns.has('area') ? 'area' : machineColumns.has('region') ? 'region' : null
    if (machineColumns.has('governorate') && legacyAreaColumn) {
      db.prepare(`UPDATE machines
        SET ${legacyAreaColumn}=TRIM(governorate)
        WHERE (${legacyAreaColumn} IS NULL OR TRIM(${legacyAreaColumn})='')
          AND governorate IS NOT NULL AND TRIM(governorate)<>''`).run()
    }
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('machine-governorate-to-region-v1')
  })()
}
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('soft-delete-audit-idempotency-columns-v1')) {
  db.transaction(() => {
    ensureColumn('invoices', 'paid_total', 'REAL NOT NULL DEFAULT 0')
    ensureColumn('invoices', 'remaining', 'REAL NOT NULL DEFAULT 0')
    ensureColumn('invoices', 'payment_status', "TEXT NOT NULL DEFAULT 'unpaid'")
    ensureColumn('invoices', 'deleted_at', 'TEXT')
    ensureColumn('clients', 'deleted_at', 'TEXT')
    ensureColumn('machines', 'active', 'INTEGER NOT NULL DEFAULT 1')
    ensureColumn('machines', 'deleted_at', 'TEXT')
    ensureColumn('materials', 'active', 'INTEGER NOT NULL DEFAULT 1')
    ensureColumn('materials', 'deleted_at', 'TEXT')
    ensureColumn('orders', 'deleted_at', 'TEXT')
    ensureColumn('audit_log', 'old_values', 'TEXT')
    ensureColumn('audit_log', 'new_values', 'TEXT')
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('soft-delete-audit-idempotency-columns-v1')
  })()
}

const fractionalStockMigration = db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('fractional-stock-to-offcuts-v1')
if (!fractionalStockMigration) {
  db.transaction(() => {
    const materials = db.prepare('SELECT id,stock FROM materials WHERE ABS(stock-ROUND(stock))>0.000001').all()
    const updateMaterial = db.prepare('UPDATE materials SET stock=?,sub_stock=sub_stock+? WHERE id=?')
    const insertMovement = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,warehouse)
      VALUES (?,'adjustment',?,'ترحيل المخزن الفرعي',?,'main')`)
    const insertOffcutMovement = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,warehouse)
      VALUES (?,'adjustment',?,'ترحيل المخزن الفرعي',?,'sub')`)
    for (const material of materials) {
      const whole = Math.floor(material.stock + 0.000001)
      const fraction = Number((material.stock - whole).toFixed(6))
      if (fraction <= 0) continue
      updateMaterial.run(whole, fraction, material.id)
      insertMovement.run(material.id, -fraction, `تحويل ${fraction} من الرصيد الكسري إلى مخزن البواقي.`)
      insertOffcutMovement.run(material.id, fraction, `رصيد مرحّل من المخزن الأساسي؛ ${whole} وحدة كاملة.`)
    }
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('fractional-stock-to-offcuts-v1')
  })()
}
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('order-machine-exclusion-v1')) {
  db.transaction(() => {
    ensureColumn('order_machines', 'excluded_at', 'TEXT')
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('order-machine-exclusion-v1')
  })()
}
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('order-machine-private-notes-v1')) {
  db.transaction(() => {
    ensureColumn('order_machines', 'note', "TEXT NOT NULL DEFAULT ''")
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('order-machine-private-notes-v1')
  })()
}
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('invoice-treasury-backfill-v1')) {
  db.transaction(() => {
    db.prepare(`INSERT OR IGNORE INTO treasury_transactions(kind,amount,category,reference,notes,invoice_id,created_by,created_at)
      SELECT CASE WHEN kind='sales' THEN 'income' ELSE 'expense' END,total,
        CASE WHEN kind='sales' THEN 'فاتورة مبيعات' ELSE 'مشتريات مخزون' END,code,notes,id,created_by,created_at
      FROM invoices WHERE status='approved'`).run()
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('invoice-treasury-backfill-v1')
  })()
}
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('invoice-payments-and-multi-vouchers-v1')) {
  db.transaction(() => {
    const uniqueInvoiceIndex = db.pragma('index_list(treasury_transactions)')
      .filter((index) => index.unique)
      .some((index) => db.pragma(`index_info(${JSON.stringify(index.name)})`).some((column) => column.name === 'invoice_id'))
    if (uniqueInvoiceIndex) {
      db.exec(`
        ALTER TABLE treasury_transactions RENAME TO treasury_transactions_legacy;
        CREATE TABLE treasury_transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL CHECK(kind IN ('income','expense')),
          amount REAL NOT NULL CHECK(amount >= 0),
          category TEXT NOT NULL DEFAULT '',
          reference TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          invoice_id INTEGER REFERENCES invoices(id),
          created_by INTEGER REFERENCES users(id),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO treasury_transactions(id,kind,amount,category,reference,notes,invoice_id,created_by,created_at)
          SELECT id,kind,amount,category,reference,notes,invoice_id,created_by,created_at FROM treasury_transactions_legacy;
        DROP TABLE treasury_transactions_legacy;
      `)
    }
    db.exec(`UPDATE invoices SET
      paid_total=MIN(total,COALESCE((SELECT SUM(t.amount) FROM treasury_transactions t WHERE t.invoice_id=invoices.id),0)),
      remaining=MAX(0,total-COALESCE((SELECT SUM(t.amount) FROM treasury_transactions t WHERE t.invoice_id=invoices.id),0)),
      payment_status=CASE
        WHEN COALESCE((SELECT SUM(t.amount) FROM treasury_transactions t WHERE t.invoice_id=invoices.id),0)<=0 THEN 'unpaid'
        WHEN COALESCE((SELECT SUM(t.amount) FROM treasury_transactions t WHERE t.invoice_id=invoices.id),0)+0.000001<total THEN 'partial'
        ELSE 'paid' END`)
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('invoice-payments-and-multi-vouchers-v1')
  })()
}
db.transaction(() => db.exec(`
  CREATE INDEX IF NOT EXISTS idx_inventory_movements_material ON inventory_movements(material_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_inventory_movements_warehouse ON inventory_movements(warehouse, id DESC);
  CREATE INDEX IF NOT EXISTS idx_treasury_created ON treasury_transactions(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_treasury_invoice ON treasury_transactions(invoice_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_invoices_kind_created ON invoices(kind, created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at_ms);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC, id DESC);
`))()

const orderColumns = new Set(db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name))
for (const [name, declaration] of [
  ['material_cost', 'REAL DEFAULT 0'],
  ['operating_cost', 'REAL DEFAULT 0'],
  ['selling_price', 'REAL DEFAULT 0'],
]) {
  if (!orderColumns.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${declaration}`)
}
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('orders-assigned-worker-v1')) {
  db.transaction(() => {
    ensureColumn('orders', 'assigned_worker_id', 'INTEGER REFERENCES users(id)')
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('orders-assigned-worker-v1')
  })()
}

if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('workers-financial-links-and-user-controls-v1')) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      job_title TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    )`)
    ensureColumn('invoices', 'worker_id', 'INTEGER REFERENCES workers(id)')
    ensureColumn('treasury_transactions', 'worker_id', 'INTEGER REFERENCES workers(id)')
    ensureColumn('users', 'deleted_at', 'TEXT')
    ensureColumn('users', 'is_master', 'INTEGER NOT NULL DEFAULT 0')
    db.prepare(`UPDATE users SET is_master=1 WHERE id=(
      SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1
    ) AND NOT EXISTS (SELECT 1 FROM users WHERE is_master=1)`).run()
    db.exec(`CREATE INDEX IF NOT EXISTS idx_workers_active ON workers(active, deleted_at, name);
      CREATE INDEX IF NOT EXISTS idx_invoices_worker ON invoices(worker_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_treasury_worker ON treasury_transactions(worker_id, id DESC);`)
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run('workers-financial-links-and-user-controls-v1')
  })()
}

const orderSchemaMigration = 'v15-area-and-order-financial-nullability-v1'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(orderSchemaMigration)) {
  const orderColumnsBeforeMigration = db.prepare('PRAGMA table_info(orders)').all()
  const orderColumnNames = new Set(orderColumnsBeforeMigration.map((column) => column.name))
  const nullableFinancialColumns = ['total_cost', 'material_cost', 'operating_cost', 'selling_price']
  const rebuildOrders = orderColumnNames.has('title')
    || nullableFinancialColumns.some((name) => orderColumnsBeforeMigration.find((column) => column.name === name)?.notnull === 1)

  if (rebuildOrders) db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      db.exec('DROP INDEX IF EXISTS idx_machines_region')
      let machineColumns = new Set(db.prepare('PRAGMA table_info(machines)').all().map((column) => column.name))
      if (!machineColumns.has('area')) {
        if (machineColumns.has('region')) db.exec('ALTER TABLE machines RENAME COLUMN region TO area')
        else db.exec("ALTER TABLE machines ADD COLUMN area TEXT DEFAULT ''")
        machineColumns = new Set(db.prepare('PRAGMA table_info(machines)').all().map((column) => column.name))
      }
      if (machineColumns.has('region')) {
        if (machineColumns.has('area')) {
          db.exec("UPDATE machines SET area=region WHERE (area IS NULL OR TRIM(area)='') AND region IS NOT NULL")
          db.exec('ALTER TABLE machines DROP COLUMN region')
        }
      }
      machineColumns = new Set(db.prepare('PRAGMA table_info(machines)').all().map((column) => column.name))
      if (machineColumns.has('governorate')) db.exec('ALTER TABLE machines DROP COLUMN governorate')
      db.exec('CREATE INDEX IF NOT EXISTS idx_machines_area ON machines(area)')

      if (rebuildOrders) {
        db.exec(`
          CREATE TABLE orders_v15 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            client_id INTEGER NOT NULL REFERENCES clients(id),
            type TEXT NOT NULL CHECK(type IN ('operation','maintenance')),
            status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','review','archived')),
            notes TEXT DEFAULT '',
            total_cost REAL DEFAULT 0,
            material_cost REAL DEFAULT 0,
            operating_cost REAL DEFAULT 0,
            selling_price REAL DEFAULT 0,
            area_path TEXT DEFAULT '',
            created_by INTEGER REFERENCES users(id),
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            archived_at TEXT,
            deleted_at TEXT,
            assigned_worker_id INTEGER REFERENCES users(id)
          );
          INSERT INTO orders_v15 (id,code,client_id,type,status,notes,total_cost,material_cost,operating_cost,selling_price,area_path,created_by,created_at,updated_at,archived_at,deleted_at,assigned_worker_id)
            SELECT id,code,client_id,type,status,notes,total_cost,material_cost,operating_cost,selling_price,area_path,created_by,created_at,updated_at,archived_at,deleted_at,assigned_worker_id FROM orders;
          DROP TABLE orders;
          ALTER TABLE orders_v15 RENAME TO orders;
        `)
      }
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_orders_client ON orders(client_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      `)
      db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(orderSchemaMigration)
    })()
  } finally {
    if (rebuildOrders) db.pragma('foreign_keys = ON')
  }
}

const employeeMigration = 'employees-users-orders-financial-links-v1'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(employeeMigration)) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT NOT NULL CHECK(department IN ('Maintenance','Sales','Purchasing','Operation')),
      phone TEXT NOT NULL DEFAULT '',
      job_title TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    )`)
    ensureColumn('users', 'employee_id', 'INTEGER REFERENCES employees(id)')
    ensureColumn('invoices', 'employee_id', 'INTEGER REFERENCES employees(id)')
    ensureColumn('treasury_transactions', 'employee_id', 'INTEGER REFERENCES employees(id)')
    ensureColumn('orders', 'assigned_employee_id', 'INTEGER REFERENCES employees(id)')

    db.prepare(`INSERT OR IGNORE INTO employees(id,name,department,phone,job_title,active,created_at,deleted_at)
      SELECT id,name,'Maintenance',phone,job_title,active,created_at,deleted_at FROM workers`).run()

    const employeeDepartmentByRole = { sales: 'Sales', purchasing: 'Purchasing', operations: 'Operation' }
    const eligibleUsers = db.prepare(`SELECT id,full_name,role,active,created_at,deleted_at FROM users
      WHERE role IN ('sales','purchasing','operations') AND employee_id IS NULL ORDER BY id`).all()
    const insertEmployee = db.prepare(`INSERT INTO employees(name,department,phone,active,created_at,deleted_at)
      VALUES (?,?, '', ?, ?, ?)`)
    const linkUser = db.prepare('UPDATE users SET employee_id=? WHERE id=? AND employee_id IS NULL')
    for (const user of eligibleUsers) {
      const employeeId = insertEmployee.run(user.full_name, employeeDepartmentByRole[user.role], user.active, user.created_at, user.deleted_at).lastInsertRowid
      linkUser.run(employeeId, user.id)
    }

    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_employee_unique ON users(employee_id) WHERE employee_id IS NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department, active, deleted_at, name);
      CREATE INDEX IF NOT EXISTS idx_invoices_employee ON invoices(employee_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_treasury_employee ON treasury_transactions(employee_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_assigned_employee ON orders(assigned_employee_id, id DESC);`)
    db.prepare(`UPDATE invoices SET employee_id=worker_id WHERE employee_id IS NULL
      AND worker_id IN (SELECT id FROM employees)`).run()
    db.prepare(`UPDATE treasury_transactions SET employee_id=worker_id WHERE employee_id IS NULL
      AND worker_id IN (SELECT id FROM employees)`).run()
    db.prepare(`UPDATE orders SET assigned_employee_id=(SELECT u.employee_id FROM users u WHERE u.id=orders.assigned_worker_id)
      WHERE assigned_employee_id IS NULL AND assigned_worker_id IS NOT NULL`).run()
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(employeeMigration)
  })()
}

const seedReasons = ['تم تغيير سبوت', 'تم تغيير ترانس', 'تم تغيير عمود إنارة', 'الماكينة تحتاج مشترك كهرباء']
const insertReason = db.prepare('INSERT OR IGNORE INTO maintenance_reasons(label) VALUES (?)')
seedReasons.forEach((label) => insertReason.run(label))

const schemaVersionMigration = 'schema-version-markers-v1'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(schemaVersionMigration)) {
  db.transaction(() => {
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(schemaVersionMigration)
  })()
}
const filesystemRecoveryMigration = 'filesystem-recovery-and-backup-health-v1'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(filesystemRecoveryMigration)) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS filesystem_operations (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('storage-delete','machine-import-delete','image-eradication','machine-catalog-wipe')),
        state TEXT NOT NULL CHECK(state IN ('prepared','committed')),
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS backup_health (
        id INTEGER PRIMARY KEY CHECK(id=1),
        last_success_at TEXT,
        last_success_bytes INTEGER,
        last_failure_at TEXT,
        last_failure_code TEXT,
        last_duration_ms INTEGER
      );
      INSERT OR IGNORE INTO backup_health(id) VALUES (1);
      CREATE INDEX IF NOT EXISTS idx_filesystem_operations_state ON filesystem_operations(state,created_at);
    `)
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(filesystemRecoveryMigration)
  })()
}

const integratedOperationsMigration = 'integrated-finance-payroll-stocktaking-v1'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(integratedOperationsMigration)) {
  db.transaction(() => {
    for (const [column, declaration] of [
      ['specification', "TEXT NOT NULL DEFAULT ''"],
      ['variant_key', 'TEXT'],
    ]) ensureColumn('materials', column, declaration)
    ensureColumn('inventory_movements', 'invoice_id', 'INTEGER REFERENCES invoices(id)')
    ensureColumn('inventory_movements', 'source_type', "TEXT NOT NULL DEFAULT 'manual'")
    ensureColumn('inventory_movements', 'source_id', 'TEXT')
    ensureColumn('employees', 'monthly_salary_cents', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumn('invoices', 'subtotal_cents', 'INTEGER')
    ensureColumn('invoices', 'tax_cents', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumn('invoices', 'tax_rate_basis_points', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumn('invoices', 'sale_type', "TEXT NOT NULL DEFAULT 'credit'")

    db.exec(`
      CREATE TABLE IF NOT EXISTS inventory_lots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        material_id INTEGER NOT NULL REFERENCES materials(id),
        invoice_id INTEGER REFERENCES invoices(id),
        source_type TEXT NOT NULL,
        source_id TEXT,
        warehouse TEXT NOT NULL CHECK(warehouse IN ('main','sub')),
        received_quantity REAL NOT NULL CHECK(received_quantity >= 0),
        remaining_quantity REAL NOT NULL CHECK(remaining_quantity >= 0),
        unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(unit_cost_cents >= 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS inventory_lot_consumptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lot_id INTEGER NOT NULL REFERENCES inventory_lots(id),
        movement_id INTEGER NOT NULL REFERENCES inventory_movements(id),
        quantity REAL NOT NULL CHECK(quantity > 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_lots_material ON inventory_lots(material_id,warehouse,id);
      CREATE INDEX IF NOT EXISTS idx_inventory_lots_invoice ON inventory_lots(invoice_id,id);

      CREATE TABLE IF NOT EXISTS invoice_attachments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id),
        storage_path TEXT NOT NULL UNIQUE,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','image/gif','image/bmp','application/pdf')),
        byte_size INTEGER NOT NULL CHECK(byte_size > 0),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS other_invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        supplier TEXT NOT NULL DEFAULT '',
        employee_id INTEGER REFERENCES employees(id),
        total_cents INTEGER NOT NULL CHECK(total_cents > 0),
        notes TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        deleted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS expense_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        account_id INTEGER REFERENCES accounts(id),
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS other_invoice_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL REFERENCES other_invoices(id),
        description TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        category_id INTEGER NOT NULL REFERENCES expense_categories(id)
      );

      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        account_type TEXT NOT NULL CHECK(account_type IN ('asset','liability','equity','revenue','expense')),
        parent_id INTEGER REFERENCES accounts(id),
        active INTEGER NOT NULL DEFAULT 1,
        system_key TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS account_mappings (
        mapping_key TEXT PRIMARY KEY,
        account_id INTEGER REFERENCES accounts(id),
        approved INTEGER NOT NULL DEFAULT 0 CHECK(approved IN (0,1)),
        updated_by INTEGER REFERENCES users(id),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS journal_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_key TEXT NOT NULL UNIQUE,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending_configuration' CHECK(status IN ('pending_configuration','posted','reversed')),
        posting_payload TEXT NOT NULL DEFAULT '[]',
        total_debit_cents INTEGER NOT NULL DEFAULT 0,
        total_credit_cents INTEGER NOT NULL DEFAULT 0,
        reverses_entry_id INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        posted_at TEXT
      );
      CREATE TABLE IF NOT EXISTS journal_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(id),
        line_number INTEGER NOT NULL,
        account_id INTEGER NOT NULL REFERENCES accounts(id),
        description TEXT NOT NULL DEFAULT '',
        debit_cents INTEGER NOT NULL DEFAULT 0 CHECK(debit_cents >= 0),
        credit_cents INTEGER NOT NULL DEFAULT 0 CHECK(credit_cents >= 0),
        CHECK ((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0)),
        UNIQUE(journal_entry_id,line_number)
      );
      CREATE INDEX IF NOT EXISTS idx_journal_entries_source ON journal_entries(source_type,source_id);
      CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(created_at,id);
      CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_id,journal_entry_id);

      CREATE TABLE IF NOT EXISTS payroll_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        period TEXT NOT NULL,
        base_salary_cents INTEGER NOT NULL CHECK(base_salary_cents >= 0),
        ordinary_overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK(ordinary_overtime_minutes >= 0),
        holiday_overtime_minutes INTEGER NOT NULL DEFAULT 0 CHECK(holiday_overtime_minutes >= 0),
        ordinary_overtime_cents INTEGER NOT NULL DEFAULT 0 CHECK(ordinary_overtime_cents >= 0),
        holiday_overtime_cents INTEGER NOT NULL DEFAULT 0 CHECK(holiday_overtime_cents >= 0),
        bonus_cents INTEGER NOT NULL DEFAULT 0 CHECK(bonus_cents >= 0),
        deduction_cents INTEGER NOT NULL DEFAULT 0 CHECK(deduction_cents >= 0),
        advances_applied_cents INTEGER NOT NULL DEFAULT 0 CHECK(advances_applied_cents >= 0),
        net_entitlement_cents INTEGER NOT NULL DEFAULT 0 CHECK(net_entitlement_cents >= 0),
        cash_paid_cents INTEGER NOT NULL DEFAULT 0 CHECK(cash_paid_cents >= 0),
        unpaid_salary_cents INTEGER NOT NULL DEFAULT 0 CHECK(unpaid_salary_cents >= 0),
        advance_balance_cents INTEGER NOT NULL DEFAULT 0 CHECK(advance_balance_cents >= 0),
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','finalized')),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id,period)
      );
      CREATE TABLE IF NOT EXISTS employee_advance_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        payroll_id INTEGER REFERENCES payroll_records(id),
        event_type TEXT NOT NULL CHECK(event_type IN ('issued','applied','overpayment')),
        amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        notes TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS order_employee_assignments (
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        employee_id INTEGER NOT NULL REFERENCES employees(id),
        assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(order_id,employee_id)
      );

      CREATE TABLE IF NOT EXISTS stock_counts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','approved','cancelled')),
        reason TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        closed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS stock_count_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        count_id INTEGER NOT NULL REFERENCES stock_counts(id),
        material_id INTEGER NOT NULL REFERENCES materials(id),
        recorded_stock REAL NOT NULL,
        recorded_sub_stock REAL NOT NULL,
        counted_stock REAL,
        counted_sub_stock REAL,
        variance REAL,
        released_at TEXT,
        UNIQUE(count_id,material_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_count_locked_material
        ON stock_count_items(material_id) WHERE released_at IS NULL;

      CREATE TABLE IF NOT EXISTS persistent_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('low_stock','backup_failed','pending_recovery')),
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT '',
        source_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TEXT,
        reviewed_by INTEGER REFERENCES users(id),
        resolved_at TEXT
      );

      CREATE TABLE IF NOT EXISTS opening_balance_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cutover_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        posted_at TEXT,
        UNIQUE(cutover_date)
      );
      CREATE TABLE IF NOT EXISTS opening_balance_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES opening_balance_batches(id),
        line_type TEXT NOT NULL,
        account_id INTEGER REFERENCES accounts(id),
        material_id INTEGER REFERENCES materials(id),
        client_id INTEGER REFERENCES clients(id),
        invoice_code TEXT,
        employee_id INTEGER REFERENCES employees(id),
        quantity REAL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
        original_date TEXT,
        due_date TEXT,
        description TEXT NOT NULL DEFAULT ''
      );
    `)

    const normalizeIdentity = (value) => String(value || '').trim().normalize('NFKC')
      .toLocaleLowerCase('ar').replace(/[\u064b-\u065f\u0670]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
    const materials = db.prepare(`SELECT id,name,specification,unit,unit_cost FROM materials
      WHERE variant_key IS NULL OR variant_key='' ORDER BY id`).all()
    const updateVariant = db.prepare('UPDATE materials SET variant_key=? WHERE id=?')
    for (const material of materials) {
      const cents = Math.max(0, Math.round(Number(material.unit_cost || 0) * 100))
      const identity = [normalizeIdentity(material.name), normalizeIdentity(material.specification), normalizeIdentity(material.unit), cents].join('|')
      const key = crypto.createHash('sha256').update(identity).digest('hex')
      // Never merge legacy catalog rows into canonical price/spec variants during migration.
      updateVariant.run(`legacy:${material.id}:${key}`, material.id)
    }
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_variant_key ON materials(variant_key) WHERE variant_key IS NOT NULL')

    const insertLot = db.prepare(`INSERT INTO inventory_lots(material_id,source_type,source_id,warehouse,received_quantity,remaining_quantity,unit_cost_cents)
      VALUES (?,'legacy-opening','migration','main',?,?,?)`)
    const insertSubLot = db.prepare(`INSERT INTO inventory_lots(material_id,source_type,source_id,warehouse,received_quantity,remaining_quantity,unit_cost_cents)
      VALUES (?,'legacy-opening','migration','sub',?,?,?)`)
    for (const material of db.prepare('SELECT id,stock,sub_stock,unit_cost FROM materials WHERE deleted_at IS NULL').all()) {
      const unitCostCents = Math.round(Number(material.unit_cost || 0) * 100)
      if (Number(material.stock) > 0) insertLot.run(material.id, material.stock, material.stock, unitCostCents)
      if (Number(material.sub_stock) > 0) insertSubLot.run(material.id, material.sub_stock, material.sub_stock, unitCostCents)
    }

    db.prepare(`INSERT OR IGNORE INTO order_employee_assignments(order_id,employee_id)
      SELECT id,assigned_employee_id FROM orders WHERE assigned_employee_id IS NOT NULL`).run()
    db.exec(`CREATE INDEX IF NOT EXISTS idx_order_employee_assignments_employee
      ON order_employee_assignments(employee_id,order_id)`)

    const insertAccount = db.prepare(`INSERT OR IGNORE INTO accounts(code,name,account_type,system_key)
      VALUES (?,?,?,?)`)
    const starterAccounts = [
      ['1000','الأصول','asset','assets'],
      ['1010','صندوق المصنع — Madar فقط','asset','factory_cashbox'],
      ['1100','ذمم العملاء','asset','customer_receivables'],
      ['1200','مخزون المواد','asset','inventory'],
      ['1300','سلف الموظفين','asset','employee_advances'],
      ['2000','الالتزامات','liability','liabilities'],
      ['2100','ضريبة مبيعات مستحقة','liability','sales_tax_payable'],
      ['2200','رواتب مستحقة','liability','salary_payable'],
      ['3000','حقوق الملكية وتمويل المالك (يتطلب اعتماد المحاسب)','equity','owner_funding'],
      ['3100','أرصدة افتتاحية مقابلة (يتطلب اعتماد المحاسب)','equity','opening_equity'],
      ['4000','إيرادات المبيعات','revenue','sales_revenue'],
      ['5000','مصروف الرواتب','expense','payroll_expense'],
      ['5100','فروقات جرد المخزون (يتطلب اعتماد المحاسب)','expense','inventory_variance'],
    ]
    starterAccounts.forEach((row) => insertAccount.run(...row))
    const mappingKeys = ['factory_cashbox','customer_receivables','inventory','employee_advances','sales_tax_payable',
      'salary_payable','owner_funding','opening_equity','sales_revenue','payroll_expense','inventory_variance']
    const insertMapping = db.prepare('INSERT OR IGNORE INTO account_mappings(mapping_key,account_id,approved) VALUES (?,NULL,0)')
    mappingKeys.forEach((key) => insertMapping.run(key))

    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(integratedOperationsMigration)
  })()
}
const integratedFollowupsMigration = 'integrated-finance-followups-v1'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(integratedFollowupsMigration)) {
  db.transaction(() => {
    ensureColumn('opening_balance_lines', 'side', "TEXT NOT NULL DEFAULT 'debit'")
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_corrections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id),
        reason TEXT NOT NULL,
        refunded_cents INTEGER NOT NULL CHECK(refunded_cents > 0),
        treasury_transaction_id INTEGER REFERENCES treasury_transactions(id),
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS sales_tax_rates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        rate_basis_points INTEGER NOT NULL UNIQUE CHECK(rate_basis_points >= 0 AND rate_basis_points <= 100000),
        active INTEGER NOT NULL DEFAULT 1,
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_tax_rates_active_label
        ON sales_tax_rates(label) WHERE active=1;
      INSERT OR IGNORE INTO sales_tax_rates(label,rate_basis_points,active) VALUES ('بدون ضريبة',0,1);
    `)
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(integratedFollowupsMigration)
  })()
}
const otherInvoiceAttachmentsMigration = 'other-invoice-attachments-v1'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(otherInvoiceAttachmentsMigration)) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS other_invoice_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      other_invoice_id INTEGER NOT NULL REFERENCES other_invoices(id),
      storage_path TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','image/gif','image/bmp','application/pdf')),
      byte_size INTEGER NOT NULL CHECK(byte_size > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_other_invoice_attachments_invoice ON other_invoice_attachments(other_invoice_id,id);`)
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(otherInvoiceAttachmentsMigration)
  })()
}
const otherInvoiceAttachmentsSchemaMigration = 'other-invoice-attachments-schema-v6'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(otherInvoiceAttachmentsSchemaMigration)) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS other_invoice_attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      other_invoice_id INTEGER NOT NULL REFERENCES other_invoices(id),
      storage_path TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL CHECK(mime_type IN ('image/jpeg','image/png','image/webp','image/gif','image/bmp','application/pdf')),
      byte_size INTEGER NOT NULL CHECK(byte_size > 0),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_other_invoice_attachments_invoice ON other_invoice_attachments(other_invoice_id,id);`)
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(otherInvoiceAttachmentsSchemaMigration)
  })()
}
const purchaseInvoiceRevisionsMigration = 'purchase-invoice-revisions-schema-v7'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(purchaseInvoiceRevisionsMigration)) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS purchase_invoice_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id),
      revision_number INTEGER NOT NULL CHECK(revision_number > 0),
      reason TEXT NOT NULL,
      previous_values TEXT NOT NULL,
      revised_values TEXT NOT NULL,
      cash_delta_cents INTEGER NOT NULL,
      stock_movements TEXT NOT NULL DEFAULT '[]',
      treasury_transaction_id INTEGER REFERENCES treasury_transactions(id),
      journal_entry_id INTEGER REFERENCES journal_entries(id),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(invoice_id,revision_number)
    );
    CREATE INDEX IF NOT EXISTS idx_purchase_invoice_revisions_invoice
      ON purchase_invoice_revisions(invoice_id,revision_number);`)
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(purchaseInvoiceRevisionsMigration)
  })()
}
const workOrderCogsMigration = 'work-order-cogs-v1'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(workOrderCogsMigration)) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS inventory_issues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        classification TEXT NOT NULL CHECK(classification IN ('order','general')),
        order_id INTEGER REFERENCES orders(id),
        reference TEXT NOT NULL DEFAULT '',
        requested_quantity REAL NOT NULL CHECK(requested_quantity > 0),
        gross_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(gross_cost_cents >= 0),
        offcut_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK(offcut_cost_cents >= 0),
        cogs_cents INTEGER NOT NULL DEFAULT 0 CHECK(cogs_cents >= 0),
        journal_entry_id INTEGER REFERENCES journal_entries(id),
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK ((classification='order' AND order_id IS NOT NULL) OR (classification='general' AND order_id IS NULL))
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_issues_order_date ON inventory_issues(order_id,created_at,id);
    `)
    ensureColumn('inventory_movements', 'issue_id', 'INTEGER REFERENCES inventory_issues(id)')
    db.exec(`CREATE INDEX IF NOT EXISTS idx_inventory_movements_issue ON inventory_movements(issue_id,id)`)

    const insertAccount = db.prepare(`INSERT OR IGNORE INTO accounts(code,name,account_type,system_key) VALUES (?,?,?,?)`)
    insertAccount.run('5200', 'تكلفة مواد أوامر التشغيل', 'expense', 'work_order_cogs')
    insertAccount.run('5210', 'استهلاك مواد عام', 'expense', 'inventory_consumption')
    const insertMapping = db.prepare('INSERT OR IGNORE INTO account_mappings(mapping_key,account_id,approved) VALUES (?,NULL,0)')
    insertMapping.run('work_order_cogs')
    insertMapping.run('inventory_consumption')
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(workOrderCogsMigration)
  })()
}
const manufacturingAccountMappingsMigration = 'manufacturing-account-mappings-v1'
if (!db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(manufacturingAccountMappingsMigration)) {
  db.transaction(() => {
    const standardAccounts = [
      ['inventory', '1200', 'مخزون المواد', 'asset'],
      ['work_order_wip', '1250', 'مواد تحت التشغيل — أوامر الإنتاج', 'asset'],
      ['work_order_cogs', '5200', 'تكلفة مواد أوامر التشغيل', 'expense'],
      ['inventory_consumption', '5210', 'استهلاك مواد عام', 'expense'],
    ]
    for (const [systemKey, preferredCode, name, accountType] of standardAccounts) {
      if (db.prepare('SELECT 1 FROM accounts WHERE system_key=?').get(systemKey)) continue
      let code = Number(preferredCode)
      while (code <= 19990 && db.prepare('SELECT 1 FROM accounts WHERE code=?').get(String(code))) code += 10
      if (code > 19990) throw new Error(`لا يوجد رقم حساب متاح لإضافة الحساب النظامي ${systemKey}.`)
      db.prepare('INSERT INTO accounts(code,name,account_type,system_key) VALUES (?,?,?,?)')
        .run(String(code), name, accountType, systemKey)
    }
    const standardMappings = [
      ['inventory', 'inventory', 'asset'],
      ['work_order_wip', 'work_order_wip', 'asset'],
      ['work_order_cogs', 'work_order_cogs', 'expense'],
      ['inventory_consumption', 'inventory_consumption', 'expense'],
    ]
    const insertMapping = db.prepare('INSERT OR IGNORE INTO account_mappings(mapping_key,account_id,approved) VALUES (?,NULL,0)')
    const approveDefault = db.prepare(`UPDATE account_mappings SET account_id=?,approved=1,updated_at=CURRENT_TIMESTAMP
      WHERE mapping_key=? AND (account_id IS NULL OR account_id=?)`)
    for (const [mappingKey, systemKey, expectedType] of standardMappings) {
      const account = db.prepare('SELECT id FROM accounts WHERE system_key=?').get(systemKey)
      const details = account && db.prepare('SELECT id,account_type,active FROM accounts WHERE id=?').get(account.id)
      if (!details || details.account_type !== expectedType) {
        throw new Error(`تعذر العثور على الحساب النظامي الصحيح للربط ${mappingKey}.`)
      }
      insertMapping.run(mappingKey)
      if (details.active === 1) approveDefault.run(details.id, mappingKey, details.id)
    }

    const pendingOrderIssues = db.prepare(`SELECT je.id,je.posting_payload FROM journal_entries je
      JOIN inventory_issues ii ON ii.id=CAST(je.source_id AS INTEGER)
      WHERE je.source_type='inventory_issue' AND je.status='pending_configuration' AND ii.classification='order'
      ORDER BY je.id`).all()
    const updatePayload = db.prepare('UPDATE journal_entries SET posting_payload=? WHERE id=?')
    for (const entry of pendingOrderIssues) {
      const postings = JSON.parse(entry.posting_payload || '[]')
      let changed = false
      for (const posting of postings) {
        if (posting.mappingKey === 'work_order_cogs' && Number(posting.debitCents || 0) > 0) {
          posting.mappingKey = 'work_order_wip'
          posting.description = 'مواد تحت التشغيل'
          changed = true
        }
      }
      if (changed) updatePayload.run(JSON.stringify(postings), entry.id)
    }

    const { retryPendingJournalEntries } = require('./accounting')
    retryPendingJournalEntries(db)
    db.prepare('INSERT INTO schema_migrations(name) VALUES (?)').run(manufacturingAccountMappingsMigration)
  })()
}
db.pragma(`application_id = ${MADAR_APPLICATION_ID}`)
db.pragma(`user_version = ${CURRENT_SCHEMA_VERSION}`)

function nextCode(name, prefix) {
  return db.transaction(() => {
    db.prepare('INSERT OR IGNORE INTO counters(name, value) VALUES (?, 1000)').run(name)
    db.prepare('UPDATE counters SET value = value + 1 WHERE name = ?').run(name)
    const value = db.prepare('SELECT value FROM counters WHERE name = ?').get(name).value
    return `${prefix}-${String(value).padStart(4, '0')}`
  })()
}

function audit(userId, action, entity, entityId, details = '', oldValues = null, newValues = null) {
  const serialize = (value) => value == null ? null : JSON.stringify(value)
  db.prepare('INSERT INTO audit_log(user_id, action, entity, entity_id, details, old_values, new_values) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId || null, action, entity, String(entityId || ''), details, serialize(oldValues), serialize(newValues))
}

module.exports = { db, nextCode, audit, projectRoot, databasePath }
