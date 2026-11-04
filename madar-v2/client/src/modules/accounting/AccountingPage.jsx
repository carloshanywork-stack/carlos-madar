import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

const attendanceStatus = [
  { value: 'present', label: 'حاضر' }, { value: 'absent', label: 'غائب' },
  { value: 'late', label: 'متأخر' }, { value: 'leave', label: 'إجازة' },
];

function currentMonth() { return new Date().toISOString().slice(0, 7); }
function currentDate() { return new Date().toISOString().slice(0, 10); }
function currentBusinessDateTimeLocal(timeZone = 'Africa/Cairo') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).filter((part) => part.type !== 'literal').map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function formatClock(value, timeZone = 'Africa/Cairo') {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'short', timeStyle: 'short', timeZone,
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

export default function AccountingPage({ isAdmin = false }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('staff');
  const [attendanceView, setAttendanceView] = useState('monthly');
  const [date, setDate] = useState(currentDate());
  const manuallySelectedDate = useRef(false);
  const [month, setMonth] = useState(currentMonth());
  const { data: employees, reload: reloadEmployees } = useApi('/api/employees?all=1');
  const { data: attendance, loading: attendanceLoading, error: attendanceError, reload: reloadAttendance } = useApi(`/api/employees/attendance?date=${date}`, { enabled: tab === 'attendance' && attendanceView === 'daily' });
  const { data: pendingOvertime, error: overtimeError, reload: reloadPendingOvertime } = useApi('/api/attendance/pending-overtime', { enabled: tab === 'attendance' && isAdmin });
  const { data: attendanceToday, reload: reloadAttendanceToday } = useApi('/api/attendance/today', { enabled: tab === 'attendance' && isAdmin });
  const { data: payroll, loading: payrollLoading, error: payrollError, reload: reloadPayroll } = useApi(`/api/employees/payroll?month=${month}`, { enabled: tab === 'payroll' });
  const { data: treasury, loading: treasuryLoading, error: treasuryError } = useApi('/api/finance/treasury', { enabled: tab === 'treasury' });
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const { data: tools, loading: toolsLoading, reload: reloadTools } = useApi(selectedEmployeeId ? `/api/employees/${selectedEmployeeId}/tools` : '', { enabled: tab === 'tools' && Boolean(selectedEmployeeId) });
  const [attendanceRows, setAttendanceRows] = useState([]);
  const [payrollModal, setPayrollModal] = useState(false);
  const [payrollEmployee, setPayrollEmployee] = useState(null);
  const [payrollAction, setPayrollAction] = useState('bonus');
  const [toolModal, setToolModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessageText, setErrorMessageText] = useState('');
  const [savingAttendance, setSavingAttendance] = useState(false);
  const [attendanceActionId, setAttendanceActionId] = useState(null);
  const [clockOutEmployee, setClockOutEmployee] = useState(null);
  const [clockOutLocal, setClockOutLocal] = useState('');
  const [clockOutAdminNote, setClockOutAdminNote] = useState('');
  const [reviewingOvertimeId, setReviewingOvertimeId] = useState(null);
  const { notice, showToast, clearToast } = useToast();
  const activeEmployees = (employees ?? []).filter((employee) => employee.active && !employee.deleted_at);
  const businessTimeZone = attendanceToday?.timeZone || 'Africa/Cairo';

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

  useEffect(() => {
    if (!isAdmin || !['attendance', 'payroll'].includes(tab)) return undefined;
    const onOperationsEvent = (message) => {
      const event = message.detail;
      if (!['attendance.changed', 'overtime.reviewed', 'overtime.pending'].includes(event?.type)) return;
      void Promise.all([reloadAttendance(), reloadPendingOvertime(), reloadPayroll(), reloadAttendanceToday()]);
      window.dispatchEvent(new CustomEvent('madar:attendance-updated', { detail: event }));
      if (event.type === 'overtime.pending') showToast('يوجد أوفر تايم جديد بانتظار الاعتماد.');
    };
    window.addEventListener('madar:operations-event', onOperationsEvent);
    return () => {
      window.removeEventListener('madar:operations-event', onOperationsEvent);
    };
  }, [isAdmin, tab, reloadAttendance, reloadPendingOvertime, reloadPayroll, reloadAttendanceToday, showToast]);

  useEffect(() => {
    if (tab !== 'attendance' || !isAdmin) return undefined;
    const interval = window.setInterval(() => { void reloadAttendanceToday(); }, 60_000);
    return () => window.clearInterval(interval);
  }, [isAdmin, tab, reloadAttendanceToday]);

  function openPayrollAction(employee, action) {
    setPayrollEmployee(employee);
    setPayrollAction(action);
    setErrorMessageText('');
    setPayrollModal(true);
  }

  async function savePayrollAction(event) {
    event.preventDefault();
    if (!payrollEmployee) return;
    setSaving(true);
    setErrorMessageText('');
    const form = new FormData(event.currentTarget);
    try {
      const amountCents = egpToCents(form.get('amount'), { allowZero: false });
      if (payrollAction === 'advance') {
        await api.post(`/api/employees/${payrollEmployee.employee_id}/advances`, {
          month, amountCents, notes: form.get('description') || null,
        });
      } else {
        await api.post(`/api/employees/${payrollEmployee.employee_id}/payroll-adjustments`, {
          month, kind: payrollAction, amountCents, description: form.get('description'),
        });
      }
      setPayrollModal(false);
      await Promise.all([reloadPayroll(), reloadEmployees()]);
      showToast(payrollAction === 'advance' ? 'سُجلت السلفة كحركة صرف في الخزينة.' : 'أُضيفت التسوية إلى مسير الشهر.');
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  function printPayslip(line) {
    const popup = window.open('', '_blank');
    if (!popup) {
      showToast('اسمح بفتح نافذة الطباعة لإظهار قسيمة الراتب.', 'error');
      return;
    }
    popup.opener = null;
    const rows = [
      ['الراتب الأساسي', line.base_salary_cents],
      [`إضافي عادي (${line.normal_overtime_hours ?? 0} ساعة × 1.5)`, line.normal_overtime_amount_cents ?? 0],
      [`إضافي الجمعة (${line.holiday_overtime_hours ?? 0} ساعة × 2)`, line.holiday_overtime_amount_cents ?? 0],
      ['المكافآت', line.bonus_cents ?? 0],
      ['خصم الغياب', line.absence_deduction_cents ?? 0],
      ['خصومات أخرى', line.other_deductions_cents ?? 0],
      ['السلف المصروفة', line.advances_cents ?? 0],
    ];
    const detailRows = rows.map(([label, amount]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(formatMoney(amount))}</td></tr>`).join('');
    const adjustmentRows = [...(line.adjustments ?? []).map((item) => `${item.kind === 'bonus' ? 'مكافأة' : 'خصم'}: ${item.description}`),
      ...(line.advance_details ?? []).map((item) => `سلفة: ${item.notes || 'بدون ملاحظة'}`)];
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>قسيمة راتب ${escapeHtml(month)}</title><style>
      body{font-family:Arial,sans-serif;color:#182c3d;margin:0;padding:34px;background:#fff}main{max-width:760px;margin:auto;border:1px solid #cad6dc;border-radius:14px;padding:26px}header{display:flex;justify-content:space-between;align-items:start;border-bottom:2px solid #176b56;padding-bottom:18px;margin-bottom:20px}h1{font-size:24px;margin:0 0 8px}p{margin:5px 0;color:#526371;font-size:13px}.stamp{border:1px solid #c7d8d0;border-radius:9px;padding:8px 12px;font-weight:bold;color:#176b56}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{padding:11px 9px;border-bottom:1px solid #e2e8eb;text-align:right;font-size:13px}td{font-weight:bold;text-align:left}.net{display:flex;justify-content:space-between;align-items:center;margin-top:24px;padding:18px;background:#f1f7f3;border-radius:10px;font-size:18px}.notes{margin-top:22px;padding-top:14px;border-top:1px dashed #bbc8ce;color:#56646c;font-size:11px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:60px;margin-top:55px}.signatures span{border-top:1px solid #7d8b93;padding-top:9px;text-align:center;font-size:11px;color:#526371}.print{margin-top:20px;padding:10px 20px;border:0;border-radius:8px;background:#176b56;color:#fff;font-weight:bold;cursor:pointer}@media print{body{padding:0}main{border:0;border-radius:0;padding:12mm}.print{display:none}}
      </style></head><body><main><header><div><h1>قسيمة راتب · MADAR</h1><p>الموظف: <strong>${escapeHtml(line.name)}</strong></p><p>القسم: ${escapeHtml(line.department)} · الشهر: ${escapeHtml(month)}</p></div><span class="stamp">${payroll?.finalized ? 'مسير معتمد ومصروف' : 'مسودة غير معتمدة'}</span></header><table><tbody>${detailRows}</tbody></table><div class="net"><strong>صافي المستحق</strong><strong>${escapeHtml(formatMoney(line.net_salary_cents))}</strong></div>${adjustmentRows.length ? `<div class="notes"><strong>تفاصيل التسويات</strong><br>${adjustmentRows.map(escapeHtml).join('<br>')}</div>` : ''}<div class="signatures"><span>توقيع الموظف بالاستلام</span><span>اعتماد الإدارة</span></div><button class="print" onclick="window.print()">طباعة القسيمة</button></main></body></html>`);
    popup.document.close();
    popup.focus();
  }

  async function saveAttendance() {
    setSavingAttendance(true);
    setErrorMessageText('');
    try {
      await api.post('/api/employees/attendance', { date, records: attendanceRows }, { timeoutMs: 4000 });
      await reloadAttendance();
      showToast('تم حفظ سجل الحضور اليومي.');
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setSavingAttendance(false); }
  }

  async function clockEmployee(employee, action) {
    setAttendanceActionId(employee.employee_id);
    setErrorMessageText('');
    try {
      await api.post(action === 'in' ? '/api/attendance/mark' : '/api/attendance/clock-out', { employeeId: employee.employee_id }, { timeoutMs: 4000 });
      await Promise.all([reloadAttendance(), reloadPendingOvertime()]);
      showToast(action === 'in' ? `تم تسجيل حضور ${employee.name}.` : `تم تسجيل انصراف ${employee.name}.`);
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setAttendanceActionId(null); }
  }

  function openClockOut(employee) {
    setClockOutEmployee(employee);
    setClockOutLocal(currentBusinessDateTimeLocal(businessTimeZone));
    setClockOutAdminNote('');
    setErrorMessageText('');
  }

  async function submitClockOut(event) {
    event.preventDefault();
    if (!clockOutEmployee) return;
    setAttendanceActionId(clockOutEmployee.employee_id);
    setErrorMessageText('');
    try {
      await api.post('/api/attendance/clock-out', {
        employeeId: clockOutEmployee.employee_id,
        clockOutLocal,
        adminNote: clockOutAdminNote,
      }, { timeoutMs: 4000 });
      setClockOutEmployee(null);
      await Promise.all([reloadAttendance(), reloadPendingOvertime(), reloadAttendanceToday()]);
      showToast(`تم تسجيل الانصراف الإداري لـ ${clockOutEmployee.name}.`);
    } catch (caught) { setErrorMessageText(errorMessage(caught)); }
    finally { setAttendanceActionId(null); }
  }

  async function reviewOvertime(record, decision) {
    setReviewingOvertimeId(record.id);
    setErrorMessageText('');
    try {
      await api.post(`/api/attendance/${record.id}/${decision}-overtime`, {}, { timeoutMs: 4000 });
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
        <div className="madar-list-toolbar madar-section"><div><strong>دليل الفريق والكادر</strong><span className="madar-small madar-muted"> {activeEmployees.length} فرد نشط · ملف واحد لكل موظف ومندوب</span></div><Button icon="users" onClick={() => navigate('/staff')}>فتح الدليل الموحد</Button></div>
        <section className="madar-panel madar-section"><div className="madar-panel-pad"><h2>إدارة الهوية والصلاحيات من الدليل الموحد</h2><p className="madar-small madar-muted">إنشاء الموظفين وربط حسابات المناديب أو إيقافها متاح الآن من صفحة الفريق والكادر، لتجنب إنشاء ملفات مكررة.</p><Button icon="arrow" onClick={() => navigate('/staff')}>إدارة الفريق والكادر</Button></div></section>
      </>}

      {tab === 'attendance' && <>
        {overtimeError && <div className="madar-section"><Alert tone="error">{overtimeError}</Alert></div>}
        {attendanceToday?.overdue?.length > 0 && <section className="madar-panel madar-section" aria-label="تنبيهات عدم تسجيل الانصراف">
          <div className="madar-panel-header"><div><h2>تنبيه: لم يُسجّل الانصراف</h2><p>تجاوز موعد الانصراف الرسمي الساعة 6:00 مساءً · {businessTimeZone}.</p></div><Badge tone="warning">{attendanceToday.overdue.length}</Badge></div>
          <div className="madar-panel-body"><div className="madar-inline-wrap">{attendanceToday.overdue.map((record) => <div key={record.id} className="madar-inline-wrap">
            <span className="madar-small"><strong>{record.name}</strong> · {record.work_date} · تجاوز الموعد بـ {record.overdue_hours} ساعة</span>
            {isAdmin && <Button size="small" variant="secondary" onClick={() => openClockOut(record)}>تسجيل انصراف إداري</Button>}
          </div>)}</div></div>
        </section>}
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
           const overdue = (attendanceToday?.overdue ?? []).find((record) => record.employee_id === employee.employee_id);
           return <tr key={employee.employee_id}>
             <td><strong>{employee.name}</strong>{employee.user_role && <small className="madar-small madar-muted"> · {employee.user_role}</small>}{overdue && <Badge tone="warning">متأخر عن الانصراف {overdue.overdue_hours} س</Badge>}</td>
            <td>{employee.department}</td>
            <td><Select aria-label={`حالة ${employee.name}`} value={attendanceRows[index]?.status ?? 'present'} onChange={(event) => changeAttendance(employee.employee_id, 'status', event.target.value)}>{attendanceStatus.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></td>
             <td>{hasClockIn ? <span title={employee.clock_in_source}>{formatClock(employee.clock_in_time, businessTimeZone)}</span> : '—'}</td>
             <td>{hasClockOut ? <span title={employee.clock_out_source}>{formatClock(employee.clock_out_time, businessTimeZone)}</span> : '—'}</td>
            <td>{employee.total_hours ?? 0} / {employee.regular_hours ?? 0} س</td>
            <td>{employee.overtime_hours ?? 0} س{employee.overtime_status === 'pending' ? <Badge tone="warning">بانتظار الاعتماد</Badge> : employee.overtime_status === 'approved' ? <Badge tone="success">معتمد</Badge> : employee.overtime_status === 'rejected' ? <Badge tone="danger">مرفوض</Badge> : null}<br /><Input type="number" min="0" max="24" step="0.25" aria-label={`الساعات الإضافية لـ ${employee.name}`} disabled={hasClockIn || hasClockOut} value={attendanceRows[index]?.overtimeHours ?? 0} onChange={(event) => changeAttendance(employee.employee_id, 'overtimeHours', Number(event.target.value))} /></td>
            <td><Input aria-label={`ملاحظات ${employee.name}`} value={attendanceRows[index]?.notes ?? ''} maxLength={1000} onChange={(event) => changeAttendance(employee.employee_id, 'notes', event.target.value)} /></td>
             <td>{!isAdmin ? '—' : !isClockedToday ? <span className="madar-small madar-muted">إجراءات اليوم فقط</span> : !hasClockIn ? <Button size="small" disabled={attendanceActionId === employee.employee_id} onClick={() => void clockEmployee(employee, 'in')}>تسجيل حضور</Button> : !hasClockOut ? <Button size="small" variant="secondary" disabled={attendanceActionId === employee.employee_id} onClick={() => openClockOut(employee)}>تسجيل انصراف إداري</Button> : <Badge tone="success">اكتمل</Badge>}</td>
          </tr>;
        })}</tbody></table></div> : <EmptyState icon="calendar" title="لا يوجد موظفون نشطون" />}</section>
        </>}
      </>}

      {tab === 'payroll' && <>
        <div className="madar-list-toolbar madar-section"><Input label="الشهر" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />{payroll?.finalized && <Badge tone="success">معتمد ومصروف</Badge>}<Button icon="check" disabled={!isAdmin || saving || payroll?.finalized || payroll?.pending_overtime_count > 0 || !payroll?.lines?.length} onClick={finalizePayroll}>اعتماد وصرف الرواتب</Button></div>
        {payroll?.pending_overtime_count > 0 && <div className="madar-section"><Alert tone="warning">توجد {payroll.pending_overtime_count} سجلات إضافي معلقة لهذا الشهر. راجعها من سجل الحضور واعتمدها أو ارفضها قبل إقفال مسير الرواتب.</Alert></div>}
        {payrollError && <Alert tone="error">{payrollError}</Alert>}
        <section className="madar-panel madar-section">{payrollLoading ? <LoadingState /> : payroll?.lines?.length ? <><div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الموظف</th><th>القسم</th><th>الأساسي</th><th>حضور</th><th>غياب</th><th>إضافي عادي · 1.5×</th><th>الجمعة · 2×</th><th>مكافآت</th><th>سلف</th><th>الخصومات</th><th>الصافي</th><th>الإجراءات</th></tr></thead><tbody>{payroll.lines.map((line) => <tr key={line.employee_id}><td>{line.name}</td><td>{line.department}</td><td>{formatMoney(line.base_salary_cents)}</td><td>{line.present_days}</td><td>{line.absent_days}</td><td>{formatMoney(line.normal_overtime_amount_cents ?? 0)} <small>({line.normal_overtime_hours ?? 0} س)</small></td><td>{formatMoney(line.holiday_overtime_amount_cents ?? 0)} <small>({line.holiday_overtime_hours ?? 0} س)</small></td><td>{formatMoney(line.bonus_cents ?? 0)}</td><td>{formatMoney(line.advances_cents ?? 0)}</td><td>{formatMoney(line.deductions_cents)}</td><td className="madar-money"><strong>{formatMoney(line.net_salary_cents)}</strong></td><td><div className="madar-inline-wrap"><Button size="small" variant="ghost" onClick={() => printPayslip(line)}>قسيمة</Button>{isAdmin && !payroll.finalized && <><Button size="small" variant="ghost" onClick={() => openPayrollAction(line, 'bonus')}>مكافأة</Button><Button size="small" variant="ghost" onClick={() => openPayrollAction(line, 'deduction')}>خصم</Button><Button size="small" variant="ghost" onClick={() => openPayrollAction(line, 'advance')}>سلفة</Button></>}</div></td></tr>)}</tbody></table></div><div className="madar-panel-pad"><strong>إجمالي الصافي: {formatMoney(payroll.totals?.net_total_cents ?? payroll.run?.net_total_cents)}</strong><p className="madar-small madar-muted">الحساب: الأساسي + الإضافي العادي (1.5×) + عمل الجمعة (2×) + المكافآت − الغياب والخصومات والسلف. السلفة تُسجل فوراً كمصروف مستقل في الخزينة.</p></div></> : <EmptyState icon="wallet" title="لا توجد رواتب لهذا الشهر" description="أضف موظفين نشطين أو اختر شهراً آخر." />}</section>
      </>}

      {tab === 'tools' && <>
        <div className="madar-list-toolbar madar-section"><Select label="الموظف" value={selectedEmployeeId} onChange={(event) => setSelectedEmployeeId(event.target.value)}><option value="">اختر موظفاً</option>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</Select><Button icon="plus" disabled={!selectedEmployeeId} onClick={() => { setErrorMessageText(''); setToolModal(true); }}>تسجيل عهدة أداة</Button></div>
        <section className="madar-panel madar-section">{toolsLoading ? <LoadingState /> : tools?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>الأداة</th><th>الرقم التسلسلي</th><th>تاريخ التسليم</th><th>تاريخ الإرجاع</th><th>ملاحظات</th><th /></tr></thead><tbody>{tools.map((tool) => <tr key={tool.id}><td>{tool.tool_name}</td><td>{tool.serial_number || '—'}</td><td>{formatDate(tool.issued_at)}</td><td>{tool.returned_at ? formatDate(tool.returned_at) : <Badge tone="warning">بعهدة الموظف</Badge>}</td><td>{tool.notes || '—'}</td><td>{!tool.returned_at && <Button variant="secondary" size="small" onClick={() => returnTool(tool)}>تسجيل الإرجاع</Button>}</td></tr>)}</tbody></table></div> : <EmptyState icon="boxes" title={selectedEmployeeId ? 'لا توجد أدوات مسجلة' : 'اختر موظفاً لعرض عهدته'} />}</section>
      </>}

      {tab === 'treasury' && <section className="madar-panel madar-section"><div className="madar-panel-header"><div><h2>دفتر النقدية</h2><p>آخر الحركات المسجلة في الخزينة</p></div><strong className="madar-money">{treasury ? formatMoney(treasury.cashBalanceCents) : '—'}</strong></div>{treasuryError && <div className="madar-panel-body"><Alert tone="error">{treasuryError}</Alert></div>}{treasuryLoading && !treasury ? <LoadingState /> : treasury?.entries?.length ? <div className="madar-table-wrap"><table className="madar-table"><thead><tr><th>التاريخ</th><th>التصنيف</th><th>النوع</th><th>المبلغ</th><th>الموظف</th></tr></thead><tbody>{treasury.entries.map((entry) => <tr key={entry.id}><td>{formatDate(entry.created_at)}</td><td>{entry.category}</td><td><Badge tone={entry.kind === 'income' ? 'success' : 'danger'}>{entry.kind === 'income' ? 'إيراد' : 'مصروف'}</Badge></td><td>{formatMoney(entry.amount_cents)}</td><td>{entry.employee_name || '—'}</td></tr>)}</tbody></table></div> : <EmptyState icon="wallet" title="لا توجد حركات خزينة" />}</section>}

      <Modal open={payrollModal} onClose={() => setPayrollModal(false)} title={payrollAction === 'advance' ? 'تسجيل سلفة راتب' : payrollAction === 'bonus' ? 'إضافة مكافأة' : 'إضافة خصم'}>
        <form onSubmit={savePayrollAction}><div className="madar-form-stack">
          <p className="madar-small madar-muted">{payrollEmployee?.name} · مسير {month}{payrollAction === 'advance' ? ' · ستُسجل السلفة كمصروف في الخزينة الآن وتُخصم من الصافي.' : ''}</p>
          <Input label="المبلغ (جنيه) *" name="amount" type="text" inputMode="decimal" required autoFocus />
          <Textarea label={payrollAction === 'advance' ? 'ملاحظات' : 'السبب *'} name="description" required={payrollAction !== 'advance'} maxLength={1000} rows={3} />
        </div>{errorMessageText && <Alert tone="error">{errorMessageText}</Alert>}<div className="madar-form-actions"><Button type="button" variant="secondary" onClick={() => setPayrollModal(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'حفظ في مسير الشهر'}</Button></div></form>
      </Modal>
      <Modal open={toolModal} onClose={() => setToolModal(false)} title="تسجيل عهدة أداة">
        <form onSubmit={issueTool}><div className="madar-form-stack"><Input label="اسم الأداة *" name="tool_name" required maxLength={160} /><Input label="الرقم التسلسلي" name="serial_number" maxLength={120} /><Textarea label="ملاحظات" name="notes" maxLength={1000} /></div>{errorMessageText && <Alert tone="error">{errorMessageText}</Alert>}<div className="madar-form-actions"><Button variant="secondary" onClick={() => setToolModal(false)}>إلغاء</Button><Button type="submit" disabled={saving}>{saving ? 'جارٍ الحفظ…' : 'تسجيل الأداة'}</Button></div></form>
      </Modal>
      <Modal open={Boolean(clockOutEmployee)} onClose={() => setClockOutEmployee(null)} title="تسجيل انصراف إداري">
        <form onSubmit={submitClockOut}><div className="madar-form-stack">
          <p className="madar-small madar-muted">{clockOutEmployee?.name} · أدخل وقت الانصراف الفعلي حسب المنطقة الزمنية {businessTimeZone}. يُحفظ التوقيت وملاحظة الإدارة في سجل التدقيق.</p>
          <Input label={`التاريخ والوقت الفعلي للانصراف · ${businessTimeZone} *`} type="datetime-local" value={clockOutLocal}
            onChange={(event) => setClockOutLocal(event.target.value)} required />
          <Textarea label="الملاحظة الإدارية *" value={clockOutAdminNote} onChange={(event) => setClockOutAdminNote(event.target.value)}
            required maxLength={1000} rows={3} placeholder="سبب تسجيل الانصراف نيابةً عن الموظف" />
        </div>{errorMessageText && <Alert tone="error">{errorMessageText}</Alert>}<div className="madar-form-actions">
          <Button type="button" variant="secondary" onClick={() => setClockOutEmployee(null)}>إلغاء</Button>
          <Button type="submit" disabled={attendanceActionId === clockOutEmployee?.employee_id || !clockOutLocal || !clockOutAdminNote.trim()}>
            {attendanceActionId === clockOutEmployee?.employee_id ? 'جارٍ التسجيل…' : 'تأكيد الانصراف'}
          </Button>
        </div></form>
      </Modal>
      <Toast notice={notice} onClose={clearToast} />
    </>
  );
}
