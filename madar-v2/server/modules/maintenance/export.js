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
import { extname, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import sharp from 'sharp';
import { db as defaultDatabase } from '../../database/connection.js';
import { projectRoot } from '../../config/paths.js';
import { allowOnlyKeys, HttpError, integerIdArray, optionalText, positiveId, requireObject } from '../http.js';
import { resolveStorageFile } from '../storage.js';
import { getMaintenanceOrder } from './service.js';
import { applyPhotoRotation } from './photo-images.js';
import { compareMachineCodes, compareMaintenanceAreas } from './sorting.js';

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const IMAGE_TYPES = new Map([
  ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'], ['.png', 'image/png'], ['.webp', 'image/webp'], ['.heic', 'image/heic'], ['.heif', 'image/heif'],
]);
const INDEX_ROWS_PER_SLIDE = 15;
const FIXED_LOGO_CANDIDATES = [
  'server/assets/report-logo.png',
  'server/assets/report-logo.jpg',
  'server/assets/report-logo.jpeg',
  'server/assets/report-logo.webp',
  'server/assets/logo.png',
  'server/assets/logo.jpg',
];
const EXPORT_PROGRESS_TTL_MS = 10 * 60 * 1000;
const PPTX_EXPORT_SOCKET_TIMEOUT_MS = 7 * 60 * 1000;
const MAX_PPTX_EXPORT_ORDERS = 20;
const TOO_MANY_PPTX_ORDERS_MESSAGE = 'يرجى تحديد 20 أمر صيانة كحد أقصى للتصدير الواحد';
const PPTX_IMAGE_MAX_DIMENSION = 680;
const PPTX_IMAGE_JPEG_QUALITY = 70;
const exportProgressMap = new Map();
const completedReportsMap = new Map();

function pruneExpiredCompletedExports(now = Date.now()) {
  for (const [exportId, report] of completedReportsMap) {
    if (report.expiresAt && report.expiresAt <= now) completedReportsMap.delete(exportId);
  }
}

function pruneExpiredExportProgress(now = Date.now()) {
  for (const [exportId, progress] of exportProgressMap) {
    if (progress.expiresAt && progress.expiresAt <= now) exportProgressMap.delete(exportId);
  }
  pruneExpiredCompletedExports(now);
}

const exportCacheCleanupTimer = setInterval(() => pruneExpiredExportProgress(), 60_000);
exportCacheCleanupTimer.unref?.();

function storeExportProgress(exportId, progress, { completed = false } = {}) {
  if (!exportId) return;
  const now = Date.now();
  pruneExpiredExportProgress(now);
  exportProgressMap.set(exportId, {
    ...progress,
    expiresAt: completed ? now + EXPORT_PROGRESS_TTL_MS : null,
  });
}

export function getExportProgress(exportId) {
  if (typeof exportId !== 'string' || !exportId) return null;
  pruneExpiredExportProgress();
  const progress = exportProgressMap.get(exportId);
  if (!progress) return null;
  const { expiresAt, ...publicProgress } = progress;
  return publicProgress;
}

export function storeCompletedExport(exportId, report) {
  if (typeof exportId !== 'string' || !exportId || !report) return;
  const now = Date.now();
  pruneExpiredExportProgress(now);
  completedReportsMap.set(exportId, {
    ...report,
    expiresAt: now + EXPORT_PROGRESS_TTL_MS,
  });
}

export function getCompletedExportReport(exportId) {
  if (typeof exportId !== 'string' || !exportId) return null;
  const now = Date.now();
  pruneExpiredExportProgress(now);
  const report = completedReportsMap.get(exportId);
  if (!report) return null;
  const { expiresAt, ...completedReport } = report;
  return completedReport;
}

async function loadImage(storedPath, { ensurePortrait = false, rotation = 0 } = {}) {
  const extension = extname(storedPath).toLowerCase();
  const contentType = IMAGE_TYPES.get(extension);
  if (!contentType) return null;
  try {
    const absolutePath = await resolveStorageFile(storedPath);
    const source = await readFile(absolutePath);
    const metadata = await sharp(source, { failOn: 'none', fastShrinkOnLoad: true }).metadata();
    const orientationSwapsDimensions = [5, 6, 7, 8].includes(metadata.orientation);
    let orientedWidth = orientationSwapsDimensions ? metadata.height : metadata.width;
    let orientedHeight = orientationSwapsDimensions ? metadata.width : metadata.height;
    let pipelineSource = source;
    if (rotation) {
      pipelineSource = await applyPhotoRotation(source, rotation);
      const rotatedMetadata = await sharp(pipelineSource, { failOn: 'none' }).metadata();
      orientedWidth = rotatedMetadata.width;
      orientedHeight = rotatedMetadata.height;
    }
    let pipeline = rotation
      ? sharp(pipelineSource, { failOn: 'none', fastShrinkOnLoad: true })
      : sharp(source, { failOn: 'none', fastShrinkOnLoad: true }).rotate();
    if (ensurePortrait && orientedWidth && orientedHeight && orientedWidth > orientedHeight) {
      pipeline = pipeline.rotate(90);
    }
    const { data, info } = await pipeline
      .resize({
        width: PPTX_IMAGE_MAX_DIMENSION,
        height: PPTX_IMAGE_MAX_DIMENSION,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: PPTX_IMAGE_JPEG_QUALITY })
      .toBuffer({ resolveWithObject: true });
    return { contentType: 'image/jpeg', data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

async function loadLocalImageFile(filePath) {
  try {
    const source = await readFile(filePath);
    const { data, info } = await sharp(source, { failOn: 'none', fastShrinkOnLoad: true })
      .rotate()
      .resize({ width: 680, height: 680, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#FFFFFF' })
      .jpeg({ quality: 70 })
      .toBuffer({ resolveWithObject: true });
    if (!info.width || !info.height) return null;
    return { contentType: 'image/jpeg', data, width: info.width, height: info.height };
  } catch {
    return null;
  }
}

async function loadFixedReportLogo() {
  for (const relativePath of FIXED_LOGO_CANDIDATES) {
    const absolutePath = resolve(projectRoot, relativePath);
    try {
      const fileStat = await stat(absolutePath);
      if (!fileStat.isFile()) continue;
      const image = await loadLocalImageFile(absolutePath);
      if (image) return image;
    } catch {
      // The candidate may not exist; try the next supported filename.
    }
  }
  return null;
}

async function loadCardImages(paths, rotations = []) {
  const topPaths = paths.slice(0, 4);
  const results = await Promise.all(
    topPaths.map((path, index) => loadImage(path, { ensurePortrait: true, rotation: rotations[index] ?? 0 })),
  );
  return results.filter(Boolean);
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
    data: `data:${image.contentType || 'image/jpeg'};base64,${image.data.toString('base64')}`,
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

function addSlideFooter(slide, pageNumber, pageCount, primary = '07509B', secondary = 'F58220') {
  const primaryColor = primary || '07509B';
  const secondaryColor = secondary || 'F58220';
  slide.addShape('line', {
    x: 0.48,
    y: 7.15,
    w: 10.35,
    h: 0,
    line: { color: 'CBD5E1', width: 0.8 },
  });
  slide.addShape('roundRect', {
    x: 10.95,
    y: 6.94,
    w: 1.9,
    h: 0.42,
    rectRadius: 0.08,
    line: { color: primaryColor, width: 1.4 },
    fill: { color: 'FFFFFF' },
    shadow: {
      type: 'outer',
      color: '0F172A',
      blur: 5,
      angle: 45,
      distance: 1.8,
      opacity: 0.16,
    },
  });
  slide.addShape('roundRect', {
    x: 12.74,
    y: 7.02,
    w: 0.05,
    h: 0.26,
    rectRadius: 0.02,
    line: { color: secondaryColor },
    fill: { color: secondaryColor },
  });
  slide.addText(`\u200Fصفحة ${pageNumber} من ${pageCount}\u200F`, {
    x: 10.98,
    y: 6.97,
    w: 1.74,
    h: 0.36,
    fontFace: 'Arial',
    fontSize: 10.5,
    bold: true,
    color: primaryColor,
    align: 'center',
    valign: 'mid',
    rtlMode: true,
  });
}

function optionalBoolean(value, label, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new HttpError(400, `${label} must be true or false.`);
}

function addMaintenanceIndexSlide(pptx, rows, areaName, indexPage, indexPageCount, pageNumber, pageCount, primary) {
  const slide = pptx.addSlide();
  slide.background = { color: 'F7F9FC' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.9, line: { color: primary }, fill: { color: primary } });
  slide.addText(`فهرس الماكينات · ${areaName}`, { x: 0.62, y: 0.2, w: 7.2, h: 0.38, fontFace: 'Arial', fontSize: 20, bold: true, color: 'FFFFFF', align: 'right', fit: 'shrink' });
  slide.addText(`صفحة ${indexPage} من ${indexPageCount}`, { x: 9.3, y: 0.3, w: 3.35, h: 0.22, fontFace: 'Arial', fontSize: 10, color: 'DDEBFA', align: 'left' });

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
      { text: String(row.index), ...columns[0], hyperlink: { slide: row.pageNumber, tooltip: `فتح شريحة ${row.pageNumber}` } },
      { text: row.card.machine_name_en || row.card.machine_code, ...columns[1] },
      { text: row.card.machine_area || row.order.area || '—', ...columns[2] },
      { text: row.card.machine_code, ...columns[3] },
      { text: String(row.pageNumber), ...columns[4], hyperlink: { slide: row.pageNumber, tooltip: `فتح شريحة ${row.pageNumber}` } },
    ];
    for (const value of values) {
      slide.addText(value.text, {
        x: value.x, y: y + 0.045, w: value.w, h: 0.15,
        fontFace: 'Arial', fontSize: 8, color: value === values.at(-1) ? primary : '263B50',
        bold: value === values.at(-1), align: value.align, fit: 'shrink', hyperlink: value.hyperlink,
      });
    }
  });
  addSlideFooter(slide, pageNumber, pageCount, primary);
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

function addMaintenanceCoverSlide(pptx, client, logo, primary, secondary, areaIndex, totalMachines, reportPeriod, pageCount) {
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
  slide.addText(`فترة التقرير: ${reportPeriod || 'غير محددة'}`, {
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
      hyperlink: { slide: item.startPage, tooltip: `فتح شريحة ${item.startPage}` },
    });
  });

  // 4. Subtle Bottom Footer
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 7.36, w: 13.333, h: 0.14, line: { color: 'E2E8F0' }, fill: { color: 'E2E8F0' } });
  slide.addText('البنك التجاري الدولي (CIB)  ·  تقرير فحص وتوثيق الصيانة الدورية لماكينات الصراف الآلي  ·  سري وخاص بالإدارة', {
    x: 0.8, y: 7.37, w: 11.733, h: 0.12, fontFace: 'Arial', fontSize: 8, color: '64748B', align: 'center',
  });
  addSlideFooter(slide, 1, pageCount, primary, secondary);
}

