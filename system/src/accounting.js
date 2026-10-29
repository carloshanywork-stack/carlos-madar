const { createHash } = require('node:crypto')

function normalizedMaterialText(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('ar')
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي')
}

function materialVariantKey({ name, specification = '', unit, unitCostCents }) {
  if (!Number.isSafeInteger(unitCostCents) || unitCostCents < 0) throw new Error('سعر الصنف غير صالح.')
  const identity = [normalizedMaterialText(name), normalizedMaterialText(specification), normalizedMaterialText(unit), unitCostCents].join('|')
  return createHash('sha256').update(identity).digest('hex')
}

function salesTaxCents(subtotalCents, rateBasisPoints) {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 0
    || !Number.isSafeInteger(rateBasisPoints) || rateBasisPoints < 0 || rateBasisPoints > 100_000) {
    throw new Error('بيانات ضريبة المبيعات غير صالحة.')
  }
  const numerator = BigInt(subtotalCents) * BigInt(rateBasisPoints)
  const denominator = 10_000n // Basis points: 10,000 = 100%.
  const taxIncrementCents = 10n // EGP 0.10; round any fractional increment upward.
  const taxCents = ((numerator + denominator * taxIncrementCents - 1n)
    / (denominator * taxIncrementCents)) * taxIncrementCents
  if (taxCents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('قيمة الضريبة تتجاوز الحد المدعوم.')
  return Number(taxCents)
}

function roundRatio(numerator, denominator) {
  if (numerator < 0n || denominator <= 0n) throw new Error('النسبة المالية غير صالحة.')
  return Number((numerator + denominator / 2n) / denominator)
}

