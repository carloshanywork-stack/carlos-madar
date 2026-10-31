import PptxGenJS from 'pptxgenjs';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { db as defaultDatabase } from '../../database/connection.js';
import { allowOnlyKeys, HttpError, integerIdArray, optionalText, positiveId, requireObject } from '../http.js';
import { resolveStorageFile } from '../storage.js';
import { getMaintenanceOrder } from './service.js';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IMAGE_TYPES = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'], ['.heic', 'image/heic'], ['.heif', 'image/heif'],
]);
const INDEX_ROWS_PER_SLIDE = 20;

async function loadImage(storedPath, { rotateClockwise = false } = {}) {
  const extension = extname(storedPath).toLowerCase();
  const contentType = IMAGE_TYPES.get(extension);
  if (!contentType) return null;
  try {
    const absolutePath = await resolveStorageFile(storedPath);
    const source = await readFile(absolutePath);
    const orientedSource = await sharp(source, { failOn: 'none' }).rotate().toBuffer();
    const image = sharp(orientedSource, { failOn: 'none' });
    if (rotateClockwise) image.rotate(90);
    const { data, info } = await image
      .resize({ width: 800, withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer({ resolveWithObject: true });
    return { contentType: 'image/jpeg', data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

async function loadCardImages(paths) {
  const images = [];
  for (const path of paths.slice(0, 4)) {
    const image = await loadImage(path, { rotateClockwise: true });
    if (image) images.push(image);
  }
  return images;
}

async function loadClientLogo(order) {
  return order.client?.logo_path ? loadImage(order.client.logo_path) : null;
}

function safeReportName(order, extension) {
  const safe = (value) => String(value ?? '').normalize('NFKC').trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '');
  return `${safe(order.order_code)}_${safe(order.area) || 'Area'}_Report.${extension}`;
}

function addImageFit(slide, image, x, y, width, height) {
  const ratio = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
  const frameRatio = width / height;
  const fittedWidth = ratio > frameRatio ? width : height * ratio;
  const fittedHeight = ratio > frameRatio ? width / ratio : height;
  slide.addImage({
    data: `data:image/jpeg;base64,${image.data.toString('base64')}`,
    x: x + (width - fittedWidth) / 2,
    y: y + (height - fittedHeight) / 2,
    w: fittedWidth,
    h: fittedHeight,
  });
}

function addImageGrid(slide, pptx, images, x, y, width, height) {
  if (!images.length) {
    slide.addShape(pptx.ShapeType.roundRect, { x, y, w: width, h: height, rectRadius: 0.08, line: { color: 'D4DEE8' }, fill: { color: 'F6F8FA' } });
    slide.addText('لا توجد صور مرفقة', { x, y: y + height / 2 - 0.15, w: width, h: 0.3, fontFace: 'Arial', fontSize: 12, color: '7C8A99', align: 'center' });
    return;
  }
  const gap = images.length === 1 ? 0 : 0.12;
  const cellWidth = (width - gap * (images.length - 1)) / images.length;
  images.forEach((image, index) => {
    const left = x + index * (cellWidth + gap);
    slide.addShape(pptx.ShapeType.roundRect, {
      x: left, y, w: cellWidth, h: height,
      rectRadius: 0.06,
      line: { color: 'D4DEE8', width: 0.8 },
      fill: { color: 'FFFFFF' },
      shadow: { type: 'outer', color: '183247', blur: 3, angle: 45, distance: 1, opacity: 0.12 },
    });
    addImageFit(slide, image, left + 0.06, y + 0.06, cellWidth - 0.12, height - 0.12);
  });
}

function addSlideFooter(slide, pageNumber, pageCount, reason = null) {
  slide.addShape('line', { x: 0.48, y: 7.05, w: 12.37, h: 0, line: { color: 'D8E0E8', width: 0.8 } });
  if (reason) {
    slide.addText(`سبب الصيانة: ${reason}`, {
      x: 0.62, y: 7.12, w: 10.25, h: 0.18, fontFace: 'Arial', fontSize: 8, color: '53677B', align: 'right', fit: 'shrink',
    });
  }
  slide.addText(`صفحة ${pageNumber} من ${pageCount}`, {
    x: 10.95, y: 7.12, w: 1.82, h: 0.18, fontFace: 'Arial', fontSize: 8, color: '53677B', align: 'left',
  });
}

function optionalBoolean(value, label, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new HttpError(400, `${label} must be true or false.`);
}

function addMaintenanceIndexSlide(pptx, rows, indexPage, indexPageCount, pageNumber, pageCount, primary) {
  const slide = pptx.addSlide();
  slide.background = { color: 'F7F9FC' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.9, line: { color: primary }, fill: { color: primary } });
  slide.addText('فهرس الماكينات', { x: 0.62, y: 0.2, w: 7.2, h: 0.38, fontFace: 'Arial', fontSize: 22, bold: true, color: 'FFFFFF', align: 'right' });
  slide.addText(`صفحة الفهرس ${indexPage} من ${indexPageCount}`, { x: 9.3, y: 0.3, w: 3.35, h: 0.22, fontFace: 'Arial', fontSize: 10, color: 'DDEBFA', align: 'left' });

  const columns = [
    { label: 'م', x: 0.58, w: 0.55, align: 'center' },
    { label: 'اسم الماكينة', x: 1.25, w: 4.8, align: 'right' },
    { label: 'المنطقة', x: 6.17, w: 2.6, align: 'right' },
    { label: 'الكود', x: 8.89, w: 2.2, align: 'center' },
    { label: 'الصفحة', x: 11.21, w: 1.6, align: 'center' },
  ];
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.48, y: 1.12, w: 12.37, h: 0.34, rectRadius: 0.06, line: { color: primary }, fill: { color: primary } });
  for (const column of columns) {
    slide.addText(column.label, { x: column.x, y: 1.2, w: column.w, h: 0.16, fontFace: 'Arial', fontSize: 9, bold: true, color: 'FFFFFF', align: column.align });
  }
  rows.forEach((row, index) => {
    const y = 1.52 + index * 0.265;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.48, y, w: 12.37, h: 0.235, rectRadius: 0.04,
      line: { color: index % 2 ? 'E5EBF1' : 'DDE5ED', width: 0.5 },
      fill: { color: index % 2 ? 'FFFFFF' : 'F0F4F8' },
    });
    const values = [
      { text: String(row.index), ...columns[0] },
      { text: row.card.machine_name_en || row.card.machine_code, ...columns[1] },
      { text: row.card.machine_area || row.order.area || '—', ...columns[2] },
      { text: row.card.machine_code, ...columns[3] },
      { text: String(row.pageNumber), ...columns[4] },
    ];
    for (const value of values) {
      slide.addText(value.text, {
        x: value.x, y: y + 0.045, w: value.w, h: 0.15,
        fontFace: 'Arial', fontSize: 8, color: value === values.at(-1) ? primary : '263B50',
        bold: value === values.at(-1), align: value.align, fit: 'shrink',
      });
    }
  });
  addSlideFooter(slide, pageNumber, pageCount);
  return slide;
}