function addAreaDividerSlide(pptx, area, entries, pageNumber, pageCount, primary, secondary) {
  const slide = pptx.addSlide();
  slide.background = { color: 'F3F7FB' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.92, line: { color: primary }, fill: { color: primary } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.92, w: 13.333, h: 0.06, line: { color: secondary }, fill: { color: secondary } });
  slide.addText('فحص وتوثيق الصيانة الميدانية · تغطية المناطق', {
    x: 1.1, y: 1.72, w: 11.13, h: 0.3, fontFace: 'Arial', fontSize: 13, bold: true,
    color: '64748B', align: 'center', rtlMode: true,
  });
  slide.addText(area, {
    x: 1.0, y: 2.24, w: 11.33, h: 0.75, fontFace: 'Arial', fontSize: 28, bold: true,
    color: primary, align: 'center', valign: 'mid', fit: 'shrink', rtlMode: true,
  });
  slide.addShape(pptx.ShapeType.roundRect, {
    x: 4.2, y: 3.45, w: 4.93, h: 0.72, rectRadius: 0.12,
    line: { color: primary }, fill: { color: primary },
  });
  slide.addText(`${entries.length} ماكينة ATM`, {
    x: 4.35, y: 3.64, w: 4.63, h: 0.3, fontFace: 'Arial', fontSize: 16, bold: true,
    color: 'FFFFFF', align: 'center', valign: 'mid', rtlMode: true,
  });
  const orderCodes = [...new Set(entries.map(({ order }) => order.order_code).filter(Boolean))];
  slide.addText(`أوامر التشغيل: ${orderCodes.join('، ') || '—'}`, {
    x: 1.1, y: 4.75, w: 11.13, h: 0.38, fontFace: 'Arial', fontSize: 13,
    color: '475569', align: 'center', fit: 'shrink', rtlMode: true,
  });
  slide.addShape(pptx.ShapeType.line, { x: 4.25, y: 5.55, w: 4.83, h: 0, line: { color: secondary, width: 1.5, transparency: 14 } });
  addSlideFooter(slide, pageNumber, pageCount, primary, secondary);
  return slide;
}

