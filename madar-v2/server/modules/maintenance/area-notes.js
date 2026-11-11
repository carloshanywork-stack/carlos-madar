import XLSX from 'xlsx-js-style';
import { ZipArchive } from 'archiver';
import yauzl from 'yauzl';
import { db as defaultDb } from '../../database/connection.js';
import { HttpError, positiveId, requireText } from '../http.js';
import { compareMachineCodes, compareMachineNames, compareMaintenanceAreas } from './sorting.js';
import { formatMachineNoteDate, getMachineNotesHistory } from './note-history.js';

const AREA_NOTE_HEADERS = ['كود الماكينة', 'الاسم بالعربي', 'الاسم بالإنجليزي', 'الملاحظات'];
function addWorksheetPrintSetup(sheetXml) {
  const sheetProperties = '<sheetPr><pageSetUpPr fitToPage="1" autoPageBreaks="0"/></sheetPr>';
  let xml = /<sheetPr\b/.test(sheetXml)
    ? sheetXml.replace(/<sheetPr\b[^>]*>(.*?)<\/sheetPr>/s, (_match, contents) => (
      `<sheetPr>${contents.replace(/<pageSetUpPr\b[^>]*\/?\s*>/g, '')}<pageSetUpPr fitToPage="1" autoPageBreaks="0"/></sheetPr>`
    ))
    : sheetXml.replace(/(<worksheet\b[^>]*>)/, `$1${sheetProperties}`);
  if (/<sheetViews\b[^>]*>/.test(xml)) {
    if (/<sheetView\b/.test(xml)) {
      xml = xml.replace(/<sheetView\b([^>]*?)(\/?)>/g, (_match, attributes, selfClosing) => {
        const withoutRightToLeft = attributes.replace(/\s+rightToLeft=(?:"[^"]*"|'[^']*'|[^\s/>]+)/, '');
        return `<sheetView${withoutRightToLeft} rightToLeft="1"${selfClosing}>`;
      });
    } else {
      xml = xml.replace(/<sheetViews\b[^>]*>/, '$&<sheetView workbookViewId="0" rightToLeft="1"/>');
    }
  } else {
    xml = xml.replace(/(<sheetPr\b[^>]*>.*?<\/sheetPr>)/s, '$1<sheetViews><sheetView workbookViewId="0" rightToLeft="1"/></sheetViews>');
  }
  const pageSetup = '<pageSetup paperSize="9" orientation="portrait" scale="100" fitToWidth="1" fitToHeight="0"/>';
  if (/<pageSetup\b/.test(xml)) {
    xml = xml.replace(/<pageSetup\b[^>]*\/>/, pageSetup);
  } else if (/<pageMargins\b[^>]*\/>/.test(xml)) {
    xml = xml.replace(/(<pageMargins\b[^>]*\/>)/, `$1${pageSetup}`);
  } else {
    xml = xml.replace('</worksheet>', `${pageSetup}</worksheet>`);
  }
  return xml;
}

function applyA4PrintSetup(workbookBuffer) {
  return new Promise((resolve, reject) => {
    const outputChunks = [];
    const archive = new ZipArchive({ zlib: { level: 6 } });
    let worksheetsFound = 0;
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
        if (!worksheetsFound) {
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
          if (/^xl\/worksheets\/sheet\d+\.xml$/.test(entry.fileName)) {
            worksheetsFound += 1;
            const xmlChunks = [];
            stream.on('data', (chunk) => xmlChunks.push(chunk));
            stream.once('end', () => {
              archive.append(addWorksheetPrintSetup(Buffer.concat(xmlChunks).toString('utf8')), options);
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
  const machineId = input?.machineId === undefined || input?.machineId === null || input?.machineId === ''
    ? null
    : positiveId(input.machineId, 'machineId');
  const onlyNotesValue = input?.onlyNotes ?? input?.onlyWithNotes;
  if (onlyNotesValue !== undefined && ![true, false, 'true', 'false'].includes(onlyNotesValue)) {
    throw new HttpError(400, 'onlyNotes must be true or false.');
  }
  const onlyNotes = onlyNotesValue === true || onlyNotesValue === 'true';
  const historyMode = input?.historyMode ?? 'latest';
  if (!['latest', 'all'].includes(historyMode)) throw new HttpError(400, 'historyMode must be latest or all.');
  const parameters = [];
  const areaCondition = area === null ? '' : 'AND machine.area = ? COLLATE NOCASE';
  if (area !== null) parameters.push(area);
  const machineCondition = machineId === null ? '' : 'AND machine.id = ?';
  if (machineId !== null) parameters.push(machineId);

  const machines = database.prepare(`
    WITH listed_machines AS (
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
        ), NULLIF(TRIM(COALESCE(machine.maintenance_note, '')), ''), '') AS current_note,
        (SELECT COUNT(*) FROM machine_notes_history note_history WHERE note_history.machine_id = machine.id) AS history_count
      FROM machines machine
      WHERE machine.active = 1 AND machine.deleted_at IS NULL ${areaCondition} ${machineCondition}
    )
    SELECT id, code, name_ar, name_en, area, current_note, history_count
    FROM listed_machines
    ORDER BY area COLLATE NOCASE, name_ar COLLATE NOCASE, code COLLATE NOCASE, id
  `).all(...parameters);

  if (machineId !== null && machines.length === 0) throw new HttpError(404, 'Active machine was not found.');

  const historyByMachine = new Map();
  if (historyMode === 'all') {
    const historyRows = database.prepare(`
      SELECT history.id, history.machine_id, history.card_id, history.order_id,
        history.author_id, history.author_name, history.author_role, history.note,
        history.created_at, COALESCE(order_record.order_code, '') AS order_code
      FROM machine_notes_history history
      JOIN machines machine ON machine.id = history.machine_id
      LEFT JOIN maintenance_orders order_record ON order_record.id = history.order_id
      WHERE machine.active = 1 AND machine.deleted_at IS NULL ${areaCondition} ${machineCondition}
      ORDER BY history.machine_id, datetime(history.created_at), history.id
    `).all(...parameters);
    for (const entry of historyRows) {
      const id = Number(entry.machine_id);
      const history = historyByMachine.get(id) ?? [];
      history.push({ ...entry, formatted_date: formatMachineNoteDate(entry.created_at) });
      historyByMachine.set(id, history);
    }
  }

  const listedMachines = machines.map((machine) => {
    const history = historyByMachine.get(Number(machine.id)) ?? [];
    const currentNote = String(machine.current_note ?? '').trim();
    const historyCount = Math.max(Number(machine.history_count) || 0, history.length);
    const historicalNotes = history.map((entry) => {
      const authorRole = entry.author_role === 'rep' ? 'مندوب ميداني'
        : entry.author_role === 'supervisor' ? 'مشرف' : 'إدارة';
      const order = entry.order_code ? ` · أمر ${entry.order_code}` : '';
      return `[${entry.formatted_date}] ${entry.author_name} (${authorRole})${order}: ${entry.note}`;
    }).join('\n');
    return {
      ...machine,
      current_note: currentNote,
      notes: historyMode === 'all' ? (historicalNotes || currentNote) : currentNote,
      history_count: historyCount,
      has_history: historyCount > 0,
      ...(historyMode === 'all' ? { history } : {}),
    };
  }).filter((machine) => machineId !== null || !onlyNotes || Boolean(
    machine.current_note || (historyMode === 'all' && machine.history_count),
  ));

  const areas = new Map();
  for (const machine of listedMachines) {
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
     .filter((group) => group.machines.length > 0)
    .sort((left, right) => compareMaintenanceAreas(left.area, right.area));
}

export async function buildAreaMaintenanceNotesWorkbook(input = {}, database = defaultDb) {
  const groups = getAreaMaintenanceNotes(input, database);
  const workbook = XLSX.utils.book_new();
  const bannerStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: '174F63' } },
    font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 15 },
    alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2 },
    border: {
      top: { style: 'medium', color: { rgb: '174F63' } },
      bottom: { style: 'medium', color: { rgb: '174F63' } },
      left: { style: 'medium', color: { rgb: '174F63' } },
      right: { style: 'medium', color: { rgb: '174F63' } },
    },
  };
  const headerStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: 'DCEBF0' } },
    font: { bold: true, color: { rgb: '17394A' }, sz: 12 },
    alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2, wrapText: true },
    border: {
      bottom: { style: 'thin', color: { rgb: '9BB9C4' } },
      top: { style: 'thin', color: { rgb: '9BB9C4' } },
      left: { style: 'thin', color: { rgb: '9BB9C4' } },
      right: { style: 'thin', color: { rgb: '9BB9C4' } },
    },
  };
  const cellBorder = {
    top: { style: 'thin', color: { rgb: 'CBD5E1' } },
    bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
    left: { style: 'thin', color: { rgb: 'CBD5E1' } },
    right: { style: 'thin', color: { rgb: 'CBD5E1' } },
  };
  const contentStyle = {
    font: { sz: 11, color: { rgb: '0F172A' } },
    alignment: { horizontal: 'right', vertical: 'top', readingOrder: 2, wrapText: true },
    border: cellBorder,
  };
  const noteStyle = {
    fill: { patternType: 'solid', fgColor: { rgb: 'FFF9E8' } },
    font: { sz: 11, color: { rgb: '0F172A' } },
    alignment: { horizontal: 'right', vertical: 'top', wrapText: true, readingOrder: 2 },
    border: cellBorder,
  };

  if (input?.machineId !== undefined && input.machineId !== null && input.machineId !== '') {
    const machine = groups.flatMap((group) => group.machines)[0];
    if (!machine) throw new HttpError(404, 'Active machine was not found.');
    const history = getMachineNotesHistory(machine.id, database);
    const visibleHistory = input.historyMode === 'all'
      ? history
      : history.filter((entry) => entry.note === machine.current_note).slice(0, 1);
    const latestEntry = history.find((entry) => entry.note === machine.current_note);
    const rows = [
      [`سجل ملاحظات الماكينة: ${machine.code}`, '', '', '', ''],
      ['كود الماكينة', machine.code, 'الاسم بالعربي', machine.name_ar, ''],
      ['المنطقة', machine.area, 'الاسم بالإنجليزي', machine.name_en ?? '', ''],
      ['الملاحظة الحالية', machine.current_note || '—', '', '', ''],
      ['التاريخ والوقت', 'اسم الكاتب', 'الدور', 'أمر الصيانة', 'الملاحظة'],
      ...visibleHistory.map((entry) => [
        entry.formatted_date,
        entry.author_name,
        entry.author_role === 'rep' ? 'مندوب ميداني' : entry.author_role === 'supervisor' ? 'مشرف' : 'إدارة',
        entry.order_code || '—',
        entry.note,
      ]),
    ];
    if (input.historyMode !== 'all' && machine.current_note && !visibleHistory.length) {
      rows.push(['—', '—', '—', latestEntry?.order_code || '—', machine.current_note]);
    }
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 22 }, { wch: 26 }, { wch: 18 }, { wch: 24 }, { wch: 58 }];
    worksheet['!rows'] = rows.map((row, index) => {
      if (index === 0) return { hpt: 30 };
      if (index === 4) return { hpt: 26 };
      const longest = Math.max(...row.map((value) => String(value ?? '').length));
      return { hpt: Math.min(180, Math.max(28, Math.ceil(longest / 58) * 18 + 10)) };
    });
    worksheet['!pageSetup'] = { paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0, scale: 100 };
    worksheet['!margins'] = { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 };
    worksheet['!autofilter'] = { ref: `A5:E${Math.max(5, rows.length)}` };
    worksheet['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
      { s: { r: 1, c: 3 }, e: { r: 1, c: 4 } },
      { s: { r: 2, c: 3 }, e: { r: 2, c: 4 } },
      { s: { r: 3, c: 1 }, e: { r: 3, c: 4 } },
    ];
    worksheet['!views'] = [{ RTL: true }];
    for (let column = 0; column < 5; column += 1) {
      worksheet[XLSX.utils.encode_cell({ r: 0, c: column })].s = bannerStyle;
      worksheet[XLSX.utils.encode_cell({ r: 4, c: column })].s = headerStyle;
    }
    for (let row = 1; row < 4; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        worksheet[address] ??= { t: 's', v: '' };
        worksheet[address].s = column % 2 === 0 ? headerStyle : contentStyle;
      }
    }
    for (let row = 5; row < rows.length; row += 1) {
      for (let column = 0; column < 5; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        worksheet[address] ??= { t: 's', v: '' };
        worksheet[address].s = column === 4 ? noteStyle : contentStyle;
      }
    }
    const sheetName = String(machine.code).replace(/[\\/?*:[\]]/g, ' ').slice(0, 31) || 'سجل الماكينة';
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    return applyA4PrintSetup(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', cellStyles: true }));
  }

  const sheetGroups = groups.length ? groups : [{ area: 'صيانات المناطق', machines: [] }];
  const usedSheetNames = new Set();
  for (const group of sheetGroups) {
    const notedMachineCount = group.machines.filter((machine) => String(machine.notes ?? '').trim()).length;
    const areaName = String(group.area || 'غير محددة');
    const bannerText = group.machines.length
      ? `المنطقة: ${areaName} - ${notedMachineCount} ملاحظة`
      : (input?.onlyNotes === true || input?.onlyNotes === 'true' || input?.onlyWithNotes === true || input?.onlyWithNotes === 'true'
        ? 'لا توجد ملاحظات مسجلة'
        : 'لا توجد ماكينات نشطة');
    const rows = [
      [bannerText, '', '', ''],
      AREA_NOTE_HEADERS,
      ...group.machines.map((machine) => [machine.code, machine.name_ar, machine.name_en ?? '', machine.notes ?? '']),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 18 }, { wch: 30 }, { wch: 28 }, { wch: 52 }];
    worksheet['!rows'] = rows.map((row, index) => {
      if (index === 0) return { hpt: 30 };
      if (index === 1) return { hpt: 26 };
      const values = [row[0], row[1], row[2], row[3]];
      const widths = [18, 30, 28, 52];
      const estimatedLines = Math.max(...values.map((value, column) => (
        String(value ?? '').split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil([...line].length / widths[column])), 0)
      )));
      return { hpt: Math.min(180, Math.max(32, estimatedLines * 16 + 10)) };
    });
    worksheet['!pageSetup'] = {
      paperSize: 9,
      orientation: 'portrait',
      fitToWidth: 1,
      fitToHeight: 0,
      scale: 100,
    };
    worksheet['!margins'] = {
      left: 0.35,
      right: 0.35,
      top: 0.45,
      bottom: 0.45,
      header: 0.2,
      footer: 0.2,
    };
    worksheet['!autofilter'] = { ref: `A2:D${Math.max(2, rows.length)}` };
    worksheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];
    worksheet['!views'] = [{ RTL: true }];

    for (let column = 0; column < 4; column += 1) {
      worksheet[XLSX.utils.encode_cell({ r: 0, c: column })].s = bannerStyle;
      worksheet[XLSX.utils.encode_cell({ r: 1, c: column })].s = headerStyle;
    }
    for (let row = 2; row < rows.length; row += 1) {
      for (let column = 0; column < 4; column += 1) {
        const address = XLSX.utils.encode_cell({ r: row, c: column });
        worksheet[address] ??= { t: 's', v: '' };
        worksheet[address].s = column === 3 ? noteStyle : contentStyle;
      }
    }

    const normalizedName = areaName.replace(/[\\/?*:[\]]/g, ' ').trim() || 'منطقة';
    let sheetName = normalizedName.slice(0, 31);
    let suffix = 2;
    while (usedSheetNames.has(sheetName.toLocaleLowerCase())) {
      const ending = ` (${suffix})`;
      sheetName = `${normalizedName.slice(0, 31 - ending.length)}${ending}`;
      suffix += 1;
    }
    usedSheetNames.add(sheetName.toLocaleLowerCase());
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  }

  const workbookBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer', cellStyles: true });
  return applyA4PrintSetup(workbookBuffer);
}
