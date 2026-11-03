import XLSX from 'xlsx-js-style';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import { db as defaultDb } from '../../database/connection.js';
import { HttpError, requireText } from '../http.js';
import { compareMachineCodes, compareMachineNames, compareMaintenanceAreas } from './sorting.js';

const AREA_NOTE_HEADERS = ['كود الماكينة', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'الملاحظات'];
const MACHINES_PER_A4_PAGE = 22;
const ROWS_PER_A4_PAGE = MACHINES_PER_A4_PAGE + 2;

function addWorksheetPrintSetup(sheetXml, totalRows) {
  const sheetProperties = '<sheetPr><pageSetUpPr fitToPage="1" autoPageBreaks="0"/></sheetPr>';
  let xml = sheetXml.replace(/(<worksheet\b[^>]*>)/, `$1${sheetProperties}`);
  const pageSetup = '<pageSetup paperSize="9" orientation="portrait" scale="100" fitToWidth="1" fitToHeight="0"/>';
  const rowBreaks = [];
  for (let row = ROWS_PER_A4_PAGE; row < totalRows; row += ROWS_PER_A4_PAGE) {
    rowBreaks.push(`<brk id="${row}" max="16383" man="1"/>`);
  }
  const rowBreaksXml = rowBreaks.length
    ? `<rowBreaks count="${rowBreaks.length}" manualBreakCount="${rowBreaks.length}">${rowBreaks.join('')}</rowBreaks>`
    : '';

  if (/<pageSetup\b/.test(xml)) {
    xml = xml.replace(/<pageSetup\b[^>]*\/>/, pageSetup);
  } else if (/<pageMargins\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/(<pageMargins\b[^>]*\/>)/, `$1${pageSetup}`);
  } else {
    xml = xml.replace('</worksheet>', `${pageSetup}</worksheet>`);
  }
  if (rowBreaksXml) {
    xml = xml.replace(/(<pageSetup\b[^>]*\/>)/, `$1${rowBreaksXml}`);
  }
  return xml;
}

function applyA4PrintSetup(workbookBuffer, totalRows) {
  return new Promise((resolve, reject) => {
    const outputChunks = [];
    const archive = new ZipArchive({ zlib: { level: 6 } });
    let worksheetFound = false;
    let zipfile;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      zipfile?.close();
      reject(error);
    };

    archive.on('data', (chunk) => outputChunks.push(chunk));
    archive.once('error', fail);
    archive.once('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(outputChunks));
    });

    yauzl.fromBuffer(workbookBuffer, { lazyEntries: true }, (openError, openedZip) => {
      if (openError) {
        fail(openError);
        return;
      }
      zipfile = openedZip;
      zipfile.once('error', fail);
      zipfile.once('end', () => {
        if (!worksheetFound) {
          fail(new Error('The area maintenance workbook worksheet was not found.'));
          return;
        }
        archive.finalize().catch(fail);
      });
      zipfile.on('entry', (entry) => {
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError) {
            fail(streamError);
            return;
          }
          stream.once('error', fail);
          const options = { name: entry.fileName, date: entry.getLastModDate() };
          if (entry.fileName === 'xl/worksheets/sheet1.xml') {
            worksheetFound = true;
            const xmlChunks = [];
            stream.on('data', (chunk) => xmlChunks.push(chunk));
            stream.once('end', () => {
              archive.append(addWorksheetPrintSetup(Buffer.concat(xmlChunks).toString('utf8'), totalRows), options);
              zipfile.readEntry();
            });
          } else {
            archive.append(stream, options);
            stream.once('end', () => zipfile.readEntry());
          }
        });
      });
      zipfile.readEntry();
    });
  });
}

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
     ORDER BY machine.area COLLATE NOCASE, machine.name_ar COLLATE NOCASE, machine.code COLLATE NOCASE, machine.id
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
  return [...areas.values()]
    .map((group) => ({
       ...group,
       machines: group.machines.sort((left, right) => (
         compareMachineNames(left.name_ar, right.name_ar)
         || compareMachineCodes(left.code, right.code)
         || left.id - right.id
       )),
    }))
    .sort((left, right) => compareMaintenanceAreas(left.area, right.area));
}

