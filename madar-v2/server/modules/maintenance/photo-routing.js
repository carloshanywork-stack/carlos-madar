import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { storageDirectory } from '../storage.js';

export function safeMachineStorageSegment(value, fallback = 'unknown') {
  if (typeof value !== 'string') return fallback;
  const sanitized = value
    .trim()
    .replace(/[/\\:*?"<>|\0]/g, '_')
    .replace(/\s+/g, ' ');
  return sanitized.length ? sanitized : fallback;
}

export const MONTH_ABBREVIATIONS = Object.freeze([
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC',
]);

/**
 * Resolves the month folder casing under Areas/<YYYY>/.
 * Reuses existing directory casing (e.g. 'nov' if Areas/2026/nov exists).
 * Throws on conflict if both uppercase and lowercase exist.
 * Defaults to uppercase (e.g. 'DEC') for new/future months.
 */
export function resolveMonthDirectory(year, monthAbbrev, storageRoot = null) {
  const normalizedAbbrev = String(monthAbbrev).trim().toUpperCase();
  if (storageRoot) {
    const yearDir = join(storageRoot, 'Areas', String(year));
    if (existsSync(yearDir)) {
      try {
        const entries = readdirSync(yearDir, { withFileTypes: true });
        const matching = entries
          .filter((e) => e.isDirectory() && e.name.toLowerCase() === normalizedAbbrev.toLowerCase())
          .map((e) => e.name);
        if (matching.length > 1) {
          throw new Error(`Month folder conflict: multiple aliases (${matching.join(', ')}) exist under Areas/${year}`);
        }
        if (matching.length === 1) {
          return matching[0];
        }
      } catch (err) {
        if (err.message && err.message.startsWith('Month folder conflict')) throw err;
      }
    }
  }
  return normalizedAbbrev;
}

/**
 * Returns year, month abbreviation (JAN-DEC), month number, day, and dateString in business timezone.
 * Defaults to 'Africa/Cairo' per MADAR operational standards.
 */
export function getBusinessTimeParts(dateInput, timeZone = 'Africa/Cairo') {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date provided to getBusinessTimeParts: ${dateInput}`);
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timeZone || 'Africa/Cairo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date).filter((p) => p.type !== 'literal').map(({ type, value }) => [type, value]),
  );
  const monthIndex = Number(parts.month) - 1;
  const monthAbbrev = MONTH_ABBREVIATIONS[monthIndex] ?? 'NOV';
  return {
    year: parts.year,
    monthAbbrev,
    monthNumber: parts.month,
    day: parts.day,
    dateString: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/**
 * Builds the canonical storage path for maintenance photos:
 * Areas/<YYYY>/<resolved-month>/<area>/<machine>/<stable-order-key>/Before/<filename>
 * Areas/<YYYY>/<resolved-month>/<area>/<machine>/<stable-order-key>/After/<filename>
 */
export function buildMaintenancePhotoStoredPath({
  date,
  timeZone = 'Africa/Cairo',
  area,
  machineCode,
  machineName = '',
  orderCode,
  orderId,
  phase,
  filename,
  storageRoot = null,
}) {
  const { year, monthAbbrev } = getBusinessTimeParts(date, timeZone);
  const resolvedMonth = resolveMonthDirectory(year, monthAbbrev, storageRoot);
  const areaSegment = safeMachineStorageSegment(area, 'Unassigned Area');
  const machineSegment = safeMachineStorageSegment(
    `${machineCode}_${machineName || ''}`,
    machineCode,
  );
  const orderKey = safeMachineStorageSegment(
    orderCode || `order_${orderId}`,
    `order_${orderId}`,
  );
  const phaseSegment = String(phase).toLowerCase() === 'before' ? 'Before' : 'After';

  return storageDirectory(
    'Areas',
    year,
    resolvedMonth,
    areaSegment,
    machineSegment,
    orderKey,
    phaseSegment,
    filename,
  );
}

/**
 * Builds the canonical workshop order storage path:
 * Workshop/Orders/<orderId>/<subfolder>/<filename>
 */
export function buildWorkshopOrderStoredPath({
  orderId,
  subfolder = 'designs',
  filename,
}) {
  const safeSubfolder = ['designs', 'technicians', 'attachments'].includes(subfolder)
    ? subfolder
    : 'attachments';
  return storageDirectory(
    'Workshop',
    'Orders',
    String(orderId),
    safeSubfolder,
    filename,
  );
}
