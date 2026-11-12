export const REP_RECOVERY_PACKAGE_TYPE = 'madar-rep-recovery';
export const REP_RECOVERY_SCHEMA_VERSION = 3;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const MAX_ITEMS_PER_QUEUE = 20_000;
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

export async function sha256Json(value) {
  return sha256Hex(new TextEncoder().encode(canonicalJson(value)));
}

function decodeBase64(value, label, maxBytes) {
  if (typeof value !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error(`${label}: base64 data is malformed.`);
  }
  const binary = atob(value);
  if (binary.length > maxBytes) throw new Error(`${label}: file exceeds the per-item limit of ${Math.floor(maxBytes / 1024 / 1024)} MiB.`);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function validateFile(file, label, maxBytes = MAX_EVIDENCE_BYTES) {
  if (!file || file.omitted) throw new Error(`${label}: evidence is omitted and cannot be imported.`);
  const bytes = decodeBase64(file.bytesBase64, label, maxBytes);
  if (bytes.length < 1 || bytes.length !== Number(file.byteSize)) throw new Error(`${label}: declared file size does not match its bytes.`);
  const digest = await sha256Hex(bytes);
  if (!/^[a-f0-9]{64}$/i.test(file.sha256 ?? '') || digest !== file.sha256.toLowerCase()) {
    throw new Error(`${label}: SHA-256 verification failed.`);
  }
  return bytes.length;
}

async function validateIdentity(item, idField, label) {
  if (!item.identity || typeof item.identity !== 'object' || Array.isArray(item.identity)) {
    throw new Error(`${label}: immutable identity is missing.`);
  }
  if (String(item.identity[idField] ?? '').toLowerCase() !== String(item[idField] ?? '').toLowerCase()) {
    throw new Error(`${label}: immutable ID does not match its identity.`);
  }
  const digest = await sha256Json(item.identity);
  if (digest !== item.identityHash) throw new Error(`${label}: immutable identity hash does not match.`);
}

/** Validate structure, ownership, identities, file sizes and content hashes before any local write. */
export async function validateRepRecoveryPackage(input, expectedRepId, { requireComplete = true } = {}) {
  const recovery = typeof input === 'string' ? JSON.parse(input) : input;
  const repId = Number(expectedRepId);
  if (!recovery || typeof recovery !== 'object' || Array.isArray(recovery)
      || recovery.type !== REP_RECOVERY_PACKAGE_TYPE || recovery.schemaVersion !== REP_RECOVERY_SCHEMA_VERSION) {
    throw new Error('Recovery package type or version is unsupported.');
  }
  if (!Number.isSafeInteger(repId) || repId < 1 || Number(recovery.repId) !== repId) {
    throw new Error('Recovery package belongs to a different representative account.');
  }
  if (typeof recovery.localSessionId !== 'string' || !UUID_PATTERN.test(recovery.localSessionId)) {
    throw new Error('Recovery package local-session identity is invalid.');
  }
  const arrayKeys = ['visits', 'machineActions', 'attendanceActions', 'pendingGpsPoints', 'rejectedGpsPoints', 'omissions'];
  for (const key of arrayKeys) {
    if (!Array.isArray(recovery[key]) || recovery[key].length > MAX_ITEMS_PER_QUEUE) {
      throw new Error(`Recovery package ${key} is missing or exceeds the item limit.`);
    }
  }
  if (requireComplete && (recovery.complete !== true || recovery.omissions.length > 0)) {
    throw new Error('Recovery package is incomplete; omitted items must be recovered before import.');
  }

  let accountedBytes = new TextEncoder().encode(typeof input === 'string' ? input : canonicalJson(input)).length;
  const ids = new Set();
  const assertItemOwner = (item, label) => {
    if (Number(item?.repId) !== repId) throw new Error(`${label}: representative ownership does not match the signed-in account.`);
};
for (const [index, visit] of recovery.visits.entries()) {
  const label = `Visit ${index + 1}`;
  assertItemOwner(visit, label);
  if (!['queued', 'syncing', 'blocked'].includes(visit.status) || typeof visit.provenance !== 'string' || !visit.provenance.trim()) {
    throw new Error(`${label}: status or provenance is invalid.`);
  }
  if (!UUID_PATTERN.test(visit.visitUuid ?? '') || ids.has(`visit:${visit.visitUuid}`)) throw new Error(`${label}: visit UUID is invalid or duplicated.`);
  ids.add(`visit:${visit.visitUuid}`);
  await validateIdentity(visit, 'visitUuid', label);
  if (!visit.payload || typeof visit.payload !== 'object' || Array.isArray(visit.payload)) throw new Error(`${label}: payload is invalid.`);
    for (const phase of ['beforePhotos', 'afterPhotos']) {
      if (!Array.isArray(visit[phase]) || (phase === 'beforePhotos' && visit[phase].length !== 3)
          || (phase === 'afterPhotos' && visit[phase].length > 3)) throw new Error(`${label}: ${phase} is incomplete or malformed.`);
    for (const [photoIndex, photo] of visit[phase].entries()) {
      accountedBytes += await validateFile(photo, `${label} ${phase}[${photoIndex + 1}]`, 3 * 1024 * 1024);
      const expectedHashes = phase === 'beforePhotos' ? visit.identity.beforeHashes : visit.identity.afterHashes;
      const expectedCapturedAt = phase === 'beforePhotos' ? visit.identity.beforeCapturedAt : visit.identity.afterCapturedAt;
      if (!Array.isArray(expectedHashes) || expectedHashes[photoIndex] !== photo.sha256) {
        throw new Error(`${label}: evidence hash does not match immutable visit identity.`);
    }
    if (!Array.isArray(expectedCapturedAt) || expectedCapturedAt[photoIndex] !== (photo.capturedAt ?? '')) {
      throw new Error(`${label}: evidence capture time does not match immutable visit identity.`);
    }
  }
  }
}
for (const [index, action] of recovery.machineActions.entries()) {
  const label = `Machine action ${index + 1}`;
  assertItemOwner(action, label);
  if (!['queued', 'syncing', 'blocked', 'pending_approval', 'approved', 'rejected', 'superseded'].includes(action.status)
      || typeof action.provenance !== 'string' || !action.provenance.trim()) throw new Error(`${label}: status or provenance is invalid.`);
  if (!UUID_PATTERN.test(action.actionUuid ?? '') || ids.has(`machine:${action.actionUuid}`)) throw new Error(`${label}: action UUID is invalid or duplicated.`);
    ids.add(`machine:${action.actionUuid}`);
    await validateIdentity(action, 'actionUuid', label);
    if (!action.payload || typeof action.payload !== 'object' || Array.isArray(action.payload)) throw new Error(`${label}: payload is invalid.`);
    if (action.evidence) {
      accountedBytes += await validateFile(action.evidence, `${label} evidence`, 4 * 1024 * 1024);
      if (action.identity.evidenceSha256 !== action.evidence.sha256) throw new Error(`${label}: evidence hash does not match immutable action identity.`);
    } else if (action.identity.evidenceSha256 !== null) {
      throw new Error(`${label}: immutable identity expects missing evidence.`);
    }
}
for (const [index, action] of recovery.attendanceActions.entries()) {
  const label = `Attendance action ${index + 1}`;
  assertItemOwner(action, label);
  if (!['pending_attendance_sync', 'attendance_rejected'].includes(action.status)
      || typeof action.provenance !== 'string' || !action.provenance.trim()) throw new Error(`${label}: status or provenance is invalid.`);
  if (!UUID_PATTERN.test(action.actionUuid ?? '') || ids.has(`attendance:${action.actionUuid}`)) throw new Error(`${label}: action UUID is invalid or duplicated.`);
  ids.add(`attendance:${action.actionUuid}`);
  await validateIdentity(action, 'actionUuid', label);
}
for (const [index, point] of [...recovery.pendingGpsPoints, ...recovery.rejectedGpsPoints].entries()) {
  const label = `GPS point ${index + 1}`;
  assertItemOwner(point, label);
  if (!['pending', 'rejected'].includes(point.status) || typeof point.provenance !== 'string' || !point.provenance.trim()) {
    throw new Error(`${label}: status or provenance is invalid.`);
  }
  if (typeof point.trackId !== 'number' || !Number.isSafeInteger(point.trackId) || point.trackId < 1
      || !Number.isFinite(point.latitude) || point.latitude < -90 || point.latitude > 90
      || !Number.isFinite(point.longitude) || point.longitude < -180 || point.longitude > 180
      || !Number.isFinite(point.accuracy) || point.accuracy < 0 || typeof point.capturedAt !== 'string'
        || !Number.isFinite(Date.parse(point.capturedAt))) throw new Error(`${label}: coordinates, timestamp, or local ID is invalid.`);
    await validateIdentity(point, 'trackId', label);
  }
  if (accountedBytes > MAX_PACKAGE_BYTES) throw new Error('Recovery package exceeds the 128 MiB total-size limit.');
  return recovery;
}

function actionContent(action) {
  return canonicalJson({
    actionUuid: action.actionUuid,
    repId: Number(action.repId),
    type: action.type,
    machineId: Number(action.machineId),
    payload: action.payload,
  });
}

/** Native SQLite owns Android-created actions; IndexedDB-only legacy work remains visible and recoverable. */
export function mergeMachineActions(indexedActions, nativeActions, repId) {
  const owner = Number(repId);
  const byUuid = new Map();
  for (const action of indexedActions ?? []) {
    if (Number(action.repId) !== owner) throw new Error('IndexedDB machine action ownership does not match the signed-in representative.');
    if (byUuid.has(action.actionUuid)) throw new Error(`Duplicate IndexedDB machine action UUID ${action.actionUuid}.`);
    byUuid.set(action.actionUuid, action);
  }
  const nativeIds = new Set();
  const merged = [];
  for (const action of nativeActions ?? []) {
    if (Number(action.repId) !== owner) throw new Error('Native machine action ownership does not match the signed-in representative.');
    if (nativeIds.has(action.actionUuid)) throw new Error(`Duplicate native machine action UUID ${action.actionUuid}.`);
    nativeIds.add(action.actionUuid);
    const indexed = byUuid.get(action.actionUuid);
    if (indexed && actionContent(indexed) !== actionContent(action)) {
      throw new Error(`Machine action UUID ${action.actionUuid} has conflicting local content; neither copy was changed.`);
    }
    merged.push({ ...(indexed ?? {}), ...action, ...(indexed?.evidence instanceof Blob ? { evidence: indexed.evidence } : {}), source: 'native-sqlite' });
  }
  for (const action of byUuid.values()) {
    if (!nativeIds.has(action.actionUuid)) merged.push({ ...action, source: action.source ?? 'indexeddb' });
  }
  return merged.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
}
