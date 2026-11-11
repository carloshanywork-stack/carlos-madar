import path from 'node:path';

export class HttpError extends Error {
  constructor(status, message, { apiCode } = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    if (apiCode) this.apiCode = apiCode;
  }
}

export function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function requireObject(value, label = 'Request body') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, `${label} must be a JSON object.`);
  }
  return value;
}

export function allowOnlyKeys(value, allowedKeys) {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) throw new HttpError(400, `Unsupported field: ${unknown}.`);
}

export function requireText(value, label, { maxLength = 500, minLength = 1 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${label} must be text.`);
  const cleaned = value.trim();
  if (cleaned.length < minLength || cleaned.length > maxLength) {
    throw new HttpError(400, `${label} must contain ${minLength} to ${maxLength} characters.`);
  }
  return cleaned;
}

export function optionalText(value, label, { maxLength = 500 } = {}) {
  if (value === undefined || value === null || value === '') return null;
  return requireText(value, label, { maxLength, minLength: 0 });
}

export function positiveId(value, label = 'id') {
  const id = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, `${label} must be a positive integer.`);
  return id;
}

export function nonNegativeInteger(value, label) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new HttpError(400, `${label} must be a non-negative integer.`);
  }
  return value;
}

export function integerIdArray(value, label) {
  if (!Array.isArray(value)) throw new HttpError(400, `${label} must be an array of employee IDs.`);
  const ids = value.map((item, index) => positiveId(item, `${label}[${index}]`));
  if (new Set(ids).size !== ids.length) throw new HttpError(400, `${label} cannot contain duplicate IDs.`);
  return ids;
}

export function isoDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${label} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${label} is not a valid calendar date.`);
  }
  return value;
}

export function safeOriginalName(value) {
  const name = path.basename(String(value ?? '').replaceAll('\\', '/'));
  const safe = name.replace(/[\r\n\0]/g, '').slice(0, 240);
  if (!safe || safe === '.' || safe === '..') throw new HttpError(400, 'Uploaded file must have a valid filename.');
  return safe;
}
