import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api.js';
import { errorMessage } from '../../lib/format.js';
import Alert from '../../components/ui/Alert.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Toast from '../../components/ui/Toast.jsx';
import { useToast } from '../../lib/useToast.js';
import './MonthlyAttendanceMatrix.css';

const STATUS = {
  present: { label: 'حاضر', icon: '✔', className: 'badge-present' },
  absent: { label: 'غائب', icon: '✖', className: 'badge-absent' },
  leave: { label: 'إجازة', icon: '🏖️', className: 'badge-leave' },
  late: { label: 'متأخر / نصف يوم', icon: '⏰', className: 'badge-late' },
};
const WEEKDAY = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function localMonth(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dateFor(month, day) {
  return `${month}-${String(day).padStart(2, '0')}`;
}

function cellKey(employeeId, date) {
  return `${employeeId}:${date}`;
}

function recordMap(records) {
  return Object.fromEntries(records.map((record) => [cellKey(record.employee_id, record.date), {
    status: record.status,
    overtimeHours: Number(record.overtime_hours ?? 0),
    notes: record.notes ?? '',
  }]));
}

function daySummary(employeeId, days, records) {
  let present = 0;
  let absent = 0;
  let leave = 0;
  let overtime = 0;
  for (const day of days) {
    const record = records[cellKey(employeeId, day.date)];
    if (!record) continue;
    if (['present', 'late'].includes(record.status)) present += 1;
    if (record.status === 'absent') absent += 1;
    if (record.status === 'leave') leave += 1;
    overtime += Number(record.overtimeHours ?? 0);
  }
  return { present, absent, leave, overtime: Math.round(overtime * 100) / 100 };
}

export default function MonthlyAttendanceMatrix() {
  const [month, setMonth] = useState(localMonth);
  const [employees, setEmployees] = useState([]);
  const [records, setRecords] = useState({});
  const [dirty, setDirty] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState(null);
  const { notice, showToast, clearToast } = useToast();

  const daysInMonth = useMemo(() => {
    if (!MONTH_PATTERN.test(month)) return 0;
    const [year, number] = month.split('-').map(Number);
    return new Date(year, number, 0).getDate();
  }, [month]);
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, index) => {
    const number = index + 1;
    const date = dateFor(month, number);
    const weekday = new Date(`${date}T12:00:00`).getDay();
    return { number, date, weekday, label: WEEKDAY[weekday], weekend: weekday === 5 || weekday === 6 };
  }), [daysInMonth, month]);
  const departments = useMemo(() => [...new Set(employees.map((employee) => employee.department || '—'))], [employees]);
  const today = new Date();
  const todayDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const dirtyCount = dirty.size;

  const loadMonth = useCallback(async (selectedMonth, { preserveError = false } = {}) => {
    setLoading(true);
    if (!preserveError) setError('');
    try {
      const data = await api.get(`/api/employees/attendance/monthly?month=${encodeURIComponent(selectedMonth)}`);
      setEmployees(data.employees ?? []);
      setRecords(recordMap(data.records ?? []));
      setDirty(new Set());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadMonth(month); }, [month, loadMonth]);

  function editCell(employeeId, date, patch) {
    const key = cellKey(employeeId, date);
    setRecords((current) => ({
      ...current,
      [key]: { status: 'present', overtimeHours: 0, notes: '', ...current[key], ...patch },
    }));
    setDirty((current) => new Set(current).add(key));
  }

  function toggleAttendance(employeeId, date) {
    const current = records[cellKey(employeeId, date)];
    editCell(employeeId, date, { status: current?.status === 'present' ? 'absent' : 'present' });
  }

  function openEditor(event, employeeId, date) {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(340, window.innerWidth - 24);
    setEditor({
      employeeId,
      date,
      left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
      top: Math.max(12, Math.min(rect.bottom + 5, window.innerHeight - 260)),
    });
  }

  async function saveChanges() {
    if (!dirty.size) return;
    setSaving(true);
    setError('');
    try {
      const changedRecords = [...dirty].map((key) => {
        const [employeeId, date] = key.split(':');
        const record = records[key];
        return {
          employeeId: Number(employeeId), date, status: record.status,
          overtimeHours: Number(record.overtimeHours ?? 0), notes: record.notes ?? '',
        };
      });
      const saved = await api.post('/api/employees/attendance/monthly', { month, records: changedRecords });
      setRecords(recordMap(saved.records ?? []));
      setEmployees(saved.employees ?? []);
      setDirty(new Set());
      setEditor(null);
      showToast(`تم حفظ ${changedRecords.length} سجل حضور لهذا الشهر.`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function markAllForToday() {
    if (dirty.size) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.post('/api/employees/attendance/mark-all-present', { date: todayDate });
      await loadMonth(month, { preserveError: true });
      showToast(`تم تسجيل الحضور لجميع الموظفين النشطين (${result.count}).`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function exportMonthly() {
    setError('');
    try {
      const response = await fetch(`/api/employees/attendance/export-monthly?month=${encodeURIComponent(month)}`, { credentials: 'include' });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `تعذر التصدير (${response.status})`);
      }
      const file = await response.blob();
      const url = URL.createObjectURL(file);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `كشف-الحضور-${month}.xlsx`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function changeMonth(delta) {
    if (dirty.size && !window.confirm('توجد تعديلات غير محفوظة. هل تريد تغيير الشهر وإهمالها؟')) return;
    const [year, number] = month.split('-').map(Number);
    const next = new Date(year, number - 1 + delta, 1);
    setMonth(localMonth(next));
    setEditor(null);
  }

  function chooseMonth(value) {
    if (!MONTH_PATTERN.test(value)) return;
    if (dirty.size && !window.confirm('توجد تعديلات غير محفوظة. هل تريد تغيير الشهر وإهمالها؟')) return;
    setMonth(value);
    setEditor(null);
  }

  const totalColumns = 2 + daysInMonth + 4;

  return (
    <section className="madar-attendance-matrix madar-panel madar-section">
      <div className="madar-panel-header madar-attendance-toolbar">
        <div>
          <h2>مصفوفة الحضور الشهري</h2>
          <p>انقر ✔ / ✖ للتبديل السريع، أو افتح خيارات الخلية لتسجيل الإجازة والتأخير والإضافي والملاحظات.</p>
        </div>
        <div className="madar-attendance-toolbar-actions">
          <div className="madar-attendance-month-nav" dir="ltr">
            <Button variant="secondary" size="small" aria-label="الشهر السابق" onClick={() => changeMonth(-1)}>◀</Button>
            <input aria-label="الشهر المحدد" type="month" value={month} onChange={(event) => chooseMonth(event.target.value)} />
            <Button variant="secondary" size="small" aria-label="الشهر التالي" onClick={() => changeMonth(1)}>▶</Button>
          </div>
          {todayDate.startsWith(`${month}-`) && <Button variant="secondary" size="small" disabled={saving || Boolean(dirtyCount)} title={dirtyCount ? 'احفظ التعديلات قبل التحضير الجماعي' : ''} onClick={markAllForToday}>⚡ تحضير كل موظفي اليوم</Button>}
          <Button variant="secondary" size="small" disabled={saving || Boolean(dirtyCount)} title={dirtyCount ? 'احفظ التعديلات قبل التصدير' : ''} onClick={exportMonthly}>📥 تصدير كشف الحضور (Excel)</Button>
          <Button icon="check" disabled={saving || !dirtyCount} onClick={saveChanges}>{saving ? 'جارٍ الحفظ…' : dirtyCount ? `حفظ كشف الحضور (${dirtyCount})` : 'حفظ كشف الحضور'}</Button>
        </div>
      </div>
      {error && <div className="madar-panel-pad"><Alert tone="error">{error}</Alert></div>}
      {loading ? <div className="madar-panel-pad"><LoadingState /></div> : employees.length ? (
        <div className="madar-attendance-grid-scroll">
          <table className="madar-attendance-grid" dir="rtl">
            <thead>
              <tr>
                <th className="madar-attendance-sticky madar-attendance-employee">الموظف</th>
                <th className="madar-attendance-sticky madar-attendance-department">القسم</th>
                {days.map((day) => <th key={day.date} className={day.weekend ? 'madar-day-weekend' : ''}>
                  <span className="madar-attendance-weekday">{day.label}</span>
                  <strong>{day.number}</strong>
                  {day.date === todayDate && <button type="button" className="madar-attendance-bulk" disabled={saving || Boolean(dirtyCount)} title="تحضير جميع الموظفين النشطين" onClick={markAllForToday}>⚡ الكل</button>}
                </th>)}
                <th className="madar-attendance-summary-head">حضور</th>
                <th className="madar-attendance-summary-head">غياب</th>
                <th className="madar-attendance-summary-head">إجازات</th>
                <th className="madar-attendance-summary-head">إضافي (س)</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((department) => <Fragment key={department}>
                <tr key={`department-${department}`} className="madar-attendance-department-row">
                  <th colSpan={totalColumns}>{department}</th>
                </tr>
                {employees.filter((employee) => (employee.department || '—') === department).map((employee) => {
                  const summary = daySummary(employee.employee_id, days, records);
                  return <tr key={employee.employee_id}>
                    <th scope="row" className="madar-attendance-sticky madar-attendance-employee">{employee.name}</th>
                    <td className="madar-attendance-sticky madar-attendance-department">{employee.department || '—'}</td>
                    {days.map((day) => {
                      const key = cellKey(employee.employee_id, day.date);
                      const record = records[key];
                      const badge = record ? STATUS[record.status] : null;
                      return <td key={day.date} className={`madar-attendance-cell ${day.weekend ? 'madar-day-weekend' : ''} ${dirty.has(key) ? 'is-dirty' : ''}`}>
                        <button type="button" className={`madar-attendance-cell-status ${badge?.className ?? 'badge-empty'}`} title={`${employee.name} · ${day.date}${badge ? ` · ${badge.label}` : ' · غير مسجل'}`} disabled={saving} onClick={() => toggleAttendance(employee.employee_id, day.date)}>
                          {badge?.icon ?? '—'}
                        </button>
                        <button type="button" className="madar-attendance-cell-edit" aria-label={`خيارات حضور ${employee.name} بتاريخ ${day.date}`} title="الحالة والإضافي والملاحظات" disabled={saving} onClick={(event) => openEditor(event, employee.employee_id, day.date)}>⋯</button>
                      </td>;
                    })}
                    <td className="madar-attendance-summary-value">{summary.present}</td>
                    <td className="madar-attendance-summary-value">{summary.absent}</td>
                    <td className="madar-attendance-summary-value">{summary.leave}</td>
                    <td className="madar-attendance-summary-value">{summary.overtime}</td>
                  </tr>;
                })}
              </Fragment>)}
            </tbody>
          </table>
        </div>
      ) : <div className="madar-panel-pad"><EmptyState icon="users" title="لا يوجد موظفون نشطون" description="أضف موظفاً نشطاً لبدء تسجيل الحضور." /></div>}

      {editor && (() => {
        const employee = employees.find((item) => item.employee_id === editor.employeeId);
        const key = cellKey(editor.employeeId, editor.date);
        const record = records[key] ?? { status: 'present', overtimeHours: 0, notes: '' };
        return <div className="madar-attendance-cell-editor" role="dialog" aria-label={`خيارات حضور ${employee?.name ?? ''}`} style={{ left: editor.left, top: editor.top }}>
          <div className="madar-attendance-editor-header"><strong>{employee?.name} · {editor.date}</strong><button type="button" aria-label="إغلاق" onClick={() => setEditor(null)}>×</button></div>
          <label>الحالة<select value={record.status} onChange={(event) => editCell(editor.employeeId, editor.date, { status: event.target.value })}>{Object.entries(STATUS).map(([value, item]) => <option key={value} value={value}>{item.icon} {item.label}</option>)}</select></label>
          <label>ساعات إضافية<input type="number" min="0" max="24" step="0.25" value={record.overtimeHours} onChange={(event) => editCell(editor.employeeId, editor.date, { overtimeHours: event.target.value === '' ? 0 : Number(event.target.value) })} /></label>
          <label>ملاحظات<input maxLength="1000" value={record.notes} onChange={(event) => editCell(editor.employeeId, editor.date, { notes: event.target.value })} /></label>
          <Button size="small" onClick={() => setEditor(null)}>تم</Button>
        </div>;
      })()}
      <Toast notice={notice} onClose={clearToast} />
    </section>
  );
}