function initials(name) {
  return String(name ?? '').trim().split(/\s+/u).slice(0, 2).map((part) => [...part][0] ?? '').join('') || 'C';
}

function hexColor(value, fallback = '07509B') {
  const normalized = String(value ?? '').replace(/^#/, '');
  return /^[\da-f]{6}$/i.test(normalized) ? normalized.toUpperCase() : fallback;
}

function addClientLogo(slide, pptx, logo, client, x, y, width, height) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w: width, h: height,
    rectRadius: 0.08,
    line: { color: 'DCE4EC', width: 0.8 },
    fill: { color: 'FFFFFF' },
  });
  if (logo) addImageFit(slide, logo, x + 0.06, y + 0.04, width - 0.12, height - 0.08);
  else slide.addText(initials(client?.name), { x, y: y + height / 2 - 0.18, w: width, h: 0.36, fontFace: 'Arial', fontSize: 19, bold: true, color: '07509B', align: 'center', valign: 'mid' });
}

function maintenanceReportPeriod(entries) {
  const months = [...new Set(entries
    .map(({ order }) => String(order.archived_at || order.created_at || '').match(/^(\d{4})-(\d{2})/)?.slice(1).join('-'))
    .filter(Boolean))].sort();
  if (!months.length) return null;

  const formatMonth = (month) => {
    const date = new Date(`${month}-01T00:00:00.000Z`);
    const label = new Intl.DateTimeFormat('ar-EG', { month: 'long', timeZone: 'UTC' }).format(date);
    return `${label} ${month.slice(0, 4)}`;
  };
  return months.map(formatMonth).join(' – ');
}

