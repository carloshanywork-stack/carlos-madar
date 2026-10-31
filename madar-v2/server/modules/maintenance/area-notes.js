import XLSX from 'xlsx-js-style';
import { db as defaultDb } from '../../database/connection.js';
import { HttpError, requireText } from '../http.js';

const AREA_NOTE_HEADERS = ['كود الماكينة', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'الملاحظات'];

function normalizeAreaFilter(input = {}) {
  const area = input?.area;
  if (area === undefined || area === null || area === '') return null;
  if (typeof area !== 'string') throw new HttpError(400, 'area must be text.');
  return requireText(area, 'area', { maxLength: 160 });
}

export function getAreaMaintenanceNotes(input = {}, database = defaultDb) {
  const area = normalizeAreaFilter(input);
  const parameters = [];
  const areaCondition = area === null ? '' : 'AND machine.area = ? COLLATE NOCASE';
  if (area !== null) parameters.push(area);

  const machines = database.prepare(`
    SELECT machine.id, machine.code, machine.name_ar, machine.name_en, machine.area,
      COALESCE((
        SELECT card.notes
        FROM maintenance_cards card
        JOIN maintenance_orders order_record ON order_record.id = card.order_id
        WHERE card.machine_id = machine.id
          AND order_record.deleted_at IS NULL
          AND card.deleted_at IS NULL
          AND TRIM(COALESCE(card.notes, '')) <> ''
        ORDER BY COALESCE(order_record.archived_at, order_record.updated_at, order_record.created_at) DESC,
          order_record.id DESC, card.id DESC
        LIMIT 1
      ), '') AS notes
    FROM machines machine
    WHERE machine.active = 1 AND machine.deleted_at IS NULL ${areaCondition}
    ORDER BY machine.area COLLATE NOCASE, machine.code COLLATE NOCASE, machine.id
  `).all(...parameters);

  const areas = new Map();
  for (const machine of machines) {
    let group = areas.get(machine.area);
    if (!group) {
      group = { area: machine.area, machines: [] };
      areas.set(machine.area, group);
    }
    group.machines.push(machine);
  }
  return [...areas.values()];
}

export function buildAreaMaintenanceNotesWorkbook(input = {}, database = defaultDb) {
  const groups = getAreaMaintenanceNotes(input, database);
  const rows = [];
  const bannerRows = [];
  const headerRows = [];
  const noteRows = [];

  for (const [groupIndex, group] of groups.entries()) {
    const bannerRow = rows.length;
    rows.push([`المنطقة: ${group.area}`, '', '', '']);
    bannerRows.push(bannerRow);

    headerRows.push(rows.length);
    rows.push(AREA_NOTE_HEADERS);
    for (const machine of group.machines) {
      noteRows.push(rows.length);
      rows.push([machine.code, machine.name_ar, machine.name_en ?? '', machine.notes ?? '']);
    }
    if (groupIndex < groups.length - 1) rows.push(['', '', '', '']);
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 20 }, { wch: 30 }, { wch: 30 }, { wch: 52 }];
  worksheet['!rows'] = rows.map((_, index) => {
    if (bannerRows.includes(index)) return { hpt: 27 };
    if (headerRows.includes(index)) return { hpt: 24 };
    if (noteRows.includes(index)) return { hpt: 32 };
    return {};
  });
  worksheet['!merges'] = bannerRows.map((row) => ({ s: { r: row, c: 0 }, e: { r: row, c: 3 } }));
  worksheet['!views'] = [{ RTL: true }];

  const bannerStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: '174F63' } },
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 14 },
    alignment: { horizontal: 'right', vertical: 'center' },
  };
  const headerStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: 'DCEBF0' } },
    font: { bold: true, color: { rgb: '17394A' } },
    alignment: { horizontal: 'right', vertical: 'center' },
    border: { bottom: { style: 'thin', color: { rgb: '9BB9C4' } } },
  };
  const noteStyle = { alignment: { horizontal: 'right', vertical: 'top', wrapText: true } };

  for (const row of bannerRows) {
    for (let column = 0; column < 4; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      worksheet[address].s = bannerStyle;
    }
  }
  for (const row of headerRows) {
    for (let column = 0; column < 4; column += 1) {
      worksheet[XLSX.utils.encode_cell({ r: row, c: column })].s = headerStyle;
    }
  }
  for (const row of noteRows) {
    worksheet[XLSX.utils.encode_cell({ r: row, c: 3 })].s = noteStyle;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'صيانات المناطق');
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', cellStyles: true });
}
