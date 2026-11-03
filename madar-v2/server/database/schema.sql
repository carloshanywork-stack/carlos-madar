CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'sales', 'operations', 'purchasing', 'rep')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT,
  assigned_regions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assigned_regions_json)),
  is_online INTEGER NOT NULL DEFAULT 0 CHECK (is_online IN (0, 1)),
  last_location_json TEXT CHECK (last_location_json IS NULL OR json_valid(last_location_json))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_expiry
  ON sessions(user_id, expires_at);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  department TEXT NOT NULL CHECK (department IN ('Maintenance', 'Workshop', 'Warehouse', 'Finance', 'Administration')),
  job_title TEXT,
  phone TEXT,
  national_id TEXT,
  base_salary_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_salary_cents >= 0),
  can_login INTEGER NOT NULL DEFAULT 0 CHECK (can_login IN (0, 1)),
  user_id INTEGER UNIQUE REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  primary_color TEXT,
  secondary_color TEXT,
  logo_path TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  area TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS client_machines (
  client_id INTEGER NOT NULL REFERENCES clients(id),
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  site_area TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, machine_id)
);

CREATE TABLE IF NOT EXISTS maintenance_orders (
  id INTEGER PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'review', 'archived')),
  notes TEXT,
  warranty_period_months INTEGER NOT NULL DEFAULT 3 CHECK (warranty_period_months IN (3, 6)),
  petty_cash_disbursed_cents INTEGER NOT NULL DEFAULT 0 CHECK (petty_cash_disbursed_cents >= 0),
  actual_expenses_cents INTEGER NOT NULL DEFAULT 0 CHECK (actual_expenses_cents >= 0),
  petty_cash_refund_cents INTEGER NOT NULL DEFAULT 0 CHECK (petty_cash_refund_cents >= 0),
  archived_at TEXT,
  archived_by INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS maintenance_order_technicians (
  order_id INTEGER NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  PRIMARY KEY (order_id, employee_id)
);

CREATE TABLE IF NOT EXISTS maintenance_cards (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES maintenance_orders(id) ON DELETE CASCADE,
  machine_id INTEGER NOT NULL REFERENCES machines(id),
  before_photos_json TEXT NOT NULL DEFAULT '[]',
  after_photos_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'excluded')),
  notes TEXT,
  reason_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS rep_visits (
  id INTEGER PRIMARY KEY,
  visit_uuid TEXT NOT NULL UNIQUE,
  rep_user_id INTEGER NOT NULL REFERENCES users(id),
  order_id INTEGER REFERENCES maintenance_orders(id) ON DELETE SET NULL,
  card_id INTEGER REFERENCES maintenance_cards(id) ON DELETE SET NULL,
  machine_id INTEGER REFERENCES machines(id) ON DELETE SET NULL,
  order_code TEXT NOT NULL,
  machine_code TEXT NOT NULL,
  region_name TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK (length(payload_sha256) = 64),
  status TEXT NOT NULL CHECK (status IN ('receiving', 'completed', 'failed')),
  reason_ids_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reason_ids_json)),
  notes TEXT,
  captured_at TEXT NOT NULL,
  before_captured_at TEXT,
  after_captured_at TEXT,
  location_json TEXT CHECK (location_json IS NULL OR json_valid(location_json)),
  staging_path TEXT NOT NULL,
  final_path TEXT NOT NULL,
  before_path TEXT,
  after_path TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rep_visits_rep_status_created
  ON rep_visits(rep_user_id, status, created_at, id);
CREATE INDEX IF NOT EXISTS idx_rep_visits_card_created
  ON rep_visits(card_id, created_at, id);

CREATE TABLE IF NOT EXISTS rep_visit_reviews (
  visit_id INTEGER PRIMARY KEY REFERENCES rep_visits(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'reshoot')),
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rep_visit_reviews_status_created
  ON rep_visit_reviews(status, created_at, visit_id);

