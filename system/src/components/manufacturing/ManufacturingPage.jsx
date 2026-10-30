import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Boxes, CalendarDays, Check, Download, Factory, FileUp, PackagePlus, Plus, RefreshCw, Truck } from 'lucide-react'
import DomainTabs from '../DomainTabs'

const stages = [
  { id: 'in_production', label: 'قيد التشغيل' },
  { id: 'ready', label: 'جاهز للتسليم' },
  { id: 'delivered_archived', label: 'تم التسليم ومؤرشف' },
]
const machineNames = { cnc_router: 'CNC Router', laser: 'Laser', both: 'كلاهما', manual: 'تجميع يدوي' }
const blankOrder = { clientId: '', productName: '', description: '', targetDeliveryDate: '', machineType: 'cnc_router', technicianIds: [], saleAmount: '' }
const blankOffcut = { materialId: '', name: '', dimensions: '', quantity: '', unit: 'لوح', notes: '' }

export default function ManufacturingPage({ apiClient, data, user, notify }) {
  const navigate = useNavigate()
  const [orders, setOrders] = useState([])
  const [stage, setStage] = useState(stages[0].id)
  const [employees, setEmployees] = useState([])
  const [form, setForm] = useState(blankOrder)
  const [offcut, setOffcut] = useState(blankOffcut)
  const [activeOrder, setActiveOrder] = useState(null)
  const [invoiceId, setInvoiceId] = useState('')
  const [deliveryMode, setDeliveryMode] = useState('existing')
  const [offcuts, setOffcuts] = useState([])
  const [issueOrder, setIssueOrder] = useState(null)
  const [issueSource, setIssueSource] = useState('main')
  const [issueMaterialId, setIssueMaterialId] = useState('')
  const [issueOffcutId, setIssueOffcutId] = useState('')
  const [issueQuantity, setIssueQuantity] = useState('')
  const [designBusy, setDesignBusy] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadOrders = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await apiClient('/manufacturing/orders')
      setOrders(Array.isArray(result) ? result : [])
    } catch (requestError) {
      setError(requestError.message || 'تعذر تحميل أوامر التشغيل.')
    } finally { setLoading(false) }
  }
  useEffect(() => { void loadOrders() }, [])
  useEffect(() => {
    let alive = true
    apiClient('/employees?active=true').then((rows) => { if (alive) setEmployees(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (alive) setEmployees([]) })
    return () => { alive = false }
  }, [apiClient])
  useEffect(() => {
    let alive = true
    if (!['admin', 'operations'].includes(user?.role)) return () => { alive = false }
    apiClient('/warehouse/offcuts?status=available').then((rows) => { if (alive) setOffcuts(Array.isArray(rows) ? rows : []) })
      .catch(() => { if (alive) setOffcuts([]) })
    return () => { alive = false }
  }, [apiClient, user?.role])

  const counts = useMemo(() => Object.fromEntries(stages.map((item) => [item.id,
    orders.filter((order) => order.status === item.id).length])), [orders])
  const visibleOrders = orders.filter((order) => order.status === stage)
  const canCreate = ['admin', 'operations'].includes(user?.role)

  const createOrder = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const result = await apiClient('/manufacturing/orders', { method: 'POST', body: JSON.stringify({
        ...form, clientId: Number(form.clientId), technicianIds: form.technicianIds.map(Number),
      }) })
      setOrders((rows) => [result, ...rows])
      setForm(blankOrder)
      setFormOpen(false)
      setStage('in_production')
      notify?.(`تم إنشاء أمر التشغيل ${result.order_code}.`)
    } catch (requestError) { notify?.(requestError.message || 'تعذر إنشاء أمر التشغيل.') }
    finally { setSaving(false) }
  }

  const markReady = async (event) => {
    event.preventDefault()
    if (!activeOrder || saving) return
    setSaving(true)
    try {
      const offcuts = offcut.name.trim() ? [{ ...offcut, quantity: Number(offcut.quantity) }] : []
      if (offcuts[0]?.materialId) offcuts[0].materialId = Number(offcuts[0].materialId)
      else if (offcuts[0]) offcuts[0].materialId = null
      await apiClient(`/manufacturing/orders/${activeOrder.id}/ready`, { method: 'POST', body: JSON.stringify({ offcuts }) })
      setActiveOrder(null)
      setOffcut(blankOffcut)
      await loadOrders()
      notify?.('تم نقل الأمر إلى الجاهزية وتسجيل البواقي في المخزن الجانبي.')
    } catch (requestError) { notify?.(requestError.message || 'تعذر تحديث مرحلة التشغيل.') }
    finally { setSaving(false) }
  }

  const deliverOrder = async (order) => {
    if ((deliveryMode === 'existing' && !invoiceId) || saving) return
    setSaving(true)
    try {
      const body = deliveryMode === 'new' ? { createInvoice: true } : { invoiceId: Number(invoiceId) }
      await apiClient(`/manufacturing/orders/${order.id}/deliver`, { method: 'POST', body: JSON.stringify(body) })
      setInvoiceId('')
      await loadOrders()
      notify?.(deliveryMode === 'new' ? 'تم إنشاء فاتورة آجل للعميل وربطها بأمر التشغيل.' : 'تم ربط فاتورة العميل وأرشفة أمر التشغيل.')
    } catch (requestError) { notify?.(requestError.message || 'تعذر إقفال التسليم.') }
    finally { setSaving(false) }
  }

  const issueMaterial = async (event) => {
    event.preventDefault()
    if (!issueOrder || saving) return
    const quantity = Number(issueQuantity)
    const item = issueSource === 'main'
      ? { sourceWarehouse: 'main', materialId: Number(issueMaterialId), quantity }
      : { sourceWarehouse: 'offcut', offcutId: Number(issueOffcutId), quantity }
    setSaving(true)
    try {
      await apiClient(`/manufacturing/orders/${issueOrder.id}/materials`, { method: 'POST', body: JSON.stringify({ items: [item] }) })
      setIssueOrder(null)
      setIssueMaterialId('')
      setIssueOffcutId('')
      setIssueQuantity('')
      await loadOrders()
      notify?.('تم صرف الخامة وتسجيل حركة المخزون لأمر التشغيل.')
    } catch (requestError) { notify?.(requestError.message || 'تعذر صرف الخامة.') }
    finally { setSaving(false) }
  }

  const uploadDesign = async (order, file) => {
    if (!file || designBusy != null) return
    const body = new FormData()
    body.append('file', file)
    setDesignBusy(order.id)
    try {
      await apiClient(`/manufacturing/orders/${order.id}/designs`, { method: 'POST', body })
      await loadOrders()
      notify?.('تم حفظ ملف التصميم ضمن مرفقات أمر التشغيل.')
    } catch (requestError) { notify?.(requestError.message || 'تعذر رفع ملف التصميم.') }
    finally { setDesignBusy(null) }
  }

  return <div className="page-enter">
    <header className="page-heading"><div><span className="section-eyebrow">التشغيل داخل الورشة</span><h2>أوامر التشغيل</h2>
      <p>أوامر الأكريليك والمنتجات الورشية حسب مرحلة الإنتاج والتسليم.</p></div>
      {canCreate && <div className="heading-actions"><button className="button button-primary" onClick={() => setFormOpen((open) => !open)}><Plus size={16}/> أمر تشغيل جديد</button>
        <button className="button button-ghost" onClick={() => navigate('/warehouse?tab=offcuts')}><Boxes size={16}/> المخزن الجانبي</button></div>}
    </header>
    <DomainTabs tabs={stages.map((item) => ({ ...item, count: counts[item.id] || 0,
      icon: item.id === 'in_production' ? Factory : item.id === 'ready' ? Check : Truck }))}
      value={stage} onChange={setStage} label="مراحل التشغيل"/>

    {formOpen && <section className="panel manufacturing-form-panel"><div className="panel-heading"><div><span className="section-eyebrow">طلب ورشة جديد</span><h3>إنشاء أمر تشغيل</h3></div></div>
      <form className="form-grid" onSubmit={createOrder}>
        <label className="field"><span>العميل</span><select required value={form.clientId} onChange={(event) => setForm({ ...form, clientId: event.target.value })}><option value="">اختر العميل</option>{(data?.clients || []).map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
        <label className="field"><span>اسم المنتج</span><input required maxLength={180} value={form.productName} onChange={(event) => setForm({ ...form, productName: event.target.value })} placeholder="لوحة أكريليك، حامل..."/></label>
        <label className="field"><span>الماكينة</span><select value={form.machineType} onChange={(event) => setForm({ ...form, machineType: event.target.value })}><option value="cnc_router">CNC Router</option><option value="laser">Laser</option><option value="both">كلاهما</option><option value="manual">تجميع يدوي</option></select></label>
        <label className="field"><span><CalendarDays size={14}/> تاريخ التسليم المستهدف</span><input type="date" value={form.targetDeliveryDate} onChange={(event) => setForm({ ...form, targetDeliveryDate: event.target.value })}/></label>
        <label className="field"><span>فني الورشة (اختياري)</span><select value={form.technicianIds[0] || ''} onChange={(event) => setForm({ ...form, technicianIds: event.target.value ? [Number(event.target.value)] : [] })}><option value="">غير محدد</option>{employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.jobTitle || employee.department}</option>)}</select></label>
        <label className="field"><span>قيمة البيع (ج.م)</span><input required type="number" min="0.01" step="0.01" value={form.saleAmount} onChange={(event) => setForm({ ...form, saleAmount: event.target.value })} placeholder="تُستخدم عند إنشاء فاتورة التسليم"/></label>
        <label className="field"><span>وصف ومواصفات المنتج</span><textarea maxLength={3000} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })}/></label>
        <div className="manufacturing-form-actions"><button className="button button-primary" disabled={saving}>{saving ? 'جارٍ الحفظ...' : 'إنشاء أمر التشغيل'}</button><button type="button" className="button button-ghost" onClick={() => setFormOpen(false)}>إلغاء</button></div>
      </form>
       <div className="modal-hint">تُحفظ قيمة البيع على الأمر لتكون أساس فاتورة العميل الآجلة عند التسليم. تُصرف الخامات من المخزن الرئيسي أو من قطع المخزن الجانبي أثناء التشغيل.</div>
    </section>}

    {error && <div className="inline-error">{error}<button className="button button-ghost button-small" onClick={loadOrders}><RefreshCw size={14}/> إعادة المحاولة</button></div>}
    {loading ? <div className="panel loading-inline">جارٍ تحميل أوامر التشغيل...</div> : visibleOrders.length ? <section className="manufacturing-order-grid">{visibleOrders.map((order) => <article className="panel manufacturing-order-card" key={order.id}>
      <div className="panel-heading"><div><span className="section-eyebrow">{order.order_code}</span><h3>{order.product_name}</h3></div><span className={`status-badge status-${order.status}`}><i/>{stages.find((item) => item.id === order.status)?.label}</span></div>
      <div className="manufacturing-order-meta"><span>{order.client_name}</span><span>{machineNames[order.machine_type] || order.machine_type}</span><span>{order.target_delivery_date || 'لا يوجد موعد تسليم'}</span></div>
       {order.description && <p>{order.description}</p>}
       {order.sale_amount_cents > 0 && <div className="manufacturing-invoice-link">قيمة البيع المسجلة: <strong>{(Number(order.sale_amount_cents) / 100).toFixed(2)} ج.م</strong></div>}
       {Array.isArray(order.materials_used) && order.materials_used.length > 0 && <div className="manufacturing-offcuts-note">تم تسجيل {order.materials_used.length} حركة صرف خامة.</div>}
       {Array.isArray(order.design_files) && order.design_files.length > 0 && <div className="manufacturing-design-files">{order.design_files.map((file) => <a key={file.id} className="button button-ghost button-small" href={`/api/manufacturing/designs/${file.id}/download`}><Download size={14}/>{file.original_name}</a>)}</div>}
       {canCreate && order.status !== 'delivered_archived' && <label className="manufacturing-design-upload"><FileUp size={15}/>{designBusy === order.id ? 'جارٍ رفع التصميم...' : 'إرفاق تصميم DXF / CDR / AI / PDF'}<input type="file" accept=".dxf,.cdr,.ai,.pdf,application/pdf" disabled={designBusy != null} onChange={(event) => { void uploadDesign(order, event.target.files?.[0]); event.target.value = '' }}/></label>}
       {order.invoice_code && <div className="manufacturing-invoice-link">فاتورة مرتبطة: <strong>{order.invoice_code}</strong>{order.invoice_total != null && <span> · {Number(order.invoice_total).toFixed(2)} ج.م</span>}</div>}
       {Array.isArray(order.offcuts_returned) && order.offcuts_returned.length > 0 && <div className="manufacturing-offcuts-note">تم تسجيل {order.offcuts_returned.length} باقٍ في المخزن الجانبي.</div>}
       <div className="manufacturing-order-actions">
         {order.status === 'in_production' && canCreate && <button className="button button-ghost" onClick={() => { setIssueOrder(order); setIssueSource('main') }}><PackagePlus size={15}/> صرف خامة</button>}
         {order.status === 'in_production' && canCreate && <button className="button button-secondary" onClick={() => { setActiveOrder(order); setOffcut(blankOffcut) }}><Check size={15}/> تجهيز للتسليم</button>}
         {order.status === 'ready' && ['admin', 'sales'].includes(user?.role) && <><label className="field"><span>طريقة الفاتورة</span><select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value)}><option value="existing">ربط فاتورة مبيعات موجودة</option><option value="new">إنشاء فاتورة آجل من قيمة الأمر</option></select></label>{deliveryMode === 'existing' ? <label className="field"><span>رقم فاتورة المبيعات</span><input type="number" min="1" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}/></label> : <span className="manufacturing-invoice-link">ستُنشأ فاتورة آجل بقيمة {(Number(order.sale_amount_cents || 0) / 100).toFixed(2)} ج.م</span>}<button className="button button-primary" disabled={saving || (deliveryMode === 'existing' && !invoiceId) || (deliveryMode === 'new' && !Number(order.sale_amount_cents))} onClick={() => deliverOrder(order)}><Truck size={15}/> تسجيل التسليم والأرشفة</button></>}
      </div>
    </article>)}</section> : <section className="panel empty-state"><div className="empty-icon"><Factory size={23}/></div><h3>لا توجد أوامر في هذه المرحلة</h3><p>{stage === 'in_production' ? 'أنشئ أمر تشغيل لبدء متابعة المنتج في الورشة.' : 'ستظهر هنا الأوامر عند انتقالها إلى هذه المرحلة.'}</p>{stage === 'in_production' && canCreate && <button className="button button-primary button-small" onClick={() => setFormOpen(true)}><Plus size={15}/> أمر تشغيل جديد</button>}</section>}

    {activeOrder && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setActiveOrder(null)}><section className="modal-card">
      <div className="modal-header"><div><span className="section-eyebrow">{activeOrder.order_code}</span><h2>تجهيز المنتج للتسليم</h2></div><button className="icon-button" onClick={() => setActiveOrder(null)} aria-label="إغلاق">×</button></div>
      <form className="modal-form" onSubmit={markReady}><p>سجّل البواقي القابلة لإعادة الاستخدام ليتم إضافتها إلى المخزن الجانبي.</p>
         <label className="field"><span>اسم الباقي (اختياري)</span><input maxLength={150} value={offcut.name} onChange={(event) => setOffcut({ ...offcut, name: event.target.value })}/></label>
         <label className="field"><span>الخامة المرتبطة (اختياري)</span><select value={offcut.materialId} onChange={(event) => setOffcut({ ...offcut, materialId: event.target.value })}><option value="">بدون ربط بخامة</option>{(data?.materials || []).map((material) => <option key={material.id} value={material.id}>{material.code} · {material.name}</option>)}</select></label>
        <label className="field"><span>الأبعاد</span><input maxLength={120} value={offcut.dimensions} onChange={(event) => setOffcut({ ...offcut, dimensions: event.target.value })} placeholder="مثال: 50 × 50 سم"/></label>
        <div className="form-row"><label className="field"><span>الكمية</span><input type="number" min="0.000001" step="0.000001" value={offcut.quantity} onChange={(event) => setOffcut({ ...offcut, quantity: event.target.value })}/></label><label className="field"><span>الوحدة</span><input maxLength={40} value={offcut.unit} onChange={(event) => setOffcut({ ...offcut, unit: event.target.value })}/></label></div>
        <label className="field"><span>ملاحظات</span><input maxLength={500} value={offcut.notes} onChange={(event) => setOffcut({ ...offcut, notes: event.target.value })}/></label>
        <div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setActiveOrder(null)}>إلغاء</button><button className="button button-primary" disabled={saving || (offcut.name.trim() && (!offcut.quantity || Number(offcut.quantity) <= 0))}>{saving ? 'جارٍ الحفظ...' : 'اعتماد الجاهزية'}</button></div>
      </form>
    </section></div>}

    {issueOrder && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setIssueOrder(null)}><section className="modal-card">
      <div className="modal-header"><div><span className="section-eyebrow">{issueOrder.order_code}</span><h2>صرف خامات أمر التشغيل</h2></div><button className="icon-button" onClick={() => setIssueOrder(null)} aria-label="إغلاق">×</button></div>
      <form className="modal-form" onSubmit={issueMaterial}>
        <label className="field"><span>مصدر الخامة</span><select value={issueSource} onChange={(event) => { setIssueSource(event.target.value); setIssueQuantity('') }}><option value="main">المخزن الرئيسي — ألواح كاملة</option><option value="offcut">المخزن الجانبي — باقي قابل للاستخدام</option></select></label>
        {issueSource === 'main' ? <label className="field"><span>الخامة</span><select required value={issueMaterialId} onChange={(event) => setIssueMaterialId(event.target.value)}><option value="">اختر خامة</option>{(data?.materials || []).map((material) => <option key={material.id} value={material.id} disabled={Number(material.stock) < 1}>{material.code} · {material.name} — {material.stock} {material.unit}</option>)}</select></label>
          : <label className="field"><span>الباقي</span><select required value={issueOffcutId} onChange={(event) => setIssueOffcutId(event.target.value)}><option value="">اختر باقيًا</option>{offcuts.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.dimensions} — {item.quantity} {item.unit}</option>)}</select></label>}
        <label className="field"><span>الكمية{issueSource === 'main' ? ' (وحدات كاملة)' : ''}</span><input required type="number" min="0.000001" step={issueSource === 'main' ? '1' : '0.000001'} value={issueQuantity} onChange={(event) => setIssueQuantity(event.target.value)}/></label>
        <div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setIssueOrder(null)}>إلغاء</button><button className="button button-primary" disabled={saving}>{saving ? 'جارٍ الصرف...' : 'اعتماد الصرف'}</button></div>
      </form>
    </section></div>}
  </div>
}