function addMaintenanceCoverSlide(pptx, client, logo, primary, secondary, areaIndex, totalMachines, reportPeriod) {
  const slide = pptx.addSlide();
  slide.background = { color: 'F8FAFC' };

  // 1. Top Corporate Dual Accent Bar
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.1, line: { color: primary }, fill: { color: primary } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.1, w: 13.333, h: 0.035, line: { color: secondary }, fill: { color: secondary } });

  // 2. Left Panel: Brand & Certification Card
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 0.75, y: 0.6, w: 5.2, h: 6.4, rectRadius: 0.1,
    line: { color: 'D8E2EC', width: 0.8 }, fill: { color: 'FFFFFF' },
    shadow: { type: 'outer', color: '0F172A', blur: 6, angle: 45, distance: 2, opacity: 0.06 },
  });

  slide.addShape(pptx.ShapeType.roundRect, {
    x: 6.25, y: 0.6, w: 6.35, h: 6.4, rectRadius: 0.1,
    line: { color: 'D8E2EC', width: 0.8 }, fill: { color: 'FFFFFF' },
    shadow: { type: 'outer', color: '0F172A', blur: 6, angle: 45, distance: 2, opacity: 0.06 },
  });

  // Client Logo container
  addClientLogo(slide, pptx, logo, client, 1.35, 1.0, 4.0, 1.7);
  slide.addShape(pptx.ShapeType.line, { x: 1.45, y: 2.95, w: 3.8, h: 0, line: { color: secondary, width: 2 } });

  // Titles
  slide.addText('تقرير صيانة الشهر', {
    x: 0.95, y: 3.2, w: 4.8, h: 0.52, fontFace: 'Arial', fontSize: 24, bold: true, color: primary, align: 'center',
  });
  slide.addText('ماكينات الصراف الآلي (ATM Maintenance)', {
    x: 0.95, y: 3.75, w: 4.8, h: 0.3, fontFace: 'Arial', fontSize: 13, bold: true, color: '334155', align: 'center',
  });
  slide.addText('Periodic ATM Fleet Inspection & Service Report', {
    x: 0.95, y: 4.08, w: 4.8, h: 0.24, fontFace: 'Arial', fontSize: 9, color: '64748B', align: 'center',
  });

  // Period Badge
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.25, y: 4.6, w: 4.2, h: 0.45, rectRadius: 0.08, line: { color: 'BAE6FD' }, fill: { color: 'F0F9FF' },
  });
  slide.addText(`فترة التقرير: ${reportPeriod || 'أكتوبر 2026'}`, {
    x: 1.35, y: 4.68, w: 4.0, h: 0.28, fontFace: 'Arial', fontSize: 11, bold: true, color: primary, align: 'center',
  });

  // Machine Count Badge
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 1.25, y: 5.2, w: 4.2, h: 0.45, rectRadius: 0.08, line: { color: 'E2E8F0' }, fill: { color: 'F8FAFC' },
  });
  slide.addText(`إجمالي الماكينات المشمولة: ${totalMachines} ماكينة ATM`, {
    x: 1.35, y: 5.28, w: 4.0, h: 0.28, fontFace: 'Arial', fontSize: 11, bold: true, color: '1E293B', align: 'center',
  });

  // Verification Tag
  slide.addText('وثيقة فنية معتمدة · صالحة للتدقيق والمراجعة التشغيلية', {
    x: 0.95, y: 6.2, w: 4.8, h: 0.25, fontFace: 'Arial', fontSize: 8.5, color: '64748B', align: 'center',
  });

  // 3. Right Panel: Interactive Area Index Card
  // Right Header Banner
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 6.55, y: 0.9, w: 5.75, h: 0.72, rectRadius: 0.08, line: { color: primary }, fill: { color: primary },
  });
  slide.addText('فهرس المناطق المشمولة بالتقرير', {
    x: 6.7, y: 0.98, w: 5.45, h: 0.32, fontFace: 'Arial', fontSize: 15, bold: true, color: 'FFFFFF', align: 'right',
  });
  slide.addText('Index of Covered Service Areas & Page Navigation', {
    x: 6.7, y: 1.28, w: 5.45, h: 0.22, fontFace: 'Arial', fontSize: 8.5, color: 'BAE6FD', align: 'right',
  });

  // Area Cards List
  const listTop = 1.85;
  const listMaxHeight = 4.8;
  const rowHeight = Math.min(0.68, (listMaxHeight - (areaIndex.length - 1) * 0.1) / Math.max(areaIndex.length, 1));
  const rowGap = 0.1;
  areaIndex.forEach((item, index) => {
    const y = listTop + index * (rowHeight + rowGap);

    // Card Strip
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 6.55, y, w: 5.75, h: rowHeight, rectRadius: 0.08,
      line: { color: 'CBD5E1', width: 0.7 }, fill: { color: index % 2 ? 'FFFFFF' : 'F8FAFC' },
    });
    // Orange Right Border Accent
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 12.22, y: y + 0.06, w: 0.06, h: rowHeight - 0.12, rectRadius: 0.03,
      line: { color: secondary }, fill: { color: secondary },
    });

    // Area Name (Right)
    slide.addText(item.area, {
      x: 8.7, y: y + (rowHeight - 0.3) / 2, w: 3.4, h: 0.3,
      fontFace: 'Arial', fontSize: 13, bold: true, color: '0F172A', align: 'right', valign: 'mid',
    });

    // Machine Count Badge (Center)
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 7.7, y: y + (rowHeight - 0.34) / 2, w: 1.2, h: 0.34, rectRadius: 0.06,
      line: { color: 'E2E8F0' }, fill: { color: 'EFF6FF' },
    });
    slide.addText(`${item.count} ماكينة`, {
      x: 7.72, y: y + (rowHeight - 0.26) / 2, w: 1.16, h: 0.26,
      fontFace: 'Arial', fontSize: 10, bold: true, color: primary, align: 'center', valign: 'mid',
    });

    // Page Number Navigation Pill (Left)
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 6.72, y: y + (rowHeight - 0.36) / 2, w: 0.88, h: 0.36, rectRadius: 0.06,
      line: { color: primary }, fill: { color: primary },
    });
    slide.addText(`ص ${item.startPage}`, {
      x: 6.74, y: y + (rowHeight - 0.26) / 2, w: 0.84, h: 0.26,
      fontFace: 'Arial', fontSize: 10, bold: true, color: 'FFFFFF', align: 'center', valign: 'mid',
    });
  });

  // 4. Subtle Bottom Footer
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 7.36, w: 13.333, h: 0.14, line: { color: 'E2E8F0' }, fill: { color: 'E2E8F0' } });
  slide.addText('البنك التجاري الدولي (CIB)  ·  تقرير فحص وتوثيق الصيانة الدورية لماكينات الصراف الآلي  ·  سري وخاص بالإدارة', {
    x: 0.8, y: 7.37, w: 11.733, h: 0.12, fontFace: 'Arial', fontSize: 8, color: '64748B', align: 'center',
  });
}

