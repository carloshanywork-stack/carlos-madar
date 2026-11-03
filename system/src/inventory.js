function calculateIssue({ mainStock, subStock, quantity, warehouse = 'auto' }) {
  const main = Number(mainStock)
  const sub = Number(subStock)
  const requested = Number(quantity)
  if (![main, sub, requested].every(Number.isFinite) || !Number.isInteger(main) || main < 0 || sub < 0 || requested <= 0) {
    throw new Error('بيانات الرصيد أو الكمية غير صالحة.')
  }
  if (!['auto', 'sub', 'main'].includes(warehouse)) throw new Error('مصدر الصرف غير صالح.')
  if (warehouse === 'sub') {
    if (sub + 0.000001 < requested) throw new Error('رصيد مخزن البواقي لا يكفي للكمية المطلوبة.')
    return { stock: main, subStock: Number((sub - requested).toFixed(6)), mainDeducted: 0,
      subUsed: Number(requested.toFixed(6)), offcutCreated: 0 }
  }
  if (warehouse === 'main') {
    const mainDeducted = Math.ceil(requested - 0.000001)
    if (main < mainDeducted) throw new Error('الرصيد الأساسي لا يكفي بعد التقريب إلى وحدة كاملة.')
    const offcutCreated = Number(Math.max(0, mainDeducted - requested).toFixed(6))
    return { stock: main - mainDeducted, subStock: Number((sub + offcutCreated).toFixed(6)),
      mainDeducted, subUsed: 0, offcutCreated }
  }
  if (main + sub + 0.000001 < requested) throw new Error('الرصيد المتاح في المخزنين لا يكفي للصرف.')

  const subUsed = Math.min(sub, requested)
  const remaining = Math.max(0, requested - subUsed)
  const mainDeducted = remaining > 0 ? Math.ceil(remaining - 0.000001) : 0
  if (mainDeducted > main) throw new Error('الرصيد الأساسي لا يكفي بعد استخدام البواقي المتاحة.')
  const offcutCreated = Number(Math.max(0, mainDeducted - remaining).toFixed(6))

  return {
    stock: main - mainDeducted,
    subStock: Number(Math.max(0, sub - subUsed + offcutCreated).toFixed(6)),
    mainDeducted,
    subUsed: Number(subUsed.toFixed(6)),
    offcutCreated,
  }
}

module.exports = { calculateIssue }
