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
    baseSalaryCents: { type: DataTypes.INTEGER, field: 'base_salary', allowNull: false, defaultValue: 0 },
    standardDailyHours: { type: DataTypes.INTEGER, field: 'standard_daily_hours', allowNull: false, defaultValue: 9 },
    standardMonthlyDays: { type: DataTypes.INTEGER, field: 'standard_monthly_days', allowNull: false, defaultValue: 26 },
    canLogin: { type: DataTypes.BOOLEAN, field: 'can_login', allowNull: false, defaultValue: false },
    loginUsername: { type: DataTypes.STRING, field: 'login_username' },
    // Kept nullable for schema compatibility only. users.password_hash remains the sole credential source.
    loginPasswordHash: { type: DataTypes.STRING, field: 'login_password_hash' },
    loginRole: { type: DataTypes.STRING, field: 'role' },
    active: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
    isActive: { type: DataTypes.BOOLEAN, field: 'is_active', allowNull: false, defaultValue: true },
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

  const MaintenanceOrder = sequelize.define('MaintenanceOrder', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    clientId: { type: DataTypes.INTEGER, field: 'client_id', allowNull: false },
    siteLocation: { type: DataTypes.TEXT, field: 'site_location', allowNull: false, defaultValue: '' },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'in_progress' },
    createdBy: { type: DataTypes.INTEGER, field: 'created_by' },
    assignedTechnicians: { type: DataTypes.TEXT, field: 'assigned_technicians', allowNull: false, defaultValue: '[]' },
    pettyCashAmountCents: { type: DataTypes.INTEGER, field: 'petty_cash_amount', allowNull: false, defaultValue: 0 },
    pettyCashSettled: { type: DataTypes.BOOLEAN, field: 'petty_cash_settled', allowNull: false, defaultValue: false },
    pettyCashBalanceCents: { type: DataTypes.INTEGER, field: 'petty_cash_balance', allowNull: false, defaultValue: 0 },
    materialsIssued: { type: DataTypes.TEXT, field: 'materials_issued', allowNull: false, defaultValue: '[]' },
    materialsReconciled: { type: DataTypes.TEXT, field: 'materials_reconciled', allowNull: false, defaultValue: '[]' },
    adminEditHistory: { type: DataTypes.TEXT, field: 'admin_edit_history', allowNull: false, defaultValue: '[]' },
    archivedAt: { type: DataTypes.DATE, field: 'archived_at' },
  }, {
    tableName: 'maintenance_orders',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const ManufacturingOrder = sequelize.define('ManufacturingOrder', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    orderCode: { type: DataTypes.STRING, field: 'order_code', allowNull: false, unique: true },
    clientId: { type: DataTypes.INTEGER, field: 'client_id', allowNull: false },
    productName: { type: DataTypes.STRING, field: 'product_name', allowNull: false },
    description: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    targetDeliveryDate: { type: DataTypes.DATEONLY, field: 'target_delivery_date' },
    machineType: { type: DataTypes.STRING, field: 'machine_type', allowNull: false },
    assignedTechnicians: { type: DataTypes.TEXT, field: 'assigned_technicians', allowNull: false, defaultValue: '[]' },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'in_production' },
    materialsUsed: { type: DataTypes.TEXT, field: 'materials_used', allowNull: false, defaultValue: '[]' },
    offcutsReturned: { type: DataTypes.TEXT, field: 'offcuts_returned', allowNull: false, defaultValue: '[]' },
    salesInvoiceId: { type: DataTypes.INTEGER, field: 'sales_invoice_id' },
    createdBy: { type: DataTypes.INTEGER, field: 'created_by' },
    deliveredAt: { type: DataTypes.DATE, field: 'delivered_at' },
  }, {
    tableName: 'manufacturing_orders',
    timestamps: true,
    createdAt: 'created_at',
    updatedAt: 'updated_at',
    paranoid: true,
    deletedAt: 'deleted_at',
    freezeTableName: true,
  })

  const SecondaryWarehouseOffcut = sequelize.define('SecondaryWarehouseOffcut', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    materialId: { type: DataTypes.INTEGER, field: 'material_id' },
    name: { type: DataTypes.STRING, allowNull: false },
    dimensions: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    quantity: { type: DataTypes.FLOAT, allowNull: false },
    unit: { type: DataTypes.STRING, allowNull: false, defaultValue: '' },
    notes: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    status: { type: DataTypes.STRING, allowNull: false, defaultValue: 'available' },
  }, { tableName: 'secondary_warehouse_offcuts', timestamps: true, createdAt: 'created_at', updatedAt: false, freezeTableName: true })

  const SecondaryWarehouseScrapSale = sequelize.define('SecondaryWarehouseScrapSale', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    amountCents: { type: DataTypes.INTEGER, field: 'amount_cents', allowNull: false },
    treasuryTransactionId: { type: DataTypes.INTEGER, field: 'treasury_transaction_id', allowNull: false, unique: true },
    createdBy: { type: DataTypes.INTEGER, field: 'created_by' },
    notes: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  }, { tableName: 'secondary_warehouse_scrap_sales', timestamps: true, createdAt: 'created_at', updatedAt: false, freezeTableName: true })

  const SecondaryWarehouseScrapSaleItem = sequelize.define('SecondaryWarehouseScrapSaleItem', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    saleId: { type: DataTypes.INTEGER, field: 'sale_id', allowNull: false },
    offcutId: { type: DataTypes.INTEGER, field: 'offcut_id', allowNull: false },
    quantity: { type: DataTypes.FLOAT, allowNull: false },
  }, { tableName: 'secondary_warehouse_scrap_sale_items', timestamps: false, freezeTableName: true })

  const EmployeeDailyAttendance = sequelize.define('EmployeeDailyAttendance', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    employeeId: { type: DataTypes.INTEGER, field: 'employee_id', allowNull: false },
    attendanceDate: { type: DataTypes.DATEONLY, field: 'attendance_date', allowNull: false },
    status: { type: DataTypes.STRING, allowNull: false },
    overtimeMinutes: { type: DataTypes.INTEGER, field: 'overtime_minutes', allowNull: false, defaultValue: 0 },
    holidayOvertimeMinutes: { type: DataTypes.INTEGER, field: 'holiday_overtime_minutes', allowNull: false, defaultValue: 0 },
    notes: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    markedBy: { type: DataTypes.INTEGER, field: 'marked_by' },
  }, { tableName: 'employee_daily_attendance', timestamps: true, createdAt: 'created_at', updatedAt: 'updated_at', freezeTableName: true })

  const EmployeeToolCustody = sequelize.define('EmployeeToolCustody', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    employeeId: { type: DataTypes.INTEGER, field: 'employee_id', allowNull: false },
    toolName: { type: DataTypes.STRING, field: 'tool_name', allowNull: false },
    serialNumber: { type: DataTypes.STRING, field: 'serial_number', allowNull: false, defaultValue: '' },
    issuedAt: { type: DataTypes.DATE, field: 'issued_at', allowNull: false },
    issuedBy: { type: DataTypes.INTEGER, field: 'issued_by' },
    returnStatus: { type: DataTypes.STRING, field: 'return_status', allowNull: false, defaultValue: 'issued' },
    returnedAt: { type: DataTypes.DATE, field: 'returned_at' },
    returnedBy: { type: DataTypes.INTEGER, field: 'returned_by' },
    notes: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
  }, { tableName: 'employee_tool_custody', timestamps: false, freezeTableName: true })

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
  Employee.hasOne(User, { as: 'user', foreignKey: 'employeeId' })
  User.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' })
  Employee.hasMany(Invoice, { as: 'invoices', foreignKey: 'employeeId' })
  Invoice.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' })
  Employee.hasMany(TreasuryTransaction, { as: 'treasuryTransactions', foreignKey: 'employeeId' })
  TreasuryTransaction.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' })
  Employee.hasMany(Order, { as: 'orders', foreignKey: 'assignedEmployeeId' })
  Order.belongsTo(Employee, { as: 'assignedEmployee', foreignKey: 'assignedEmployeeId' })

  Client.hasMany(MaintenanceOrder, { as: 'maintenanceOrders', foreignKey: 'clientId' })
  MaintenanceOrder.belongsTo(Client, { as: 'client', foreignKey: 'clientId' })
  MaintenanceOrder.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' })
  User.hasMany(MaintenanceOrder, { as: 'createdMaintenanceOrders', foreignKey: 'createdBy' })
  Client.hasMany(ManufacturingOrder, { as: 'manufacturingOrders', foreignKey: 'clientId' })
  ManufacturingOrder.belongsTo(Client, { as: 'client', foreignKey: 'clientId' })
  ManufacturingOrder.belongsTo(Invoice, { as: 'salesInvoice', foreignKey: 'salesInvoiceId' })
  Invoice.hasMany(ManufacturingOrder, { as: 'manufacturingOrders', foreignKey: 'salesInvoiceId' })
  ManufacturingOrder.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' })
  User.hasMany(ManufacturingOrder, { as: 'createdManufacturingOrders', foreignKey: 'createdBy' })
  Material.hasMany(SecondaryWarehouseOffcut, { as: 'offcuts', foreignKey: 'materialId' })
  SecondaryWarehouseOffcut.belongsTo(Material, { as: 'material', foreignKey: 'materialId' })
  TreasuryTransaction.hasOne(SecondaryWarehouseScrapSale, { as: 'scrapSale', foreignKey: 'treasuryTransactionId' })
  SecondaryWarehouseScrapSale.belongsTo(TreasuryTransaction, { as: 'treasuryTransaction', foreignKey: 'treasuryTransactionId' })
  SecondaryWarehouseScrapSale.belongsTo(User, { as: 'creator', foreignKey: 'createdBy' })
  User.hasMany(SecondaryWarehouseScrapSale, { as: 'scrapSales', foreignKey: 'createdBy' })
  SecondaryWarehouseScrapSale.hasMany(SecondaryWarehouseScrapSaleItem, { as: 'items', foreignKey: 'saleId' })
  SecondaryWarehouseScrapSaleItem.belongsTo(SecondaryWarehouseScrapSale, { as: 'sale', foreignKey: 'saleId' })
  SecondaryWarehouseOffcut.hasMany(SecondaryWarehouseScrapSaleItem, { as: 'scrapSaleItems', foreignKey: 'offcutId' })
  SecondaryWarehouseScrapSaleItem.belongsTo(SecondaryWarehouseOffcut, { as: 'offcut', foreignKey: 'offcutId' })
  Employee.hasMany(EmployeeDailyAttendance, { as: 'attendance', foreignKey: 'employeeId' })
  EmployeeDailyAttendance.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' })
  User.hasMany(EmployeeDailyAttendance, { as: 'markedAttendance', foreignKey: 'markedBy' })
  EmployeeDailyAttendance.belongsTo(User, { as: 'marker', foreignKey: 'markedBy' })
  Employee.hasMany(EmployeeToolCustody, { as: 'toolCustody', foreignKey: 'employeeId' })
  EmployeeToolCustody.belongsTo(Employee, { as: 'employee', foreignKey: 'employeeId' })
  User.hasMany(EmployeeToolCustody, { as: 'issuedTools', foreignKey: 'issuedBy' })
  EmployeeToolCustody.belongsTo(User, { as: 'issuer', foreignKey: 'issuedBy' })
  User.hasMany(EmployeeToolCustody, { as: 'returnedTools', foreignKey: 'returnedBy' })
  EmployeeToolCustody.belongsTo(User, { as: 'returner', foreignKey: 'returnedBy' })

  return {
    User, Employee, Client, Machine, Material, Order, OrderMachine, OrderEmployeeAssignment, AreaFolder, IdempotencyKey,
    Invoice, TreasuryTransaction, InvoiceItem, InventoryMovement, Counter, AuditLog,
    MaintenanceOrder, ManufacturingOrder, SecondaryWarehouseOffcut, SecondaryWarehouseScrapSale, SecondaryWarehouseScrapSaleItem,
    EmployeeDailyAttendance, EmployeeToolCustody,
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
