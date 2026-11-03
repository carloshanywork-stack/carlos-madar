import { useEffect, useState } from 'react'
import { Boxes, Plus, RefreshCw, Trash2 } from 'lucide-react'

const emptyOffcut = { name: '', dimensions: '', quantity: '', unit: 'لوح', notes: '' }
const money = (value) => new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0) / 100)

export default function SecondaryWarehousePage({ apiClient, notify, canManage = false }) {
  const [offcuts, setOffcuts] = useState([])
  const [form, setForm] = useState(emptyOffcut)
  const [selected, setSelected] = useState({})
  const [saleAmount, setSaleAmount] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const rows = await apiClient('/warehouse/offcuts')
      setOffcuts(Array.isArray(rows) ? rows : [])
      setSelected((current) => Object.fromEntries(Object.entries(current).filter(([id]) => rows.some((row) => String(row.id) === id))))
    } catch (error) { notify?.(error.message || 'تعذر تحميل المخزن الجانبي.') }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const createOffcut = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await apiClient('/warehouse/offcuts', { method: 'POST', body: JSON.stringify({ ...form, quantity: Number(form.quantity) }) })
      setForm(emptyOffcut)
      await load()
      notify?.('تمت إضافة الباقي إلى المخزن الجانبي.')
    } catch (error) { notify?.(error.message || 'تعذر حفظ الباقي.') }
    finally { setSaving(false) }
  }

  const sellScrap = async () => {
    const items = Object.entries(selected).filter(([, value]) => value).map(([id]) => {
      const row = offcuts.find((item) => String(item.id) === id)
      return { offcutId: Number(id), quantity: Number(row?.quantity || 0) }
    })
    if (!items.length || !saleAmount || saving) return
    if (!window.confirm(`سيتم شطب ${items.length} قطعة/باقٍ وإيداع ${saleAmount} ج.م في الخزينة. متابعة؟`)) return
    setSaving(true)
    try {
      const sale = await apiClient('/warehouse/scrap-sales', { method: 'POST', body: JSON.stringify({ amount: saleAmount, items }) })
      setSelected({})
      setSaleAmount('')
      await load()
      notify?.(`تم تسجيل بيع الخردة وإيداع ${money(sale.amount_cents)} ج.م بالخزينة.`)
    } catch (error) { notify?.(error.message || 'تعذر تسجيل بيع الخردة.') }
    finally { setSaving(false) }
  }

  const toggle = (row) => setSelected((current) => ({ ...current, [row.id]: !current[row.id] }))

  return <div className="page-enter">
    <header className="page-heading"><div><span className="section-eyebrow">إدارة الخامات</span><h2>المخزن الجانبي للخامات</h2><p>بواقي قابلة لإعادة الاستخدام مع تسوية بيع الخردة إلى الخزينة.</p></div><button className="button button-ghost" onClick={load} disabled={loading}><RefreshCw size={15}/> تحديث</button></header>
    {canManage && <section className="panel modal-form"><div className="panel-heading"><div><span className="section-eyebrow">إضافة باقٍ قابل للاستخدام</span><h3>تسجيل قطعة أو لوح جزئي</h3></div><Boxes size={18}/></div>
      <form className="form-grid" onSubmit={createOffcut}>
        <label className="field"><span>اسم الخامة</span><input required maxLength={150} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
        <label className="field"><span>الأبعاد</span><input maxLength={120} value={form.dimensions} onChange={(event) => setForm({ ...form, dimensions: event.target.value })} placeholder="مثال: 50 × 50 سم"/></label>
        <label className="field"><span>الكمية</span><input required type="number" min="0.000001" max="1000000" step="0.000001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: event.target.value })}/></label>
        <label className="field"><span>وحدة القياس</span><input maxLength={40} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })}/></label>
        <label className="field"><span>ملاحظات</span><input maxLength={500} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })}/></label>
        <button className="button button-primary" disabled={saving}><Plus size={15}/> إضافة للمخزن</button>
      </form>
    </section>}
    <section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">المتوفر</span><h3>الألواح والبواقي</h3></div><span className="result-count">{offcuts.length} قطعة</span></div>
      {loading ? <div className="loading-inline">جارٍ التحميل...</div> : offcuts.length ? <div className="table-wrap"><table><thead><tr><th>{canManage ? 'تحديد الخردة' : ''}</th><th>الخامة</th><th>الأبعاد</th><th>الرصيد</th><th>الملاحظات</th></tr></thead><tbody>{offcuts.map((row) => <tr key={row.id}>
        <td>{canManage && <input type="checkbox" checked={Boolean(selected[row.id])} onChange={() => toggle(row)} aria-label={`اختيار ${row.name} للخردة`}/>}</td>
        <td><strong>{row.material_name || row.name}</strong>{row.material_code && <small> · {row.material_code}</small>}</td><td>{row.dimensions || '—'}</td><td>{row.quantity} {row.unit}</td><td>{row.notes || '—'}</td>
      </tr>)}</tbody></table></div> : <div className="empty-inline">المخزن الجانبي فارغ حاليًا.</div>}
      {canManage && <><div className="form-row"><label className="field"><span>قيمة بيع الخردة المستلمة (ج.م)</span><input type="number" min="0.01" step="0.01" value={saleAmount} onChange={(event) => setSaleAmount(event.target.value)}/></label>
        <button className="button button-secondary" disabled={saving || !Object.values(selected).some(Boolean) || !saleAmount} onClick={sellScrap}><Trash2 size={15}/>{saving ? 'جارٍ التسجيل...' : 'تفريغ وبيع الخردة'}</button>
      </div>
      <div className="modal-hint">تسجيل البيع ينشئ واردًا نقديًا في الخزينة تحت تصنيف «إيرادات بيع خردة ومخلفات تشغيل»، ويُحدّث رصيد القطع المحددة في معاملة واحدة.</div></>}
    </section>
  </div>
}
