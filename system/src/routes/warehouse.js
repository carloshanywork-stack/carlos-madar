const SCRAP_REVENUE_CATEGORY = 'إيرادات بيع خردة ومخلفات تشغيل'

function registerWarehouseRoutes(api, {
  db, requireAuth, allowRoles, sendError, parseCurrencyCents, currencyAmountFromCents, queueJournalEntry,
}) {
  const readAccess = [requireAuth, allowRoles('admin', 'operations', 'purchasing')]
  const writeAccess = [requireAuth, allowRoles('admin')]

  api.get('/warehouse/offcuts', ...readAccess, (req, res) => {
    const status = String(req.query.status || 'available')
    if (!['available', 'consumed', 'scrapped', 'all'].includes(status)) return sendError(res, 400, 'حالة المخزن الجانبي غير صالحة.')
    const rows = db.prepare(`SELECT o.*,m.code AS material_code,m.name AS material_name
      FROM secondary_warehouse_offcuts o LEFT JOIN materials m ON m.id=o.material_id
      ${status === 'all' ? '' : 'WHERE o.status=?'} ORDER BY o.created_at DESC,o.id DESC`).all(...(status === 'all' ? [] : [status]))
    res.json(rows)
  })

  api.post('/warehouse/offcuts', ...writeAccess, (req, res) => {
    const materialId = req.body?.materialId == null || req.body.materialId === '' ? null : Number(req.body.materialId)
    const name = String(req.body?.name || '').trim()
    const dimensions = String(req.body?.dimensions || '').trim()
    const quantity = Number(req.body?.quantity)
    const unit = String(req.body?.unit || '').trim()
    const notes = String(req.body?.notes || '').trim()
    if ((materialId !== null && (!Number.isSafeInteger(materialId) || materialId < 1))
      || !name || name.length > 150 || dimensions.length > 120 || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000
      || unit.length > 40 || notes.length > 500) return sendError(res, 400, 'بيانات قطعة المخزن الجانبي غير صالحة.')
    try {
      const row = db.transaction(() => {
        if (materialId && !db.prepare('SELECT 1 FROM materials WHERE id=? AND deleted_at IS NULL').get(materialId)) {
          throw new Error('الخامة المحددة غير موجودة.')
        }
        const result = db.prepare(`INSERT INTO secondary_warehouse_offcuts(material_id,name,dimensions,quantity,unit,notes)
          VALUES (?,?,?,?,?,?)`).run(materialId, name, dimensions, quantity, unit, notes)
        const created = db.prepare('SELECT * FROM secondary_warehouse_offcuts WHERE id=?').get(result.lastInsertRowid)
        db.prepare('INSERT INTO audit_log(user_id,action,entity,entity_id,details,new_values) VALUES (?,?,?,?,?,?)')
          .run(req.user.id, 'create-offcut', 'secondary_warehouse_offcut', created.id, '', JSON.stringify(created))
        return created
      })()
      res.status(201).json(row)
    } catch (error) { return sendError(res, 400, error.message) }
  })

  api.post('/warehouse/scrap-sales', ...writeAccess, (req, res) => {
    const amountCents = parseCurrencyCents(req.body?.amount)
    const notes = String(req.body?.notes || '').trim()
    const rawItems = req.body?.items
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || notes.length > 500
      || !Array.isArray(rawItems) || rawItems.length < 1 || rawItems.length > 500) {
      return sendError(res, 400, 'أدخل قيمة بيع صحيحة واختر قطعة خردة واحدة على الأقل.')
    }
    const items = rawItems.map((item) => ({ offcutId: Number(item?.offcutId), quantity: Number(item?.quantity) }))
    if (items.some((item) => !Number.isSafeInteger(item.offcutId) || item.offcutId < 1
      || !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 1_000_000)
      || new Set(items.map(({ offcutId }) => offcutId)).size !== items.length) {
      return sendError(res, 400, 'كميات أو معرفات الخردة غير صالحة أو مكررة.')
    }
    try {
      const sale = db.transaction(() => {
        const before = []
        for (const item of items) {
          if (db.prepare(`SELECT 1 FROM stock_count_offcut_items WHERE offcut_id=? AND released_at IS NULL`).get(item.offcutId)) {
            throw Object.assign(new Error(`القطعة ${item.offcutId} مقفلة في محضر جرد مفتوح.`), { status: 409 })
          }
          const offcut = db.prepare(`SELECT * FROM secondary_warehouse_offcuts
            WHERE id=? AND status='available'`).get(item.offcutId)
          if (!offcut || item.quantity > Number(offcut.quantity) + 1e-9) {
            throw Object.assign(new Error(`القطعة ${item.offcutId} غير متاحة أو كميتها غير كافية.`), { status: 409 })
          }
          before.push({ offcut, quantitySold: item.quantity })
        }
        const treasuryId = db.prepare(`INSERT INTO treasury_transactions(kind,amount,category,reference,notes,created_by)
          VALUES ('income',?,?,?,?,?)`).run(currencyAmountFromCents(amountCents), SCRAP_REVENUE_CATEGORY,
          `SCRAP-${Date.now()}`, notes, req.user.id).lastInsertRowid
        const mappingKey = `treasury_income:${treasuryId}`
        db.prepare('INSERT OR IGNORE INTO account_mappings(mapping_key,account_id,approved) VALUES (?,NULL,0)').run(mappingKey)
        const saleId = db.prepare(`INSERT INTO secondary_warehouse_scrap_sales(amount_cents,treasury_transaction_id,created_by,notes)
          VALUES (?,?,?,?)`).run(amountCents, treasuryId, req.user.id, notes).lastInsertRowid
        const insertItem = db.prepare(`INSERT INTO secondary_warehouse_scrap_sale_items(sale_id,offcut_id,quantity)
          VALUES (?,?,?)`)
        const updateOffcut = db.prepare(`UPDATE secondary_warehouse_offcuts SET quantity=?,status=?
          WHERE id=? AND status='available'`)
        const changes = []
        for (const { offcut, quantitySold } of before) {
          const remaining = Number((Number(offcut.quantity) - quantitySold).toFixed(6))
          const status = remaining <= 0 ? 'scrapped' : 'available'
          insertItem.run(saleId, offcut.id, quantitySold)
          // A fully cleared row retains its historical sold quantity; no zero-quantity stock row is created.
          updateOffcut.run(status === 'scrapped' ? offcut.quantity : remaining, status, offcut.id)
          changes.push({ id: offcut.id, name: offcut.name, dimensions: offcut.dimensions,
            quantityBefore: offcut.quantity, quantitySold, quantityAfter: status === 'scrapped' ? 0 : remaining, status })
        }
        const journal = queueJournalEntry(db, {
          sourceType: 'treasury_transaction', sourceId: treasuryId, sourceKey: `treasury-entry:${treasuryId}`,
          description: SCRAP_REVENUE_CATEGORY, createdBy: req.user.id,
          postings: [
            { mappingKey: 'factory_cashbox', debitCents: amountCents, description: SCRAP_REVENUE_CATEGORY },
            { mappingKey, creditCents: amountCents, description: SCRAP_REVENUE_CATEGORY },
          ],
        })
        const record = db.prepare(`SELECT s.*,t.kind AS treasury_kind,t.amount AS treasury_amount,t.category AS treasury_category
          FROM secondary_warehouse_scrap_sales s JOIN treasury_transactions t ON t.id=s.treasury_transaction_id
          WHERE s.id=?`).get(saleId)
        db.prepare(`INSERT INTO audit_log(user_id,action,entity,entity_id,details,old_values,new_values)
          VALUES (?,?,?,?,?,?,?)`)
          .run(req.user.id, 'sell-scrap', 'secondary_warehouse_scrap_sale', saleId, `treasury_transaction=${treasuryId}`,
            JSON.stringify(changes.map((change) => ({ offcutId: change.id, quantity: change.quantityBefore, status: 'available' }))),
            JSON.stringify({ ...record, items: changes, journalEntryId: journal.id }))
        return { ...record, items: changes, journalEntryId: journal.id, journalStatus: journal.status }
      })()
      res.status(201).json(sale)
    } catch (error) { return sendError(res, error.status || (/UNIQUE/.test(error.message) ? 409 : 400), error.message) }
  })
}

module.exports = { registerWarehouseRoutes, SCRAP_REVENUE_CATEGORY }
