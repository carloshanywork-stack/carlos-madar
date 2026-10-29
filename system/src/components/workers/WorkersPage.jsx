import { useEffect, useState } from 'react'
import { BriefcaseBusiness, Pencil, Phone, Plus, RefreshCw, Trash2, UserRound, X } from 'lucide-react'

const emptyWorker = { name: '', jobTitle: '', phone: '' }

export default function WorkersPage({ apiClient, onRefresh, notify }) {
  const [workers, setWorkers] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyWorker)

  const loadWorkers = async () => {
    setLoading(true)
    try {
      const rows = await apiClient('/workers')
      setWorkers(Array.isArray(rows) ? rows : [])
    } catch (error) {
      notify?.(error.message || 'تعذر تحميل بيانات العمال.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadWorkers() }, [])

  const openForm = (worker = null) => {
    setEditing(worker)
    setForm(worker ? { name: worker.name, jobTitle: worker.jobTitle || '', phone: worker.phone || '' } : emptyWorker)
    setFormOpen(true)
  }

  const saveWorker = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await apiClient(editing ? `/workers/${editing.id}` : '/workers', {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify(form),
      })
      setEditing(null)
      setFormOpen(false)
      await loadWorkers()
      await onRefresh?.()
      notify?.(editing ? 'تم تحديث بيانات العامل.' : 'تمت إضافة العامل.')
    } catch (error) {
      notify?.(error.message || 'تعذر حفظ بيانات العامل.')
    } finally {
      setSaving(false)
    }
  }

  const removeWorker = async (worker) => {
    if (!window.confirm(`سيتم إخفاء ${worker.name} من القوائم مع الاحتفاظ بسجلاته المالية. متابعة؟`)) return
    try {
      await apiClient(`/workers/${worker.id}`, { method: 'DELETE' })
      await loadWorkers()
      await onRefresh?.()
      notify?.('تم إيقاف العامل مع الاحتفاظ بالسجلات المرتبطة.')
    } catch (error) {
      notify?.(error.message || 'تعذر إيقاف العامل.')
    }
  }

  return <div className="page-enter">
    <header className="page-heading">
      <div><span className="section-eyebrow">البيانات البشرية</span><h2>إدارة العمال</h2><p>سجّل العمال المنفذين للأعمال واربطهم بحركات الخزينة وفواتير المشتريات.</p></div>
      <div className="heading-actions"><button className="button button-primary" onClick={() => openForm()}><Plus size={17}/> عامل جديد</button></div>
    </header>
    <section className="panel users-panel">
      <div className="panel-heading"><div><span className="section-eyebrow">العمال</span><h3>سجل العمال</h3></div><span className="result-count">{workers.length} عامل</span></div>
      {loading ? <div className="loading-inline">جارٍ تحميل العمال...</div> : workers.length ? <div className="table-wrap"><table>
        <thead><tr><th>الاسم</th><th>المسمى الوظيفي</th><th>رقم الهاتف</th><th>الإجراءات</th></tr></thead>
        <tbody>{workers.map((worker) => <tr key={worker.id}>
          <td><div className="user-cell"><span className="avatar"><UserRound size={15}/></span><strong>{worker.name}</strong></div></td>
          <td>{worker.jobTitle || '—'}</td><td>{worker.phone || '—'}</td>
          <td><div className="worker-actions"><button className="text-button" onClick={() => openForm(worker)}><Pencil size={14}/> تعديل</button><button className="text-button danger-text" onClick={() => removeWorker(worker)}><Trash2 size={14}/> إيقاف</button></div></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-inline">لا توجد سجلات عمال بعد.</div>}
    </section>

    {formOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setFormOpen(false)}>
      <section className="modal-card"><div className="modal-header"><div><span className="section-eyebrow">مَدَار · الموارد البشرية</span><h2>{editing ? 'تعديل بيانات العامل' : 'إضافة عامل'}</h2></div><button className="icon-button" onClick={() => setFormOpen(false)} aria-label="إغلاق"><X size={19}/></button></div>
        <form className="modal-form" onSubmit={saveWorker}>
          <label className="field"><span>اسم العامل <b>*</b></span><input required maxLength={150} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
          <label className="field"><span><BriefcaseBusiness size={14}/> المسمى الوظيفي</span><input maxLength={150} value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}/></label>
          <label className="field"><span><Phone size={14}/> رقم الهاتف</span><input maxLength={80} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></label>
          <div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setFormOpen(false)}>إلغاء</button><button type="submit" className="button button-primary" disabled={saving}>{saving && <RefreshCw size={15} className="spin"/>}{saving ? 'جارٍ الحفظ...' : 'حفظ العامل'}</button></div>
        </form>
      </section>
    </div>}
  </div>
}