function reportableReason(reasonName) {
  const reason = String(reasonName ?? '').trim();
  return reason && reason !== 'غير محدد' ? reason : null;
}

async function addMaintenanceCardSlide(pptx, order, card, logo, primary, secondary) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 1.08, line: { color: 'F3F7FB' }, fill: { color: 'F3F7FB' } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.04, w: 13.333, h: 0.05, line: { color: secondary }, fill: { color: secondary } });
  addClientLogo(slide, pptx, logo, order.client, 0.42, 0.18, 0.82, 0.68);
  slide.addText(`${card.machine_name_en || card.machine_code} · ${card.machine_code}`, {
    x: 1.65, y: 0.29, w: 11.1, h: 0.42, fontFace: 'Arial', fontSize: 19, bold: true,
    color: primary, align: 'right', fit: 'shrink',
  });
  const [before, after] = await Promise.all([loadCardImages(card.before_photos), loadCardImages(card.after_photos)]);
  const reason = reportableReason(card.reason_name);
  const photoGridHeight = reason ? 4.6 : 5.1;
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.48, y: 1.32, w: 6.05, h: 0.43, rectRadius: 0.1, line: { color: 'DDE6EF' }, fill: { color: 'EAF4F4' } });
  slide.addText('After', { x: 0.6, y: 1.42, w: 5.8, h: 0.2, fontFace: 'Arial', fontSize: 13, bold: true, color: primary, align: 'center' });
  slide.addShape(pptx.ShapeType.roundRect, { x: 6.8, y: 1.32, w: 6.05, h: 0.43, rectRadius: 0.1, line: { color: 'DDE6EF' }, fill: { color: 'EEF3FA' } });
  slide.addText('Before', { x: 6.92, y: 1.42, w: 5.8, h: 0.2, fontFace: 'Arial', fontSize: 13, bold: true, color: primary, align: 'center' });
  addImageGrid(slide, pptx, after, 0.48, 1.92, 6.05, photoGridHeight);
  addImageGrid(slide, pptx, before, 6.8, 1.92, 6.05, photoGridHeight);
  if (reason) {
    slide.addText(`سبب الصيانة: ${reason}`, {
      x: 0.62, y: 6.6, w: 12.1, h: 0.35, fontFace: 'Arial', fontSize: 11, bold: true,
      color: primary, align: 'right', valign: 'mid', fit: 'shrink',
    });
  }
}

