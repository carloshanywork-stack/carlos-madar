import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api.js';
import { egpToCents, errorMessage, formatDate, formatMoney } from '../../lib/format.js';
import { useApi } from '../../lib/useApi.js';
import { useToast } from '../../lib/useToast.js';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Toast from '../../components/ui/Toast.jsx';
import MonthlyAttendanceMatrix from './MonthlyAttendanceMatrix.jsx';

const departments = ['Maintenance', 'Workshop', 'Management', 'Sales', 'Warehouse', 'Finance', 'Administration'];
const attendanceStatus = [
  { value: 'present', label: 'حاضر' }, { value: 'absent', label: 'غائب' },
  { value: 'late', label: 'متأخر' }, { value: 'leave', label: 'إجازة' },
];

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function currentDate() { return new Date().toISOString().slice(0, 10); }
function formatClock(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export default function AccountingPage({ isAdmin = false }) {
  const [tab, setTab] = useState('staff');
  const [attendanceView, setAttendanceView] = useState('monthly');
  const [date, setDate] = useState(currentDate());
  const manuallySelectedDate = useRef(false);
  const [month, setMonth] = useState(currentMonth());
  const { data: employees, loading: employeesLoading, error: employeesError, reload: reloadEmployees } = useApi('/api/employees?all=1');
  const { data: attendance, loading: attendanceLoading, error: attendanceError, reload: reloadAttendance } = useApi(`/api/employees/attendance?date=${date}`, { enabled: tab === 'attendance' && attendanceView === 'daily' });
  const { data: pendingOvertime, error: overtimeError, reload: reloadPendingOvertime } = useApi('/api/attendance/pending-overtime', { enabled: tab === 'attendance' && isAdmin });
  const { data: attendanceToday } = useApi('/api/attendance/today', { enabled: tab === 'attendance' });
  const { data: payroll, loading: payrollLoading, error: payrollError, reload: reloadPayroll } = useApi(`/api/employees/payroll?month=${month}`, { enabled: tab === 'payroll' });
  const { data: treasury, loading: treasuryLoading, error: treasuryError } = useApi('/api/finance/treasury', { enabled: tab === 'treasury' });
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const { data: tools, loading: toolsLoading, reload: reloadTools } = useApi(selectedEmployeeId ? `/api/employees/${selectedEmployeeId}/tools` : '', { enabled: tab === 'tools' && Boolean(selectedEmployeeId) });
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [employeeModal, setEmployeeModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toolModal, setToolModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessageText, setErrorMessageText] = useState('');
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [attendanceActionId, setAttendanceActionId] = useState(null);
  const [reviewingOvertimeId, setReviewingOvertimeId] = useState(null);
  const { notice, showToast, clearToast } = useToast();
  const activeEmployees = (employees ?? []).filter((employee) => employee.active && !employee.deleted_at);

  useEffect(() => {
    if (attendance?.employees) setAttendanceRows(attendance.employees.map((row) => ({
      employeeId: row.employee_id,
      status: row.status || 'present',
      overtimeHours: row.overtime_hours ?? 0,
      notes: row.notes ?? '',
    })));
  }, [attendance]);

  useEffect(() => {
    if (attendanceToday?.date && !manuallySelectedDate.current) setDate(attendanceToday.date);
  }, [attendanceToday]);

  async function saveEmployee(event) {
    event.preventDefault();
    setSaving(true);
    setErrorMessageText('');
    const form = new FormData(event.currentTarget);
    try {
      const payload = {
        name: form.get('name'), department: form.get('department'), job_title: form.get('job_title') || null,
        phone: form.get('phone') || null,
        monthly_salary_cents: egpToCents(form.get('monthly_salary'), { allowZero: true }),
        daily_rate_cents: form.get('daily_rate') ? egpToCents(form.get('daily_rate'), { allowZero: true }) : 0,
      };
      if (editing) await api.patch(`/api/employees/${editing.id}`, payload);
      else await api.post('/api/employees', payload);
      setEmployeeModal(false);
      setEditing(null);
      await reloadEmployees();
      showToast(editing ? 'تم تحديث بيانات الموظف.' : 'تمت إضافة الموظف.');
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function setEmployeeActive(employee, active) {
    if (!window.confirm(`${active ? 'سيتم تفعيل' : 'سيتم إيقاف'} ${employee.name}. متابعة؟`)) return;
    try {
      await api.patch(`/api/employees/${employee.id}`, { active });
      await reloadEmployees();
      showToast(active ? 'تم تفعيل الموظف.' : 'تم إيقاف الموظف، وأُلغي وصوله للنظام إن كان مرتبطاً بحساب دخول.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
  }

  async function saveAttendance() {
    setSavingAttendance(true);
    setErrorMessageText('');
    try {
      await api.post('/api/employees/attendance', { date, records: attendanceRows });
      await reloadAttendance();
      showToast('تم حفظ سجل الحضور اليومي.');
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setSavingAttendance(false); }
  }

  async function clockEmployee(employee, action) {
    setAttendanceActionId(employee.employee_id);
    setErrorMessageText('');
    try {
      await api.post(action === 'in' ? '/api/attendance/mark' : '/api/attendance/clock-out', { employeeId: employee.employee_id });
      await Promise.all([reloadAttendance(), reloadPendingOvertime()]);
      showToast(action === 'in' ? `تم تسجيل حضور ${employee.name}.` : `تم تسجيل انصراف ${employee.name}.`);
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setAttendanceActionId(null); }
  }

  async function reviewOvertime(record, decision) {
    setReviewingOvertimeId(record.id);
    setErrorMessageText('');
    try {
      await api.post(`/api/attendance/${record.id}/${decision}-overtime`, {});
      await Promise.all([reloadPendingOvertime(), reloadAttendance(), reloadPayroll()]);
      showToast(decision === 'approve' ? 'تم اعتماد الساعات الإضافية.' : 'تم رفض الساعات الإضافية.');
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setReviewingOvertimeId(null); }
  }

  function changeAttendance(employeeId, key, value) {
    setAttendanceRows((rows) => rows.map((row) => row.employeeId === employeeId ? { ...row, [key]: value } : row));
  }

  async function finalizePayroll() {
    if (!window.confirm(`سيتم اعتماد مسير ${month} وتسجيل صافي الرواتب كمصروفات خزينة. لا يمكن إعادة اعتماده. متابعة؟`)) return;
    setSaving(true);
    setErrorMessageText('');
    try {
      await api.post('/api/employees/payroll/finalize', { month });
      await reloadPayroll();
      await reloadEmployees();
      showToast('تم اعتماد وصرف الرواتب وربطها بدفتر الخزينة.');
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function issueTool(event) {
    event.preventDefault();
    if (!selectedEmployeeId) return;
    setSaving(true);
    setErrorMessageText('');
    const form = new FormData(event.currentTarget);
    try {
      await api.post(`/api/employees/${selectedEmployeeId}/tools`, {
        tool_name: form.get('tool_name'), serial_number: form.get('serial_number') || null, notes: form.get('notes') || null,
      });
      setToolModal(false);
      await reloadTools();
      showToast('تم تسجيل عهدة الأداة.');
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  async function returnTool(tool) {
    try {
      await api.post(`/api/employees/tools/${tool.id}/return`, {});
      await reloadTools();
      showToast('تم تسجيل إرجاع الأداة.');
    } catch (caught) { showToast(errorMessage(caught), 'error'); }
  }

  const tabs = [
    { value: 'staff', label: 'دليل الموظفين' }, { value: 'attendance', label: 'سجل الحضور اليومي' },
    { value: 'payroll', label: 'مسير الرواتب' }, { value: 'tools', label: 'عهد الأدوات' }, { value: 'treasury', label: 'دفتر الخزينة' },
  ];

  return (
    <>
      <PageHeader kicker="المحاسبة · الكادر" title="المحاسبة والموظفون" description="إدارة بيانات الفريق والحضور والعهد ومسير الرواتب المرتبط بالخزينة." />
      <div className="madar-section"><Tabs items={tabs} value={tab} onChange={(next) => { setTab(next); setErrorMessageText(''); }} ariaLabel="أقسام الموظفين والمحاسبة" /></div>

      {errorMessageText && <div className="madar-section"><Alert tone="error">{errorMessageText}</Alert></div>}
      {tab === 'staff' && <>
        <div className="madar-list-toolbar madar-section"><div><strong>دليل الموظفين</strong><span className="madar-small madar-muted"> {activeEmployees.length} موظف نشط</span></div><Button icon="plus" onClick={() => { setEditing(null); setErrorMessageText(''); setEmployeeModal(true); }}>إضافة موظف</Button></div>
        {employeesError && <Alert tone="error">{employeesError}</Alert>}
        <section className="madar-panel madar-section">{employeesLoading ? <LoadingState /> : employees?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الموظف</th><th>القسم</th><th>المسمى الوظيفي</th><th>الهاتف</th><th>الراتب الشهري</th><th>الحالة</th><th>إجراءات</th></tr></thead><tbody>{employees.map((employee) => <tr key={employee.id}><td><strong>{employee.name}</strong></td><td>{employee.department}</td><td>{employee.job_title || '—'}</td><td>{employee.phone || '—'}</td><td>{formatMoney(employee.monthly_salary_cents)}</td><td><Badge tone={employee.active ? 'success' : 'neutral'}>{employee.active ? 'نشط' : 'موقوف'}</Badge></td><td><div className="madar-inline-wrap"><Button variant="ghost" size="small" onClick={() => { setEditing(employee); setErrorMessageText(''); setEmployeeModal(true); }}>تعديل</Button><Button variant="ghost" size="small" onClick={() => setEmployeeActive(employee, !employee.active)}>{employee.active ? 'إيقاف' : 'إعادة تفعيل'}</Button></div></td></tr>)}</tbody></table></div> : <EmptyState icon="users" title="لا يوجد موظفون" action={<Button icon="plus" onClick={() => setEmployeeModal(true)}>إضافة موظف</Button>} />}</section>
      </>}

      {tab === 'attendance' && <>
        {overtimeError && <div className="madar-section"><Alert tone="error">{overtimeError}</Alert></div>}
        {pendingOvertime?.records?.length > 0 && <section className="madar-panel madar-section" aria-label="ساعات إضافية بانتظار الاعتماد">
          <div className="madar-panel-header"><div><h2>ساعات عمل إضافية بانتظار الاعتماد</h2><p>لن تدخل ساعات الحضور المسجلة بالتطبيق في مسير الرواتب حتى اعتمادها.</p></div><Badge tone="warning">{pendingOvertime.records.length}</Badge></div>
          <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الموظف</th><th>التاريخ</th><th>إجمالي الدوام</th><th>ساعات عادية</th><th>ساعات إضافية</th><th>إجراء</th></tr></thead><tbody>
            {pendingOvertime.records.map((record) => <tr key={record.id}><td>{record.name}</td><td>{record.work_date}</td><td>{record.total_hours} س</td><td>{record.regular_hours} س</td><td><strong>{record.overtime_hours} س</strong></td><td>{isAdmin ? <div className="madar-inline-wrap"><Button size="small" disabled={reviewingOvertimeId === record.id} onClick={() => void reviewOvertime(record, 'approve')}>اعتماد</Button><Button size="small" variant="danger" disabled={reviewingOvertimeId === record.id} onClick={() => void reviewOvertime(record, 'reject')}>رفض</Button></div> : <Badge tone="warning">بانتظار الإدارة</Badge>}</td></tr>)}
          </tbody></table></div>
        </section>}
        <div className="madar-list-toolbar madar-section madar-attendance-view-toggle">
          <div><strong>إدارة سجل الحضور</strong><span className="madar-small madar-muted">اختر عرض الشهر الكامل أو تفاصيل يوم واحد.</span></div>
          <div className="madar-inline-wrap">
            <Button variant={attendanceView === 'monthly' ? 'primary' : 'secondary'} size="small" onClick={() => setAttendanceView('monthly')}>عرض مصفوفة الشهر كامل</Button>
            <Button variant={attendanceView === 'daily' ? 'primary' : 'secondary'} size="small" onClick={() => setAttendanceView('daily')}>عرض اليوم الفردي</Button>
          </div>
        </div>
        {attendanceView === 'monthly' ? <MonthlyAttendanceMatrix /> : <>
        <div className="madar-list-toolbar madar-section"><Input label="تاريخ الحضور" type="date" value={date} onChange={(event) => { manuallySelectedDate.current = true; setDate(event.target.value); }} /><Button icon="check" disabled={savingAttendance || !attendanceRows.length} onClick={saveAttendance}>{savingAttendance ? 'جارٍ الحفظ…' : 'حفظ الحضور'}</Button></div>
        {attendanceError && <Alert tone="error">{attendanceError}</Alert>}
        <section className="madar-panel madar-section">{attendanceLoading ? <LoadingState /> : attendance?.employees?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الموظف</th><th>القسم</th><th>الحالة</th><th>تسجيل الحضور</th><th>تسجيل الانصراف</th><th>الساعات</th><th>الإضافي</th><th>ملاحظات</th><th>إجراء</th></tr></thead><tbody>{attendance.employees.map((employee, index) => {
          const hasClockIn = Boolean(employee.clock_in_time);
          const hasClockOut = Boolean(employee.clock_out_time);
          const isClockedToday = date === attendanceToday?.date;
          return <tr key={employee.employee_id}>
            <td><strong>{employee.name}</strong>{employee.user_role && <small className="madar-small madar-muted"> · {employee.user_role}</small>}</td>
            <td>{employee.department}</td>
            <td><Select aria-label={`حالة ${employee.name}`} value={attendanceRows[index]?.status ?? 'present'} onChange={(event) => changeAttendance(employee.employee_id, 'status', event.target.value)}>{attendanceStatus.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></td>
            <td>{hasClockIn ? <span title={employee.clock_in_source}>{formatClock(employee.clock_in_time)}</span> : '—'}</td>
            <td>{hasClockOut ? <span title={employee.clock_out_source}>{formatClock(employee.clock_out_time)}</span> : '—'}</td>
            <td>{employee.total_hours ?? 0} / {employee.regular_hours ?? 0} س</td>
            <td>{employee.overtime_hours ?? 0} س{employee.overtime_status === 'pending' ? <Badge tone="warning">بانتظار الاعتماد</Badge> : employee.overtime_status === 'approved' ? <Badge tone="success">معتمد</Badge> : employee.overtime_status === 'rejected' ? <Badge tone="danger">مرفوض</Badge> : null}<br /><Input type="number" min="0" max="24" step="0.25" aria-label={`الساعات الإضافية لـ ${employee.name}`} disabled={hasClockIn || hasClockOut} value={attendanceRows[index]?.overtimeHours ?? 0} onChange={(event) => changeAttendance(employee.employee_id, 'overtimeHours', Number(event.target.value))} /></td>
            <td><Input aria-label={`ملاحظات ${employee.name}`} value={attendanceRows[index]?.notes ?? ''} maxLength={1000} onChange={(event) => changeAttendance(employee.employee_id, 'notes', event.target.value)} /></td>
            <td>{!isAdmin ? '—' : !isClockedToday ? <span className="madar-small madar-muted">إجراءات اليوم فقط</span> : !hasClockIn ? <Button size="small" disabled={attendanceActionId === employee.employee_id} onClick={() => void clockEmployee(employee, 'in')}>تسجيل حضور</Button> : !hasClockOut ? <Button size="small" variant="secondary" disabled={attendanceActionId === employee.employee_id} onClick={() => void clockEmployee(employee, 'out')}>تسجيل انصراف</Button> : <Badge tone="success">اكتمل</Badge>}</td>
          </tr>;
        })}</tbody></table></div> : <EmptyState icon="calendar" title="لا يوجد موظفون نشطون" />}</section>
        </>}
      </>}

      {tab === 'payroll' && <>
        <div className="madar-list-toolbar madar-section"><Input label="الشهر" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />{payroll?.finalized && <Badge tone="success">معتمد ومصروف</Badge>}<Button icon="check" disabled={saving || payroll?.finalized || payroll?.pending_overtime_count > 0 || !payroll?.lines?.length} onClick={finalizePayroll}>اعتماد وصرف الرواتب</Button></div>
        {payroll?.pending_overtime_count > 0 && <div className="madar-section"><Alert tone="warning">توجد {payroll.pending_overtime_count} سجلات إضافي معلقة لهذا الشهر. راجعها من سجل الحضور واعتمدها أو ارفضها قبل إقفال مسير الرواتب.</Alert></div>}
        {payrollError && <Alert tone="error">{payrollError}</Alert>}
        <section className="madar-panel madar-section">{payrollLoading ? <LoadingState /> : payroll?.lines?.length ? <><div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الموظف</th><th>القسم</th><th>الأجر الأساسي</th><th>أيام الحضور</th><th>أيام الغياب</th><th>الإضافي</th><th>الخصومات</th><th>صافي الراتب</th></tr></thead><tbody>{payroll.lines.map((line) => <tr key={line.employee_id}><td>{line.name}</td><td>{line.department}</td><td>{formatMoney(line.base_salary_cents)}</td><td>{line.present_days}</td><td>{line.absent_days}</td><td>{formatMoney(line.overtime_amount_cents)} <small>({line.overtime_hours} س)</small></td><td>{formatMoney(line.deductions_cents)}</td><td className="madar-money"><strong>{formatMoney(line.net_salary_cents)}</strong></td></tr>)}</tbody></table></div><div className="madar-panel-pad"><strong>إجمالي الصافي: {formatMoney(payroll.totals?.net_total_cents ?? payroll.run?.net_total_cents)}</strong><p className="madar-small madar-muted">الحساب: الراتب الشهري + العمل الإضافي − خصم الغياب. تُحتسب الساعة الإضافية بمعدل 1.5×.</p></div></> : <EmptyState icon="wallet" title="لا توجد رواتب لهذا الشهر" description="أضف موظفين نشطين أو اختر شهراً آخر." />}</section>
      </>}

      {tab === 'tools' && <>
        <div className="madar-list-toolbar madar-section"><Select label="الموظف" value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}><option value="">اختر موظفاً</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select><Button icon="plus" disabled={!selectedEmployeeId} onClick={() => { setErrorMessageText(''); setToolModal(true); }}>تسجيل عهدة أداة</Button></div>
        <section className="madar-panel madar-section">{toolsLoading ? <LoadingState /> : tools?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الأداة</th><th>الرقم التسلسلي</th><th>تاريخ التسليم</th><th>تاريخ الإرجاع</th><th>ملاحظات</th><th /></tr></thead><tbody>{tools.map((tool) => <tr key={tool.id}><td>{tool.tool_name}</td><td>{tool.serial_number || '—'}</td><td>{formatDate(tool.issued_at)}</td><td>{tool.returned_at ? formatDate(tool.returned_at) : <Badge tone="warning">بعهدة الموظف</Badge>}</td><td>{tool.notes || '—'}</td><td>{!tool.returned_at && <Button variant="secondary" size="small" onClick={() => returnTool(tool)}>تسجيل الإرجاع</Button>}</td></tr>)}</tbody></table></div> : <EmptyState icon="boxes" title={selectedEmployeeId ? 'لا توجد أدوات مسجلة' : 'اختر موظفاً لعرض عهدته'} />}</section>
      </>}

      {tab === 'treasury' && <section className="madar-panel madar-section"><div className="madar-panel-header"><div><h2>دفتر النقدية</h2><p>آخر الحركات المسجلة في الخزينة</p></div><strong className="madar-money">{treasury ? formatMoney(treasury.cashBalanceCents) : '—'}</strong></div>{treasuryError && <div className="madar-panel-body"><Alert tone="error">{treasuryError}</Alert></div>}{treasuryLoading && !treasury ? <LoadingState /> : treasury?.entries?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>التاريخ</th><th>التصنيف</th><th>النوع</th><th>المبلغ</th><th>الموظف</th></tr></thead><tbody>{treasury.entries.map((entry) => <tr key={entry.id}><td>{formatDate(entry.created_at)}</td><td>{entry.category}</td><td><Badge tone={entry.kind === 'income' ? 'success' : 'danger'}>{entry.kind === 'income' ? 'إيراد' : 'مصروف'}</Badge></td><td>{formatMoney(entry.amount_cents)}</td><td>{entry.employee_name || '—'}</td></tr>)}</tbody></table></div> : <EmptyState icon="wallet" title="لا توجد حركات خزينة" />}</section>}

      <Modal open={employeeModal} onClose={() => setEmployeeModal(false)} title={editing ? 'تعديل بيانات موظف' : 'إضافة موظف'}>
        <form onSubmit={saveEmployee}><div className="madar-form-stack">
          <Input label="الاسم *" name="name" required defaultValue={editing?.name ?? ''} maxLength={160} />
          <Select label="القسم *" name="department" required defaultValue={editing?.department ?? 'Maintenance'}>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</Select>
          <Input label="المسمى الوظيفي" name="job_title" defaultValue={editing?.job_title ?? ''} maxLength={120} />
          <Input label="الهاتف" name="phone" defaultValue={editing?.phone ?? ''} maxLength={80} />
          <Input label="الراتب الشهري (جنيه)" name="monthly_salary" type="text" inputMode="decimal" required defaultValue={editing ? (editing.monthly_salary_cents / 100).toFixed(2) : '0.00'} />
          <Input label="الأجر اليومي (اختياري، جنيه)" name="daily_rate" type="text" inputMode="decimal" defaultValue={editing?.daily_rate_cents ? (editing.daily_rate_cents / 100).toFixed(2) : ''} hint="إذا تركته صفراً يُحسب تلقائياً من الراتب الشهري ÷ 26." />
        </div>{errorMessageText && <Alert tone="error">{errorMessageText}</Alert>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setEmployeeModal(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ'}</Button></div></form>
      </Modal>
      <Modal open={toolModal} onClose={() => setToolModal(false)} title="تسجيل عهدة أداة">
        <form onSubmit={issueTool}><div className="madar-form-stack"><Input label="اسم الأداة *" name="tool_name" required maxLength={160} /><Input label="الرقم التسلسلي" name="serial_number" maxLength={120} /><Textarea label="ملاحظات" name="notes" maxLength={1000} /></div>{errorMessageText && <Alert tone="error">{errorMessageText}</Alert>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setToolModal(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'تسجيل الأداة'}</Button></div></form>
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
