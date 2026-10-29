import { useEffect, useState } from 'react'
import { BriefcaseBusiness, KeyRound, Pencil, Phone, Plus, RefreshCw, Trash2, UserRound, X } from 'lucide-react'

const departments = [
  ['Maintenance', 'صيانة'],
  ['Sales', 'مبيعات'],
  ['Purchasing', 'مشتريات'],
  ['Operation', 'تشغيل'],
]
const departmentLabels = Object.fromEntries(departments)
const emptyEmployee = { name: '', department: 'Maintenance', phone: '', monthlyBaseSalary: '0', username: '', password: '' }

export default function EmployeesPage({ apiClient, onRefresh, notify }) {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyEmployee)

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
        <tbody>{employees.map((employee) => <tr key={employee.id}>
          <td><div className="user-cell"><span className="avatar"><UserRound size={15}/></span><strong>{employee.name}</strong></div></td>
          <td><span className="role-label">{departmentLabels[employee.department] || employee.department}</span></td>
          <td>{employee.phone || '—'}</td>
          <td>{new Intl.NumberFormat('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(employee.monthlySalaryCents||0)/100)} ج.م</td>
          <td>{employee.department === 'Maintenance' ? 'بدون دخول' : employee.username || '—'}{employee.department !== 'Maintenance' && employee.username && <small className={employee.userActive ? 'employee-access-active' : 'employee-access-disabled'}>{employee.userActive ? ' · نشط' : ' · موقوف'}</small>}</td>
          <td><div className="worker-actions"><button className="text-button" onClick={() => openForm(employee)}><Pencil size={14}/> تعديل</button><button className="text-button danger-text" onClick={() => removeEmployee(employee)}><Trash2 size={14}/> إيقاف</button></div></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-inline">لا توجد سجلات موظفين بعد.</div>}
    </section>

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
