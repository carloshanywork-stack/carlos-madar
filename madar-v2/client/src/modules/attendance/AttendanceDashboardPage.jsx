import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '../../components/ui/Alert.jsx';
import Badge from '../../components/ui/Badge.jsx';
import Button from '../../components/ui/Button.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { Input, Select, Textarea } from '../../components/ui/Field.jsx';
import Icon from '../../components/ui/Icon.jsx';
import LoadingState from '../../components/ui/LoadingState.jsx';
import Modal from '../../components/ui/Modal.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import Tabs from '../../components/ui/Tabs.jsx';
import Toast from '../../components/ui/Toast.jsx';
import MonthlyAttendanceMatrix from '../accounting/MonthlyAttendanceMatrix.jsx';
import { api } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';

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
    timeStyle: 'short', timeZone,
  }).format(date);
}

function formatElapsed(clockInTime) {
  if (!clockInTime) return '';
  const start = new Date(clockInTime).getTime();
  if (Number.isNaN(start)) return '';
  const diffMinutes = Math.max(0, Math.floor((Date.now() - start) / 60000));
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;
  if (hours === 0) return `${minutes} د`;
  return `${hours} س و ${minutes} د`;
}

export default function AttendanceDashboardPage({ isAdmin = true }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('live');
  const [date, setDate] = useState(currentDate());
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [errorMessageText, setErrorMessageText] = useState('');
  const [toastMessage, setToastMessage] = useState('');
  const [attendanceActionId, setAttendanceActionId] = useState(null);

  // Administrative Clock-out modal
  const [clockOutEmployee, setClockOutEmployee] = useState(null);
  const [clockOutLocal, setClockOutLocal] = useState('');
  const [clockOutAdminNote, setClockOutAdminNote] = useState('');

  // Overtime reviews
  const [reviewingOvertimeId, setReviewingOvertimeId] = useState(null);
  const [reviewingRequestId, setReviewingRequestId] = useState(null);

  // Live timer tick for active shift duration
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((prev) => prev + 1), 60000);
    return () => clearInterval(timer);
  }, []);

  // Fetch Attendance Records
  const { data: attendance, loading, error: attendanceError, reload: reloadAttendance } = useApi(
    `/api/employees/attendance?date=${date}`,
    { enabled: tab === 'live' }
  );

  // Fetch Today's Live Overdue and Summary
  const { data: attendanceToday, reload: reloadToday } = useApi(
    '/api/attendance/today',
    { enabled: tab === 'live' }
  );

  // Fetch Pending Overtime Requests & Sessions
  const { data: overtimeRequests, reload: reloadOvertimeRequests } = useApi(
    '/api/attendance/overtime-requests?status=pending',
    { enabled: tab === 'overtime' || tab === 'live' }
  );

  const { data: pendingOvertime, reload: reloadPendingOvertime } = useApi(
    '/api/attendance/pending-overtime',
    { enabled: tab === 'overtime' || tab === 'live' }
  );

  // Subscribe to Operations Events for real-time live attendance updates
  useEffect(() => {
    const onOperationsEvent = (message) => {
      const event = message.detail;
      if (['attendance.changed', 'overtime.pending', 'overtime.requested', 'rep.tracking.updated'].includes(event?.type)) {
        void reloadAttendance();
        void reloadToday();
        void reloadOvertimeRequests();
        void reloadPendingOvertime();
      }
    };
    window.addEventListener('madar:operations-event', onOperationsEvent);
    return () => window.removeEventListener('madar:operations-event', onOperationsEvent);
  }, [reloadAttendance, reloadToday, reloadOvertimeRequests, reloadPendingOvertime]);

  const businessTimeZone = attendance?.timeZone || 'Africa/Cairo';
  const isSelectedDateToday = date === currentDate();

  // Metrics calculation
  const employees = attendance?.employees ?? [];
  const metrics = useMemo(() => {
    let activeDutyCount = 0;
    let completedCount = 0;
    let lateCount = 0;
    let pendingCount = 0;
    let totalWorkHours = 0;

    for (const emp of employees) {
      const hasClockIn = Boolean(emp.clock_in_time);
      const hasClockOut = Boolean(emp.clock_out_time);
      totalWorkHours += Number(emp.total_hours ?? 0);

      if (hasClockIn && !hasClockOut) {
        activeDutyCount += 1;
      } else if (hasClockIn && hasClockOut) {
        completedCount += 1;
      } else {
        pendingCount += 1;
      }

      if (emp.status === 'late') {
        lateCount += 1;
      }
    }

    const overdueCount = attendanceToday?.overdue?.length ?? 0;
    return {
      activeDutyCount,
      completedCount,
      lateCount,
      pendingCount,
      overdueCount,
      totalWorkHours: totalWorkHours.toFixed(1),
      totalEmployees: employees.length,
    };
  }, [employees, attendanceToday]);

  // Filtered Roster
  const filteredEmployees = useMemo(() => {
    return employees.filter((emp) => {
      const matchesSearch = !searchQuery.trim() || [
        emp.name,
        emp.department,
        emp.user_role,
        emp.phone,
      ].some((val) => val && String(val).toLowerCase().includes(searchQuery.trim().toLowerCase()));

      if (!matchesSearch) return false;

      const hasClockIn = Boolean(emp.clock_in_time);
      const hasClockOut = Boolean(emp.clock_out_time);

      if (statusFilter === 'active') return hasClockIn && !hasClockOut;
      if (statusFilter === 'completed') return hasClockIn && hasClockOut;
      if (statusFilter === 'pending') return !hasClockIn;
      if (statusFilter === 'late') return emp.status === 'late';
      return true;
    });
  }, [employees, searchQuery, statusFilter]);

  // One-click Administrative Clock-In
  const clockInEmployee = async (employee) => {
    try {
      setAttendanceActionId(employee.employee_id);
      await api.post('/api/attendance/mark', { employeeId: employee.employee_id }, { timeoutMs: 4000 });
      setToastMessage(`تم تسجيل حضور ${employee.name} بنجاح.`);
      await reloadAttendance();
      await reloadToday();
    } catch (err) {
      setErrorMessageText(err.message || 'تعذر تسجيل الحضور.');
    } finally {
      setAttendanceActionId(null);
    }
  };

  // Open Administrative Clock-Out Modal
  const openClockOutModal = (employee) => {
    setClockOutEmployee(employee);
    setClockOutLocal(currentBusinessDateTimeLocal(businessTimeZone));
    setClockOutAdminNote('');
    setErrorMessageText('');
  };

  // Submit Administrative Clock-Out
  const submitClockOut = async (e) => {
    e.preventDefault();
    if (!clockOutEmployee || !clockOutLocal || !clockOutAdminNote.trim()) return;
    try {
      setAttendanceActionId(clockOutEmployee.employee_id);
      await api.post('/api/attendance/clock-out', {
        employeeId: clockOutEmployee.employee_id,
        clockOutTime: new Date(clockOutLocal).toISOString(),
        adminNote: clockOutAdminNote.trim(),
        customTime: true,
      }, { timeoutMs: 5000 });
      setToastMessage(`تم تسجيل انصراف ${clockOutEmployee.name} إدارياً.`);
      setClockOutEmployee(null);
      await reloadAttendance();
      await reloadToday();
    } catch (err) {
      setErrorMessageText(err.message || 'تعذر تسجيل الانصراف الإداري.');
    } finally {
      setAttendanceActionId(null);
    }
  };

  // Overtime Review Handlers
  const reviewOvertimeRequest = async (request, decision) => {
    try {
      setReviewingRequestId(request.id);
      await api.post(`/api/attendance/overtime-requests/${request.id}/${decision === 'approved' ? 'approve' : 'reject'}`, {}, { timeoutMs: 5000 });
      setToastMessage(decision === 'approved' ? `تم اعتماد طلب أوفرتايم ${request.employee_name}.` : `تم رفض طلب أوفرتايم ${request.employee_name}.`);
      await reloadOvertimeRequests();
      await reloadAttendance();
    } catch (err) {
      setErrorMessageText(err.message || 'تعذر معالجة طلب الأوفرتايم.');
    } finally {
      setReviewingRequestId(null);
    }
  };

  const reviewCompletedOvertime = async (record, decision) => {
    try {
      setReviewingOvertimeId(record.id);
      await api.post(`/api/attendance/${record.id}/${decision}-overtime`, {}, { timeoutMs: 5000 });
      setToastMessage(decision === 'approve' ? `تم اعتماد ساعات إضافي ${record.name}.` : `تم رفض ساعات إضافي ${record.name}.`);
      await reloadPendingOvertime();
      await reloadAttendance();
    } catch (err) {
      setErrorMessageText(err.message || 'تعذر مراجعة الساعات الإضافية.');
    } finally {
      setReviewingOvertimeId(null);
    }
  };

  const tabs = [
    { value: 'live', label: 'الميدان وسجل اليوم' },
    { value: 'overtime', label: `الأوفرتايم (${(overtimeRequests?.requests?.length ?? 0) + (pendingOvertime?.records?.length ?? 0)})` },
    { value: 'monthly', label: 'مصفوفة الشهر كامل' },
  ];

  return (
    <>
      <PageHeader
        kicker="المتابعة والعمليات · الكادر"
        title="سجل الحضور والورديات"
        description="متابعة الحضور الميداني المباشر، توثيق البصمة الحيوية، وتتبع الورديات وساعات العمل."
        actions={
          <div className="madar-inline-wrap">
            <Button
              variant="secondary"
              icon="calendar"
              onClick={() => { setDate(currentDate()); }}
            >
              اليوم
            </Button>
            <Button
              variant="secondary"
              icon="download"
              onClick={() => {
                const month = date.slice(0, 7);
                window.location.href = `/api/employees/attendance/export-monthly?month=${encodeURIComponent(month)}`;
              }}
            >
              تصدير إكسيل
            </Button>
          </div>
        }
      />

      <div className="madar-section">
        <Tabs items={tabs} value={tab} onChange={setTab} ariaLabel="أقسام الحضور والورديات" />
      </div>

      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage('')} />}
      {errorMessageText && <div className="madar-section"><Alert tone="error">{errorMessageText}</Alert></div>}

      {/* TAB: LIVE FIELD & DAILY ATTENDANCE */}
      {tab === 'live' && (
        <>
          {/* KPI CARDS */}
          <div className="madar-section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
            {/* Active Duty */}
            <div className="madar-panel" style={{ padding: '18px 20px', borderTop: '4px solid #10b981', background: 'var(--madar-surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="madar-small madar-muted" style={{ fontWeight: 600 }}>في الميدان الآن</span>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 8px #10b981' }} />
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#10b981', marginTop: 8 }}>
                {metrics.activeDutyCount} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--madar-muted)' }}>مندوب</span>
              </div>
              <div className="madar-small madar-muted" style={{ marginTop: 4 }}>
                وردية نشطة ومسار GPS يعمل
              </div>
            </div>

            {/* Total Clocked Today */}
            <div className="madar-panel" style={{ padding: '18px 20px', borderTop: '4px solid var(--madar-blue-500, #3b82f6)', background: 'var(--madar-surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="madar-small madar-muted" style={{ fontWeight: 600 }}>حاضرون اليوم</span>
                <Icon name="users" size={18} />
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, marginTop: 8 }}>
                {metrics.activeDutyCount + metrics.completedCount} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--madar-muted)' }}>/ {metrics.totalEmployees}</span>
              </div>
              <div className="madar-small madar-muted" style={{ marginTop: 4 }}>
                {metrics.completedCount} انصرفوا بعد استكمال الوردية
              </div>
            </div>

            {/* Overdue / Late */}
            <div className="madar-panel" style={{ padding: '18px 20px', borderTop: '4px solid #f59e0b', background: 'var(--madar-surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="madar-small madar-muted" style={{ fontWeight: 600 }}>تجاوز الانصراف / متأخرون</span>
                <Icon name="clock" size={18} />
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: '#f59e0b', marginTop: 8 }}>
                {metrics.overdueCount} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--madar-muted)' }}>تنبيه</span>
              </div>
              <div className="madar-small madar-muted" style={{ marginTop: 4 }}>
                تجاوزوا موعد الوردية الرسمي (6:00 م)
              </div>
            </div>

            {/* Total Work Hours */}
            <div className="madar-panel" style={{ padding: '18px 20px', borderTop: '4px solid var(--madar-teal, #14b8a6)', background: 'var(--madar-surface)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span className="madar-small madar-muted" style={{ fontWeight: 600 }}>إجمالي ساعات العمل</span>
                <Icon name="chart" size={18} />
              </div>
              <div style={{ fontSize: 32, fontWeight: 800, color: 'var(--madar-teal, #14b8a6)', marginTop: 8 }}>
                {metrics.totalWorkHours} <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--madar-muted)' }}>ساعة</span>
              </div>
              <div className="madar-small madar-muted" style={{ marginTop: 4 }}>
                مجموع ساعات الدوام المنجزة
              </div>
            </div>
          </div>

          {/* OVERDUE ALERTS BANNER */}
          {attendanceToday?.overdue?.length > 0 && isSelectedDateToday && (
            <div className="madar-section">
              <div className="madar-panel" style={{ borderRight: '4px solid #f59e0b', padding: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Icon name="alert" size={20} />
                    <strong>تنبيه انصراف متأخر ({attendanceToday.overdue.length} موظف):</strong>
                    <span className="madar-small madar-muted">تجاوزوا موعد الانصراف الرسمي الساعة 6:00 مساءً.</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {attendanceToday.overdue.map((rec) => (
                    <div key={rec.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: 8 }}>
                      <span style={{ fontWeight: 600 }}>{rec.name}</span>
                      <span className="madar-small madar-muted">متأخر {rec.overdue_hours} س</span>
                      {isAdmin && (
                        <Button size="small" variant="secondary" onClick={() => openClockOutModal(rec)}>
                          تسجيل انصراف إداري
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* FILTER & TOOLBAR */}
          <div className="madar-list-toolbar madar-section" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
              <Input
                label="التاريخ"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
              <Input
                placeholder="بحث باسم الموظف أو القسم…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ minWidth: 220 }}
              />
              <Select
                label="تصفية الحالة"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">جميع الحالات</option>
                <option value="active">في الميدان الآن (نشط)</option>
                <option value="completed">اكتمل وانصرف</option>
                <option value="late">متأخر عن الحضور</option>
                <option value="pending">لم يسجل الحضور بعد</option>
              </Select>
            </div>
            <div className="madar-inline-wrap">
              <Button icon="refresh" variant="secondary" onClick={() => { void reloadAttendance(); void reloadToday(); }}>
                تحديث
              </Button>
            </div>
          </div>

          {/* ROSTER TABLE */}
          <section className="madar-panel madar-section">
            {loading ? (
              <LoadingState label="جارٍ تحميل سجل الحضور الميداني…" />
            ) : filteredEmployees.length > 0 ? (
              <div className="madar-table-wrap">
                <table className="madar-table">
                  <thead>
                    <tr>
                      <th>الموظف / المندوب</th>
                      <th>القسم والدور</th>
                      <th>حالة الوردية</th>
                      <th>الحضور وتوثيق البصمة</th>
                      <th>موقع الـ GPS</th>
                      <th>الانصراف</th>
                      <th>الساعات</th>
                      <th>الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEmployees.map((emp) => {
                      const hasClockIn = Boolean(emp.clock_in_time);
                      const hasClockOut = Boolean(emp.clock_out_time);
                      const isDutyActive = hasClockIn && !hasClockOut;
                      const hasGps = emp.clock_in_lat != null && emp.clock_in_lng != null;
                      const isBiometric = Boolean(emp.clock_in_biometric_verified);

                      return (
                        <tr key={emp.employee_id} style={isDutyActive ? { background: 'rgba(16, 185, 129, 0.03)' } : undefined}>
                          {/* Employee info */}
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <div style={{
                                width: 34, height: 34, borderRadius: '50%',
                                background: isDutyActive ? '#10b981' : 'var(--madar-ink-soft, #334155)',
                                color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 13,
                              }}>
                                {emp.name.slice(0, 1)}
                              </div>
                              <div>
                                <strong style={{ fontSize: 14 }}>{emp.name}</strong>
                                {emp.phone && <div className="madar-small madar-muted">{emp.phone}</div>}
                              </div>
                            </div>
                          </td>

                          {/* Department & Role */}
                          <td>
                            <div>{emp.department}</div>
                            {emp.user_role && (
                              <small className="madar-small madar-muted">
                                {emp.user_role === 'rep' ? 'مندوب ميداني 🚗' : emp.user_role}
                              </small>
                            )}
                          </td>

                          {/* Shift Status */}
                          <td>
                            {isDutyActive ? (
                              <span style={{
                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                padding: '4px 10px', borderRadius: 999, background: '#d1fae5', color: '#065f46',
                                fontWeight: 700, fontSize: 12,
                              }}>
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                                في الميدان الآن
                              </span>
                            ) : hasClockIn && hasClockOut ? (
                              <Badge tone="neutral">اكتملت الوردية</Badge>
                            ) : emp.status === 'late' ? (
                              <Badge tone="warning">متأخر</Badge>
                            ) : (
                              <Badge tone="danger">لم يسجل بعد</Badge>
                            )}
                          </td>

                          {/* Clock-in & Proof */}
                          <td>
                            {hasClockIn ? (
                              <div>
                                <div style={{ fontWeight: 700, color: 'var(--madar-ink)' }}>
                                  {formatClock(emp.clock_in_time, businessTimeZone)}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                  {isBiometric ? (
                                    <span style={{ fontSize: 11, color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                                      بصمة حيوية 📱
                                    </span>
                                  ) : (
                                    <span style={{ fontSize: 11, color: 'var(--madar-muted)' }}>
                                      {emp.clock_in_source === 'app' ? 'تطبيق المندوب' : 'إداري'}
                                    </span>
                                  )}
                                  {isDutyActive && (
                                    <span style={{ fontSize: 11, color: '#047857', fontWeight: 600 }}>
                                      ({formatElapsed(emp.clock_in_time)})
                                    </span>
                                  )}
                                </div>
                              </div>
                            ) : (
                              <span className="madar-small madar-muted">—</span>
                            )}
                          </td>

                          {/* GPS Location */}
                          <td>
                            {hasGps ? (
                              <a
                                href={`https://www.google.com/maps?q=${emp.clock_in_lat},${emp.clock_in_lng}`}
                                target="_blank"
                                rel="noreferrer"
                                style={{
                                  display: 'inline-flex', alignItems: 'center', gap: 4,
                                  fontSize: 12, color: 'var(--madar-blue-600, #2563eb)', fontWeight: 600,
                                }}
                                title="فتح الموقع الدقيق على خرائط جوجل"
                              >
                                <Icon name="map" size={14} />
                                {Number(emp.clock_in_lat).toFixed(4)}, {Number(emp.clock_in_lng).toFixed(4)}
                                {emp.clock_in_accuracy && <small className="madar-small madar-muted"> (±{Math.round(emp.clock_in_accuracy)}م)</small>}
                              </a>
                            ) : hasClockIn ? (
                              <span className="madar-small madar-muted">بدون إحداثيات</span>
                            ) : (
                              <span className="madar-small madar-muted">—</span>
                            )}
                          </td>

                          {/* Clock-out */}
                          <td>
                            {hasClockOut ? (
                              <div>
                                <div style={{ fontWeight: 600 }}>
                                  {formatClock(emp.clock_out_time, businessTimeZone)}
                                </div>
                                {emp.clock_out_source && (
                                  <small className="madar-small madar-muted">{emp.clock_out_source}</small>
                                )}
                              </div>
                            ) : isDutyActive ? (
                              <span style={{ color: '#10b981', fontWeight: 600, fontSize: 12 }}>الوردية جارية…</span>
                            ) : (
                              <span className="madar-small madar-muted">—</span>
                            )}
                          </td>

                          {/* Hours */}
                          <td>
                            <div>
                              <strong>{emp.total_hours ?? 0}</strong> / {emp.regular_hours ?? 0} س
                              {Number(emp.overtime_hours ?? 0) > 0 && (
                                <div style={{ color: '#d97706', fontSize: 11, fontWeight: 700 }}>
                                  +{emp.overtime_hours} س إضافي
                                </div>
                              )}
                            </div>
                          </td>

                          {/* Actions */}
                          <td>
                            <div className="madar-inline-wrap">
                              {isAdmin && !hasClockIn && isSelectedDateToday && (
                                <Button
                                  size="small"
                                  disabled={attendanceActionId === emp.employee_id}
                                  onClick={() => clockInEmployee(emp)}
                                >
                                  تسجيل حضور
                                </Button>
                              )}
                              {isAdmin && isDutyActive && (
                                <Button
                                  size="small"
                                  variant="secondary"
                                  disabled={attendanceActionId === emp.employee_id}
                                  onClick={() => openClockOutModal(emp)}
                                >
                                  تسجيل انصراف
                                </Button>
                              )}
                              {emp.user_role === 'rep' && (
                                <Button
                                  size="small"
                                  variant="ghost"
                                  onClick={() => navigate('/supervisor')}
                                  title="فتح رادار المتابعة الميداني"
                                >
                                  الرادار
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                icon="calendar"
                title="لا توجد سجلات حضور تطابق التصفية"
                description="جرّب تغيير التاريخ أو إزالة كلمات البحث."
              />
            )}
          </section>
        </>
      )}

      {/* TAB: OVERTIME REQUESTS & SESSIONS */}
      {tab === 'overtime' && (
        <div className="madar-section">
          {/* Requests needing supervisor pre-approval */}
          <section className="madar-panel madar-section" style={{ marginBottom: 20 }}>
            <div className="madar-panel-header">
              <div>
                <h2>طلبات فتح أوفرتايم · اعتماد المشرف</h2>
                <p>طلبات مرسلة من هواتف المناديب لطلب السماح ببدء وردية عمل إضافية.</p>
              </div>
              <Badge tone="warning">{overtimeRequests?.requests?.length ?? 0}</Badge>
            </div>
            {overtimeRequests?.requests?.length > 0 ? (
              <div className="madar-table-wrap">
                <table className="madar-table">
                  <thead>
                    <tr>
                      <th>المندوب</th>
                      <th>التاريخ</th>
                      <th>الدوام الأساسي</th>
                      <th>سبب طلب الأوفرتايم</th>
                      <th>وقت الطلب</th>
                      <th>الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overtimeRequests.requests.map((req) => (
                      <tr key={req.id}>
                        <td><strong>{req.employee_name}</strong><br /><small className="madar-small madar-muted">{req.department}</small></td>
                        <td>{req.work_date}</td>
                        <td>{formatClock(req.clock_in_time, businessTimeZone)} إلى {formatClock(req.clock_out_time, businessTimeZone)} ({req.total_hours ?? 0} س)</td>
                        <td style={{ maxWidth: 280 }}>{req.reason || '—'}</td>
                        <td>{formatClock(req.created_at, businessTimeZone)}</td>
                        <td>
                          {isAdmin ? (
                            <div className="madar-inline-wrap">
                              <Button
                                size="small"
                                disabled={reviewingRequestId === req.id}
                                onClick={() => reviewOvertimeRequest(req, 'approved')}
                              >
                                موافقة وفتح التسجيل
                              </Button>
                              <Button
                                size="small"
                                variant="danger"
                                disabled={reviewingRequestId === req.id}
                                onClick={() => reviewOvertimeRequest(req, 'rejected')}
                              >
                                رفض
                              </Button>
                            </div>
                          ) : (
                            <Badge tone="warning">بانتظار الإدارة</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="madar-panel-pad madar-muted">لا توجد طلبات أوفرتايم معلقة حالياً.</div>
            )}
          </section>

          {/* Completed overtime sessions pending final payroll approval */}
          <section className="madar-panel madar-section">
            <div className="madar-panel-header">
              <div>
                <h2>ساعات عمل إضافية منجزة بانتظار الاعتماد المالي</h2>
                <p>ساعات سجلها الموظفون بالفعل، وتتطلب اعتماد الإدارة لتثبيتها في مسير الرواتب.</p>
              </div>
              <Badge tone="warning">{pendingOvertime?.records?.length ?? 0}</Badge>
            </div>
            {pendingOvertime?.records?.length > 0 ? (
              <div className="madar-table-wrap">
                <table className="madar-table">
                  <thead>
                    <tr>
                      <th>الموظف</th>
                      <th>التاريخ</th>
                      <th>إجمالي الدوام</th>
                      <th>ساعات عادية</th>
                      <th>ساعات إضافية</th>
                      <th>الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingOvertime.records.map((rec) => (
                      <tr key={rec.id}>
                        <td><strong>{rec.name}</strong></td>
                        <td>{rec.work_date}</td>
                        <td>{rec.total_hours} س</td>
                        <td>{rec.regular_hours} س</td>
                        <td><strong style={{ color: '#d97706' }}>{rec.overtime_hours} س</strong></td>
                        <td>
                          {isAdmin ? (
                            <div className="madar-inline-wrap">
                              <Button
                                size="small"
                                disabled={reviewingOvertimeId === rec.id}
                                onClick={() => reviewCompletedOvertime(rec, 'approve')}
                              >
                                اعتماد الساعات
                              </Button>
                              <Button
                                size="small"
                                variant="danger"
                                disabled={reviewingOvertimeId === rec.id}
                                onClick={() => reviewCompletedOvertime(rec, 'reject')}
                              >
                                رفض
                              </Button>
                            </div>
                          ) : (
                            <Badge tone="warning">بانتظار الإدارة</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="madar-panel-pad madar-muted">لا توجد ساعات عمل إضافية معلقة.</div>
            )}
          </section>
        </div>
      )}

      {/* TAB: MONTHLY MATRIX */}
      {tab === 'monthly' && (
        <div className="madar-section">
          <MonthlyAttendanceMatrix />
        </div>
      )}

      {/* MODAL: ADMINISTRATIVE CLOCK-OUT */}
      <Modal
        open={Boolean(clockOutEmployee)}
        onClose={() => setClockOutEmployee(null)}
        title="تسجيل انصراف إداري"
      >
        <form onSubmit={submitClockOut}>
          <div className="madar-form-stack">
            <p className="madar-small madar-muted">
              {clockOutEmployee?.name} · أدخل توقيت الانصراف الفعلي وملاحظة الإدارة. سيتم حفظ هذا الإجراء وتوثيقه في سجل التدقيق المالي والإداري.
            </p>
            <Input
              label={`التاريخ والوقت الفعلي للانصراف · ${businessTimeZone} *`}
              type="datetime-local"
              value={clockOutLocal}
              onChange={(e) => setClockOutLocal(e.target.value)}
              required
            />
            <Textarea
              label="الملاحظة الإدارية *"
              value={clockOutAdminNote}
              onChange={(e) => setClockOutAdminNote(e.target.value)}
              required
              maxLength={1000}
              rows={3}
              placeholder="مثال: نسي الموظف تسجيل الانصراف عند انتهاء الوردية في تمام 6:00 م."
            />
          </div>
          <div className="madar-form-actions" style={{ marginTop: 16 }}>
            <Button type="button" variant="secondary" onClick={() => setClockOutEmployee(null)}>
              إلغاء
            </Button>
            <Button
              type="submit"
              disabled={attendanceActionId === clockOutEmployee?.employee_id || !clockOutLocal || !clockOutAdminNote.trim()}
            >
              {attendanceActionId === clockOutEmployee?.employee_id ? 'جارٍ التسجيل…' : 'تأكيد الانصراف'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
