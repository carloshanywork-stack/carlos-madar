const path = require('node:path')
const { DataTypes, Sequelize } = require('sequelize')
const projectRoot = path.resolve(__dirname, '..', '..', '..')

function defineModels(sequelize) {
  const User = sequelize.define('User', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    username: { type: DataTypes.STRING, allowNull: false, unique: true },
    passwordHash: { type: DataTypes.STRING, field: 'password_hash', allowNull: false },
    fullName: { type: DataTypes.STRING, field: 'full_name', allowNull: false },
    role: { type: DataTypes.STRING, allowNull: false },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isMaster: { type: DataTypes.BOOLEAN, field: 'is_master', allowNull: false, defaultValue: false },
    employeeId: { type: DataTypes.INTEGER, field: 'employee_id', unique: true },
  }, {
    tableName: 'users',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const Worker = sequelize.define('Worker', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    jobTitle: { type: DataTypes.STRING, field: 'job_title', allowNull: false, defaultValue: '' },
    phone: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    tableName: 'workers',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const Employee = sequelize.define('Employee', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
    department: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: { isIn: [['Maintenance', 'Sales', 'Purchasing', 'Operation']] },
    },
    phone: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    jobTitle: { type: DataTypes.STRING, field: 'job_title', allowNull: false, defaultValue: '' },
    monthlySalaryCents: { type: DataTypes.INTEGER, field: 'monthly_salary_cents', allowNull: false, defaultValue: 0 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    tableName: 'employees',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const Client = sequelize.define('Client', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    contactName: { type: DataTypes.STRING, field: 'contact_name', defaultValue: '' },
    phone: { type: DataTypes.STRING, defaultValue: '' },
    email: { type: DataTypes.STRING, defaultValue: '' },
    address: { type: DataTypes.TEXT, defaultValue: '' },
    primaryColor: { type: DataTypes.STRING, field: 'primary_color', allowNull: false, defaultValue: '#173a66' },
    secondaryColor: { type: DataTypes.STRING, field: 'secondary_color', allowNull: false, defaultValue: '#f49b36' },
    logoPath: { type: DataTypes.STRING, field: 'logo_path', defaultValue: '' },
  }, {
    tableName: 'clients',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const Machine = sequelize.define('Machine', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    nameAr: { type: DataTypes.STRING, field: 'name_ar', allowNull: false },
    nameEn: { type: DataTypes.STRING, field: 'name_en', defaultValue: '' },
    area: { type: DataTypes.STRING, allowNull: true, defaultValue: '' },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  }, {
    tableName: 'machines',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const Material = sequelize.define('Material', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    name: { type: DataTypes.STRING, allowNull: false },
    specification: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    variantKey: { type: DataTypes.STRING, field: 'variant_key' },
    unit: { type: DataTypes.STRING, allowNull: false, defaultValue: 'قطعة' },
    stock: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    unitCost: { type: DataTypes.FLOAT, field: 'unit_cost', allowNull: false, defaultValue: 0 },
    minStock: { type: DataTypes.FLOAT, field: 'min_stock', allowNull: false, defaultValue: 0 },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    subStock: { type: DataTypes.FLOAT, field: 'sub_stock', allowNull: false, defaultValue: 0 },
  }, {
    tableName: 'materials',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const Order = sequelize.define('Order', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    code: { type: DataTypes.STRING, allowNull: false, unique: true },
    clientId: { type: DataTypes.INTEGER, field: 'client_id', allowNull: false },
    type: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'in_progress' },
    notes: { type: DataTypes.TEXT, defaultValue: '' },
    totalCost: { type: DataTypes.FLOAT, field: 'total_cost', allowNull: true, defaultValue: null },
    materialCost: { type: DataTypes.FLOAT, field: 'material_cost', allowNull: true, defaultValue: null },
    operatingCost: { type: DataTypes.FLOAT, field: 'operating_cost', allowNull: true, defaultValue: null },
    sellingPrice: { type: DataTypes.FLOAT, field: 'selling_price', allowNull: true, defaultValue: null },
    profit: {
      type: DataTypes.VIRTUAL(DataTypes.FLOAT),
      allowNull: true,
      get() {
        const sellingPrice = this.getDataValue('sellingPrice')
        const totalCost = this.getDataValue('totalCost')
        return sellingPrice == null || totalCost == null ? null : Number(sellingPrice) - Number(totalCost)
      },
    },
    areaPath: { type: DataTypes.TEXT, field: 'area_path', defaultValue: '' },
    createdBy: { type: DataTypes.INTEGER, field: 'created_by' },
    assignedWorkerId: { type: DataTypes.INTEGER, field: 'assigned_worker_id', allowNull: true },
    assignedEmployeeId: { type: DataTypes.INTEGER, field: 'assigned_employee_id', allowNull: true },
    archivedAt: { type: DataTypes.DATE, field: 'archived_at' },
  }, {
    tableName: 'orders',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const OrderMachine = sequelize.define('OrderMachine', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    orderId: { type: DataTypes.INTEGER, field: 'order_id', allowNull: false },
    machineId: { type: DataTypes.INTEGER, field: 'machine_id', allowNull: false },
    beforePhotos: { type: DataTypes.TEXT, field: 'before_photos', allowNull: false, defaultValue: '[]' },
    afterPhotos: { type: DataTypes.TEXT, field: 'after_photos', allowNull: false, defaultValue: '[]' },
    reasonIds: { type: DataTypes.TEXT, field: 'reason_ids', allowNull: false, defaultValue: '[]' },
    note: { type: DataTypes.TEXT, field: 'note', allowNull: false, defaultValue: '' },
    excludedAt: { type: DataTypes.DATE, field: 'excluded_at' },
  }, {
    tableName: 'order_machines',
    timestamps: false,
    freezeTableName: true,
    indexes: [{ unique: true, fields: ['order_id', 'machine_id'] }],
  })

  const AreaFolder = sequelize.define('AreaFolder', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    orderId: { type: DataTypes.INTEGER, field: 'order_id', allowNull: false },
    folderName: { type: DataTypes.STRING, field: 'folder_name', allowNull: false },
    folderKey: { type: DataTypes.STRING, field: 'folder_key', allowNull: false },
    imagePaths: { type: DataTypes.TEXT, field: 'image_paths', allowNull: false, defaultValue: '[]' },
    sourceFolderPaths: { type: DataTypes.TEXT, field: 'source_folder_paths', allowNull: false, defaultValue: '[]' },
    machineId: { type: DataTypes.INTEGER, field: 'machine_id' },
    createdAt: { type: DataTypes.DATE, field: 'created_at' },
    deletedAt: { type: DataTypes.DATE, field: 'deleted_at' },
  }, {
    tableName: 'area_folders',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
    indexes: [{ unique: true, fields: ['order_id', 'folder_key'] }],
  })

  const OrderEmployeeAssignment = sequelize.define('OrderEmployeeAssignment', {
    orderId: { type: DataTypes.INTEGER, field: 'order_id', primaryKey: true },
    employeeId: { type: DataTypes.INTEGER, field: 'employee_id', primaryKey: true },
    assignedAt: { type: DataTypes.DATE, field: 'assigned_at' },
  }, { tableName: 'order_employee_assignments', timestamps: false, freezeTableName: true })

  const IdempotencyKey = sequelize.define('IdempotencyKey', {
    userId: { type: DataTypes.INTEGER, field: 'user_id', primaryKey: true, allowNull: false },
    scope: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
    key: { type: DataTypes.STRING, primaryKey: true, allowNull: false },
    requestHash: { type: DataTypes.STRING, field: 'request_hash', allowNull: false },
    responseStatus: { type: DataTypes.INTEGER, field: 'response_status', allowNull: false },
    responseBody: { type: DataTypes.TEXT, field: 'response_body', allowNull: false },
    createdAtMs: { type: DataTypes.BIGINT, field: 'created_at_ms', allowNull: false },
  }, {
    tableName: 'idempotency_keys',
    timestamps: false,
    freezeTableName: true,
  })

  const InvoiceItem = sequelize.define('InvoiceItem', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    invoiceId: { type: DataTypes.INTEGER, field: 'invoice_id', allowNull: false },
    materialId: { type: DataTypes.INTEGER, field: 'material_id', allowNull: false },
    quantity: { type: DataTypes.FLOAT, allowNull: false },
    unitCost: { type: DataTypes.FLOAT, field: 'unit_cost', allowNull: false },
  }, { tableName: 'invoice_items', timestamps: false, freezeTableName: true })

  const Invoice = sequelize.define('Invoice', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    code: { type: DataTypes.STRING, allowNull: false },
    kind: { type: DataTypes.STRING, allowNull: false },
    supplier: { type: DataTypes.STRING, defaultValue: '' },
    workerId: { type: DataTypes.INTEGER, field: 'worker_id' },
    employeeId: { type: DataTypes.INTEGER, field: 'employee_id' },
    total: { type: DataTypes.FLOAT, allowNull: false, defaultValue: 0 },
    subtotalCents: { type: DataTypes.INTEGER, field: 'subtotal_cents' },
    taxCents: { type: DataTypes.INTEGER, field: 'tax_cents', allowNull: false, defaultValue: 0 },
    taxRateBasisPoints: { type: DataTypes.INTEGER, field: 'tax_rate_basis_points', allowNull: false, defaultValue: 0 },
    saleType: { type: DataTypes.STRING, field: 'sale_type', allowNull: false, defaultValue: 'credit' },
  }, {
    tableName: 'invoices',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const TreasuryTransaction = sequelize.define('TreasuryTransaction', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    kind: { type: DataTypes.STRING, allowNull: false },
    amount: { type: DataTypes.FLOAT, allowNull: false },
    category: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    invoiceId: { type: DataTypes.INTEGER, field: 'invoice_id' },
    workerId: { type: DataTypes.INTEGER, field: 'worker_id' },
    employeeId: { type: DataTypes.INTEGER, field: 'employee_id' },
  }, {
    tableName: 'treasury_transactions',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    freezeTableName: true,
  })

  const InventoryMovement = sequelize.define('InventoryMovement', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    materialId: { type: DataTypes.INTEGER, field: 'material_id', allowNull: false },
    kind: { type: DataTypes.STRING, allowNull: false },
    quantity: { type: DataTypes.FLOAT, allowNull: false },
    reference: { type: DataTypes.STRING, defaultValue: '' },
    notes: { type: DataTypes.TEXT, defaultValue: '' },
    createdBy: { type: DataTypes.INTEGER, field: 'created_by' },
    warehouse: { type: DataTypes.STRING, allowNull: false, defaultValue: 'main' },
    invoiceId: { type: DataTypes.INTEGER, field: 'invoice_id' },
    sourceType: { type: DataTypes.STRING, field: 'source_type', allowNull: false, defaultValue: 'manual' },
    sourceId: { type: DataTypes.STRING, field: 'source_id' },
  }, {
    tableName: 'inventory_movements',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    freezeTableName: true,
  })

  const Counter = sequelize.define('Counter', {
    name: { type: DataTypes.STRING, primaryKey: true },
    value: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1000 },
  }, { tableName: 'counters', timestamps: false, freezeTableName: true })

  const AuditLog = sequelize.define('AuditLog', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.INTEGER, field: 'user_id' },
    action: { type: DataTypes.STRING, allowNull: false },
    entity: { type: DataTypes.STRING, allowNull: false },
    entityId: { type: DataTypes.STRING, field: 'entity_id', defaultValue: '' },
    details: { type: DataTypes.TEXT, defaultValue: '' },
    oldValues: { type: DataTypes.TEXT, field: 'old_values' },
    newValues: { type: DataTypes.TEXT, field: 'new_values' },
  }, {
    tableName: 'audit_log',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: false,
    freezeTableName: true,
  })

  Client.hasMany(Order, { as: 'orders', foreignKey: 'clientId' })
  Order.belongsTo(Client, { as: 'client', foreignKey: 'clientId' })

  Order.belongsToMany(Machine, {
    as: 'machines', through: OrderMachine, foreignKey: 'orderId', otherKey: 'machineId',
  })
  Machine.belongsToMany(Order, {
    as: 'orders', through: OrderMachine, foreignKey: 'machineId', otherKey: 'orderId',
  })
  OrderMachine.belongsTo(Order, { as: 'order', foreignKey: 'orderId' })
  OrderMachine.belongsTo(Machine, { as: 'machine', foreignKey: 'machineId' })
  Order.hasMany(AreaFolder, { as: 'areaFolders', foreignKey: 'orderId' })
  AreaFolder.belongsTo(Order, { as: 'order', foreignKey: 'orderId' })
  Machine.hasMany(AreaFolder, { as: 'areaFolders', foreignKey: 'machineId' })
  AreaFolder.belongsTo(Machine, { as: 'machine', foreignKey: 'machineId' })

  Order.belongsToMany(Employee, { as: 'employees', through: OrderEmployeeAssignment, foreignKey: 'orderId', otherKey: 'employeeId' })
  Employee.belongsToMany(Order, { as: 'workOrders', through: OrderEmployeeAssignment, foreignKey: 'employeeId', otherKey: 'orderId' })

  Material.hasMany(InvoiceItem, { as: 'invoiceItems', foreignKey: 'materialId' })
  InvoiceItem.belongsTo(Material, { as: 'material', foreignKey: 'materialId' })
  Material.hasMany(InventoryMovement, { as: 'movements', foreignKey: 'materialId' })
  InventoryMovement.belongsTo(Material, { as: 'material', foreignKey: 'materialId' })
  Worker.hasMany(Invoice, { as: 'invoices', foreignKey: 'workerId' })
  Invoice.belongsTo(Worker, { as: 'worker', foreignKey: 'workerId' })
  Worker.hasMany(TreasuryTransaction, { as: 'treasuryTransactions', foreignKey: 'workerId' })
  TreasuryTransaction.belongsTo(Worker, { as: 'worker', foreignKey: 'workerId' })
  Employee.hasOne(User, { as: 'user', foreignKey: 'employeeId' })
  User.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' })
  Employee.hasMany(Invoice, { as: 'invoices', foreignKey: 'employeeId' })
  Invoice.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' })
  Employee.hasMany(TreasuryTransaction, { as: 'treasuryTransactions', foreignKey: 'employeeId' })
  TreasuryTransaction.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' })
  Employee.hasMany(Order, { as: 'orders', foreignKey: 'assignedEmployeeId' })
  Order.belongsTo(Employee, { as: 'assignedEmployee', foreignKey: 'assignedEmployeeId' })

  return {
    User, Worker, Employee, Client, Machine, Material, Order, OrderMachine, OrderEmployeeAssignment, AreaFolder, IdempotencyKey,
    Invoice, TreasuryTransaction, InvoiceItem, InventoryMovement, Counter, AuditLog,
  }
}

function resolveSqliteStorage({ storage, dbPath = process.env.DB_PATH, databaseUrl = process.env.DATABASE_URL } = {}) {
  if (storage) return storage
  const configuredPath = dbPath || databaseUrl || 'file:./system/data/madar.sqlite'
  if (configuredPath.startsWith('file:')) return path.resolve(projectRoot, configuredPath.slice('file:'.length))
  return path.resolve(projectRoot, configuredPath)
}

function createSqliteSequelize(options = {}) {
  const { logging = false } = options
  const storage = resolveSqliteStorage(options)
  return new Sequelize({
    dialect: 'sqlite',
    storage,
    logging,
    pool: { max: 1, min: 0, acquire: 5000, idle: 10000 },
    retry: { max: 0 },
  })
}

async function initializeSqlite(sequelize) {
  await sequelize.authenticate()
  await sequelize.query('PRAGMA journal_mode = WAL')
  await sequelize.query('PRAGMA foreign_keys = ON')
  await sequelize.query('PRAGMA busy_timeout = 5000')
}

module.exports = { createSqliteSequelize, defineModels, initializeSqlite, resolveSqliteStorage }