CREATE TABLE IF NOT EXISTS rep_duty_sessions (
  id INTEGER PRIMARY KEY,
  rep_user_id INTEGER NOT NULL REFERENCES users(id),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  start_location_json TEXT CHECK (start_location_json IS NULL OR json_valid(start_location_json)),
  end_location_json TEXT CHECK (end_location_json IS NULL OR json_valid(end_location_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_rep_duty_sessions_one_active
  ON rep_duty_sessions(rep_user_id) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rep_duty_sessions_rep_started
  ON rep_duty_sessions(rep_user_id, started_at, ended_at);

CREATE TABLE IF NOT EXISTS rep_location_points (
  id INTEGER PRIMARY KEY,
  rep_user_id INTEGER NOT NULL REFERENCES users(id),
  duty_session_id INTEGER REFERENCES rep_duty_sessions(id),
  latitude REAL NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude REAL NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  accuracy REAL NOT NULL CHECK (accuracy >= 0 AND accuracy <= 100000),
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (rep_user_id, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_rep_location_points_rep_captured
  ON rep_location_points(rep_user_id, captured_at, id);

CREATE TABLE IF NOT EXISTS workshop_orders (
  id INTEGER PRIMARY KEY,
  order_code TEXT NOT NULL UNIQUE,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  product_name TEXT NOT NULL,
  description TEXT,
  machine_type TEXT NOT NULL CHECK (machine_type IN ('cnc_router', 'laser', 'both', 'manual')),
  status TEXT NOT NULL DEFAULT 'in_production' CHECK (status IN ('in_production', 'ready', 'delivered_archived')),
  target_delivery_date TEXT,
  sale_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (sale_price_cents >= 0),
  sales_invoice_id INTEGER REFERENCES invoices(id),
  delivered_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS workshop_order_technicians (
  order_id INTEGER NOT NULL REFERENCES workshop_orders(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  PRIMARY KEY (order_id, employee_id)
);

CREATE TABLE IF NOT EXISTS workshop_design_files (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES workshop_orders(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  extension TEXT NOT NULL CHECK (extension IN ('.dxf', '.cdr', '.ai', '.pdf')),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  specification TEXT,
  unit TEXT NOT NULL,
  stock REAL NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock REAL NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS secondary_warehouse_offcuts (
  id INTEGER PRIMARY KEY,
  material_id INTEGER REFERENCES materials(id),
  name TEXT NOT NULL,
  dimensions TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  unit_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (unit_cost_cents >= 0),
  origin_workshop_order_id INTEGER REFERENCES workshop_orders(id),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'consumed', 'scrapped_sold', 'variance_lost')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id INTEGER PRIMARY KEY,
  material_id INTEGER REFERENCES materials(id),
  offcut_id INTEGER REFERENCES secondary_warehouse_offcuts(id),
  kind TEXT NOT NULL CHECK (kind IN ('purchase', 'issue', 'scrap_sale', 'variance_gain', 'variance_loss')),
  quantity REAL NOT NULL CHECK (quantity > 0),
  warehouse TEXT NOT NULL CHECK (warehouse IN ('main', 'secondary')),
  reference TEXT,
  source_type TEXT CHECK (source_type IN ('workshop_order', 'maintenance_custody', 'manual', 'stock_count')),
  source_id INTEGER,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (material_id IS NOT NULL OR offcut_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS stock_count_sessions (
  id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reconciled')),
  notes TEXT,
  started_by INTEGER REFERENCES users(id),
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_by INTEGER REFERENCES users(id),
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES stock_count_sessions(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('main', 'offcut')),
  material_id INTEGER REFERENCES materials(id),
  offcut_id INTEGER REFERENCES secondary_warehouse_offcuts(id),
  snapshot_quantity REAL NOT NULL CHECK (snapshot_quantity >= 0),
  system_quantity_at_reconcile REAL CHECK (system_quantity_at_reconcile >= 0),
  counted_quantity REAL CHECK (counted_quantity >= 0),
  variance_quantity REAL,
  CHECK (
    (item_type = 'main' AND material_id IS NOT NULL AND offcut_id IS NULL)
    OR (item_type = 'offcut' AND material_id IS NULL AND offcut_id IS NOT NULL)
  ),
  UNIQUE (session_id, material_id),
  UNIQUE (session_id, offcut_id)
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('sales', 'purchase', 'other_expense')),
  client_id INTEGER REFERENCES clients(id),
  workshop_order_id INTEGER REFERENCES workshop_orders(id),
  supplier TEXT,
  employee_id INTEGER REFERENCES employees(id),
  subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK (subtotal_cents >= 0),
  tax_cents INTEGER NOT NULL DEFAULT 0 CHECK (tax_cents >= 0),
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0),
  paid_total_cents INTEGER NOT NULL DEFAULT 0 CHECK (paid_total_cents >= 0),
  remaining_cents INTEGER NOT NULL DEFAULT 0 CHECK (remaining_cents >= 0),
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'partial', 'paid')),
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('approved', 'corrected', 'void')),
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  material_id INTEGER NOT NULL REFERENCES materials(id),
  material_code TEXT NOT NULL,
  material_name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
  UNIQUE (invoice_id, line_number)
);

CREATE TABLE IF NOT EXISTS treasury_entries (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  category TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  invoice_id INTEGER REFERENCES invoices(id),
  maintenance_order_id INTEGER REFERENCES maintenance_orders(id),
  employee_id INTEGER REFERENCES employees(id),
  reference TEXT,
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER REFERENCES users(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  old_values_json TEXT,
  new_values_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_employees_department_active ON employees(department, active);
CREATE INDEX IF NOT EXISTS idx_maintenance_orders_client ON maintenance_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_orders_status ON maintenance_orders(status);
CREATE INDEX IF NOT EXISTS idx_client_machines_machine_active ON client_machines(machine_id, active);
CREATE INDEX IF NOT EXISTS idx_maintenance_order_technicians_employee ON maintenance_order_technicians(employee_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_cards_machine ON maintenance_cards(machine_id);
CREATE INDEX IF NOT EXISTS idx_workshop_orders_client ON workshop_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_workshop_orders_status ON workshop_orders(status);
CREATE INDEX IF NOT EXISTS idx_workshop_order_technicians_employee ON workshop_order_technicians(employee_id);
CREATE INDEX IF NOT EXISTS idx_workshop_design_files_order ON workshop_design_files(order_id);
CREATE INDEX IF NOT EXISTS idx_secondary_offcuts_material_status ON secondary_warehouse_offcuts(material_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_material_created ON inventory_movements(material_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_source ON inventory_movements(source_type, source_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_count_lines_session ON stock_count_lines(session_id, item_type);
CREATE INDEX IF NOT EXISTS idx_invoices_client_created ON invoices(client_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_workshop_order ON invoices(workshop_order_id, kind);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id, line_number);
CREATE INDEX IF NOT EXISTS idx_treasury_entries_created ON treasury_entries(created_at);
CREATE INDEX IF NOT EXISTS idx_treasury_entries_invoice ON treasury_entries(invoice_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_users_role_presence ON users(role, is_online, active, deleted_at);