function addReasonDividerSlide(pptx, groupName, entries, pageNumber, pageCount, primary, secondary) {
  const slide = pptx.addSlide();
  slide.background = { color: 'F3F7FB' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 1.0, line: { color: primary }, fill: { color: primary } });
  slide.addText('MADAR  ·  FIELD MAINTENANCE', { x: 0.65, y: 0.34, w: 12.0, h: 0.28, fontFace: 'Arial', fontSize: 14, bold: true, color: 'FFFFFF', align: 'right' });
  slide.addShape(pptx.ShapeType.roundRect, { x: 2.0, y: 2.25, w: 9.33, h: 2.5, rectRadius: 0.15, line: { color: 'DCE5EE' }, fill: { color: 'FFFFFF' } });
  slide.addText('الأسباب', { x: 2.5, y: 2.75, w: 8.33, h: 0.38, fontFace: 'Arial', fontSize: 17, color: '748498', align: 'center' });
  slide.addText(groupName, { x: 2.5, y: 3.25, w: 8.33, h: 0.72, fontFace: 'Arial', fontSize: 28, bold: true, color: primary, align: 'center', fit: 'shrink' });
  slide.addText(`${entries.length} ماكينة  ·  ${[...new Set(entries.map(({ order }) => order.order_code))].join('، ')}`, { x: 2.5, y: 4.12, w: 8.33, h: 0.28, fontFace: 'Arial', fontSize: 11, color: '53677B', align: 'center', fit: 'shrink' });
  addSlideFooter(slide, pageNumber, pageCount, primary, secondary);
  return slide;
}

