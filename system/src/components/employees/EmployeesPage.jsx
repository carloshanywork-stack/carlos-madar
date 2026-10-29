import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { BriefcaseBusiness, FileSpreadsheet, FileText, History, KeyRound, Pencil, Phone, Plus, RefreshCw, Trash2, UserRound, X } from 'lucide-react'

const departments = [
  ['Maintenance', 'صيانة'],
  ['Sales', 'مبيعات'],
  ['Purchasing', 'مشتريات'],
  ['Operation', 'تشغيل'],
]
const departmentLabels = Object.fromEntries(departments)
const emptyEmployee = { name: '', department: 'Maintenance', phone: '', monthlyBaseSalary: '0', username: '', password: '' }

export default function EmployeesPage({ apiClient, onRefresh, notify }) {
  const location = useLocation()
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyEmployee)
  const [historyEmployee, setHistoryEmployee] = useState(null)
  const [history, setHistory] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyFrom, setHistoryFrom] = useState('')
  const [historyTo, setHistoryTo] = useState('')
  const [historyExporting, setHistoryExporting] = useState(false)

  const loadEmployees = async () => {
    setLoading(true)
    try {
      const rows = await apiClient('/employees')
      setEmployees(Array.isArray(rows) ? rows : [])
    } catch (error) {
      notify?.(error.message || 'تعذر تحميل بيانات الموظفين.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadEmployees() }, [])

  useEffect(() => {
    if (!location.hash.startsWith('#employee-record-') || !employees.length) return
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [location.hash, employees])

  useEffect(() => {
    if (!historyEmployee) return undefined
    let active = true
    setHistoryLoading(true)
    const query = new URLSearchParams()
    if (historyFrom) query.set('from', historyFrom)
    if (historyTo) query.set('to', historyTo)
    apiClient(`/employees/${historyEmployee.id}/history?${query}`).then((result) => {
      if (active) setHistory(result)
    }).catch((error) => {
      if (active) { setHistory(null); notify?.(error.message || 'تعذر تحميل سجل الموظف.') }
    }).finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [apiClient, historyEmployee?.id, historyFrom, historyTo])

  const openForm = (employee = null) => {
    setEditing(employee)
    setForm(employee ? {
      name: employee.name, department: employee.department, phone: employee.phone || '',
      monthlyBaseSalary: String(Number(employee.monthlySalaryCents || 0) / 100),
      username: employee.username || '', password: '',
    } : emptyEmployee)
    setFormOpen(true)
  }

  const needsLogin = form.department !== 'Maintenance'
  const needsPassword = needsLogin && (!editing?.username || editing?.userDeleted)

  const saveEmployee = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), department: form.department, phone: form.phone.trim(), monthlyBaseSalary: form.monthlyBaseSalary }
      if (needsLogin) {
        payload.username = form.username.trim()
        if (form.password) payload.password = form.password
      }
      await apiClient(editing ? `/employees/${editing.id}` : '/employees', {
        method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload),
      })
      setFormOpen(false)
      setEditing(null)
      await loadEmployees()
      await onRefresh?.()
      notify?.(editing ? 'تم تحديث بيانات الموظف.' : 'تمت إضافة الموظف.')
    } catch (error) {
      notify?.(error.message || 'تعذر حفظ بيانات الموظف.')
    } finally {
      setSaving(false)
    }
  }

  const removeEmployee = async (employee) => {
    if (!window.confirm(`سيتم إيقاف ${employee.name} والاحتفاظ بسجلاته؛ كما سيُلغى حساب الدخول المرتبط به إن وجد. متابعة؟`)) return
    try {
      await apiClient(`/employees/${employee.id}`, { method: 'DELETE' })
      await loadEmployees()
      await onRefresh?.()
      notify?.('تم إيقاف الموظف وحساب دخوله مع الاحتفاظ بالسجلات.')
    } catch (error) {
      notify?.(error.message || 'تعذر إيقاف الموظف.')
    }
  }

  const openHistory = (employee) => {
    setHistory(null)
    setHistoryFrom('')
    setHistoryTo('')
    setHistoryEmployee(employee)
  }

  const exportHistory = async (format) => {
    if (!historyEmployee) return
    setHistoryExporting(true)
    try {
      const query = new URLSearchParams()
      if (historyFrom) query.set('from', historyFrom)
      if (historyTo) query.set('to', historyTo)
      const response = await fetch(`/api/employees/${historyEmployee.id}/history.${format}?${query}`, { credentials: 'same-origin' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'تعذر تصدير سجل الموظف.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `employee-${historyEmployee.id}-history.${format}`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      notify?.(error.message || 'تعذر تصدير سجل الموظف.')
    } finally {
      setHistoryExporting(false)
    }
  }

  const money = (cents) => new Intl.NumberFormat('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .format(Number(cents || 0) / 100)

  return <div className="page-enter">
    <header className="page-heading">
      <div><span className="section-eyebrow">الموارد البشرية</span><h2>الموظفون</h2><p>سجل موحد للموظفين، مع حسابات دخول للأقسام التشغيلية والمالية فقط.</p></div>
      <div className="heading-actions"><button className="button button-primary" onClick={() => openForm()}><Plus size={17}/> موظف جديد</button></div>
    </header>
    <div className="users-import-note"><BriefcaseBusiness size={16}/><span>موظفو الصيانة ميدانيون بلا حساب دخول. المبيعات والمشتريات والتشغيل ينشأ لهم حساب نظام بكلمة مرور مشفّرة.</span></div>
    <section className="panel users-panel">
      <div className="panel-heading"><div><span className="section-eyebrow">سجل الموارد البشرية</span><h3>قائمة الموظفين</h3></div><span className="result-count">{employees.length} موظف</span></div>
      {loading ? <div className="loading-inline">جارٍ تحميل الموظفين...</div> : employees.length ? <div className="table-wrap"><table>
        <thead><tr><th>الموظف</th><th>القسم</th><th>الهاتف</th><th>الراتب الأساسي الشهري</th><th>حساب النظام</th><th>الإجراءات</th></tr></thead>
        <tbody>{employees.map((employee) => <tr key={employee.id} id={`employee-record-${employee.id}`}>
          <td><div className="user-cell"><span className="avatar"><UserRound size={15}/></span><strong>{employee.name}</strong></div></td>
          <td><span className="role-label">{departmentLabels[employee.department] || employee.department}</span></td>
          <td>{employee.phone || '—'}</td>
          <td>{new Intl.NumberFormat('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(employee.monthlySalaryCents||0)/100)} ج.م</td>
          <td>{employee.department === 'Maintenance' ? 'بدون دخول' : employee.username || '—'}{employee.department !== 'Maintenance' && employee.username && <small className={employee.userActive ? 'employee-access-active' : 'employee-access-disabled'}>{employee.userActive ? ' · نشط' : ' · موقوف'}</small>}</td>
          <td><div className="worker-actions"><button className="text-button" onClick={() => openHistory(employee)}><History size={14}/> السجل</button><button className="text-button" onClick={() => openForm(employee)}><Pencil size={14}/> تعديل</button><button className="text-button danger-text" onClick={() => removeEmployee(employee)}><Trash2 size={14}/> إيقاف</button></div></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-inline">لا توجد سجلات موظفين بعد.</div>}
    </section>

    {historyEmployee && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setHistoryEmployee(null)}>
      <section className="modal-card employee-history-modal"><div className="modal-header"><div><span className="section-eyebrow">مَدَار · الموارد البشرية</span><h2>السجل الوظيفي — {historyEmployee.name}</h2></div><button className="icon-button" onClick={() => setHistoryEmployee(null)} aria-label="إغلاق"><X size={19}/></button></div>
        <div className="filter-panel"><div className="filter-fields"><label><span>من تاريخ</span><input type="date" value={historyFrom} onChange={(event) => setHistoryFrom(event.target.value)}/></label><label><span>إلى تاريخ</span><input type="date" value={historyTo} onChange={(event) => setHistoryTo(event.target.value)}/></label><button className="button button-ghost" disabled={historyExporting || historyLoading} onClick={() => exportHistory('xlsx')}><FileSpreadsheet size={15}/>{historyExporting ? 'جارٍ التصدير...' : 'Excel'}</button><button className="button button-secondary" disabled={historyExporting || historyLoading} onClick={() => exportHistory('pdf')}><FileText size={15}/>PDF</button></div></div>
        {historyLoading ? <div className="loading-inline">جارٍ تحميل السجل الوظيفي...</div> : history && <>
          <section className="finance-summary-grid employee-history-summary">
            <div className="finance-stat"><div><span>أوامر مسندة</span><strong>{history.summary.assignedOrderCount}</strong></div></div>
            <div className="finance-stat"><div><span>إجمالي استحقاقات الرواتب</span><strong>{money(history.summary.payrollEntitlementCents)} <small>ج.م</small></strong></div></div>
            <div className="finance-stat"><div><span>رواتب غير مسددة</span><strong>{money(history.summary.unpaidSalaryCents)} <small>ج.م</small></strong></div></div>
            <div className="finance-stat"><div><span>رصيد السلف الحالي</span><strong>{money(history.summary.currentAdvanceBalanceCents)} <small>ج.م</small></strong></div></div>
          </section>
          <section className="panel invoice-list-panel"><div className="panel-heading"><div><span className="section-eyebrow">التاريخ والتحليلات</span><h3>الأحداث المالية والتشغيلية</h3></div><span className="result-count">{history.events.length} حدث</span></div>
            {history.events.length ? <div className="table-wrap"><table><thead><tr><th>التاريخ</th><th>النوع</th><th>الحدث والتفاصيل</th><th>المبلغ</th></tr></thead><tbody>{history.events.map((event) => <tr key={event.id}>
              <td>{event.date}</td><td>{({ order: 'أمر تشغيل', payroll: 'راتب', advance: 'سلفة', treasury: 'خزينة', audit: 'تدقيق' })[event.type] || event.type}</td>
              <td><strong>{event.title}</strong><br/><span>{event.description || '—'}</span>{event.type === 'audit' && (event.oldValues || event.newValues) && <details><summary>القيم السابقة والجديدة</summary><pre className="audit-json">{JSON.stringify({ old: event.oldValues, new: event.newValues }, null, 2)}</pre></details>}</td>
              <td>{event.amountCents == null ? '—' : `${money(event.amountCents)} ج.م`}</td>
            </tr>)}</tbody></table></div> : <div className="empty-inline">لا توجد أحداث ضمن الفترة المحددة.</div>}
          </section>
        </>}
        <div className="modal-actions"><button className="button button-ghost" onClick={() => setHistoryEmployee(null)}><X size={14}/> إغلاق السجل</button></div>
      </section>
    </div>}

    {formOpen && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setFormOpen(false)}>
      <section className="modal-card"><div className="modal-header"><div><span className="section-eyebrow">مَدَار · الموارد البشرية</span><h2>{editing ? 'تعديل موظف' : 'إضافة موظف'}</h2></div><button className="icon-button" onClick={() => setFormOpen(false)} aria-label="إغلاق"><X size={19}/></button></div>
        <form className="modal-form" onSubmit={saveEmployee}>
          <label className="field"><span>اسم الموظف <b>*</b></span><input required maxLength={150} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label>
          <div className="form-row">
            <label className="field"><span>القسم <b>*</b></span><select required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })}>
              {departments.map(([value, label]) => <option key={value} value={value} disabled={Boolean(editing?.username) && value === 'Maintenance'}>{label}</option>)}
            </select></label>
            <label className="field"><span><Phone size={14}/> رقم الهاتف</span><input maxLength={80} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></label>
          </div>
          <label className="field"><span>الراتب الأساسي الشهري (ج.م)</span><input type="number" min="0" step="0.01" value={form.monthlyBaseSalary} onChange={(event) => setForm({ ...form, monthlyBaseSalary: event.target.value })}/></label>
          {needsLogin && <>
            <label className="field"><span>اسم الدخول <b>*</b></span><input required minLength={3} maxLength={100} autoComplete="off" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })}/></label>
            <label className="field"><span><KeyRound size={14}/> {editing?.username ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور (10 أحرف على الأقل)'}{needsPassword && <b> *</b>}</span><input type="password" minLength={needsPassword ? 10 : undefined} required={needsPassword} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/></label>
          </>}
          {!needsLogin && <div className="modal-hint">موظف الصيانة لا ينشأ له مستخدم أو بيانات اعتماد لتسجيل الدخول.</div>}
          <div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setFormOpen(false)}>إلغاء</button><button type="submit" className="button button-primary" disabled={saving}>{saving && <RefreshCw size={15} className="spin"/>}{saving ? 'جارٍ الحفظ...' : 'حفظ الموظف'}</button></div>
        </form>
      </section>
    </div>}
  </div>
}