function pptxDocument(title, subject) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'MADAR';
  pptx.subject = subject;
  pptx.title = title;
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'ar-EG' };
  return pptx;
}

function downloadReport(res, report) {
  const fallbackFilename = report.filename.replace(/[^A-Za-z0-9._-]/g, '-');
  res.set({
    'Content-Type': report.contentType,
    'Content-Disposition': `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
    'Cache-Control': 'private, no-store',
  });
  res.send(report.buffer);
}

export async function buildMaintenancePptx(orderId, database, { showReasonFooter = false } = {}) {
  const order = getMaintenanceOrder(positiveId(orderId, 'orderId'), database);
  const report = await buildMaintenancePptxExport({
    orderIds: [order.id],
    showReasonFooter,
    groupBy: 'none',
  }, database);
  return { ...report, filename: safeReportName(order, 'pptx') };
}

export async function buildMaintenancePptxExport(input, database = defaultDatabase) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['orderIds', 'reasonId', 'area', 'groupBy', 'showReasonFooter']);
  if (!Array.isArray(body.orderIds)) throw new HttpError(400, 'orderIds must be an array of maintenance order IDs.');
  if (body.orderIds.length > 500) throw new HttpError(400, 'Select no more than 500 orders at a time.');
  const requestedOrderIds = integerIdArray(body.orderIds, 'orderIds');
  const reasonId = body.reasonId === undefined || body.reasonId === null || body.reasonId === ''
    ? null
    : positiveId(body.reasonId, 'reasonId');
  const area = optionalText(body.area, 'area', { maxLength: 160 });
  const groupBy = body.groupBy ?? 'none';
  if (!['reason', 'area', 'none'].includes(groupBy)) throw new HttpError(400, 'groupBy must be reason, area, or none.');
  optionalBoolean(body.showReasonFooter, 'showReasonFooter');

  let orderIds = requestedOrderIds;
  if (!orderIds.length) {
    orderIds = database.prepare(`
      SELECT id FROM maintenance_orders
      WHERE status = 'archived' AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
    `).all().map((row) => row.id);
  }
  if (!orderIds.length) throw new HttpError(404, 'No archived maintenance orders are available for export.');

  const orders = orderIds.map((orderId) => getMaintenanceOrder(orderId, database));
  let reasonName = null;
  if (reasonId !== null) {
    reasonName = database.prepare('SELECT name FROM maintenance_reasons WHERE id = ?').get(reasonId)?.name;
    if (!reasonName) throw new HttpError(404, 'Maintenance reason was not found.');
  }
  const normalizedArea = area?.toLocaleLowerCase('ar-EG') ?? null;
  const cards = orders.flatMap((order) => order.cards
    .filter((card) => (reasonId === null || card.reason_id === reasonId)
      && (normalizedArea === null || String(card.machine_area || order.area || '').trim().toLocaleLowerCase('ar-EG') === normalizedArea))
    .map((card) => ({ order, card })));
  if (!cards.length) throw new HttpError(404, 'No maintenance cards match the selected orders and filters.');

  const pptx = pptxDocument('MADAR Maintenance Report', `Categorized maintenance report · ${cards.length} machine cards`);
  const firstOrder = cards[0].order;
  const uniqueOrders = new Map(cards.map(({ order }) => [order.id, order]));
  const uniqueClients = new Map([...uniqueOrders.values()].map((order) => [order.client.id, order.client]));
  const logos = new Map();
  await Promise.all([...uniqueClients.values()].map(async (client) => {
    const firstClientOrder = [...uniqueOrders.values()].find((order) => order.client.id === client.id);
    logos.set(client.id, await loadClientLogo(firstClientOrder));
  }));
  const primary = hexColor(firstOrder.client?.primary_color);
  const secondary = hexColor(firstOrder.client?.secondary_color, 'F58220');

  const orderedGroups = new Map();
  if (groupBy === 'none') orderedGroups.set('', cards);
  else {
    const groupLabel = ({ order, card }) => groupBy === 'reason'
      ? (card.reason_name || 'سبب غير محدد')
      : (card.machine_area || order.area || 'منطقة غير محددة');
    for (const entry of cards) {
      const key = groupLabel(entry);
      const group = orderedGroups.get(key) ?? [];
      group.push(entry);
      orderedGroups.set(key, group);
    }
  }
  const groups = [...orderedGroups.entries()].sort(([left], [right]) => left.localeCompare(right, 'ar'));
  const indexPageCount = Math.ceil(cards.length / INDEX_ROWS_PER_SLIDE);
  let slideCursor = 1 + indexPageCount;
  let machineIndex = 0;
  const presentationGroups = groups.map(([groupName, entries]) => ({
    groupName,
    dividerPageNumber: groupBy === 'none' ? null : ++slideCursor,
    entries: entries.map((entry) => ({
      ...entry,
      index: ++machineIndex,
      pageNumber: ++slideCursor,
    })),
  }));
  const pageCount = slideCursor;
  const indexRows = presentationGroups.flatMap((group) => group.entries);
  const areaIndexByKey = new Map();
  for (const row of indexRows) {
    const areaName = String(row.card.machine_area || row.order.area || 'منطقة غير محددة').trim() || 'منطقة غير محددة';
    const key = areaName.toLocaleLowerCase('ar-EG');
    const summary = areaIndexByKey.get(key) ?? {
      area: areaName,
      count: 0,
      startPage: 2 + Math.floor((row.index - 1) / INDEX_ROWS_PER_SLIDE),
    };
    summary.count += 1;
    areaIndexByKey.set(key, summary);
  }
  const areaIndex = [...areaIndexByKey.values()].sort((left, right) => left.area.localeCompare(right.area, 'ar'));
  const reportPeriod = maintenanceReportPeriod(cards);
  addMaintenanceCoverSlide(
    pptx,
    firstOrder.client,
    logos.get(firstOrder.client.id),
    primary,
    secondary,
    areaIndex,
    cards.length,
    reportPeriod,
  );

  for (let page = 0; page < indexPageCount; page += 1) {
    const indexRowsForPage = indexRows.slice(page * INDEX_ROWS_PER_SLIDE, (page + 1) * INDEX_ROWS_PER_SLIDE);
    addMaintenanceIndexSlide(pptx, indexRowsForPage, page + 1, indexPageCount, page + 2, pageCount, primary);
  }

  for (const { groupName, dividerPageNumber, entries } of presentationGroups) {
    if (groupBy !== 'none') {
      const divider = pptx.addSlide();
      divider.background = { color: 'F3F7FB' };
      divider.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 1.0, line: { color: primary }, fill: { color: primary } });
      divider.addText('MADAR  ·  FIELD MAINTENANCE', { x: 0.65, y: 0.34, w: 12.0, h: 0.28, fontFace: 'Arial', fontSize: 14, bold: true, color: 'FFFFFF', align: 'right' });
      divider.addShape(pptx.ShapeType.roundRect, { x: 2.0, y: 2.25, w: 9.33, h: 2.5, rectRadius: 0.15, line: { color: 'DCE5EE' }, fill: { color: 'FFFFFF' } });
      divider.addText(groupBy === 'reason' ? 'سبب الصيانة' : 'المنطقة', { x: 2.5, y: 2.75, w: 8.33, h: 0.38, fontFace: 'Arial', fontSize: 17, color: '748498', align: 'center' });
      divider.addText(groupName, { x: 2.5, y: 3.25, w: 8.33, h: 0.72, fontFace: 'Arial', fontSize: 28, bold: true, color: primary, align: 'center', fit: 'shrink' });
      divider.addText(`${entries.length} ماكينة  ·  ${[...new Set(entries.map(({ order }) => order.order_code))].join('، ')}`, { x: 2.5, y: 4.12, w: 8.33, h: 0.28, fontFace: 'Arial', fontSize: 11, color: '53677B', align: 'center', fit: 'shrink' });
      addSlideFooter(divider, dividerPageNumber, pageCount);
    }
    for (const { order, card } of entries) {
      const clientLogo = logos.get(order.client.id);
      await addMaintenanceCardSlide(pptx, order, card, clientLogo, hexColor(order.client?.primary_color), hexColor(order.client?.secondary_color, '24A6A0'));
    }
  }
  const filterFilename = [reasonName, area].filter(Boolean).join('_') || 'All_Maintenance';
  const safeFilter = String(filterFilename).normalize('NFKC').trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'All_Maintenance';
  return {
    buffer: await pptx.write({ outputType: 'nodebuffer' }),
    filename: `Madar_Report_${safeFilter}.pptx`,
    contentType: PPTX_MIME,
  };
}

function rtlParagraph(text, options = {}) {
  return new Paragraph({ alignment: AlignmentType.RIGHT, bidirectional: true, ...options, children: [new TextRun(String(text ?? '—'))] });
}

export async function buildMaintenanceDocx(orderId, database) {
  const order = getMaintenanceOrder(positiveId(orderId, 'orderId'), database);
  const content = [
    new Paragraph({ text: 'MADAR', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    rtlParagraph('تقرير الصيانة الميدانية', { heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
    rtlParagraph(`العميل: ${order.client.name}`),
    rtlParagraph(`رقم الأمر: ${order.order_code}    ·    المنطقة: ${order.area || 'غير محددة'}`),
    rtlParagraph(`التاريخ: ${String(order.created_at ?? '').slice(0, 10) || '—'}`),
    rtlParagraph(`الفنيون: ${order.technicians.map((technician) => technician.name).join('، ') || 'غير معيّنين'}`),
    ...(order.notes ? [rtlParagraph(`ملاحظات الأمر: ${order.notes}`)] : []),
    rtlParagraph('ملخص بطاقات الفحص', { heading: HeadingLevel.HEADING_1 }),
  ];
  const cell = (text, header = false) => new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    shading: header ? { fill: 'DCE8F1' } : undefined,
    children: [rtlParagraph(text)],
  });
  content.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: [cell('الكود', true), cell('الآلة', true), cell('المنطقة', true), cell('الحالة / السبب', true)] }),
      ...order.cards.map((card) => new TableRow({ children: [cell(card.machine_code), cell(`${card.machine_name_ar}${card.machine_name_en ? ` · ${card.machine_name_en}` : ''}`), cell(card.machine_area), cell(`${card.status} · ${card.reason_name || '—'}`)] })),
    ],
  }));
  for (const card of order.cards) {
    content.push(rtlParagraph(`${card.machine_code} · ${card.machine_name_ar}`, { heading: HeadingLevel.HEADING_2, pageBreakBefore: true }));
    content.push(rtlParagraph(`المنطقة: ${card.machine_area || '—'}    ·    سبب العطل: ${card.reason_name || 'غير محدد'}`));
    content.push(rtlParagraph(`الفنيون: ${order.technicians.map((technician) => technician.name).join('، ') || 'غير معيّنين'}    ·    تاريخ الزيارة: ${String(order.created_at ?? '').slice(0, 10) || '—'}`));
    if (card.notes) content.push(rtlParagraph(`ملاحظات فنية: ${card.notes}`));
    if (order.notes) content.push(rtlParagraph(`ملاحظات الزيارة: ${order.notes}`));
    for (const [label, paths] of [['قبل الصيانة', card.before_photos], ['بعد الصيانة', card.after_photos]]) {
      content.push(rtlParagraph(label, { heading: HeadingLevel.HEADING_3 }));
      const images = await loadCardImages(paths);
      if (!images.length) {
        content.push(rtlParagraph('لا توجد صور مرفقة.'));
      } else {
        for (const image of images) {
          if (!['image/jpeg', 'image/png'].includes(image.contentType)) continue;
          content.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ data: image.data, transformation: { width: 240, height: 160 } })] }));
        }
      }
    }
  }
  const document = new Document({ creator: 'MADAR', title: `Maintenance report ${order.order_code}`, sections: [{ children: content }] });
  return { buffer: await Packer.toBuffer(document), filename: safeReportName(order, 'docx'), contentType: DOCX_MIME };
}

export async function exportMaintenanceReport(req, res, format, database) {
  if (!['pptx', 'docx'].includes(format)) throw new HttpError(400, 'Unsupported maintenance report format.');
  const report = format === 'pptx'
    ? await buildMaintenancePptx(req.params.id, database, { showReasonFooter: req.query?.showReasonFooter })
    : await buildMaintenanceDocx(req.params.id, database);
  downloadReport(res, report);
}

export async function exportMaintenancePptx(req, res, database = defaultDatabase) {
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const query = req.query ?? {};
  const input = { ...body };
  if (query.orderIds !== undefined) {
    const queryValues = Array.isArray(query.orderIds) ? query.orderIds : [query.orderIds];
    input.orderIds = queryValues.flatMap((value) => {
      if (typeof value !== 'string') throw new HttpError(400, 'orderIds query parameters must be text.');
      const cleaned = value.trim();
      return cleaned ? cleaned.split(',').map((id) => id.trim()) : [];
    });
  }
  for (const key of ['reasonId', 'area', 'groupBy', 'showReasonFooter']) {
    if (query[key] !== undefined) input[key] = query[key];
  }
  if (input.orderIds === undefined) input.orderIds = [];
  const report = await buildMaintenancePptxExport(input, database);
  downloadReport(res, report);
}