async function addMaintenanceCardSlide(pptx, order, card, clientLogo, fixedLogo, primary, secondary, pageNumber, pageCount) {
  const slide = pptx.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 1.18, line: { color: 'F3F7FB' }, fill: { color: 'F3F7FB' } });
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 1.14, w: 13.333, h: 0.04, line: { color: secondary }, fill: { color: secondary } });
  addClientLogo(slide, pptx, fixedLogo || clientLogo, order.client, 0.42, 0.18, 0.85, 0.72);
  slide.addText(`${card.machine_name_en || card.machine_code} • ${card.machine_code}`, {
    x: 8.6,
    y: 0.18,
    w: 4.3,
    h: 0.75,
    fontFace: 'Arial',
    fontSize: 17,
    bold: true,
    color: primary,
    align: 'right',
    valign: 'mid',
    fit: 'shrink',
    rtlMode: true,
  });
  const reasonEntries = (Array.isArray(card.reason_ids) && Array.isArray(card.reason_names) && card.reason_ids.length === card.reason_names.length)
    ? card.reason_ids.map((id, index) => ({ id: Number(id), name: String(card.reason_names[index] ?? '').trim() }))
    : (Array.isArray(card.reason_names) && card.reason_names.length
      ? card.reason_names.map((name, index) => ({ id: Array.isArray(card.reason_ids) ? Number(card.reason_ids[index]) : null, name: String(name ?? '').trim() }))
      : (card.reason_name ? card.reason_name.split(/ • |، /).map((name) => ({ id: null, name: String(name ?? '').trim() })) : []));
  const reasons = reasonEntries.filter((entry) => entry.name && entry.name !== 'غير محدد');
  const linesByReasonId = new Map(
    (card.maintenance_lines ?? []).map((line) => [Number(line.reasonId), line])
  );
  const linesByLabel = new Map(
    (card.maintenance_lines ?? []).map((line) => [String(line.label).trim(), line])
  );
  if (reasons.length) {
    const fontSize = reasons.length === 1 ? 15.5 : (reasons.length === 2 ? 12.5 : 11);
    const reasonRuns = reasons.map((entry, index) => {
      const reasonText = entry.name;
      const line = (entry.id !== null && linesByReasonId.get(entry.id))
        || linesByLabel.get(reasonText);
      let formattedText = reasonText;
      if (line && line.quantity > 0) {
        if (line.quantityProvenance === 'legacy_default') {
          formattedText = reasonText;
        } else {
          formattedText = `${reasonText} (العدد: ${line.quantity})`;
        }
      }
      return {
        text: `${index + 1}. ${formattedText}`,
        options: {
          rtlMode: true,
          fontSize,
          bold: true,
          color: primary,
          lang: 'ar-EG',
          breakLine: index < reasons.length - 1,
        },
      };
    });
    slide.addText(reasonRuns, {
      x: 1.8,
      y: 0.16,
      w: 6.6,
      h: 0.85,
      fontFace: 'Arial',
      align: 'center',
      valign: 'mid',
      fit: 'shrink',
      rtlMode: true,
    });
  }
  const [before, after] = await Promise.all([
    loadCardImages(card.before_photos, card.before_photo_rotations),
    loadCardImages(card.after_photos, card.after_photo_rotations),
  ]);
  const photoGridHeight = 5.1;
  slide.addShape(pptx.ShapeType.roundRect, { x: 0.48, y: 1.35, w: 6.05, h: 0.43, rectRadius: 0.1, line: { color: 'DDE6EF' }, fill: { color: 'EAF4F4' } });
  slide.addText('After', { x: 0.6, y: 1.45, w: 5.8, h: 0.2, fontFace: 'Arial', fontSize: 13, bold: true, color: primary, align: 'center' });
  slide.addShape(pptx.ShapeType.roundRect, { x: 6.8, y: 1.35, w: 6.05, h: 0.43, rectRadius: 0.1, line: { color: 'DDE6EF' }, fill: { color: 'EEF3FA' } });
  slide.addText('Before', { x: 6.92, y: 1.45, w: 5.8, h: 0.2, fontFace: 'Arial', fontSize: 13, bold: true, color: primary, align: 'center' });
  addImageGrid(slide, pptx, after, 0.48, 1.92, 6.05, photoGridHeight);
  addImageGrid(slide, pptx, before, 6.8, 1.92, 6.05, photoGridHeight);
  slide.addShape(pptx.ShapeType.rect, {
    x: 6.64,
    y: 1.35,
    w: 0.04,
    h: 5.65,
    line: { color: secondary },
    fill: { color: secondary },
  });
  if (pageNumber && pageCount) addSlideFooter(slide, pageNumber, pageCount, primary, secondary);
}

function pptxDocument(title, subject) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'MADAR';
  pptx.subject = subject;
  pptx.title = title;
  pptx.rtlMode = true;
  pptx.theme = { headFontFace: 'Arial', bodyFontFace: 'Arial', lang: 'ar-EG' };
  return pptx;
}

