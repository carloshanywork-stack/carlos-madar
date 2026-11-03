import * as XLSX from 'xlsx';
import { db as defaultDb } from '../../database/connection.js';
import { HttpError, isoDate, positiveId } from '../http.js';
import { compareMachineCodes, compareMaintenanceAreas } from './sorting.js';

const SERVICE_DATE = "COALESCE(order_record.archived_at, order_record.created_at)";
const EXPORT_HEADERS = [
  'المنطقة / Area',
  'كود الماكينة',
  'اسم الماكينة',
  'رقم أمر الخدمة',
  'سبب العطل',
  'الملاحظات الفنية',
  'تاريخ الخدمة',
  'الفنيون المكلفون',
  'الحالة',
];

function normalizeFilters(filters = {}) {
  const from = isoDate(filters.from, 'from');
  const to = isoDate(filters.to, 'to');
  if (from && to && from > to) throw new HttpError(400, 'from must be on or before to.');
  const reasonId = filters.reasonId === undefined || filters.reasonId === ''
    ? null
    : positiveId(filters.reasonId, 'reasonId');
  return { from, to, reasonId };
}

function addFilters(conditions, parameters, filters, dateExpression) {
  if (filters.from) {
    conditions.push(`date(${dateExpression}) >= ?`);
    parameters.push(filters.from);
  }
  if (filters.to) {
    conditions.push(`date(${dateExpression}) <= ?`);
    parameters.push(filters.to);
  }
  if (filters.reasonId !== null) {
    conditions.push('card.reason_id = ?');
    parameters.push(filters.reasonId);
  }
}

export function getMaintenanceAreaAnalysis(input = {}, database = defaultDb) {
  const filters = normalizeFilters(input);
  const machines = database.prepare(`
    SELECT id, code, name_ar, area
    FROM machines
    WHERE active = 1 AND deleted_at IS NULL
  `).all().sort((left, right) => (
    compareMaintenanceAreas(left.area, right.area)
    || compareMachineCodes(left.code, right.code)
    || left.id - right.id
  ));

  const conditions = [
    "order_record.status = 'archived'",
    'order_record.deleted_at IS NULL',
    'card.deleted_at IS NULL',
    "card.status = 'completed'",
    'machine.active = 1',
    'machine.deleted_at IS NULL',
  ];
  const parameters = [];
  addFilters(conditions, parameters, filters, 'order_record.archived_at');
  const completedMachineIds = new Set(database.prepare(`
    SELECT DISTINCT card.machine_id
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN machines machine ON machine.id = card.machine_id
    WHERE ${conditions.join(' AND ')}
  `).all(...parameters).map((row) => row.machine_id));

  const areas = new Map();
  for (const machine of machines) {
    const key = machine.area.trim().toLocaleLowerCase('ar-EG');
    let area = areas.get(key);
    if (!area) {
      area = { area: machine.area, total_count: 0, completed_count: 0, missing_machines: [] };
      areas.set(key, area);
    }
    area.total_count += 1;
    if (completedMachineIds.has(machine.id)) area.completed_count += 1;
    else area.missing_machines.push({ id: machine.id, code: machine.code, name_ar: machine.name_ar });
  }

  return [...areas.values()]
    .map((area) => {
      const missingCount = area.total_count - area.completed_count;
      return {
        ...area,
        missing_count: missingCount,
        completion_ratio: area.total_count ? area.completed_count / area.total_count : 0,
      };
    })
    .sort((left, right) => compareMaintenanceAreas(left.area, right.area));
}

export function getMaintenanceAnalysisRecords(input = {}, database = defaultDb) {
  const filters = normalizeFilters(input);
  const conditions = ['order_record.deleted_at IS NULL', 'card.deleted_at IS NULL'];
  const parameters = [];
  addFilters(conditions, parameters, filters, SERVICE_DATE);

  return database.prepare(`
    SELECT machine.area AS area,
      machine.code AS machine_code,
      machine.name_ar AS machine_name,
      order_record.order_code,
      reason.name AS reason_name,
      COALESCE(card.notes, '') AS notes,
      ${SERVICE_DATE} AS service_date,
      COALESCE((
        SELECT group_concat(ordered_technicians.name, '، ')
        FROM (
          SELECT employee.name
          FROM maintenance_order_technicians assignment
          JOIN employees employee ON employee.id = assignment.employee_id
          WHERE assignment.order_id = order_record.id
          ORDER BY employee.name COLLATE NOCASE, employee.id
        ) ordered_technicians
      ), '') AS technicians,
      order_record.status
    FROM maintenance_cards card
    JOIN maintenance_orders order_record ON order_record.id = card.order_id
    JOIN machines machine ON machine.id = card.machine_id
    LEFT JOIN maintenance_reasons reason ON reason.id = card.reason_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY machine.area COLLATE NOCASE, machine.code COLLATE NOCASE,
      ${SERVICE_DATE} DESC, order_record.id DESC, card.id
  `).all(...parameters);
}

export function buildMaintenanceAnalysisWorkbook(input = {}, database = defaultDb) {
  const records = getMaintenanceAnalysisRecords(input, database)
    .sort((left, right) => compareMaintenanceAreas(left.area, right.area)
      || compareMachineCodes(left.machine_code, right.machine_code));
  const rows = records.map((record) => [
    record.area,
    record.machine_code,
    record.machine_name,
    record.order_code,
    record.reason_name ?? '',
    record.notes,
    record.service_date,
    record.technicians,
    ({ in_progress: 'قيد التنفيذ', review: 'بانتظار المراجعة', archived: 'مؤرشف' })[record.status] ?? record.status,
  ]);
  const worksheet = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...rows]);
  worksheet['!cols'] = [
    { wch: 24 }, { wch: 20 }, { wch: 32 }, { wch: 22 }, { wch: 32 },
    { wch: 42 }, { wch: 22 }, { wch: 30 }, { wch: 20 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'تحليل الصيانة');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
}
