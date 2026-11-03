import XLSX from 'xlsx-js-style';
import { getMonthlyAttendance } from './service.js';

const STATUS_LABELS = {
  present: 'حاضر',
  absent: 'غائب',
  leave: 'إجازة',
  late: 'متأخر',
};

const STATUS_STYLES = {
  present: { fill: { fgColor: { rgb: 'DCFCE7' } }, font: { color: { rgb: '166534' }, bold: true } },
  absent: { fill: { fgColor: { rgb: 'FEE2E2' } }, font: { color: { rgb: '991B1B' }, bold: true } },
  leave: { fill: { fgColor: { rgb: 'DBEAFE' } }, font: { color: { rgb: '1D4ED8' }, bold: true } },
  late: { fill: { fgColor: { rgb: 'FEF3C7' } }, font: { color: { rgb: '92400E' }, bold: true } },
};

export function buildMonthlyAttendanceWorkbook(month, database) {
  const data = getMonthlyAttendance(month, database);
  const recordsByKey = new Map(data.records.map((record) => [`${record.employee_id}:${record.date}`, record]));
  const days = Array.from({ length: data.daysInMonth }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, '0')}`;
    const weekday = new Date(`${date}T12:00:00`).getDay();
    const weekdayLabel = new Intl.DateTimeFormat('ar-EG', { weekday: 'short' }).format(new Date(`${date}T12:00:00`)).replaceAll('.', '');
    return { date, weekday, weekdayLabel };
  });
  const rows = [
    [`مصفوفة الحضور الشهري — ${month}`],
    ['حضور يشمل حاضر ومتأخر · ساعات الإضافي حسب السجل اليومي'],
    ['الموظف', 'القسم', ...days.map((day, index) => `${index + 1}\n${day.weekdayLabel}`), 'حضور', 'غياب', 'إجازات', 'إضافي (س)'],
  ];
  for (const employee of data.employees) {
    const employeeRecords = days.map((day) => recordsByKey.get(`${employee.employee_id}:${day.date}`) ?? null);
    const presentDays = employeeRecords.filter((record) => record && ['present', 'late'].includes(record.status)).length;
    const absentDays = employeeRecords.filter((record) => record?.status === 'absent').length;
    const leaveDays = employeeRecords.filter((record) => record?.status === 'leave').length;
    const overtimeHours = employeeRecords.reduce((sum, record) => sum + (record?.overtime_hours ?? 0), 0);
    rows.push([
      employee.name,
      employee.department,
      ...employeeRecords.map((record) => record
        ? `${STATUS_LABELS[record.status] ?? record.status}${record.overtime_hours ? ` · ${record.overtime_hours} س` : ''}`
        : '—'),
      presentDays,
      absentDays,
      leaveDays,
      overtimeHours,
    ]);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const lastColumn = rows[2].length - 1;
  worksheet['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastColumn } },
  ];
  worksheet['!cols'] = [
    { wch: 27 }, { wch: 19 },
    ...days.map(() => ({ wch: 11 })),
    { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 12 },
  ];
  worksheet['!rows'] = [{ hpt: 28 }, { hpt: 22 }, { hpt: 36 }];
  worksheet['!autofilter'] = {
    ref: XLSX.utils.encode_range({ s: { r: 2, c: 0 }, e: { r: Math.max(2, rows.length - 1), c: lastColumn } }),
  };

  const titleStyle = { fill: { fgColor: { rgb: '0F766E' } }, font: { color: { rgb: 'FFFFFF' }, bold: true, sz: 16 }, alignment: { horizontal: 'right', vertical: 'center' } };
  const subtitleStyle = { fill: { fgColor: { rgb: 'E2E8F0' } }, font: { color: { rgb: '334155' }, italic: true }, alignment: { horizontal: 'right', vertical: 'center' } };
  const headerStyle = { fill: { fgColor: { rgb: '1E293B' } }, font: { color: { rgb: 'FFFFFF' }, bold: true }, alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
  for (let column = 0; column <= lastColumn; column += 1) {
    const titleCell = worksheet[XLSX.utils.encode_cell({ r: 0, c: column })];
    if (titleCell) titleCell.s = titleStyle;
    const subtitleCell = worksheet[XLSX.utils.encode_cell({ r: 1, c: column })];
    if (subtitleCell) subtitleCell.s = subtitleStyle;
    const headerCell = worksheet[XLSX.utils.encode_cell({ r: 2, c: column })];
    if (headerCell) headerCell.s = headerStyle;
  }
  days.forEach((day, index) => {
    if (![5, 6].includes(day.weekday)) return;
    const cell = worksheet[XLSX.utils.encode_cell({ r: 2, c: index + 2 })];
    if (cell) cell.s = { ...headerStyle, fill: { fgColor: { rgb: '9A3412' } } };
  });
  data.employees.forEach((employee, employeeIndex) => {
    days.forEach((day, dayIndex) => {
      const record = recordsByKey.get(`${employee.employee_id}:${day.date}`);
      if (!record) return;
      const cell = worksheet[XLSX.utils.encode_cell({ r: employeeIndex + 3, c: dayIndex + 2 })];
      if (cell) cell.s = { ...STATUS_STYLES[record.status], alignment: { horizontal: 'center', vertical: 'center', wrapText: true } };
    });
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, `الحضور ${month}`.slice(0, 31));
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', cellStyles: true });
}
