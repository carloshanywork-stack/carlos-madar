const MACHINE_TYPES = new Set(['cnc_router', 'laser', 'both', 'manual'])
const STATUSES = new Set(['in_production', 'ready', 'delivered_archived'])
const DESIGN_EXTENSIONS = new Set(['.dxf', '.cdr', '.ai', '.pdf'])

function validPositiveQuantity(value) {
  const quantity = Number(value)
  return Number.isFinite(quantity) && quantity > 0 && quantity <= 1_000_000
    && Math.abs(quantity - Math.round(quantity * 1_000_000) / 1_000_000) <= 0.000001
}

async function ensureManufacturingDirectory(storageRoot, target, { fs, path, storagePathUsesSymlink }) {
  const root = path.resolve(storageRoot)
  const destination = path.resolve(target)
  const relative = path.relative(root, destination)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('مسار مرفقات التصنيع غير صالح.')
  const rootStats = await fs.promises.lstat(root)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink() || await storagePathUsesSymlink(root)) {
    throw new Error('جذر التخزين غير آمن لمرفقات التصنيع.')
  }
  let current = root
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment)
    await fs.promises.mkdir(current).catch((error) => { if (error.code !== 'EEXIST') throw error })
    const stats = await fs.promises.lstat(current)
    if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('مسار مرفقات التصنيع يحتوي على رابط رمزي أو عنصر غير صالح.')
  }
  if (await storagePathUsesSymlink(destination)) throw new Error('مسار مرفقات التصنيع يحتوي على رابط رمزي.')
  return destination
}

