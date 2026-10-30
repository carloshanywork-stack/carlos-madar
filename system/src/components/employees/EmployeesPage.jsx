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
const emptyEmployee = { name: '', jobTitle: '', department: 'Maintenance', phone: '', monthlyBaseSalary: '0', username: '', password: '', role: 'operations', canLogin: false, active: true }
const localDate = () => {
  const date = new Date()
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 10)
}

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
  const [attendanceDate, setAttendanceDate] = useState(localDate)
  const [attendance, setAttendance] = useState([])
  const [attendanceSaving, setAttendanceSaving] = useState(false)
  const [toolEmployee, setToolEmployee] = useState(null)
  const [toolRows, setToolRows] = useState([])
  const [toolForm, setToolForm] = useState({ toolName: '', serialNumber: '', notes: '' })
  const [toolSaving, setToolSaving] = useState(false)

  const loadEmployees = async () => {
    setLoading(true)
    try {
      const rows = await apiClient('/staff?includeInactive=true')
      setEmployees(Array.isArray(rows) ? rows : [])
    } catch (error) {
      notify?.(error.message || 'تعذر تحميل بيانات الموظفين.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadEmployees() }, [])

  const loadAttendance = async () => {
    try {
      const result = await apiClient(`/staff/attendance?date=${encodeURIComponent(attendanceDate)}`)
      setAttendance(Array.isArray(result.employees) ? result.employees : [])
    } catch (error) { notify?.(error.message || 'تعذر تحميل سجل الحضور.') }
  }
  useEffect(() => { void loadAttendance() }, [attendanceDate])

  const saveAttendance = async () => {
    setAttendanceSaving(true)
    try {
      await apiClient(`/staff/attendance/${attendanceDate}`, { method: 'PUT', body: JSON.stringify({
        entries: attendance.map((row) => ({
          employeeId: row.employee_id, status: row.status || 'present',
          overtimeMinutes: Number(row.overtime_minutes || 0),
          holidayOvertimeMinutes: Number(row.holiday_overtime_minutes || 0), notes: row.notes || '',
        })),
      }) })
      await loadAttendance()
      await loadEmployees()
      notify?.('تم حفظ الحضور والإضافي لهذا اليوم.')
    } catch (error) { notify?.(error.message || 'تعذر حفظ الحضور.') }
    finally { setAttendanceSaving(false) }
  }

  const markAllPresent = async () => {
    setAttendanceSaving(true)
    try {
      await apiClient('/staff/attendance/mark-all-present', { method: 'POST', body: JSON.stringify({ date: attendanceDate }) })
      await loadAttendance()
      notify?.('تم تسجيل حضور جميع الموظفين النشطين؛ يمكن تعديل الغياب والإضافي قبل الحفظ.')
    } catch (error) { notify?.(error.message || 'تعذر تسجيل الحضور.') }
    finally { setAttendanceSaving(false) }
  }

  const openTools = async (employee) => {
    setToolEmployee(employee)
    setToolForm({ toolName: '', serialNumber: '', notes: '' })
    try { setToolRows(await apiClient(`/staff/${employee.id}/tools`)) }
    catch (error) { setToolRows([]); notify?.(error.message || 'تعذر تحميل عهدة الأدوات.') }
  }
  const issueTool = async (event) => {
    event.preventDefault()
    if (!toolEmployee || toolSaving) return
    setToolSaving(true)
    try {
      await apiClient(`/staff/${toolEmployee.id}/tools`, { method: 'POST', body: JSON.stringify(toolForm) })
      setToolForm({ toolName: '', serialNumber: '', notes: '' })
      setToolRows(await apiClient(`/staff/${toolEmployee.id}/tools`))
      await loadEmployees()
      notify?.('تم تسجيل عهدة الأداة على الموظف.')
    } catch (error) { notify?.(error.message || 'تعذر تسجيل العهدة.') }
    finally { setToolSaving(false) }
  }
  const returnTool = async (tool) => {
    if (!window.confirm(`تأكيد استلام ${tool.tool_name} من الموظف؟`)) return
    try {
      await apiClient(`/staff/tools/${tool.id}/return`, { method: 'POST', body: JSON.stringify({}) })
      setToolRows(await apiClient(`/staff/${toolEmployee.id}/tools`))
      await loadEmployees()
      notify?.('تم تسجيل استلام الأداة.')
    } catch (error) { notify?.(error.message || 'تعذر تسجيل استلام الأداة.') }
  }

  const updateAttendance = (employeeId, updates) => setAttendance((rows) => rows.map((row) => row.employee_id === employeeId ? { ...row, ...updates } : row))

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
    apiClient(`/staff/${historyEmployee.id}/history?${query}`).then((result) => {
      if (active) setHistory(result)
    }).catch((error) => {
      if (active) { setHistory(null); notify?.(error.message || 'تعذر تحميل سجل الموظف.') }
    }).finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [apiClient, historyEmployee?.id, historyFrom, historyTo])

  const openForm = (employee = null) => {
    setEditing(employee)
    setForm(employee ? {
      name: employee.name, jobTitle: employee.jobTitle || '', department: employee.department, phone: employee.phone || '',
      monthlyBaseSalary: String(Number(employee.monthlySalaryCents || 0) / 100),
      username: employee.username || '', password: '', role: employee.loginRole || 'operations',
      canLogin: Boolean(employee.canLogin), active: Boolean(employee.active),
    } : emptyEmployee)
    setFormOpen(true)
  }

  const needsLogin = Boolean(form.canLogin)
  const needsPassword = needsLogin && (!editing?.username || editing?.userDeleted)

  const saveEmployee = async (event) => {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), jobTitle: form.jobTitle.trim(), department: form.department, phone: form.phone.trim(), monthlyBaseSalary: form.monthlyBaseSalary,
        canLogin: form.canLogin, active: form.active }
      if (needsLogin) {
        payload.username = form.username.trim()
        payload.role = form.role
        if (form.password) payload.password = form.password
      }
      await apiClient(editing ? `/staff/${editing.id}` : '/staff', {
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

  const toggleEmployeeActive = async (employee) => {
    const active = !employee.active
    if (!active && !window.confirm(`سيتم إيقاف ${employee.name} وسحب صلاحية دخوله. متابعة؟`)) return
    try {
      await apiClient(`/staff/${employee.id}`, { method: 'PATCH', body: JSON.stringify({
        name: employee.name, jobTitle: employee.jobTitle || '', department: employee.department, phone: employee.phone || '',
        monthlyBaseSalary: Number(employee.monthlySalaryCents || 0) / 100,
        canLogin: Boolean(employee.canLogin), role: employee.loginRole || 'operations',
        ...(employee.canLogin && employee.username ? { username: employee.username } : {}), active,
      }) })
      await loadEmployees()
      await onRefresh?.()
      notify?.(active ? 'تمت إعادة تفعيل الموظف.' : 'تم إيقاف الموظف وسحب جلسات دخوله.')
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
      const response = await fetch(`/api/staff/${historyEmployee.id}/history.${format}?${query}`, { credentials: 'same-origin' })
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
      <div><span className="section-eyebrow">الفريق والموظفون</span><h2>الفريق والدوام</h2><p>سجل موحد للموظفين والحضور اليومي وعهد الأدوات المرتبطة بهم.</p></div>
      <div className="heading-actions"><button className="button button-primary" onClick={() => openForm()}><Plus size={17}/> موظف جديد</button></div>
    </header>
      <div className="users-import-note"><BriefcaseBusiness size={16}/><span>حساب النظام اختياري حسب حاجة الموظف. إيقاف الموظف يسحب الجلسات فورًا ويتطلب إقفال عهد الأدوات المفتوحة.</span></div>
    <section className="panel invoice-list-panel">
      <div className="panel-heading"><div><span className="section-eyebrow">الحضور اليومي</span><h3>تسجيل الدوام والإضافي</h3></div><div className="heading-actions">
        <label className="field"><span>التاريخ</span><input type="date" value={attendanceDate} onChange={(event) => setAttendanceDate(event.target.value)}/></label>
        <button className="button button-ghost" disabled={attendanceSaving || !attendance.length} onClick={markAllPresent}>حضور الجميع</button>
        <button className="button button-primary" disabled={attendanceSaving || !attendance.length} onClick={saveAttendance}>{attendanceSaving ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}</button>
      </div></div>
      {attendance.length ? <div className="table-wrap"><table><thead><tr><th>الموظف</th><th>الحالة</th><th>إضافي عادي (دقائق)</th><th>إضافي عطلات (دقائق)</th><th>ملاحظات</th></tr></thead><tbody>
        {attendance.map((row) => <tr key={row.employee_id}><td><strong>{row.name}</strong><small> · {departmentLabels[row.department] || row.department}</small></td>
          <td><select aria-label={`حالة حضور ${row.name}`} value={row.status || ''} onChange={(event) => updateAttendance(row.employee_id, { status: event.target.value })}>
            <option value="">غير مسجل</option><option value="present">حاضر</option><option value="absent">غائب</option><option value="leave">إجازة</option><option value="holiday">عطلة</option>
          </select></td>
          <td><input aria-label={`إضافي عادي ${row.name}`} type="number" min="0" max="1440" step="1" value={row.overtime_minutes || 0} onChange={(event) => updateAttendance(row.employee_id, { overtime_minutes: event.target.value })}/></td>
          <td><input aria-label={`إضافي عطلات ${row.name}`} type="number" min="0" max="1440" step="1" value={row.holiday_overtime_minutes || 0} onChange={(event) => updateAttendance(row.employee_id, { holiday_overtime_minutes: event.target.value })}/></td>
          <td><input aria-label={`ملاحظات ${row.name}`} maxLength={500} value={row.notes || ''} onChange={(event) => updateAttendance(row.employee_id, { notes: event.target.value })}/></td>
        </tr>)}
      </tbody></table></div> : <div className="empty-inline">لا يوجد موظفون نشطون لتسجيل الدوام.</div>}
    </section>
    <section className="panel users-panel">
      <div className="panel-heading"><div><span className="section-eyebrow">سجل الموارد البشرية</span><h3>قائمة الموظفين</h3></div><span className="result-count">{employees.length} موظف</span></div>
      {loading ? <div className="loading-inline">جارٍ تحميل الموظفين...</div> : employees.length ? <div className="table-wrap"><table>
        <thead><tr><th>الموظف</th><th>القسم</th><th>الهاتف</th><th>الراتب الأساسي الشهري</th><th>حالة الموظف</th><th>حساب النظام</th><th>عهد الأدوات</th><th>الإجراءات</th></tr></thead>
        <tbody>{employees.map((employee) => <tr key={employee.id} id={`employee-record-${employee.id}`}>
          <td><div className="user-cell"><span className="avatar"><UserRound size={15}/></span><strong>{employee.name}</strong></div></td>
          <td><span className="role-label">{departmentLabels[employee.department] || employee.department}</span></td>
          <td>{employee.phone || '—'}</td>
          <td>{new Intl.NumberFormat('ar-EG',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(employee.monthlySalaryCents||0)/100)} ج.م</td>
          <td>{employee.active ? 'نشط' : 'غير نشط'}</td>
          <td>{employee.canLogin ? employee.username || '—' : 'بدون دخول'}{employee.canLogin && employee.username && <small className={employee.userActive && employee.active ? 'employee-access-active' : 'employee-access-disabled'}>{employee.userActive && employee.active ? ' · نشط' : ' · موقوف'}</small>}</td>
          <td>{employee.outstandingToolCount || 0} مفتوح</td>
          <td><div className="worker-actions"><button className="text-button" onClick={() => openTools(employee)}>العهدة</button><button className="text-button" onClick={() => openHistory(employee)}><History size={14}/> السجل</button><button className="text-button" onClick={() => openForm(employee)}><Pencil size={14}/> تعديل</button><button className="text-button danger-text" disabled={employee.active && Number(employee.outstandingToolCount || 0) > 0} title={employee.outstandingToolCount ? 'استلم الأدوات المفتوحة أولًا' : ''} onClick={() => toggleEmployeeActive(employee)}>{employee.active ? 'إيقاف' : 'إعادة تفعيل'}</button></div></td>
        </tr>)}</tbody>
      </table></div> : <div className="empty-inline">لا توجد سجلات موظفين بعد.</div>}
    </section>

    {toolEmployee && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setToolEmployee(null)}>
      <section className="modal-card"><div className="modal-header"><div><span className="section-eyebrow">عهدة الأدوات والمعدات</span><h2>{toolEmployee.name}</h2></div><button className="icon-button" onClick={() => setToolEmployee(null)} aria-label="إغلاق"><X size={19}/></button></div>
        <form className="modal-form" onSubmit={issueTool}><label className="field"><span>اسم الأداة</span><input required maxLength={150} value={toolForm.toolName} onChange={(event) => setToolForm({ ...toolForm, toolName: event.target.value })}/></label>
          <label className="field"><span>الرقم التسلسلي</span><input maxLength={120} value={toolForm.serialNumber} onChange={(event) => setToolForm({ ...toolForm, serialNumber: event.target.value })}/></label>
          <label className="field"><span>ملاحظات</span><input maxLength={500} value={toolForm.notes} onChange={(event) => setToolForm({ ...toolForm, notes: event.target.value })}/></label>
          <button className="button button-primary" disabled={toolSaving}>{toolSaving ? 'جارٍ التسجيل...' : 'تسجيل صرف الأداة'}</button>
        </form>
        <section className="panel invoice-list-panel"><div className="panel-heading"><h3>سجل العهد</h3><span className="result-count">{toolRows.length}</span></div>{toolRows.length ? <div className="table-wrap"><table><thead><tr><th>الأداة</th><th>الرقم التسلسلي</th><th>تاريخ الصرف</th><th>الحالة</th><th/></tr></thead><tbody>{toolRows.map((tool) => <tr key={tool.id}><td>{tool.tool_name}</td><td>{tool.serial_number || '—'}</td><td>{tool.issued_at}</td><td>{tool.return_status === 'issued' ? 'بعهدة الموظف' : `تم الاستلام ${tool.returned_at || ''}`}</td><td>{tool.return_status === 'issued' && <button className="text-button" onClick={() => returnTool(tool)}>تسجيل الاستلام</button>}</td></tr>)}</tbody></table></div> : <div className="empty-inline">لا توجد عهد مسجلة.</div>}</section>
        <div className="modal-actions"><button className="button button-ghost" onClick={() => setToolEmployee(null)}>إغلاق</button></div>
      </section>
    </div>}

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
          <label className="field"><span>المسمى الوظيفي</span><input maxLength={150} value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })}/></label>
          <div className="form-row">
            <label className="field"><span>القسم <b>*</b></span><select required value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })}>
              {departments.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select></label>
            <label className="field"><span><Phone size={14}/> رقم الهاتف</span><input maxLength={80} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })}/></label>
          </div>
          <label className="field"><span>الراتب الأساسي الشهري (ج.م)</span><input type="number" min="0" step="0.01" value={form.monthlyBaseSalary} onChange={(event) => setForm({ ...form, monthlyBaseSalary: event.target.value })}/></label>
          <label className="field"><span><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })}/> الموظف نشط</span></label>
          <details className="panel modal-form"><summary>إعداد صلاحية دخول النظام</summary><label className="field"><span><input type="checkbox" checked={form.canLogin} onChange={(event) => setForm({ ...form, canLogin: event.target.checked })}/> تمكين تسجيل الدخول</span></label>
            {needsLogin && <>
              <label className="field"><span>الدور</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}><option value="admin">مدير</option><option value="operations">تشغيل</option><option value="sales">مبيعات</option><option value="purchasing">مشتريات</option></select></label>
              <label className="field"><span>اسم الدخول <b>*</b></span><input required minLength={3} maxLength={100} autoComplete="off" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })}/></label>
              <label className="field"><span><KeyRound size={14}/> {editing?.username ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور (10 أحرف على الأقل)'}{needsPassword && <b> *</b>}</span><input type="password" minLength={needsPassword ? 10 : undefined} required={needsPassword} autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/></label>
            </>}
          </details>
          <div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setFormOpen(false)}>إلغاء</button><button type="submit" className="button button-primary" disabled={saving}>{saving && <RefreshCw size={15} className="spin"/>}{saving ? 'جارٍ الحفظ...' : 'حفظ الموظف'}</button></div>
        </form>
      </section>
    </div>}
  </div>
}
