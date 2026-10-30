import Database from 'better-sqlite3';
import { isAbsolute, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = resolve(root, '../system/data/madar.sqlite');
const targetPath = resolve(root, 'data/madar-v2.sqlite');
const migrationVersion = 'migrate-from-v1-data-v1';

const validUserRoles = new Set(['admin', 'sales', 'operations', 'purchasing']);
const validDepartments = new Set(['Maintenance', 'Workshop', 'Warehouse', 'Finance', 'Administration']);
const validOrderStatuses = new Set(['in_progress', 'review', 'archived']);

function requireTable(database, table, label) {
  const exists = database.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table);
  if (!exists) throw new Error(`${label} database is missing required table: ${table}`);
}

function requireColumns(database, table, columns, label) {
  const present = new Set(database.pragma(`table_info(${table})`).map((column) => column.name));
  const missing = columns.filter((column) => !present.has(column));
  if (missing.length) {
    throw new Error(`${label} table ${table} is missing required columns: ${missing.join(', ')}`);
  }
}

function nullableDate(value) {
  return value === undefined ? null : value;
}

function requiredDate(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing a valid created_at timestamp.`);
  }
  return value;
}

function flag(value, fallback, label) {
  const normalized = value ?? fallback;
  if (normalized === true || normalized === false) return Number(normalized);
  const number = Number(normalized);
  if (number !== 0 && number !== 1) throw new Error(`${label} must be 0 or 1.`);
  return number;
}

function nonNegativeInteger(value, fallback, label) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return number;
}

function moneyFromLegacyMaterial(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(Math.round(number * 100))) {
    throw new Error(`${label} must be a non-negative amount that can be represented in cents.`);
  }
  return Math.round(number * 100);
}

function parsePhotoList(value, label) {
  let photos;
  try {
    photos = JSON.parse(value || '[]');
  } catch {
    throw new Error(`${label} contains malformed JSON.`);
  }
  if (!Array.isArray(photos)) throw new Error(`${label} must contain a JSON array.`);

  return photos.map((photo, index) => {
    if (typeof photo !== 'string' || !photo.trim() || photo.includes('\\') || isAbsolute(photo)) {
      throw new Error(`${label}[${index}] is not a safe relative storage path.`);
    }
    const segments = photo.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes(':'))) {
      throw new Error(`${label}[${index}] is not a safe relative storage path.`);
    }
    return photo;
  });
}

function createStats(source) {
  return {
    users: { total: source.users.length, inserted: 0, matched: 0 },
    employees: { total: source.employees.length, inserted: 0, matched: 0 },
    clients: { total: source.clients.length, inserted: 0, matched: 0 },
    machines: { total: source.machines.length, inserted: 0, matched: 0 },
    maintenanceOrders: { total: source.orders.length, inserted: 0, matched: 0 },
    maintenanceTechnicians: { total: source.assignments.length, inserted: 0, matched: 0 },
    maintenanceCards: { total: source.cards.length, inserted: 0, matched: 0 },
    materials: { total: source.materials.length, inserted: 0, matched: 0 },
    photoReferences: {
      before: source.photoReferences.before,
      after: source.photoReferences.after,
      total: source.photoReferences.before + source.photoReferences.after,
    },
    softDeleted: {
      users: source.users.filter((row) => row.deleted_at != null).length,
      employees: source.employees.filter((row) => row.deleted_at != null).length,
      clients: source.clients.filter((row) => row.deleted_at != null).length,
      machines: source.machines.filter((row) => row.deleted_at != null).length,
      maintenanceOrders: source.orders.filter((row) => row.deleted_at != null).length,
    },
    departmentFallbacks: 0,
    alreadyApplied: false,
  };
}

function readSourceRows(sourceDb) {
  for (const table of ['users', 'employees', 'clients', 'machines', 'orders', 'order_machines']) {
    requireTable(sourceDb, table, 'V1 source');
  }
  requireColumns(sourceDb, 'users', ['id', 'username', 'password_hash', 'full_name', 'role', 'active', 'created_at', 'deleted_at'], 'V1 source');
  requireColumns(sourceDb, 'employees', ['id', 'name', 'department', 'phone', 'job_title', 'active', 'created_at', 'deleted_at'], 'V1 source');
  requireColumns(sourceDb, 'clients', ['id', 'code', 'name', 'created_at', 'deleted_at'], 'V1 source');
  requireColumns(sourceDb, 'machines', ['id', 'code', 'name_ar', 'name_en', 'area', 'active', 'created_at', 'deleted_at'], 'V1 source');
  requireColumns(sourceDb, 'orders', ['id', 'code', 'client_id', 'type', 'status', 'notes', 'created_by', 'created_at', 'updated_at', 'archived_at', 'deleted_at'], 'V1 source');
  requireColumns(sourceDb, 'order_machines', ['id', 'order_id', 'machine_id', 'before_photos', 'after_photos'], 'V1 source');

  const users = sourceDb.prepare('SELECT * FROM users ORDER BY id').all();
  const employees = sourceDb.prepare('SELECT * FROM employees ORDER BY id').all();
  const clients = sourceDb.prepare('SELECT * FROM clients ORDER BY id').all();
  const machines = sourceDb.prepare('SELECT * FROM machines ORDER BY id').all();
  const orders = sourceDb.prepare(`SELECT * FROM orders WHERE type = 'maintenance' ORDER BY id`).all();
  const assignmentsExist = sourceDb.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'order_employee_assignments'
  `).get();
  const assignments = assignmentsExist ? sourceDb.prepare(`
    SELECT assignment.*
    FROM order_employee_assignments assignment
    JOIN orders order_record ON order_record.id = assignment.order_id
    WHERE order_record.type = 'maintenance'
    ORDER BY assignment.order_id, assignment.employee_id
  `).all() : [];
  const cards = sourceDb.prepare(`
    SELECT card.*, order_record.status AS order_status,
      order_record.created_at AS order_created_at,
      order_record.updated_at AS order_updated_at
    FROM order_machines card
    JOIN orders order_record ON order_record.id = card.order_id
    WHERE order_record.type = 'maintenance'
    ORDER BY card.id
  `).all();

  const materialsExist = sourceDb.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'materials'
  `).get();
  const materials = materialsExist ? sourceDb.prepare('SELECT * FROM materials ORDER BY id').all() : [];
  const sourceRows = {
    users,
    employees,
    clients,
    machines,
    orders,
    assignments,
    cards,
    materials,
    photoReferences: { before: 0, after: 0 },
  };

  for (const card of cards) {
    const before = parsePhotoList(card.before_photos, `order_machines[${card.id}].before_photos`);
    const after = parsePhotoList(card.after_photos, `order_machines[${card.id}].after_photos`);
    card.migratedBeforePhotos = before;
    card.migratedAfterPhotos = after;
    sourceRows.photoReferences.before += before.length;
    sourceRows.photoReferences.after += after.length;
  }

  return sourceRows;
}

function insertOrMatchByIdentity({
  database,
  table,
  sourceId,
  identityColumn,
  identityValue,
  identityCollation = '',
  insert,
  validateExisting = () => {},
  stats,
  label,
}) {
  const byId = database.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(sourceId);
  const byIdentity = database.prepare(`
    SELECT * FROM ${table} WHERE ${identityColumn} = ? ${identityCollation}
  `).get(identityValue);

  if (byId && byIdentity && byId.id !== byIdentity.id) {
    throw new Error(`${label} ID and business-code conflicts point to different V2 rows.`);
  }
  const existing = byIdentity ?? byId;
  if (existing) {
    validateExisting(existing);
    stats.matched += 1;
    return Number(existing.id);
  }

  insert();
  stats.inserted += 1;
  return Number(sourceId);
}

function migrateUsers(sourceRows, targetDb, stats) {
  const sourceUserToTarget = new Map();
  const findByUsername = targetDb.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE');
  const findById = targetDb.prepare('SELECT * FROM users WHERE id = ?');
  const insertWithId = targetDb.prepare(`
    INSERT INTO users (id, username, password_hash, full_name, role, active, created_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertWithGeneratedId = targetDb.prepare(`
    INSERT INTO users (username, password_hash, full_name, role, active, created_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const user of sourceRows.users) {
    if (!validUserRoles.has(user.role)) throw new Error(`V1 user ${user.id} has a role not supported by V2.`);
    if (!user.username || !user.password_hash || !user.full_name) {
      throw new Error(`V1 user ${user.id} is missing required identity fields.`);
    }
    const active = flag(user.active, 1, `V1 user ${user.id} active`);
    const createdAt = requiredDate(user.created_at, `V1 user ${user.id}`);
    const byUsername = findByUsername.get(user.username);
    if (byUsername) {
      sourceUserToTarget.set(Number(user.id), Number(byUsername.id));
      stats.users.matched += 1;
      continue;
    }

    const idCollision = findById.get(user.id);
    if (idCollision) {
      const result = insertWithGeneratedId.run(
        user.username,
        user.password_hash,
        user.full_name,
        user.role,
        active,
        createdAt,
        nullableDate(user.deleted_at),
      );
      sourceUserToTarget.set(Number(user.id), Number(result.lastInsertRowid));
    } else {
      insertWithId.run(
        user.id,
        user.username,
        user.password_hash,
        user.full_name,
        user.role,
        active,
        createdAt,
        nullableDate(user.deleted_at),
      );
      sourceUserToTarget.set(Number(user.id), Number(user.id));
    }
    stats.users.inserted += 1;
  }
  return sourceUserToTarget;
}

function migrateEmployees(sourceRows, targetDb, sourceUserToTarget, stats) {
  const sourceEmployeeToUser = new Map();
  for (const user of sourceRows.users) {
    if (user.employee_id == null) continue;
    if (sourceEmployeeToUser.has(Number(user.employee_id))) {
      throw new Error(`Multiple V1 users refer to employee ${user.employee_id}; resolve the account link before migration.`);
    }
    sourceEmployeeToUser.set(Number(user.employee_id), sourceUserToTarget.get(Number(user.id)) ?? null);
  }

  const employeeIds = new Map();
  const findById = targetDb.prepare('SELECT * FROM employees WHERE id = ?');
  const findByUser = targetDb.prepare('SELECT * FROM employees WHERE user_id = ?');
  const insert = targetDb.prepare(`
    INSERT INTO employees (
      id, name, department, job_title, phone, national_id, base_salary_cents,
      can_login, user_id, active, created_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const employee of sourceRows.employees) {
    const department = validDepartments.has(employee.department) ? employee.department : 'Maintenance';
    if (department !== employee.department) stats.departmentFallbacks += 1;
    const linkedUserId = sourceEmployeeToUser.get(Number(employee.id)) ?? null;
    let salaryCents = 0;
    if (employee.monthly_salary_cents != null) {
      salaryCents = nonNegativeInteger(employee.monthly_salary_cents, 0, `V1 employee ${employee.id} monthly_salary_cents`);
    } else if (employee.base_salary != null) {
      salaryCents = moneyFromLegacyMaterial(employee.base_salary, `V1 employee ${employee.id} base_salary`);
    }

    const values = {
      name: employee.name,
      department,
      linkedUserId,
    };
    if (!values.name) throw new Error(`V1 employee ${employee.id} is missing a name.`);

    const byId = findById.get(employee.id);
    const byUser = linkedUserId == null ? null : findByUser.get(linkedUserId);
    if (byId && byUser && byId.id !== byUser.id) {
      throw new Error(`V1 employee ${employee.id} conflicts with two existing V2 employee rows.`);
    }
    const existing = byUser ?? byId;
    if (existing) {
      if (existing.name !== values.name || existing.department !== values.department) {
        throw new Error(`V1 employee ${employee.id} conflicts with an existing V2 employee identity.`);
      }
      if (linkedUserId != null && existing.user_id !== linkedUserId) {
        throw new Error(`V1 employee ${employee.id} has a conflicting V2 login-account link.`);
      }
      employeeIds.set(Number(employee.id), Number(existing.id));
      stats.employees.matched += 1;
      continue;
    }

    const active = flag(employee.active ?? employee.is_active, 1, `V1 employee ${employee.id} active`);
    insert.run(
      employee.id,
      values.name,
      values.department,
      employee.job_title ?? null,
      employee.phone ?? null,
      employee.national_id ?? null,
      salaryCents,
      flag(employee.can_login, 0, `V1 employee ${employee.id} can_login`),
      linkedUserId,
      active,
      requiredDate(employee.created_at, `V1 employee ${employee.id}`),
      nullableDate(employee.deleted_at),
    );
    employeeIds.set(Number(employee.id), Number(employee.id));
    stats.employees.inserted += 1;
  }
  return employeeIds;
}

function migrateClients(sourceRows, targetDb, stats) {
  const ids = new Map();
  const insert = targetDb.prepare(`
    INSERT INTO clients (
      id, code, name, contact_name, phone, email, address,
      primary_color, secondary_color, logo_path, created_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const client of sourceRows.clients) {
    if (!client.code || !client.name) throw new Error(`V1 client ${client.id} is missing its code or name.`);
    const id = insertOrMatchByIdentity({
      database: targetDb,
      table: 'clients',
      sourceId: client.id,
      identityColumn: 'code',
      identityValue: client.code,
      stats: stats.clients,
      label: `V1 client ${client.id}`,
      validateExisting(existing) {
        if (existing.code !== client.code) throw new Error(`V1 client ${client.id} has a conflicting V2 client code.`);
      },
      insert: () => insert.run(
        client.id,
        client.code,
        client.name,
        client.contact_name ?? null,
        client.phone ?? null,
        client.email ?? null,
        client.address ?? null,
        client.primary_color ?? null,
        client.secondary_color ?? null,
        client.logo_path ?? null,
        requiredDate(client.created_at, `V1 client ${client.id}`),
        nullableDate(client.deleted_at),
      ),
    });
    ids.set(Number(client.id), id);
  }
  return ids;
}

function migrateMachines(sourceRows, targetDb, stats) {
  const ids = new Map();
  const insert = targetDb.prepare(`
    INSERT INTO machines (id, code, name_ar, name_en, area, active, created_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const machine of sourceRows.machines) {
    if (!machine.code || !machine.name_ar) throw new Error(`V1 machine ${machine.id} is missing its code or Arabic name.`);
    const id = insertOrMatchByIdentity({
      database: targetDb,
      table: 'machines',
      sourceId: machine.id,
      identityColumn: 'code',
      identityValue: machine.code,
      identityCollation: 'COLLATE NOCASE',
      stats: stats.machines,
      label: `V1 machine ${machine.id}`,
      validateExisting(existing) {
        if (existing.code.toLocaleLowerCase() !== machine.code.toLocaleLowerCase()) {
          throw new Error(`V1 machine ${machine.id} has a conflicting V2 machine code.`);
        }
      },
      insert: () => insert.run(
        machine.id,
        machine.code,
        machine.name_ar,
        machine.name_en ?? null,
        machine.area ?? '',
        flag(machine.active, 1, `V1 machine ${machine.id} active`),
        requiredDate(machine.created_at, `V1 machine ${machine.id}`),
        nullableDate(machine.deleted_at),
      ),
    });
    ids.set(Number(machine.id), id);
  }
  return ids;
}

function migrateMaintenanceOrders(sourceRows, targetDb, clientIds, userIds, stats) {
  const ids = new Map();
  const insert = targetDb.prepare(`
    INSERT INTO maintenance_orders (
      id, order_code, client_id, status, notes, warranty_period_months,
      petty_cash_disbursed_cents, actual_expenses_cents, petty_cash_refund_cents,
      archived_at, archived_by, created_by, created_at, updated_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const order of sourceRows.orders) {
    if (!validOrderStatuses.has(order.status)) {
      throw new Error(`V1 maintenance order ${order.id} has an unsupported status: ${order.status}.`);
    }
    const clientId = clientIds.get(Number(order.client_id));
    if (clientId == null) throw new Error(`V1 maintenance order ${order.id} refers to a client that was not migrated.`);
    const createdBy = order.created_by == null ? null : userIds.get(Number(order.created_by));
    if (order.created_by != null && createdBy == null) {
      throw new Error(`V1 maintenance order ${order.id} refers to a user that was not migrated.`);
    }
    const orderCode = order.code;
    if (!orderCode) throw new Error(`V1 maintenance order ${order.id} is missing its order code.`);

    const disbursedCents = nonNegativeInteger(
      order.petty_cash_disbursed_cents ?? order.petty_cash_amount_cents,
      0,
      `V1 maintenance order ${order.id} petty cash`,
    );
    const actualExpensesCents = nonNegativeInteger(
      order.actual_expenses_cents,
      0,
      `V1 maintenance order ${order.id} actual expenses`,
    );
    const settledRefund = flag(order.petty_cash_settled, 0, `V1 maintenance order ${order.id} petty_cash_settled`)
      ? Math.max(0, disbursedCents - actualExpensesCents)
      : 0;
    const refundCents = nonNegativeInteger(
      order.petty_cash_refund_cents,
      settledRefund,
      `V1 maintenance order ${order.id} petty cash refund`,
    );
    const warrantyMonths = Number(order.warranty_period_months ?? 3);
    if (![3, 6].includes(warrantyMonths)) {
      throw new Error(`V1 maintenance order ${order.id} has an unsupported warranty period.`);
    }
    const updatedAt = order.updated_at ?? order.created_at;
    const id = insertOrMatchByIdentity({
      database: targetDb,
      table: 'maintenance_orders',
      sourceId: order.id,
      identityColumn: 'order_code',
      identityValue: orderCode,
      stats: stats.maintenanceOrders,
      label: `V1 maintenance order ${order.id}`,
      validateExisting(existing) {
        if (existing.order_code !== orderCode || Number(existing.client_id) !== clientId) {
          throw new Error(`V1 maintenance order ${order.id} conflicts with an existing V2 order identity.`);
        }
      },
      insert: () => insert.run(
        order.id,
        orderCode,
        clientId,
        order.status,
        order.notes ?? null,
        warrantyMonths,
        disbursedCents,
        actualExpensesCents,
        refundCents,
        nullableDate(order.archived_at),
        null,
        createdBy ?? null,
        requiredDate(order.created_at, `V1 maintenance order ${order.id}`),
        requiredDate(updatedAt, `V1 maintenance order ${order.id} updated_at`),
        nullableDate(order.deleted_at),
      ),
    });
    ids.set(Number(order.id), id);
  }
  return ids;
}

function migrateAssignments(sourceRows, targetDb, orderIds, employeeIds, stats) {
  const insert = targetDb.prepare(`
    INSERT INTO maintenance_order_technicians (order_id, employee_id)
    VALUES (?, ?) ON CONFLICT(order_id, employee_id) DO NOTHING
  `);
  for (const assignment of sourceRows.assignments) {
    const orderId = orderIds.get(Number(assignment.order_id));
    const employeeId = employeeIds.get(Number(assignment.employee_id));
    if (orderId == null || employeeId == null) {
      throw new Error(`V1 technician assignment for order ${assignment.order_id} references an unmigrated row.`);
    }
    const result = insert.run(orderId, employeeId);
    if (result.changes) stats.maintenanceTechnicians.inserted += 1;
    else stats.maintenanceTechnicians.matched += 1;
  }
}

function migrateCards(sourceRows, targetDb, orderIds, machineIds, stats) {
  const findById = targetDb.prepare('SELECT * FROM maintenance_cards WHERE id = ?');
  const insert = targetDb.prepare(`
    INSERT INTO maintenance_cards (
      id, order_id, machine_id, before_photos_json, after_photos_json,
      status, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const card of sourceRows.cards) {
    const orderId = orderIds.get(Number(card.order_id));
    const machineId = machineIds.get(Number(card.machine_id));
    if (orderId == null || machineId == null) {
      throw new Error(`V1 inspection card ${card.id} references an unmigrated order or machine.`);
    }
    const beforePhotos = card.migratedBeforePhotos;
    const afterPhotos = card.migratedAfterPhotos;
    const existing = findById.get(card.id);
    if (existing) {
      if (Number(existing.order_id) !== orderId || Number(existing.machine_id) !== machineId) {
        throw new Error(`V1 inspection card ${card.id} conflicts with an existing V2 card.`);
      }
      stats.maintenanceCards.matched += 1;
      continue;
    }
    const status = card.excluded_at != null
      ? 'excluded'
      : beforePhotos.length + afterPhotos.length > 0 || card.order_status === 'archived'
        ? 'completed'
        : 'pending';
    const createdAt = requiredDate(card.order_created_at, `V1 inspection card ${card.id}`);
    const updatedAt = requiredDate(card.order_updated_at ?? card.order_created_at, `V1 inspection card ${card.id} updated_at`);
    insert.run(
      card.id,
      orderId,
      machineId,
      JSON.stringify(beforePhotos),
      JSON.stringify(afterPhotos),
      status,
      card.note ?? null,
      createdAt,
      updatedAt,
    );
    stats.maintenanceCards.inserted += 1;
  }
}

function migrateMaterials(sourceRows, targetDb, stats) {
  const findById = targetDb.prepare('SELECT * FROM materials WHERE id = ?');
  const findByCode = targetDb.prepare('SELECT * FROM materials WHERE code = ?');
  const insert = targetDb.prepare(`
    INSERT INTO materials (
      id, code, name, specification, unit, stock, min_stock,
      unit_cost_cents, active, created_at, deleted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const material of sourceRows.materials) {
    const stock = Number(material.stock ?? 0);
    const minimum = Number(material.min_stock ?? 0);
    if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) {
      throw new Error(`V1 material ${material.id} has fractional or invalid main stock; reconcile it into whole units and offcuts before migration.`);
    }
    if (!Number.isFinite(minimum) || minimum < 0) throw new Error(`V1 material ${material.id} has an invalid minimum stock.`);
    if (Number(material.sub_stock ?? 0) !== 0) {
      throw new Error(`V1 material ${material.id} has aggregate sub-warehouse stock that cannot be losslessly mapped to V2 offcut records.`);
    }
    if (!material.code || !material.name || !material.unit) {
      throw new Error(`V1 material ${material.id} is missing required catalog fields.`);
    }

    const byId = findById.get(material.id);
    const byCode = findByCode.get(material.code);
    if (byId && byCode && byId.id !== byCode.id) {
      throw new Error(`V1 material ${material.id} ID and code conflicts point to different V2 rows.`);
    }
    const existing = byCode ?? byId;
    if (existing) {
      if (existing.code !== material.code) throw new Error(`V1 material ${material.id} conflicts with an existing V2 material identity.`);
      stats.materials.matched += 1;
      continue;
    }
    const unitCostCents = material.unit_cost_cents == null
      ? moneyFromLegacyMaterial(material.unit_cost, `V1 material ${material.id} unit_cost`)
      : nonNegativeInteger(material.unit_cost_cents, 0, `V1 material ${material.id} unit_cost_cents`);
    insert.run(
      material.id,
      material.code,
      material.name,
      material.specification ?? null,
      material.unit,
      stock,
      minimum,
      unitCostCents,
      flag(material.active, 1, `V1 material ${material.id} active`),
      requiredDate(material.created_at, `V1 material ${material.id}`),
      nullableDate(material.deleted_at),
    );
    stats.materials.inserted += 1;
  }
}

function assertTargetTables(targetDb) {
  for (const table of [
    'users',
    'employees',
    'clients',
    'machines',
    'maintenance_orders',
    'maintenance_order_technicians',
    'maintenance_cards',
    'materials',
    'schema_migrations',
  ]) {
    requireTable(targetDb, table, 'V2 target');
  }
}

function verifyAlreadyMigratedRows(sourceRows, targetDb, stats) {
  const requireMatch = (row, label) => {
    if (!row) throw new Error(`Migration marker exists, but ${label} is missing from V2; no data was changed.`);
    return row;
  };
  const preservesReferences = (targetReferences, sourceReferences) => {
    const remaining = new Map();
    for (const reference of targetReferences) remaining.set(reference, (remaining.get(reference) ?? 0) + 1);
    for (const reference of sourceReferences) {
      const count = remaining.get(reference) ?? 0;
      if (!count) return false;
      remaining.set(reference, count - 1);
    }
    return true;
  };

  const userIds = new Map();
  const findUser = targetDb.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE');
  for (const user of sourceRows.users) {
    const match = requireMatch(findUser.get(user.username), `V1 user ${user.username}`);
    userIds.set(Number(user.id), Number(match.id));
    stats.users.matched += 1;
  }

  const linkedUsers = new Map();
  for (const user of sourceRows.users) {
    if (user.employee_id != null) {
      linkedUsers.set(Number(user.employee_id), userIds.get(Number(user.id)));
    }
  }
  const employeeIds = new Map();
  const findEmployeeById = targetDb.prepare('SELECT id, name, department, user_id FROM employees WHERE id = ?');
  const findEmployeeByUser = targetDb.prepare('SELECT id, name, department, user_id FROM employees WHERE user_id = ?');
  for (const employee of sourceRows.employees) {
    const expectedDepartment = validDepartments.has(employee.department) ? employee.department : 'Maintenance';
    const linkedUserId = linkedUsers.get(Number(employee.id));
    const byId = findEmployeeById.get(employee.id);
    const byUser = linkedUserId == null ? null : findEmployeeByUser.get(linkedUserId);
    if (byId && byUser && Number(byId.id) !== Number(byUser.id)) {
      throw new Error(`V1 employee ${employee.id} no longer maps to one V2 employee; no data was changed.`);
    }
    const match = requireMatch(byUser ?? byId, `V1 employee ${employee.id}`);
    if (match.name !== employee.name || match.department !== expectedDepartment
        || (linkedUserId != null && Number(match.user_id) !== linkedUserId)) {
      throw new Error(`V1 employee ${employee.id} identity differs in V2; no data was changed.`);
    }
    if (expectedDepartment !== employee.department) stats.departmentFallbacks += 1;
    employeeIds.set(Number(employee.id), Number(match.id));
    stats.employees.matched += 1;
  }

  const clientIds = new Map();
  const findClient = targetDb.prepare('SELECT id FROM clients WHERE code = ?');
  for (const client of sourceRows.clients) {
    const match = requireMatch(findClient.get(client.code), `V1 client ${client.code}`);
    clientIds.set(Number(client.id), Number(match.id));
    stats.clients.matched += 1;
  }

  const machineIds = new Map();
  const findMachine = targetDb.prepare('SELECT id, code FROM machines WHERE code = ? COLLATE NOCASE');
  for (const machine of sourceRows.machines) {
    const match = requireMatch(findMachine.get(machine.code), `V1 machine ${machine.code}`);
    machineIds.set(Number(machine.id), Number(match.id));
    stats.machines.matched += 1;
  }

  const orderIds = new Map();
  const findOrder = targetDb.prepare('SELECT id, client_id FROM maintenance_orders WHERE order_code = ?');
  for (const order of sourceRows.orders) {
    const match = requireMatch(findOrder.get(order.code), `V1 maintenance order ${order.code}`);
    if (Number(match.client_id) !== clientIds.get(Number(order.client_id))) {
      throw new Error(`V1 maintenance order ${order.code} has a different client link in V2; no data was changed.`);
    }
    orderIds.set(Number(order.id), Number(match.id));
    stats.maintenanceOrders.matched += 1;
  }

  const findAssignment = targetDb.prepare(`
    SELECT 1 FROM maintenance_order_technicians
    WHERE order_id = ? AND employee_id = ?
  `);
  for (const assignment of sourceRows.assignments) {
    requireMatch(findAssignment.get(
      orderIds.get(Number(assignment.order_id)),
      employeeIds.get(Number(assignment.employee_id)),
    ), `V1 technician assignment for order ${assignment.order_id}`);
    stats.maintenanceTechnicians.matched += 1;
  }

  const findCard = targetDb.prepare('SELECT order_id, machine_id, before_photos_json, after_photos_json FROM maintenance_cards WHERE id = ?');
  for (const card of sourceRows.cards) {
    const match = requireMatch(findCard.get(card.id), `V1 inspection card ${card.id}`);
    const before = JSON.parse(match.before_photos_json);
    const after = JSON.parse(match.after_photos_json);
    if (Number(match.order_id) !== orderIds.get(Number(card.order_id))
        || Number(match.machine_id) !== machineIds.get(Number(card.machine_id))
        || !Array.isArray(before) || !Array.isArray(after)
        || !preservesReferences(before, card.migratedBeforePhotos)
        || !preservesReferences(after, card.migratedAfterPhotos)) {
      throw new Error(`V1 inspection card ${card.id} or its photo references differ in V2; no data was changed.`);
    }
    stats.maintenanceCards.matched += 1;
  }

  const findMaterialById = targetDb.prepare('SELECT id, code FROM materials WHERE id = ?');
  const findMaterialByCode = targetDb.prepare('SELECT id, code FROM materials WHERE code = ?');
  for (const material of sourceRows.materials) {
    const byId = findMaterialById.get(material.id);
    const byCode = findMaterialByCode.get(material.code);
    if (byId && byCode && Number(byId.id) !== Number(byCode.id)) {
      throw new Error(`V1 material ${material.id} has a conflicting V2 identity; no data was changed.`);
    }
    const match = requireMatch(byCode ?? byId, `V1 material ${material.code}`);
    if (match.code !== material.code) {
      throw new Error(`V1 material ${material.id} identity differs in V2; no data was changed.`);
    }
    stats.materials.matched += 1;
  }
}

export function migrateFromV1({ sourceDb, targetDb } = {}) {
  if (!sourceDb?.open || !targetDb?.open) throw new Error('Open sourceDb and targetDb connections are required.');
  assertTargetTables(targetDb);
  const sourceRows = readSourceRows(sourceDb);
  const stats = createStats(sourceRows);
  const foreignKeysEnabled = targetDb.pragma('foreign_keys', { simple: true });
  if (foreignKeysEnabled !== 1) throw new Error('Foreign-key enforcement must be enabled on the V2 target.');

  const applied = targetDb.prepare('SELECT 1 FROM schema_migrations WHERE version = ?').get(migrationVersion);
  if (applied) {
    verifyAlreadyMigratedRows(sourceRows, targetDb, stats);
    const violations = targetDb.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) {
      throw new Error(`Foreign-key verification found ${violations.length} violation(s) on the already-migrated target.`);
    }
    stats.alreadyApplied = true;
    return stats;
  }

  const migrate = targetDb.transaction(() => {
    const userIds = migrateUsers(sourceRows, targetDb, stats);
    const employeeIds = migrateEmployees(sourceRows, targetDb, userIds, stats);
    const clientIds = migrateClients(sourceRows, targetDb, stats);
    const machineIds = migrateMachines(sourceRows, targetDb, stats);
    const orderIds = migrateMaintenanceOrders(sourceRows, targetDb, clientIds, userIds, stats);
    migrateAssignments(sourceRows, targetDb, orderIds, employeeIds, stats);
    migrateCards(sourceRows, targetDb, orderIds, machineIds, stats);
    migrateMaterials(sourceRows, targetDb, stats);

    const violations = targetDb.prepare('PRAGMA foreign_key_check').all();
    if (violations.length) {
      throw new Error(`Migration would leave ${violations.length} foreign-key violation(s); all changes were rolled back.`);
    }
    targetDb.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(migrationVersion);
  });
  migrate.immediate();

  const violations = targetDb.prepare('PRAGMA foreign_key_check').all();
  if (violations.length) {
    throw new Error(`Post-migration foreign_key_check found ${violations.length} violation(s).`);
  }
  return stats;
}

function formatCount(label, values) {
  return `✔ ${label}: ${values.total} (${values.inserted} inserted, ${values.matched} existing preserved)`;
}

function printSummary(stats) {
  console.log('--- V1 → V2 Migration Summary ---');
  if (stats.alreadyApplied) {
    console.log('✔ This migration was already applied; source identities and photo references were verified without changing target rows.');
    console.log(formatCount('Users', stats.users));
    console.log(formatCount('Employees', stats.employees));
    console.log(formatCount('Clients', stats.clients));
    console.log(formatCount('Machines', stats.machines));
    console.log(formatCount('Maintenance Orders', stats.maintenanceOrders));
    console.log(formatCount('Maintenance Technicians Linked', stats.maintenanceTechnicians));
    console.log(formatCount('Inspection Cards', stats.maintenanceCards));
    console.log(formatCount('Materials', stats.materials));
    console.log(`✔ Photo references verified: ${stats.photoReferences.total} (Before ${stats.photoReferences.before}, After ${stats.photoReferences.after})`);
    console.log('✔ Foreign-key verification: 0 violations');
    return;
  }
  console.log(formatCount('Users', stats.users));
  console.log(formatCount('Employees', stats.employees));
  console.log(formatCount('Clients', stats.clients));
  console.log(formatCount('Machines', stats.machines));
  console.log(formatCount('Maintenance Orders', stats.maintenanceOrders));
  console.log(formatCount('Maintenance Technicians Linked', stats.maintenanceTechnicians));
  console.log(formatCount('Inspection Cards', stats.maintenanceCards));
  console.log(formatCount('Materials', stats.materials));
  console.log(`✔ Photo references preserved: ${stats.photoReferences.total} (Before ${stats.photoReferences.before}, After ${stats.photoReferences.after})`);
  console.log(`✔ Soft-deleted rows retained as deleted: ${JSON.stringify(stats.softDeleted)}`);
  if (stats.departmentFallbacks) {
    console.log(`⚠ Employee departments normalized to Maintenance: ${stats.departmentFallbacks}`);
  }
  console.log('✔ Foreign-key verification: 0 violations');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let sourceDb;
  let targetDb;
  try {
    console.log(`Connecting source: ${sourcePath}`);
    console.log(`Connecting target: ${targetPath}`);
    sourceDb = new Database(sourcePath, { readonly: true, fileMustExist: true });
    targetDb = new Database(targetPath, { fileMustExist: true });
    targetDb.pragma('busy_timeout = 5000');
    targetDb.pragma('journal_mode = WAL');
    targetDb.pragma('foreign_keys = ON');
    const stats = migrateFromV1({ sourceDb, targetDb });
    printSummary(stats);
  } catch (error) {
    console.error(`V1 → V2 migration failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (sourceDb?.open) sourceDb.close();
    if (targetDb?.open) targetDb.close();
  }
}