function validDateOrEmpty(value) {
  if (value == null || value === '') return true
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function registerManufacturingRoutes(api, {
  db, requireAuth, allowRoles, sendError, nextCode, audit, storageRoot, fs, path, crypto, multer,
  safeStorageFile, relativeStoragePath, storagePathUsesSymlink, parseCurrencyCents, currencyAmountFromCents,
  queueJournalEntry, assertMaterialUnlocked, consumeInventoryLots,
}) {
  const read = [requireAuth, allowRoles('admin', 'operations', 'sales')]
  const create = [requireAuth, allowRoles('admin', 'operations')]
  const designUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 40 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase()
      if (!DESIGN_EXTENSIONS.has(extension)) return callback(Object.assign(new Error('صيغة التصميم يجب أن تكون DXF أو CDR أو AI أو PDF.'), { status: 400 }))
      callback(null, true)
    },
  })

  api.get('/manufacturing/orders', ...read, (req, res) => {
    const status = req.query.status == null ? null : String(req.query.status)
    if (status && !STATUSES.has(status)) return sendError(res, 400, 'مرحلة أمر التصنيع غير صالحة.')
    const rows = db.prepare(`SELECT o.*,c.name AS client_name,u.full_name AS created_by_name,
        i.code AS invoice_code,i.total AS invoice_total
      FROM manufacturing_orders o JOIN clients c ON c.id=o.client_id
      LEFT JOIN users u ON u.id=o.created_by LEFT JOIN invoices i ON i.id=o.sales_invoice_id
      WHERE o.deleted_at IS NULL ${status ? 'AND o.status=?' : ''}
      ORDER BY CASE o.status WHEN 'in_production' THEN 1 WHEN 'ready' THEN 2 ELSE 3 END,
        COALESCE(o.target_delivery_date,'9999-12-31'),o.id DESC`)
      .all(...(status ? [status] : []))
    res.json(rows.map((row) => ({ ...row, assigned_technicians: JSON.parse(row.assigned_technicians || '[]'),
      materials_used: JSON.parse(row.materials_used || '[]'), offcuts_returned: JSON.parse(row.offcuts_returned || '[]'),
      design_files: db.prepare('SELECT id,original_name,extension,byte_size,created_at FROM manufacturing_design_files WHERE order_id=? ORDER BY id')
        .all(row.id) })))
  })

  api.get('/manufacturing/orders/:id', ...read, (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id < 1) return sendError(res, 400, 'رقم أمر التصنيع غير صالح.')
    const row = db.prepare(`SELECT o.*,c.name AS client_name,i.code AS invoice_code,i.total AS invoice_total
      FROM manufacturing_orders o JOIN clients c ON c.id=o.client_id
      LEFT JOIN invoices i ON i.id=o.sales_invoice_id WHERE o.id=? AND o.deleted_at IS NULL`).get(id)
    if (!row) return sendError(res, 404, 'أمر التصنيع غير موجود.')
    res.json({ ...row, assigned_technicians: JSON.parse(row.assigned_technicians || '[]'),
      materials_used: JSON.parse(row.materials_used || '[]'), offcuts_returned: JSON.parse(row.offcuts_returned || '[]'),
      design_files: db.prepare('SELECT id,original_name,extension,byte_size,created_at FROM manufacturing_design_files WHERE order_id=? ORDER BY id')
        .all(row.id) })
  })

  api.post('/manufacturing/orders', ...create, (req, res) => {
    const clientId = Number(req.body?.clientId)
    const productName = String(req.body?.productName || '').trim()
    const description = String(req.body?.description || '').trim()
    const machineType = String(req.body?.machineType || '')
    const targetDeliveryDate = req.body?.targetDeliveryDate ? String(req.body.targetDeliveryDate) : null
    const saleAmountCents = req.body?.saleAmount == null || req.body.saleAmount === ''
      ? 0 : parseCurrencyCents(req.body.saleAmount, { allowZero: true })
    const technicians = Array.isArray(req.body?.technicianIds) ? req.body.technicianIds.map(Number) : []
    if (!Number.isSafeInteger(clientId) || clientId < 1 || !productName || productName.length > 180
      || description.length > 3000 || !MACHINE_TYPES.has(machineType) || !validDateOrEmpty(targetDeliveryDate)
      || !Number.isSafeInteger(saleAmountCents) || saleAmountCents < 0
      || technicians.length > 100 || technicians.some((id) => !Number.isSafeInteger(id) || id < 1)
      || new Set(technicians).size !== technicians.length) {
      return sendError(res, 400, 'تحقق من العميل والمنتج والماكينة والتاريخ والفنيين المحددين.')
    }
    try {
      const order = db.transaction(() => {
        const client = db.prepare('SELECT id FROM clients WHERE id=? AND deleted_at IS NULL').get(clientId)
        if (!client) throw Object.assign(new Error('العميل غير موجود.'), { status: 404 })
        if (technicians.length) {
          const active = db.prepare(`SELECT id FROM employees WHERE active=1 AND deleted_at IS NULL AND id IN (${technicians.map(() => '?').join(',')})`)
            .all(...technicians)
          if (active.length !== technicians.length) throw new Error('يوجد فني غير موجود أو غير نشط.')
        }
        const code = nextCode('manufacturing_order', 'MFG')
        const id = db.prepare(`INSERT INTO manufacturing_orders(order_code,client_id,product_name,description,target_delivery_date,
            machine_type,assigned_technicians,created_by,sale_amount_cents)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(code, clientId, productName, description, targetDeliveryDate,
          machineType, JSON.stringify(technicians), req.user.id, saleAmountCents).lastInsertRowid
        const created = db.prepare(`SELECT o.*,c.name AS client_name FROM manufacturing_orders o JOIN clients c ON c.id=o.client_id WHERE o.id=?`).get(id)
        audit(req.user.id, 'create', 'manufacturing-order', id, code, null, created)
        return { ...created, assigned_technicians: technicians, materials_used: [], offcuts_returned: [] }
      })()
      res.status(201).json(order)
    } catch (error) { return sendError(res, error.status || 400, error.message) }
  })

  api.post('/manufacturing/orders/:id/designs', ...create, designUpload.single('file'), async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isSafeInteger(id) || id < 1) return sendError(res, 400, 'رقم أمر التصنيع غير صالح.')
    if (!req.file) return sendError(res, 400, 'اختر ملف تصميم صالحًا.')
    const extension = path.extname(req.file.originalname).toLowerCase()
    let destination = null
    try {
      const order = db.prepare('SELECT * FROM manufacturing_orders WHERE id=? AND deleted_at IS NULL').get(id)
      if (!order) return sendError(res, 404, 'أمر التصنيع غير موجود.')
      if (order.status === 'delivered_archived') return sendError(res, 409, 'لا يمكن إرفاق تصميم بعد أرشفة التسليم.')
      const designDirectory = path.join(storageRoot, 'Manufacturing', String(order.order_code).replace(/[^\p{L}\p{N}._-]+/gu, '_'), 'Designs')
      await ensureManufacturingDirectory(storageRoot, designDirectory, { fs, path, storagePathUsesSymlink })
      destination = path.join(designDirectory, `${Date.now()}-${crypto.randomUUID()}${extension}`)
      if (!path.relative(storageRoot, destination) || path.relative(storageRoot, destination).startsWith('..')) {
        throw new Error('مسار مرفقات التصنيع غير صالح.')
      }
      await fs.promises.writeFile(destination, req.file.buffer, { flag: 'wx', mode: 0o600 })
      const file = db.transaction(() => {
        const current = db.prepare('SELECT status FROM manufacturing_orders WHERE id=? AND deleted_at IS NULL').get(id)
        if (!current || current.status === 'delivered_archived') throw Object.assign(new Error('تغيرت حالة أمر التصنيع؛ لم يتم حفظ المرفق.'), { status: 409 })
        const storagePath = relativeStoragePath(destination)
        const fileId = db.prepare(`INSERT INTO manufacturing_design_files(order_id,storage_path,original_name,extension,byte_size,uploaded_by)
          VALUES (?,?,?,?,?,?)`).run(id, storagePath, path.basename(req.file.originalname).slice(0, 255), extension,
          req.file.size, req.user.id).lastInsertRowid
        audit(req.user.id, 'attach-design', 'manufacturing-order', id, `file=${fileId}`,
          null, { fileId, storagePath, originalName: path.basename(req.file.originalname), extension, byteSize: req.file.size })
        return { id: fileId, original_name: path.basename(req.file.originalname), extension, byte_size: req.file.size,
          downloadUrl: `/api/manufacturing/designs/${fileId}/download` }
      })()
      res.status(201).json(file)
    } catch (error) {
      if (destination) await fs.promises.rm(destination, { force: true }).catch(() => {})
      return sendError(res, error.status || 400, error.message)
    }
  })

  api.get('/manufacturing/designs/:fileId/download', ...read, async (req, res) => {
    const fileId = Number(req.params.fileId)
    if (!Number.isSafeInteger(fileId) || fileId < 1) return sendError(res, 400, 'رقم مرفق التصميم غير صالح.')
    const design = db.prepare(`SELECT d.* FROM manufacturing_design_files d
      JOIN manufacturing_orders o ON o.id=d.order_id WHERE d.id=? AND o.deleted_at IS NULL`).get(fileId)
    if (!design) return sendError(res, 404, 'ملف التصميم غير موجود.')
    try {
      const file = await safeStorageFile(design.storage_path)
      if (!file?.stats.isFile() || path.extname(file.absolutePath).toLowerCase() !== design.extension) {
        return sendError(res, 404, 'ملف التصميم غير موجود أو مساره غير آمن.')
      }
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Length', String(file.stats.size))
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(design.original_name))}`)
      res.setHeader('Cache-Control', 'private, no-store')
      fs.createReadStream(file.absolutePath).on('error', () => { if (!res.headersSent) sendError(res, 404, 'ملف التصميم غير موجود.') })
        .pipe(res)
    } catch { return sendError(res, 404, 'ملف التصميم غير موجود أو مساره غير آمن.') }
  })

  api.post('/manufacturing/orders/:id/materials', ...create, (req, res) => {
    const id = Number(req.params.id)
    const rawItems = req.body?.items
    if (!Number.isSafeInteger(id) || id < 1 || !Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 200) {
      return sendError(res, 400, 'أدخل قائمة خامات صالحة لأمر التصنيع.')
    }
    const items = rawItems.map((item) => ({
      sourceWarehouse: String(item?.sourceWarehouse || ''),
      materialId: item?.materialId == null || item.materialId === '' ? null : Number(item.materialId),
      offcutId: item?.offcutId == null || item.offcutId === '' ? null : Number(item.offcutId),
      quantity: Number(item?.quantity),
    }))
    if (items.some((item) => !validPositiveQuantity(item.quantity)
      || (item.sourceWarehouse === 'main' && (!Number.isSafeInteger(item.materialId) || item.materialId < 1
        || item.offcutId !== null || Math.abs(item.quantity - Math.round(item.quantity)) > 0.000001))
      || (item.sourceWarehouse === 'offcut' && (!Number.isSafeInteger(item.offcutId) || item.offcutId < 1
        || item.materialId !== null))
      || !['main', 'offcut'].includes(item.sourceWarehouse))) {
      return sendError(res, 400, 'استخدم وحدات صحيحة من المخزن الرئيسي أو كميات صالحة من البواقي.')
    }
    try {
      const result = db.transaction(() => {
        const order = db.prepare('SELECT * FROM manufacturing_orders WHERE id=? AND deleted_at IS NULL').get(id)
        if (!order) throw Object.assign(new Error('أمر التصنيع غير موجود.'), { status: 404 })
        if (order.status !== 'in_production') throw Object.assign(new Error('صرف الخامات متاح أثناء مرحلة التصنيع فقط.'), { status: 409 })
        const consumedItems = []
        for (const item of items) {
          let materialId = item.materialId
          let offcutId = item.offcutId
          let unitCostCents = 0
          let costCents = 0
          let movementId = null
          if (item.sourceWarehouse === 'main') {
            const material = db.prepare('SELECT * FROM materials WHERE id=? AND active=1 AND deleted_at IS NULL').get(materialId)
            if (!material) throw Object.assign(new Error('الخامة الرئيسية غير موجودة أو غير نشطة.'), { status: 404 })
            assertMaterialUnlocked(materialId)
            if (Number(material.stock) + 0.000001 < item.quantity) throw Object.assign(new Error(`رصيد المخزن الرئيسي لا يكفي للخامة ${material.code}.`), { status: 409 })
            const movementInsert = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,source_type,source_id)
              VALUES (?,'issue',?,?,?,?,'main','manufacturing_order',?)`)
            movementId = movementInsert.run(materialId, -item.quantity, order.order_code,
              `صرف خامة لأمر التصنيع ${order.order_code}`, req.user.id, String(id)).lastInsertRowid
            const fifo = consumeInventoryLots(materialId, 'main', item.quantity, movementId)
            unitCostCents = item.quantity > 0 ? Math.round(fifo.totalCostCents / item.quantity) : 0
            costCents = fifo.totalCostCents
            db.prepare('UPDATE materials SET stock=stock-? WHERE id=?').run(item.quantity, materialId)
          } else {
            if (db.prepare('SELECT 1 FROM stock_count_offcut_items WHERE offcut_id=? AND released_at IS NULL').get(offcutId)) {
              throw Object.assign(new Error(`الباقي ${offcutId} مقفل ضمن محضر جرد مفتوح.`), { status: 409 })
            }
            const offcut = db.prepare(`SELECT * FROM secondary_warehouse_offcuts WHERE id=? AND status='available'`).get(offcutId)
            if (!offcut || item.quantity > Number(offcut.quantity) + 0.000001) {
              throw Object.assign(new Error(`الباقي ${offcutId} غير متاح أو رصيده غير كافٍ.`), { status: 409 })
            }
            materialId = offcut.material_id || null
            const linkedMaterial = materialId ? db.prepare('SELECT * FROM materials WHERE id=? AND deleted_at IS NULL').get(materialId) : null
            unitCostCents = Number(offcut.unit_cost_cents || 0) || Math.round(Number(linkedMaterial?.unit_cost || 0) * 100)
            costCents = Math.round(item.quantity * unitCostCents)
            const remaining = Number((Number(offcut.quantity) - item.quantity).toFixed(6))
            db.prepare('UPDATE secondary_warehouse_offcuts SET quantity=?,status=? WHERE id=? AND status=\'available\'')
              .run(remaining > 0.000001 ? remaining : offcut.quantity,
                remaining > 0.000001 ? 'available' : 'consumed', offcutId)
            if (materialId) {
              movementId = db.prepare(`INSERT INTO inventory_movements(material_id,kind,quantity,reference,notes,created_by,warehouse,source_type,source_id)
                VALUES (?,'issue',?,?,?,?,'offcut','manufacturing_order',?)`).run(materialId, -item.quantity, order.order_code,
                `استهلاك باقي ${offcut.name} لأمر التصنيع ${order.order_code}`, req.user.id, String(id)).lastInsertRowid
            }
          }
          const consumptionId = db.prepare(`INSERT INTO manufacturing_material_consumptions(order_id,source_warehouse,material_id,offcut_id,
              quantity,unit_cost_cents,movement_id,created_by)
            VALUES (?,?,?,?,?,?,?,?)`).run(id, item.sourceWarehouse, materialId, offcutId, item.quantity, unitCostCents, movementId, req.user.id).lastInsertRowid
          let journalEntryId = null
          if (costCents > 0) {
            const journal = queueJournalEntry(db, {
              sourceType: 'manufacturing_material_issue', sourceId: consumptionId,
              sourceKey: `manufacturing-material-issue:${consumptionId}`,
              description: `صرف خامة لأمر التصنيع ${order.order_code}`, createdBy: req.user.id,
              postings: [
                { mappingKey: 'work_order_wip', debitCents: costCents, description: `مواد تحت التشغيل ${order.order_code}` },
                { mappingKey: 'inventory', creditCents: costCents, description: `صرف مخزون ${order.order_code}` },
              ],
            })
            journalEntryId = journal.id
          }
          consumedItems.push({ id: consumptionId, sourceWarehouse: item.sourceWarehouse, materialId, offcutId,
            quantity: item.quantity, unitCostCents, costCents, movementId, journalEntryId })
        }
        const materialsUsed = [...JSON.parse(order.materials_used || '[]'), ...consumedItems]
        db.prepare('UPDATE manufacturing_orders SET materials_used=?,updated_at=CURRENT_TIMESTAMP WHERE id=?')
          .run(JSON.stringify(materialsUsed), id)
        audit(req.user.id, 'issue-materials', 'manufacturing-order', id, order.order_code,
          { materials_used: JSON.parse(order.materials_used || '[]') }, { materials_used: materialsUsed })
        return { id, orderCode: order.order_code, materialsUsed: consumedItems }
      })()
      res.status(201).json(result)
    } catch (error) { return sendError(res, error.status || 400, error.message) }
  })

  api.post('/manufacturing/orders/:id/ready', ...create, (req, res) => {
    const id = Number(req.params.id)
    const requested = Array.isArray(req.body?.offcuts) ? req.body.offcuts : []
    if (!Number.isSafeInteger(id) || id < 1 || requested.length > 1000) return sendError(res, 400, 'أمر التصنيع أو قائمة البواقي غير صالحة.')
    const offcuts = requested.map((item) => ({
      materialId: item?.materialId == null || item.materialId === '' ? null : Number(item.materialId),
      name: String(item?.name || '').trim(), dimensions: String(item?.dimensions || '').trim(),
      quantity: Number(item?.quantity), unit: String(item?.unit || '').trim(), notes: String(item?.notes || '').trim(),
    }))
    if (offcuts.some((item) => (item.materialId !== null && (!Number.isSafeInteger(item.materialId) || item.materialId < 1))
      || !item.name || item.name.length > 150 || item.dimensions.length > 120
      || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1_000_000
      || item.unit.length > 40 || item.notes.length > 500)) {
      return sendError(res, 400, 'تحقق من اسم كل باقي وأبعاده وكميته ووحدته.')
    }
    try {
      const result = db.transaction(() => {
        const order = db.prepare(`SELECT * FROM manufacturing_orders WHERE id=? AND deleted_at IS NULL`).get(id)
        if (!order) throw Object.assign(new Error('أمر التصنيع غير موجود.'), { status: 404 })
        if (order.status !== 'in_production') throw Object.assign(new Error('لا يمكن نقل هذا الأمر إلى مرحلة الجاهزية.'), { status: 409 })
        const materialsUsed = JSON.parse(order.materials_used || '[]')
        const usedByMaterial = new Map()
        for (const use of materialsUsed) {
          if (use.materialId) {
            const current = usedByMaterial.get(Number(use.materialId)) || { quantity: 0, costCents: 0 }
            current.quantity += Number(use.quantity || 0)
            current.costCents += Number(use.costCents || 0)
            usedByMaterial.set(Number(use.materialId), current)
          }
        }
        for (const offcut of offcuts) {
          if (offcut.materialId && !db.prepare('SELECT 1 FROM materials WHERE id=? AND deleted_at IS NULL').get(offcut.materialId)) {
            throw new Error('الخامة المرتبطة بالباقي غير موجودة.')
          }
          if (offcut.materialId && offcut.quantity > (usedByMaterial.get(offcut.materialId)?.quantity || 0) + 0.000001) {
            throw Object.assign(new Error('كمية الباقي المرتبط بالخامة تتجاوز كمية الخامة المصروفة لأمر التصنيع.'), { status: 409 })
          }
        }
        const returned = []
        let totalReturnCostCents = 0
        const insert = db.prepare(`INSERT INTO secondary_warehouse_offcuts(material_id,name,dimensions,quantity,unit,notes,unit_cost_cents)
          VALUES (?,?,?,?,?,?,?)`)
        for (const item of offcuts) {
          const material = item.materialId ? db.prepare('SELECT unit_cost FROM materials WHERE id=?').get(item.materialId) : null
          const consumed = item.materialId ? usedByMaterial.get(item.materialId) : null
          const unitCostCents = consumed?.quantity > 0
            ? Math.round(consumed.costCents / consumed.quantity)
            : Math.max(0, Math.round(Number(material?.unit_cost || 0) * 100))
          const costCents = item.materialId ? Math.round(item.quantity * unitCostCents) : 0
          const offcutId = insert.run(item.materialId, item.name, item.dimensions, item.quantity, item.unit,
            `ناتج تصنيع ${order.order_code}${item.notes ? ` — ${item.notes}` : ''}`,
            unitCostCents).lastInsertRowid
          returned.push({ id: offcutId, ...item, unitCostCents, costCents })
          totalReturnCostCents += costCents
        }
        db.prepare(`UPDATE manufacturing_orders SET status='ready',offcuts_returned=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
          .run(JSON.stringify(returned), id)
        const updated = db.prepare('SELECT * FROM manufacturing_orders WHERE id=?').get(id)
        let returnJournalEntryId = null
        if (totalReturnCostCents > 0) {
          const journal = queueJournalEntry(db, {
            sourceType: 'manufacturing_offcut_return', sourceId: id,
            sourceKey: `manufacturing-offcut-return:${id}`,
            description: `إرجاع بواقي خامات من أمر التصنيع ${order.order_code}`, createdBy: req.user.id,
            postings: [
              { mappingKey: 'inventory', debitCents: totalReturnCostCents, description: `إضافة بواقي ${order.order_code}` },
              { mappingKey: 'work_order_wip', creditCents: totalReturnCostCents, description: `تخفيض تحت التشغيل ${order.order_code}` },
            ],
          })
          returnJournalEntryId = journal.id
        }
        audit(req.user.id, 'ready', 'manufacturing-order', id, order.order_code,
          { status: order.status, offcutsReturned: JSON.parse(order.offcuts_returned || '[]') },
          { status: updated.status, offcutsReturned: returned, returnJournalEntryId })
        return { id, orderCode: order.order_code, status: updated.status, offcuts: returned, returnJournalEntryId }
      })()
      res.json(result)
    } catch (error) { return sendError(res, error.status || 400, error.message) }
  })

  api.post('/manufacturing/orders/:id/deliver', requireAuth, allowRoles('admin', 'sales'), (req, res) => {
    const id = Number(req.params.id)
    const rawInvoiceId = req.body?.invoiceId
    const createInvoice = req.body?.createInvoice === true
    const hasInvoiceId = rawInvoiceId !== undefined && rawInvoiceId !== null && rawInvoiceId !== ''
    const invoiceId = hasInvoiceId ? Number(rawInvoiceId) : null
    if (!Number.isSafeInteger(id) || id < 1 || createInvoice === hasInvoiceId
      || (hasInvoiceId && (!Number.isSafeInteger(invoiceId) || invoiceId < 1))) {
      return sendError(res, 400, 'اختر فاتورة قائمة أو اطلب إنشاء فاتورة مبيعات جديدة.')
    }
    try {
      const result = db.transaction(() => {
        const order = db.prepare(`SELECT * FROM manufacturing_orders WHERE id=? AND deleted_at IS NULL`).get(id)
        if (!order) throw Object.assign(new Error('أمر التصنيع غير موجود.'), { status: 404 })
        if (order.status !== 'ready') throw Object.assign(new Error('يجب أن يكون أمر التصنيع جاهزًا قبل التسليم.'), { status: 409 })
        let invoice
        if (createInvoice) {
          const totalCents = Number(order.sale_amount_cents || 0)
          if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
            throw Object.assign(new Error('أدخل قيمة بيع موجبة في أمر التصنيع قبل إنشاء فاتورة التسليم.'), { status: 400 })
          }
          const code = nextCode('invoice', 'INV')
          const total = currencyAmountFromCents(totalCents)
          const createdInvoiceId = db.prepare(`INSERT INTO invoices(code,kind,client_id,total,paid_total,remaining,payment_status,
              notes,created_by,status,manufacturing_order_id,subtotal_cents,tax_cents,tax_rate_basis_points,sale_type)
            VALUES (?,'sales',?,?,0,?,'unpaid',?,?,'approved',?,?,0,0,'credit')`)
            .run(code, order.client_id, total, total, `فاتورة تسليم أمر التصنيع ${order.order_code}`, req.user.id,
              order.id, totalCents).lastInsertRowid
          const journal = queueJournalEntry(db, {
            sourceType: 'sales_invoice', sourceId: createdInvoiceId, sourceKey: `sales-invoice:${createdInvoiceId}`,
            description: `فاتورة مبيعات أمر التصنيع ${order.order_code} — ${code}`, createdBy: req.user.id,
            postings: [
              { mappingKey: 'customer_receivables', debitCents: totalCents, description: `ذمم فاتورة ${code}` },
              { mappingKey: 'sales_revenue', creditCents: totalCents, description: `مبيعات ${code}` },
            ],
          })
          invoice = { id: createdInvoiceId, code, client_id: order.client_id, kind: 'sales', total, autoCreated: true }
          audit(req.user.id, 'sale', 'invoice', createdInvoiceId, code, null,
            { kind: 'sales', clientId: order.client_id, manufacturingOrderId: order.id, total, paidTotal: 0,
              remaining: total, paymentStatus: 'unpaid', saleType: 'credit', journalEntryId: journal.id })
        } else {
          invoice = db.prepare(`SELECT id,code,client_id,kind,total FROM invoices WHERE id=? AND deleted_at IS NULL`).get(invoiceId)
          if (!invoice || invoice.kind !== 'sales' || Number(invoice.client_id) !== Number(order.client_id)) {
            throw Object.assign(new Error('يجب اختيار فاتورة مبيعات سارية للعميل نفسه.'), { status: 400 })
          }
        }
        const materialsUsed = JSON.parse(order.materials_used || '[]')
        const offcutsReturned = JSON.parse(order.offcuts_returned || '[]')
        const materialCostCents = materialsUsed.reduce((sum, item) => sum + Math.max(0, Number(item.costCents || 0)), 0)
        const offcutReturnCostCents = offcutsReturned.reduce((sum, item) => sum + Math.max(0, Number(item.costCents || 0)), 0)
        const cogsCents = Math.max(0, materialCostCents - offcutReturnCostCents)
        let cogsJournalEntryId = null
        if (cogsCents > 0) {
          const journal = queueJournalEntry(db, {
            sourceType: 'manufacturing_cogs', sourceId: id,
            sourceKey: `manufacturing-cogs:${id}`,
            description: `إقفال تكلفة التصنيع ${order.order_code}`, createdBy: req.user.id,
            postings: [
              { mappingKey: 'work_order_cogs', debitCents: cogsCents, description: `تكلفة مبيعات ${order.order_code}` },
              { mappingKey: 'work_order_wip', creditCents: cogsCents, description: `إقفال تحت التشغيل ${order.order_code}` },
            ],
          })
          cogsJournalEntryId = journal.id
        }
        db.prepare(`UPDATE manufacturing_orders SET status='delivered_archived',sales_invoice_id=?,delivered_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(invoice.id, id)
        audit(req.user.id, 'deliver', 'manufacturing-order', id, order.order_code,
          { status: order.status, salesInvoiceId: order.sales_invoice_id },
          { status: 'delivered_archived', salesInvoiceId: invoice.id, invoiceCode: invoice.code,
            materialCostCents, offcutReturnCostCents, cogsCents, cogsJournalEntryId })
        return { id, orderCode: order.order_code, status: 'delivered_archived', salesInvoiceId: invoice.id,
          invoiceCode: invoice.code, invoiceTotal: invoice.total, invoiceAutoCreated: Boolean(invoice.autoCreated),
          materialCostCents, offcutReturnCostCents, cogsCents, cogsJournalEntryId }
      })()
      res.json(result)
    } catch (error) { return sendError(res, error.status || 400, error.message) }
  })
}

module.exports = { registerManufacturingRoutes, MACHINE_TYPES, STATUSES }