function calculatePayroll({
  baseSalaryCents,
  ordinaryOvertimeMinutes = 0,
  holidayOvertimeMinutes = 0,
  bonusCents = 0,
  deductionCents = 0,
  outstandingAdvanceCents = 0,
  cashPaidCents = 0,
}) {
  const nonnegative = [baseSalaryCents, ordinaryOvertimeMinutes, holidayOvertimeMinutes,
    bonusCents, deductionCents, outstandingAdvanceCents, cashPaidCents]
  if (nonnegative.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error('مدخلات الرواتب يجب أن تكون أعدادًا صحيحة غير سالبة.')

  const ordinaryOvertimeCents = roundRatio(BigInt(baseSalaryCents) * BigInt(ordinaryOvertimeMinutes) * 3n, 270n * 60n * 2n)
  const holidayOvertimeCents = roundRatio(BigInt(baseSalaryCents) * BigInt(holidayOvertimeMinutes) * 2n, 270n * 60n)
  const grossCents = baseSalaryCents + ordinaryOvertimeCents + holidayOvertimeCents + bonusCents
  if (!Number.isSafeInteger(grossCents) || deductionCents > grossCents) throw new Error('الخصومات تتجاوز إجمالي استحقاق الشهر.')
  const netEntitlementCents = grossCents - deductionCents
  const advancesAppliedCents = Math.min(outstandingAdvanceCents, Math.max(0, netEntitlementCents - cashPaidCents))
  const unpaidSalaryCents = Math.max(0, netEntitlementCents - advancesAppliedCents - cashPaidCents)
  const overpaymentCents = Math.max(0, cashPaidCents - netEntitlementCents)
  const advanceBalanceCents = outstandingAdvanceCents - advancesAppliedCents + overpaymentCents
  return {
    ordinaryOvertimeCents,
    holidayOvertimeCents,
    netEntitlementCents,
    advancesAppliedCents,
    cashPaidCents,
    unpaidSalaryCents,
    overpaymentCents,
    advanceBalanceCents,
  }
}

function queueJournalEntry(db, {
  sourceType,
  sourceId,
  sourceKey,
  description = '',
  postings,
  createdBy = null,
  createdAt = null,
  reversesEntryId = null,
}) {
  if (!Array.isArray(postings) || postings.length < 2) throw new Error('القيد يحتاج إلى طرفي مدين ودائن على الأقل.')
  const existing = db.prepare('SELECT id,status FROM journal_entries WHERE source_key=?').get(sourceKey)
  if (existing) return { id: existing.id, status: existing.status, replayed: true }
  for (const line of postings) {
    if (!line || (!line.mappingKey && !Number.isSafeInteger(line.accountId))) throw new Error('حساب أحد أطراف القيد غير محدد.')
    const debit = Number(line.debitCents || 0)
    const credit = Number(line.creditCents || 0)
    if (!Number.isSafeInteger(debit) || debit < 0 || !Number.isSafeInteger(credit) || credit < 0 || (debit > 0) === (credit > 0)) {
      throw new Error('قيمة أحد أطراف القيد غير صالحة.')
    }
  }
  const id = db.prepare(`INSERT INTO journal_entries(source_type,source_id,source_key,description,status,posting_payload,created_by,reverses_entry_id,created_at)
    VALUES (?,?,?,?,'pending_configuration',?,?,?,COALESCE(?,CURRENT_TIMESTAMP))`)
    .run(String(sourceType), String(sourceId), String(sourceKey), String(description), JSON.stringify(postings), createdBy,
      reversesEntryId, createdAt).lastInsertRowid
  const status = tryPostJournalEntry(db, id)
  if (createdAt && status === 'posted') db.prepare('UPDATE journal_entries SET posted_at=? WHERE id=?').run(createdAt, id)
  return { id, status, replayed: false }
}

function queueInventoryIssueJournal(db, {
  issueId,
  sourceKey = null,
  classification,
  grossCostCents,
  offcutCostCents = 0,
  description = '',
  createdBy = null,
  createdAt = null,
}) {
  if (!Number.isSafeInteger(Number(issueId)) || Number(issueId) < 1) throw new Error('رقم صرف المخزون غير صالح.')
  const gross = Number(grossCostCents)
  const offcut = Number(offcutCostCents)
  if (!Number.isSafeInteger(gross) || gross < 0 || !Number.isSafeInteger(offcut) || offcut < 0 || offcut > gross) {
    throw new Error('تكلفة صرف المخزون غير صالحة.')
  }
  if (classification !== 'order' && classification !== 'general') throw new Error('تصنيف صرف المخزون غير صالح.')
  if (gross === 0) return { id: null, status: 'zero_cost', replayed: false }
  const cogs = gross - offcut
  const postings = []
  if (cogs > 0) postings.push({
    mappingKey: classification === 'order' ? 'work_order_wip' : 'inventory_consumption',
    debitCents: cogs,
    description: description || (classification === 'order' ? 'مواد تحت التشغيل' : 'استهلاك مواد عام'),
  })
  if (offcut > 0) postings.push({ mappingKey: 'inventory', debitCents: offcut, description: 'إعادة تصنيف قيمة الباقي القابل للاستخدام إلى المخزون' })
  postings.push({ mappingKey: 'inventory', creditCents: gross, description: 'صرف مخزون FIFO' })
  return queueJournalEntry(db, {
    sourceType: 'inventory_issue', sourceId: issueId, sourceKey: sourceKey || `inventory-issue:${issueId}`,
    description: description || (classification === 'order' ? 'صرف مواد إلى تحت التشغيل لأمر التشغيل' : 'استهلاك مواد عام'),
    postings, createdBy, createdAt,
  })
}

function queueWorkOrderCogsRecognitionJournal(db, {
  orderId,
  issueId,
  cogsCents,
  description = '',
  createdBy = null,
  createdAt = null,
}) {
  if (!Number.isSafeInteger(Number(orderId)) || Number(orderId) < 1) throw new Error('رقم أمر التشغيل غير صالح.')
  if (!Number.isSafeInteger(Number(issueId)) || Number(issueId) < 1) throw new Error('رقم صرف المخزون غير صالح.')
  const amount = Number(cogsCents)
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('قيمة تكلفة أمر التشغيل غير صالحة.')
  if (amount === 0) return { id: null, status: 'zero_cost', replayed: false }
  return queueJournalEntry(db, {
    sourceType: 'work_order_cogs_recognition', sourceId: orderId, sourceKey: `work-order-cogs:${orderId}:issue:${issueId}`,
    description: description || `تحويل تكلفة صرف المخزون ${issueId} لأمر التشغيل ${orderId} من تحت التشغيل إلى تكلفة المبيعات`,
    postings: [
      { mappingKey: 'work_order_cogs', debitCents: amount, description: 'تكلفة مواد أمر التشغيل المكتمل' },
      { mappingKey: 'work_order_wip', creditCents: amount, description: 'إقفال مواد تحت التشغيل' },
    ],
    createdBy, createdAt,
  })
}

function recognizeCompletedWorkOrderIssues(db, { orderId = null } = {}) {
  const requiredTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('orders','inventory_issues','journal_entries')")
    .all().map((row) => row.name)
  if (requiredTables.length !== 3) return 0
  const orders = orderId == null
    ? db.prepare("SELECT id,archived_at FROM orders WHERE status='archived' AND deleted_at IS NULL ORDER BY id").all()
    : db.prepare("SELECT id,archived_at FROM orders WHERE id=? AND status='archived' AND deleted_at IS NULL").all(Number(orderId))
  const issuesForOrder = db.prepare(`SELECT ii.id,ii.order_id,ii.cogs_cents,ii.created_by,ii.created_at,
      je.status AS journal_status,je.posting_payload
    FROM inventory_issues ii LEFT JOIN journal_entries je ON je.id=ii.journal_entry_id
    WHERE ii.order_id=? AND ii.cogs_cents>0 ORDER BY ii.created_at,ii.id`)
  let recognized = 0
  for (const order of orders) {
    for (const issue of issuesForOrder.all(order.id)) {
      if (issue.journal_status !== 'posted') continue
      const postings = JSON.parse(issue.posting_payload || '[]')
      const wipDebitCents = postings.reduce((total, line) => total
        + (line.mappingKey === 'work_order_wip' ? Number(line.debitCents || 0) : 0), 0)
      if (wipDebitCents === 0) continue // Legacy entries posted directly to COGS are already recognized.
      if (wipDebitCents !== Number(issue.cogs_cents)) {
        throw new Error(`قيمة مواد تحت التشغيل لا تطابق سجل الصرف ${issue.id}.`)
      }
      const journal = queueWorkOrderCogsRecognitionJournal(db, {
        orderId: order.id,
        issueId: issue.id,
        cogsCents: issue.cogs_cents,
        createdBy: issue.created_by,
        createdAt: order.archived_at || issue.created_at,
      })
      if (journal.id && !journal.replayed) recognized += 1
    }
  }
  return recognized
}

function tryPostJournalEntry(db, journalEntryId) {
  const entry = db.prepare('SELECT * FROM journal_entries WHERE id=?').get(journalEntryId)
  if (!entry || entry.status !== 'pending_configuration') return entry?.status || null
  const postings = JSON.parse(entry.posting_payload || '[]')
  const resolved = []
  for (const posting of postings) {
    let accountId = posting.accountId || null
    if (posting.mappingKey) {
      const mapping = db.prepare(`SELECT am.account_id,am.approved,a.active FROM account_mappings am
        LEFT JOIN accounts a ON a.id=am.account_id WHERE am.mapping_key=?`).get(posting.mappingKey)
      if (!mapping?.account_id || mapping.approved !== 1 || mapping.active !== 1) return 'pending_configuration'
      accountId = mapping.account_id
    } else {
      const account = db.prepare('SELECT active FROM accounts WHERE id=?').get(accountId)
      if (!account?.active) return 'pending_configuration'
    }
    resolved.push({ ...posting, accountId })
  }
  const debitCents = resolved.reduce((sum, line) => sum + Number(line.debitCents || 0), 0)
  const creditCents = resolved.reduce((sum, line) => sum + Number(line.creditCents || 0), 0)
  if (!Number.isSafeInteger(debitCents) || debitCents <= 0 || debitCents !== creditCents) {
    throw new Error(`قيد غير متوازن: ${entry.source_key}`)
  }
  const insertLine = db.prepare(`INSERT INTO journal_lines(journal_entry_id,line_number,account_id,description,debit_cents,credit_cents)
    VALUES (?,?,?,?,?,?)`)
  resolved.forEach((line, index) => insertLine.run(journalEntryId, index + 1, line.accountId,
    String(line.description || ''), Number(line.debitCents || 0), Number(line.creditCents || 0)))
  db.prepare(`UPDATE journal_entries SET status='posted',total_debit_cents=?,total_credit_cents=?,posted_at=CURRENT_TIMESTAMP
    WHERE id=? AND status='pending_configuration'`).run(debitCents, creditCents, journalEntryId)
  return 'posted'
}

function retryPendingJournalEntries(db) {
  const pending = db.prepare(`SELECT id FROM journal_entries WHERE status='pending_configuration' ORDER BY id`).all()
  let posted = 0
  for (const { id } of pending) if (tryPostJournalEntry(db, id) === 'posted') posted += 1
  recognizeCompletedWorkOrderIssues(db)
  return posted
}

function setAccountMapping(db, { mappingKey, accountId, userId }) {
  const key = String(mappingKey || '').trim()
  if (!/^(factory_cashbox|customer_receivables|inventory|employee_advances|sales_tax_payable|salary_payable|owner_funding|opening_equity|sales_revenue|payroll_expense|inventory_variance|work_order_wip|work_order_cogs|inventory_consumption|expense_category:[1-9]\d*|treasury_(income|expense):[1-9]\d*)$/.test(key)) {
    throw new Error('مفتاح ربط الحساب غير صالح.')
  }
  const account = db.prepare('SELECT id FROM accounts WHERE id=? AND active=1').get(accountId)
  if (!account) throw new Error('اختر حسابًا نشطًا من دليل الحسابات.')
  const accountDetails = db.prepare('SELECT account_type FROM accounts WHERE id=?').get(accountId)
  let expectedType = null
  if (['factory_cashbox','customer_receivables','inventory','employee_advances','work_order_wip'].includes(key)) expectedType = 'asset'
  if (['sales_tax_payable','salary_payable'].includes(key)) expectedType = 'liability'
  if (['owner_funding','opening_equity'].includes(key)) expectedType = 'equity'
  if (key === 'sales_revenue' || key.startsWith('treasury_income:')) expectedType = 'revenue'
  if (['inventory_variance','work_order_cogs','inventory_consumption'].includes(key)) expectedType = 'expense'
  if (key === 'payroll_expense' || key.startsWith('expense_category:') || key.startsWith('treasury_expense:')) expectedType = 'expense'
  if (expectedType && accountDetails.account_type !== expectedType) {
    throw new Error(`مفتاح الربط ${key} يتطلب حسابًا من نوع ${expectedType}.`)
  }
  db.prepare(`INSERT INTO account_mappings(mapping_key,account_id,approved,updated_by,updated_at)
    VALUES (?,?,1,?,CURRENT_TIMESTAMP)
    ON CONFLICT(mapping_key) DO UPDATE SET account_id=excluded.account_id,approved=1,updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP`)
    .run(key, account.id, userId || null)
  const expenseCategoryId = key.startsWith('expense_category:') ? Number(key.slice('expense_category:'.length)) : null
  if (expenseCategoryId) db.prepare('UPDATE expense_categories SET account_id=? WHERE id=?').run(account.id, expenseCategoryId)
  return retryPendingJournalEntries(db)
}

module.exports = {
  calculatePayroll,
  materialVariantKey,
  normalizedMaterialText,
  queueInventoryIssueJournal,
  queueWorkOrderCogsRecognitionJournal,
  recognizeCompletedWorkOrderIssues,
  queueJournalEntry,
  retryPendingJournalEntries,
  salesTaxCents,
  setAccountMapping,
  tryPostJournalEntry,
}