export async function buildAreaMaintenanceNotesWorkbook(input = {}, database = defaultDb) {
  const groups = getAreaMaintenanceNotes(input, database);
  const rows = [];
  const bannerRows = [];
  const headerRows = [];
  const contentRows = [];

  for (const group of groups) {
    const totalMachines = group.machines.length;
    let machineIndex = 0;
    let pageInArea = 1;

    while (machineIndex < totalMachines || totalMachines === 0) {
      const isContinuation = pageInArea > 1;
      const bannerRow = rows.length;
      rows.push([`المنطقة: ${group.area}${isContinuation ? ' (تابع)' : ''}`, '', '', '']);
      bannerRows.push(bannerRow);

      const headerRow = rows.length;
      rows.push(AREA_NOTE_HEADERS);
      headerRows.push(headerRow);

      const pageMachines = group.machines.slice(machineIndex, machineIndex + MACHINES_PER_A4_PAGE);
      for (const machine of pageMachines) {
        contentRows.push(rows.length);
        rows.push([machine.code, machine.name_ar, machine.name_en ?? '', machine.notes ?? '']);
      }
      machineIndex += pageMachines.length;

      const remainingSlots = MACHINES_PER_A4_PAGE - pageMachines.length;
      for (let index = 0; index < remainingSlots; index += 1) {
        rows.push(['', '', '', '']);
      }

      pageInArea += 1;
      if (totalMachines === 0) break;
    }
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet['!cols'] = [{ wch: 18 }, { wch: 32 }, { wch: 30 }, { wch: 48 }];
  worksheet['!rows'] = rows.map((_, index) => {
    if (bannerRows.includes(index)) return { hpt: 26 };
    if (headerRows.includes(index)) return { hpt: 22 };
    if (contentRows.includes(index)) return { hpt: 30 };
    return { hpt: 30 };
  });
  worksheet['!pageSetup'] = {
    paperSize: 9,
    orientation: 'portrait',
    fitToWidth: 1,
    fitToHeight: 0,
    scale: 100,
  };
  worksheet['!margins'] = {
    left: 0.5,
    right: 0.5,
    top: 0.5,
    bottom: 0.5,
    header: 0.3,
    footer: 0.3,
  };
  if (headerRows.length > 0) {
    const firstHeader = headerRows[0];
    worksheet['!autofilter'] = { ref: `A${firstHeader + 1}:D${rows.length}` };
  }
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
    border: {
      bottom: { style: 'thin', color: { rgb: '9BB9C4' } },
      top: { style: 'thin', color: { rgb: '9BB9C4' } },
      left: { style: 'thin', color: { rgb: '9BB9C4' } },
      right: { style: 'thin', color: { rgb: '9BB9C4' } },
    },
  };
  const cellBorder = {
    top: { style: 'thin', color: { rgb: 'E2E8F0' } },
    bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
    left: { style: 'thin', color: { rgb: 'E2E8F0' } },
    right: { style: 'thin', color: { rgb: 'E2E8F0' } },
  };
  const contentStyle = {
    alignment: { horizontal: 'right', vertical: 'center' },
    border: cellBorder,
  };
  const noteStyle = {
    alignment: { horizontal: 'right', vertical: 'top', wrapText: true },
    border: cellBorder,
  };

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
  for (const row of contentRows) {
    for (let column = 0; column < 3; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      if (worksheet[address]) worksheet[address].s = contentStyle;
    }
    const noteAddress = XLSX.utils.encode_cell({ r: row, c: 3 });
    if (worksheet[noteAddress]) worksheet[noteAddress].s = noteStyle;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'صيانات المناطق');
  const workbookBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', cellStyles: true });
  return applyA4PrintSetup(workbookBuffer, rows.length);
}