export function downloadReport(res, report) {
  const fallbackFilename = report.filename.replace(/[^A-Za-z0-9._-]/g, '-');
  res.set({
    'Content-Type': report.contentType,
    'Content-Disposition': `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
    'Cache-Control': 'private, no-store',
  });
  res.send(report.buffer);
}

function extendPptxExportSocketTimeout(req, res) {
  const socket = req.socket;
  if (!socket) return;
  const previousTimeout = Number.isFinite(socket.timeout) ? socket.timeout : 0;
  const handleTimeout = () => {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) {
      res.destroy(new Error('PowerPoint export socket timed out.'));
      return;
    }
    res.status(504).json({ error: 'انتهت مهلة تجهيز عرض PowerPoint؛ قلّل نطاق الأرشيف ثم أعد المحاولة.' });
  };
  req.setTimeout(PPTX_EXPORT_SOCKET_TIMEOUT_MS, handleTimeout);
  const restoreTimeout = () => {
    socket.removeListener('timeout', handleTimeout);
    if (!socket.destroyed) socket.setTimeout(previousTimeout);
  };
  res.once('finish', restoreTimeout);
  res.once('close', restoreTimeout);
}

export async function buildMaintenancePptx(orderId, database, { showReasonFooter = false, useFixedLogoOnCover = false } = {}) {
  const order = getMaintenanceOrder(positiveId(orderId, 'orderId'), database);
  const report = await buildMaintenancePptxExport({
    orderIds: [order.id],
    showReasonFooter,
    useFixedLogoOnCover,
    groupBy: 'area',
  }, database);
  return { ...report, filename: safeReportName(order, 'pptx') };
}

export async function buildMaintenancePptxExport(input, database = defaultDatabase) {
  const body = requireObject(input);
  allowOnlyKeys(body, ['orderIds', 'reasonId', 'area', 'groupBy', 'showReasonFooter', 'exportId', 'useFixedLogoOnCover']);
  if (!Array.isArray(body.orderIds)) throw new HttpError(400, 'orderIds must be an array of maintenance order IDs.');
  if (body.orderIds.length > MAX_PPTX_EXPORT_ORDERS) throw new HttpError(400, TOO_MANY_PPTX_ORDERS_MESSAGE);
  const requestedOrderIds = integerIdArray(body.orderIds, 'orderIds');
  if (!requestedOrderIds.length) throw new HttpError(400, 'يرجى تحديد أمر صيانة واحد على الأقل للتصدير.');
  const exportId = optionalText(body.exportId, 'exportId', { maxLength: 128 }) || null;
  const reasonId = body.reasonId === undefined || body.reasonId === null || body.reasonId === ''
    ? null
    : positiveId(body.reasonId, 'reasonId');
  const area = optionalText(body.area, 'area', { maxLength: 160 });
  const groupBy = body.groupBy ?? 'area';
  if (!['reason', 'area', 'none'].includes(groupBy)) throw new HttpError(400, 'groupBy must be reason, area, or none.');
  optionalBoolean(body.showReasonFooter, 'showReasonFooter');
  const useFixedLogoOnCover = optionalBoolean(body.useFixedLogoOnCover, 'useFixedLogoOnCover');

  const orders = requestedOrderIds.map((orderId) => getMaintenanceOrder(orderId, database));
  let reasonName = null;
  if (reasonId !== null) {
    reasonName = database.prepare('SELECT name FROM maintenance_reasons WHERE id = ?').get(reasonId)?.name;
    if (!reasonName) throw new HttpError(404, 'Maintenance reason was not found.');
  }
  const normalizedArea = area?.toLocaleLowerCase('ar-EG') ?? null;
  const cardCandidates = orders.flatMap((order) => order.cards.map((card) => ({ order, card })));
  const timestamp = (value) => {
    if (!value) return 0;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const recency = ({ order, card }) => Math.max(
    timestamp(card.updated_at),
    timestamp(order.archived_at),
    timestamp(order.updated_at),
    timestamp(order.created_at),
  );
  const latestCardByMachine = new Map();
  for (const entry of cardCandidates) {
    const machineKey = entry.card.machine_id ?? entry.card.machine_code;
    const candidate = { entry, updatedAt: recency(entry) };
    const existing = latestCardByMachine.get(machineKey);
    if (!existing
      || candidate.updatedAt > existing.updatedAt
      || (candidate.updatedAt === existing.updatedAt
        && (entry.order.id > existing.entry.order.id
          || (entry.order.id === existing.entry.order.id && entry.card.id > existing.entry.card.id)))) {
      latestCardByMachine.set(machineKey, candidate);
    }
  }
  const cards = [...latestCardByMachine.values()].map(({ entry }) => entry).filter(({ order, card }) => (
    card.status !== 'excluded'
    && (card.before_photos?.length > 0 || card.after_photos?.length > 0)
    && (reasonId === null || card.reason_id === reasonId || (Array.isArray(card.reason_ids) && card.reason_ids.includes(reasonId)))
    && (normalizedArea === null || String(card.machine_area || order.area || '').trim().toLocaleLowerCase('ar-EG') === normalizedArea)
  ));
  if (!cards.length) throw new HttpError(404, 'لا توجد بطاقات صيانة تحتوي على صور للأوامر والفلاتر المحددة.');

  const totalCards = cards.length;
  const startTime = Date.now();
  storeExportProgress(exportId, {
    active: true,
    total: totalCards,
    current: 0,
    percent: 0,
    stage: 'جارٍ تجهيز بيانات التقرير...',
    machineName: null,
    machineNameAr: null,
    machineNameEn: null,
    machineCode: null,
    area: null,
    estimatedSeconds: null,
    speedSecPerMachine: null,
  });

  let processedCards = 0;
  try {
    const pptx = pptxDocument('MADAR Maintenance Report', `Categorized maintenance report · ${cards.length} machine cards`);
    const fixedLogo = await loadFixedReportLogo();
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

    const areaForEntry = ({ order, card }) => String(card.machine_area || order.area || 'منطقة غير محددة').trim() || 'منطقة غير محددة';
    const sortedCards = [...cards].sort((left, right) => (
      compareMaintenanceAreas(areaForEntry(left), areaForEntry(right))
      || compareMachineCodes(left.card.machine_code, right.card.machine_code)
      || String(left.order.order_code).localeCompare(String(right.order.order_code), undefined, { numeric: true, sensitivity: 'base' })
      || left.card.id - right.card.id
    ));
    const rowsByArea = new Map();
    for (const entry of sortedCards) {
      const areaName = areaForEntry(entry);
      const key = areaName.toLocaleLowerCase('ar-EG');
      const areaRows = rowsByArea.get(key) ?? { area: areaName, entries: [] };
      areaRows.entries.push(entry);
      rowsByArea.set(key, areaRows);
    }
    const orderedAreas = [...rowsByArea.values()].sort((left, right) => compareMaintenanceAreas(left.area, right.area));
    for (const areaRows of orderedAreas) {
      areaRows.entries.sort((left, right) => (
        compareMachineCodes(left.card.machine_code, right.card.machine_code)
        || String(left.order.order_code).localeCompare(String(right.order.order_code), undefined, { numeric: true, sensitivity: 'base' })
        || left.card.id - right.card.id
      ));
    }
    let slideCursor = 1;
    let machineIndex = 0;
    const presentedRowsByKey = new Map();
    const presentationPlan = [];
    const areaDividerPages = new Map();
    for (const areaRows of orderedAreas) {
      const areaKey = areaRows.area.toLocaleLowerCase('ar-EG');
      const areaDividerPage = ++slideCursor;
      areaDividerPages.set(areaKey, areaDividerPage);
      presentationPlan.push({
        type: 'area-divider',
        area: areaRows.area,
        entries: areaRows.entries,
        pageNumber: areaDividerPage,
      });
      const indexPageCount = Math.ceil(areaRows.entries.length / INDEX_ROWS_PER_SLIDE);
      for (let page = 0; page < indexPageCount; page += 1) {
        presentationPlan.push({
          type: 'area-index',
          area: areaRows.area,
          indexPage: page + 1,
          indexPageCount,
          pageNumber: ++slideCursor,
          entries: areaRows.entries.slice(page * INDEX_ROWS_PER_SLIDE, (page + 1) * INDEX_ROWS_PER_SLIDE),
        });
      }

      let cardGroups = [{ groupName: '', entries: areaRows.entries }];
      if (groupBy === 'reason') {
        const groupsByReason = new Map();
        for (const entry of areaRows.entries) {
          const groupName = entry.card.reason_name || 'سبب غير محدد';
          const groupKey = groupName.toLocaleLowerCase('ar-EG');
          if (!groupsByReason.has(groupKey)) groupsByReason.set(groupKey, { groupName, entries: [] });
          groupsByReason.get(groupKey).entries.push(entry);
        }
        cardGroups = [...groupsByReason.values()];
      }

      for (const { groupName, entries } of cardGroups) {
        if (groupBy === 'reason') {
          presentationPlan.push({
            type: 'reason-divider',
            groupName,
            entries,
            pageNumber: ++slideCursor,
          });
        }
        for (const entry of entries) {
          const row = { ...entry, index: ++machineIndex, pageNumber: ++slideCursor };
          presentedRowsByKey.set(`${row.order.id}:${row.card.id}`, row);
          presentationPlan.push({ type: 'machine', ...row });
        }
      }
    }
    const pageCount = slideCursor;
    const areaIndex = orderedAreas.map((areaRows) => {
      const firstRow = presentedRowsByKey.get(`${areaRows.entries[0].order.id}:${areaRows.entries[0].card.id}`);
      return {
        area: areaRows.area,
        count: areaRows.entries.length,
        startPage: areaDividerPages.get(areaRows.area.toLocaleLowerCase('ar-EG')) ?? firstRow.pageNumber,
      };
    });
    const reportPeriod = maintenanceReportPeriod(cards);
    addMaintenanceCoverSlide(
      pptx,
      firstOrder.client,
      useFixedLogoOnCover ? (fixedLogo || logos.get(firstOrder.client.id)) : logos.get(firstOrder.client.id),
      primary,
      secondary,
      areaIndex,
      cards.length,
      reportPeriod,
      pageCount,
    );

    let renderedSlideCount = 0;
    for (const plannedSlide of presentationPlan) {
      renderedSlideCount += 1;
      if (renderedSlideCount % 10 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (plannedSlide.type === 'area-divider') {
        addAreaDividerSlide(pptx, plannedSlide.area, plannedSlide.entries, plannedSlide.pageNumber, pageCount, primary, secondary);
        continue;
      }
      if (plannedSlide.type === 'area-index') {
        const rows = plannedSlide.entries.map((entry) => presentedRowsByKey.get(`${entry.order.id}:${entry.card.id}`));
        addMaintenanceIndexSlide(
          pptx,
          rows,
          plannedSlide.area,
          plannedSlide.indexPage,
          plannedSlide.indexPageCount,
          plannedSlide.pageNumber,
          pageCount,
          primary,
        );
        continue;
      }
      if (plannedSlide.type === 'reason-divider') {
        addReasonDividerSlide(pptx, plannedSlide.groupName, plannedSlide.entries, plannedSlide.pageNumber, pageCount, primary, secondary);
        continue;
      }
      if (plannedSlide.type === 'machine') {
        const { order, card, pageNumber } = plannedSlide;
        const elapsed = Date.now() - startTime;
        const avgMsPerCard = processedCards > 0 ? elapsed / processedCards : null;
        const remainingCards = totalCards - processedCards;
        const machineName = card.machine_name_ar || card.machine_name_en || card.machine_code;
        storeExportProgress(exportId, {
          active: true,
          total: totalCards,
          current: processedCards + 1,
          percent: Math.min(92, Math.round((processedCards / totalCards) * 90)),
          stage: 'جارٍ معالجة شرائح الماكينات...',
          machineName,
          machineNameAr: card.machine_name_ar || '',
          machineNameEn: card.machine_name_en || '',
          machineCode: card.machine_code,
          area: card.machine_area || order.area || '',
          estimatedSeconds: avgMsPerCard === null
            ? null
            : Math.max(0, Math.round((remainingCards * avgMsPerCard) / 1000)),
          speedSecPerMachine: avgMsPerCard === null ? null : (avgMsPerCard / 1000).toFixed(1),
        });
        const clientLogo = logos.get(order.client.id);
        await addMaintenanceCardSlide(
          pptx,
          order,
          card,
          clientLogo,
          fixedLogo,
          hexColor(order.client?.primary_color),
          hexColor(order.client?.secondary_color, '24A6A0'),
          pageNumber,
          pageCount,
        );
        processedCards += 1;
      }
    }
    const filterFilename = [reasonName, area].filter(Boolean).join('_') || 'All_Maintenance';
    const safeFilter = String(filterFilename).normalize('NFKC').trim().replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'All_Maintenance';
    storeExportProgress(exportId, {
      active: true,
      total: totalCards,
      current: totalCards,
      percent: 94,
      stage: 'جارٍ ضغط وتجهيز ملف PowerPoint...',
      machineName: null,
      machineNameAr: null,
      machineNameEn: null,
      machineCode: null,
      area: null,
      estimatedSeconds: null,
      speedSecPerMachine: null,
    });
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    storeExportProgress(exportId, {
      active: false,
      total: totalCards,
      current: totalCards,
      percent: 100,
      stage: 'اكتمل إنشاء ملف PowerPoint.',
      machineName: null,
      machineNameAr: null,
      machineNameEn: null,
      machineCode: null,
      area: null,
      estimatedSeconds: 0,
      speedSecPerMachine: null,
    }, { completed: true });
    return {
      buffer,
      filename: `Madar_Report_${safeFilter}.pptx`,
      contentType: PPTX_MIME,
    };
  } catch (error) {
    storeExportProgress(exportId, {
      active: false,
      total: totalCards,
      current: processedCards,
      percent: Math.min(92, Math.round((processedCards / totalCards) * 90)),
      stage: 'تعذر إنشاء ملف PowerPoint.',
      machineName: null,
      machineNameAr: null,
      machineNameEn: null,
      machineCode: null,
      area: null,
      estimatedSeconds: null,
      speedSecPerMachine: null,
    }, { completed: true });
    throw error;
  }
}

function rtlParagraph(text, options = {}) {
  return new Paragraph({ alignment: AlignmentType.RIGHT, bidirectional: true, ...options, children: [new TextRun(String(text ?? '—'))] });
}

export async function buildMaintenanceDocx(orderId, database) {
  const order = getMaintenanceOrder(positiveId(orderId, 'orderId'), database);
  const cards = order.cards ?? [];
  const completedCards = cards.filter((card) => card.status === 'completed');
  const missingCards = cards.filter((card) => card.status !== 'completed');
  const unmatchedFolders = order.unmatched_folders ?? [];
  const content = [
    new Paragraph({ text: 'MADAR', heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER }),
    rtlParagraph('تقرير الصيانة الميدانية الشامل للرحلة', { heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER }),
    rtlParagraph(`العميل: ${order.client.name}`),
    rtlParagraph(`رقم الأمر: ${order.order_code}    ·    المنطقة: ${order.area || 'غير محددة'}`),
    rtlParagraph(`التاريخ: ${String(order.created_at ?? '').slice(0, 10) || '—'}`),
    rtlParagraph(`الفنيون: ${order.technicians.map((technician) => technician.name).join('، ') || 'غير معيّنين'}`),
    rtlParagraph(`إحصائية الزيارة: ${completedCards.length} ماكينة مكتملة الفحص  ·  ${missingCards.length} ماكينة غير مشمولة / ناقصة  ·  ${unmatchedFolders.length} مجلدات تحتاج مراجعة`),
    ...(order.notes ? [rtlParagraph(`ملاحظات الزيارة: ${order.notes}`)] : []),
    rtlParagraph('ملخص فحص الماكينات', { heading: HeadingLevel.HEADING_1 }),
  ];
  const cell = (text, header = false, color = null) => new TableCell({
    width: { size: 25, type: WidthType.PERCENTAGE },
    shading: header ? { fill: 'DCE8F1' } : color ? { fill: color } : undefined,
    children: [rtlParagraph(text)],
  });
  content.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: [cell('الكود', true), cell('الآلة', true), cell('المنطقة', true), cell('الحالة / السبب', true)] }),
      ...cards.map((card) => {
        const isCompleted = card.status === 'completed';
        const activeLines = (card.maintenance_lines || []).filter((l) => l.quantity > 0 && l.quantityProvenance !== 'legacy_default');
        const partsSummary = activeLines.map((l) => `${l.label} (العدد: ${l.quantity})`).join('، ');
        const statusLabel = isCompleted
          ? `مكتمل (${card.reason_name || 'فحص دوري'}${partsSummary ? ` [${partsSummary}]` : ''})`
          : 'لم يتم الفحص (ناقص)';
        return new TableRow({
          children: [
            cell(card.machine_code),
            cell(`${card.machine_name_ar}${card.machine_name_en ? ` · ${card.machine_name_en}` : ''}`),
            cell(card.machine_area),
            cell(statusLabel, false, isCompleted ? 'ECFDF5' : 'FEF2F2'),
          ],
        });
      }),
    ],
  }));

  if (completedCards.length) {
    content.push(rtlParagraph('بطاقات الماكينات المكتملة الفحص والتوثيق', { heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
  }
  for (const card of completedCards) {
    content.push(rtlParagraph(`${card.machine_code} · ${card.machine_name_ar}`, { heading: HeadingLevel.HEADING_2, pageBreakBefore: true }));
    const activeLines = (card.maintenance_lines || []).filter((l) => l.quantity > 0 && l.quantityProvenance !== 'legacy_default');
    const partsSummary = activeLines.map((l) => `${l.label} (العدد: ${l.quantity})`).join('، ');
    content.push(rtlParagraph(`المنطقة: ${card.machine_area || '—'}    ·    سبب العطل: ${card.reason_name || 'غير محدد'}${partsSummary ? `    ·    القطع المستبدلة: ${partsSummary}` : ''}`));
    content.push(rtlParagraph(`الفنيون: ${order.technicians.map((technician) => technician.name).join('، ') || 'غير معيّنين'}    ·    تاريخ الزيارة: ${String(order.created_at ?? '').slice(0, 10) || '—'}`));
    for (const [label, paths] of [['قبل الصيانة', card.before_photos], ['بعد الصيانة', card.after_photos]]) {
      content.push(rtlParagraph(label, { heading: HeadingLevel.HEADING_3 }));
      const rotations = label === 'قبل الصيانة' ? card.before_photo_rotations : card.after_photo_rotations;
      const images = await loadCardImages(paths, rotations);
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

  if (missingCards.length) {
    content.push(rtlParagraph('ماكينات غير مشمولة في المجلد / لم يتم فحصها بالرحلة', { heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
    content.push(rtlParagraph('الماكينات التالية تقع ضمن نطاق خط السير ولكن لم تكتمل بيانات فحصها أو صورها في ملفات الرحلة:'));
    for (const card of missingCards) {
      content.push(rtlParagraph(`• ${card.machine_code} - ${card.machine_name_ar} (${card.machine_area || '—'}) - الحالة: معلّق بدون توثيق مكتمل`));
    }
  }

  if (unmatchedFolders.length) {
    content.push(rtlParagraph('مجلدات الرحلة غير المطابقة (تحتاج مراجعة)', { heading: HeadingLevel.HEADING_1, pageBreakBefore: true }));
    for (const folder of unmatchedFolders) {
      const photoCount = folder.photo_count
        || (folder.before_photos?.length ?? 0) + (folder.after_photos?.length ?? 0);
      content.push(rtlParagraph(`• مجلد: "${folder.folder_name}" - المصدر: ${folder.source_name || '—'} - عدد الصور: ${photoCount} صور`));
    }
  }

  const document = new Document({ creator: 'MADAR', title: `Maintenance report ${order.order_code}`, sections: [{ children: content }] });
  return { buffer: await Packer.toBuffer(document), filename: safeReportName(order, 'docx'), contentType: DOCX_MIME };
}

export async function exportMaintenanceReport(req, res, format, database) {
  if (!['pptx', 'docx'].includes(format)) throw new HttpError(400, 'Unsupported maintenance report format.');
  if (format === 'pptx') extendPptxExportSocketTimeout(req, res);
  let report;
  try {
    report = format === 'pptx'
      ? await buildMaintenancePptx(req.params.id, database, {
        showReasonFooter: req.query?.showReasonFooter,
        useFixedLogoOnCover: req.query?.useFixedLogoOnCover,
      })
      : await buildMaintenanceDocx(req.params.id, database);
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    throw error;
  }
  if (res.destroyed || res.writableEnded) return;
  downloadReport(res, report);
}

export async function exportMaintenancePptx(req, res, database = defaultDatabase) {
  extendPptxExportSocketTimeout(req, res);
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
  for (const key of ['reasonId', 'area', 'groupBy', 'showReasonFooter', 'exportId', 'useFixedLogoOnCover', 'mode']) {
    if (query[key] !== undefined) input[key] = query[key];
  }
  if (input.orderIds === undefined) input.orderIds = [];
  if (!Array.isArray(input.orderIds)) throw new HttpError(400, 'orderIds must be an array of maintenance order IDs.');
  if (input.orderIds.length > MAX_PPTX_EXPORT_ORDERS) throw new HttpError(400, TOO_MANY_PPTX_ORDERS_MESSAGE);
  if (!input.orderIds.length) throw new HttpError(400, 'يرجى تحديد أمر صيانة واحد على الأقل للتصدير.');
  const mode = optionalText(input.mode, 'mode', { maxLength: 16 }) ?? 'sync';
  delete input.mode;
  if (!['sync', 'async'].includes(mode)) throw new HttpError(400, 'mode must be sync or async.');

  if (mode === 'async') {
    const exportId = optionalText(input.exportId, 'exportId', { maxLength: 128 });
    if (!exportId) throw new HttpError(400, 'exportId is required for asynchronous PowerPoint exports.');
    if (getExportProgress(exportId)?.active || getCompletedExportReport(exportId)) {
      throw new HttpError(409, 'This exportId is already being used; create a new export request.');
    }
    input.exportId = exportId;
    storeExportProgress(exportId, {
      active: true,
      total: 0,
      current: 0,
      percent: 0,
      stage: 'جارٍ بدء تجهيز التقرير في الخلفية...',
      machineName: null,
      machineNameAr: null,
      machineNameEn: null,
      machineCode: null,
      area: null,
      estimatedSeconds: null,
      speedSecPerMachine: null,
    });

    setImmediate(async () => {
      try {
        const report = await buildMaintenancePptxExport(input, database);
        storeCompletedExport(exportId, report);
        const completedProgress = getExportProgress(exportId) ?? {};
        storeExportProgress(exportId, {
          ...completedProgress,
          active: false,
          percent: 100,
          stage: 'اكتمل إنشاء ملف PowerPoint.',
          ready: true,
          downloadUrl: `/api/maintenance/export/pptx/download/${encodeURIComponent(exportId)}`,
        }, { completed: true });
      } catch (error) {
        const currentProgress = getExportProgress(exportId) ?? {};
        const message = error instanceof HttpError && error.status < 500
          ? error.message
          : 'تعذر إنشاء ملف PowerPoint.';
        storeExportProgress(exportId, {
          ...currentProgress,
          active: false,
          stage: 'تعذر إنشاء ملف PowerPoint.',
          error: message,
        }, { completed: true });
      }
    });

    res.set('Cache-Control', 'private, no-store');
    res.status(202).json({ ok: true, status: 'processing', exportId });
    return;
  }

  let report;
  try {
    report = await buildMaintenancePptxExport(input, database);
  } catch (error) {
    if (res.destroyed || res.writableEnded) return;
    throw error;
  }
  if (res.destroyed || res.writableEnded) return;
  downloadReport(res, report);
}
