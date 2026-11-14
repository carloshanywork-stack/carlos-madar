import { App as NativeApp } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Geolocation } from '@capacitor/geolocation';
import { Network } from '@capacitor/network';
import {
  addPendingVisit,
  deletePendingVisit,
  getPendingVisit,
  listPendingMachineActions,
  listPendingVisits,
} from './offline-store.js';
import { isNativeRepApp, RepEngine } from './native-session.js';
import { normalizeNativeVisitPhotoResults } from './camera-photo-results.js';
import { canonicalJson, REP_RECOVERY_PACKAGE_TYPE, REP_RECOVERY_SCHEMA_VERSION, sha256Hex, sha256Json, validateRepRecoveryPackage } from './queue-recovery.js';

const PENDING_ROOT = 'Pending';
const RepLocation = registerPlugin('RepLocation');

export { isNativeRepApp };

/** Native transport owns the bearer token; it is never placed in an event URL. */
export async function subscribeNativeOperations(onEvent, onStatus) {
  const eventHandle = await RepEngine.addListener('operations', onEvent);
  const statusHandle = await RepEngine.addListener('realtimeStatus', onStatus);
  const queueHandle = await RepEngine.addListener('queueChanged', () => onStatus({state:'queue_changed',reconcile:true}));
  try { await RepEngine.startRealtime(); }
  catch (error) { await eventHandle.remove(); await statusHandle.remove(); await queueHandle.remove(); throw error; }
  return { remove: async () => { await RepEngine.stopRealtime(); await eventHandle.remove(); await statusHandle.remove(); await queueHandle.remove(); } };
}

function isPermissionGranted(permissionStatus) {
  return permissionStatus === 'granted' || permissionStatus === 'limited';
}

export async function getNativePhotoArchiveStatus() { return RepEngine.getPhotoArchiveStatus(); }
export async function chooseNativePhotoArchiveFolder() { return RepEngine.choosePhotoArchiveFolder(); }

export async function captureNativeCameraPhoto() {
  if (!isNativeRepApp()) throw new Error('الكاميرا الأصلية متاحة داخل تطبيق أندرويد فقط.');
  const archive = await getNativePhotoArchiveStatus();
  if (!archive?.configured) await chooseNativePhotoArchiveFolder();
  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.Uri,
    quality: 100,
    allowEditing: false,
    saveToGallery: false,
    correctOrientation: true,
  });
  if (!photo.webPath) throw new Error('لم تُرجع الكاميرا صورة صالحة. حاول مرة أخرى.');
  if (!photo.path) throw new Error('لم تُرجع الكاميرا مساراً محلياً آمناً للصورة.');
  return { sourceUri: photo.path, previewUrl: photo.webPath };
}

export async function captureNativeCameraPhotos({ maxPhotos = 3, phaseLabel = 'الصور' } = {}) {
  if (!isNativeRepApp()) throw new Error('التقاط مجموعة الصور متاح داخل تطبيق أندرويد فقط.');
  const archive = await getNativePhotoArchiveStatus();
  if (!archive?.configured) await chooseNativePhotoArchiveFolder();
  const result = await RepEngine.captureVisitPhotos({ maxPhotos, phaseLabel });
  return normalizeNativeVisitPhotoResults(result);
}

export async function getNativePermissionState() {
  if (!isNativeRepApp()) return null;
  return RepEngine.getPermissionState();
}

export async function requestNativeInitialPermissions() {
  if (!isNativeRepApp()) return null;
  return RepEngine.requestInitialPermissions();
}

export async function authenticateNativeAttendance(action) {
  if (!isNativeRepApp()) throw new Error('تسجيل الحضور بالبصمة متاح من تطبيق MADAR على أندرويد فقط.');
  const result = await RepEngine.authenticateAttendance({ action });
  if (result?.verified !== true) throw new Error('لم تكتمل المصادقة الحيوية.');
  return result;
}

export async function enqueueNativeAttendanceAction(action) {
  if (!isNativeRepApp()) throw new Error('تسجيل الحضور المحلي متاح داخل تطبيق MADAR على أندرويد فقط.');
  return RepEngine.enqueueAttendanceAction(action);
}

export async function enqueueNativeMachineAction(action, evidence = null) {
  if (!isNativeRepApp()) return null;
  if (evidence && !(evidence instanceof Blob)) {
    throw new Error('صورة إثبات بلاغ الماكينة غير صالحة للحفظ الأصلي.');
  }
  const payload = { ...action };
  delete payload.evidence;
  if (evidence) {
    payload.evidenceMimeType = evidence.type || 'image/jpeg';
    payload.evidenceBase64 = await blobToBase64(evidence);
  }
  return RepEngine.enqueueMachineAction(payload);
}

export async function listNativeMachineActions(repId) {
  if (!isNativeRepApp()) return [];
  const result = await RepEngine.listMachineActions({ repId: Number(repId) });
  return Array.isArray(result.actions) ? result.actions : [];
}

export async function retryNativeMachineAction(actionUuid, repId) {
  if (!isNativeRepApp()) return null;
  const result = await RepEngine.retryMachineAction({ actionUuid, repId: Number(repId) });
  if (!result?.updated || !result.action) throw new Error('لم يؤكد التخزين الأصلي إعادة إجراء الماكينة إلى قائمة الانتظار.');
  return result.action;
}

export async function reconcileNativeMachineActionReview(actionUuid, repId, review) {
  if (!isNativeRepApp()) return null;
  return RepEngine.reconcileMachineActionReview({ actionUuid, repId: Number(repId), ...review });
}

export async function importNativeRecoveryPackage(json, repId) {
  if (!isNativeRepApp()) throw new Error('استيراد حزمة الاسترداد متاح داخل تطبيق أندرويد فقط.');
  // Validation happens in the web layer before native writes; native repeats the account check.
  const recovery = await validateRepRecoveryPackage(json, repId);
  // Refuse an import if an existing IndexedDB identity cannot be compared. In
  // particular, don't let a native import hide conflicting legacy work.
  const [indexedVisits, indexedActions] = await Promise.all([
    listPendingVisits(Number(repId)),
    listPendingMachineActions(Number(repId)),
  ]);
  for (const action of recovery.machineActions) {
    const existing = indexedActions.find((item) => item.actionUuid === action.actionUuid);
    if (!existing) continue;
    const evidenceHash = existing.evidence instanceof Blob ? await sha256Hex(new Uint8Array(await existing.evidence.arrayBuffer())) : null;
    const comparable = {
      actionUuid: existing.actionUuid,
      repId: Number(existing.repId),
      type: existing.type,
      machineId: Number(existing.machineId),
      cardId: Number(existing.cardId ?? existing.payload?.cardId),
      payload: existing.payload,
      evidenceSha256: evidenceHash,
    };
    if (canonicalJson(comparable) !== canonicalJson(action.identity)) {
      throw new Error(`رفض الاستيراد: معرّف إجراء الماكينة ${action.actionUuid} موجود بمحتوى مختلف في IndexedDB.`);
    }
  }
  for (const visit of recovery.visits) {
    const existing = indexedVisits.find((item) => item.visitUuid === visit.visitUuid);
    if (!existing) continue;
    if (Number(existing.repId) !== Number(visit.repId) || canonicalJson(existing.payload) !== canonicalJson(visit.payload)) {
      throw new Error(`رفض الاستيراد: معرّف الزيارة ${visit.visitUuid} موجود بمحتوى مختلف في IndexedDB.`);
    }
    if (existing.nativeStoragePath?.startsWith('internal://')) continue; // Native SQLite compares all photo bytes before import.
    const getBlobHashes = async (photos) => Promise.all((photos ?? []).map(async (photo) => {
      const blob = photo instanceof Blob ? photo : photo?.blob instanceof Blob ? photo.blob : null;
      return blob ? sha256Hex(new Uint8Array(await blob.arrayBuffer())) : null;
    }));
    const [beforeHashes, afterHashes] = await Promise.all([getBlobHashes(existing.beforePhotos), getBlobHashes(existing.afterPhotos)]);
    if (canonicalJson(beforeHashes) !== canonicalJson(visit.identity.beforeHashes)
        || canonicalJson(afterHashes) !== canonicalJson(visit.identity.afterHashes)) {
      throw new Error(`رفض الاستيراد: إثبات الزيارة ${visit.visitUuid} مختلف أو غير قابل للمقارنة مع IndexedDB.`);
    }
  }
  const result = await RepEngine.importRecoveryPackage({ packageJson: JSON.stringify(recovery), repId: Number(repId) });
  if (result?.completed !== true) throw new Error('لم يؤكد التخزين الأصلي استيراد نسخة الاسترداد.');
  return result;
}

export async function listNativeAttendanceActions(repId) {
  if (!isNativeRepApp()) return [];
  const result = await RepEngine.listAttendanceActions({ repId: Number(repId) });
  return Array.isArray(result.actions) ? result.actions : [];
}

export async function acknowledgeNativeAttendanceAction(actionUuid, repId) {
  if (!isNativeRepApp()) return false;
  const result = await RepEngine.acknowledgeAttendanceAction({ actionUuid, repId: Number(repId) });
  return Boolean(result.removed);
}

export async function getNativeRecoveryGps(repId) {
  if (!isNativeRepApp()) return { pending: [], rejected: [] };
  const result = await RepLocation.getRecoveryQueue({ repId: Number(repId) });
  return {
    pending: Array.isArray(result?.pending) ? result.pending : [],
    rejected: Array.isArray(result?.rejected) ? result.rejected : [],
  };
}

export async function requestNativeBackgroundPermission() {
  if (!isNativeRepApp()) return null;
  return RepEngine.requestBackgroundPermission();
}

export async function openNativeAppSettings() {
  if (!isNativeRepApp()) return null;
  return RepEngine.openAppSettings();
}

export async function requestNativeBatteryExemption() {
  if (!isNativeRepApp()) return null;
  return RepEngine.requestBatteryExemption();
}

export async function processNativeVisitPhoto({ visitUuid, phase, index, sourceUri, watermark }) {
  if (!isNativeRepApp()) throw new Error('معالجة الصور الأصلية متاحة داخل تطبيق أندرويد فقط.');
  return RepEngine.processVisitPhoto({ visitUuid, phase, index, sourceUri, watermark });
}

export async function deleteNativeVisitPhoto(visitUuid, phase, index, path) {
  if (!isNativeRepApp()) return null;
  return RepEngine.deleteVisitPhoto({ visitUuid, phase, index, path });
}

export function nativeFilePreviewUrl(path) {
  if (!isNativeRepApp() || !path) return '';
  return Capacitor.convertFileSrc(path);
}

export async function cacheNativeRoute(repId, route) {
  if (!isNativeRepApp() || !route) return null;
  return RepEngine.cacheRoute({ repId: Number(repId), route: JSON.stringify(route) });
}

export async function cacheNativeReasons(repId, reasons) {
  if (!isNativeRepApp() || !reasons) return null;
  return RepEngine.cacheReasons({ repId: Number(repId), reasons: JSON.stringify({ reasons }) });
}

export async function listNativeVisits(repId) {
  if (!isNativeRepApp()) return [];
  const result = await RepEngine.listVisits({ repId: Number(repId) });
  return Array.isArray(result.visits) ? result.visits : [];
}

export async function getNativeRepCache(repId) {
  if (!isNativeRepApp()) return null;
  return RepEngine.getCachedRepData({ repId: Number(repId) });
}

export async function requestNativeSync() {
  if (!isNativeRepApp()) return null;
  return RepEngine.requestSync();
}

export async function retryNativeVisit(visitUuid, repId) {
  if (!isNativeRepApp()) return null;
  const result = await RepEngine.retryVisit({ visitUuid, repId: Number(repId) });
  return Boolean(result.updated);
}

async function ensureForegroundLocationPermission() {
  let status = await Geolocation.checkPermissions();
  // A coarse-only grant is not enough for attendance GPS; still request precise
  // location instead of silently skipping the Android permission prompt.
  if (!isPermissionGranted(status.location)) {
    status = await Geolocation.requestPermissions({ permissions: ['location'] });
  }
  if (!isPermissionGranted(status.location)) {
    throw new Error('اسمح بالوصول إلى الموقع الدقيق من إعدادات التطبيق للمتابعة.');
  }
}

export async function getNativeGpsLocation() {
  if (!isNativeRepApp()) return null;
  await ensureForegroundLocationPermission();
  const result = await RepLocation.getCurrentPosition();
  if (result.mocked) throw new Error('تم رصد تطبيق لتزييف الموقع، يرجى إغلاقه للمتابعة.');
  return {
    latitude: result.latitude,
    longitude: result.longitude,
    accuracy: result.accuracy,
    speed: result.speed ?? 0,
    updatedAt: new Date(result.timestamp).toISOString(),
  };
}

export async function getNativeGpsAvailability() {
  if (!isNativeRepApp()) return null;
  return RepLocation.getGpsAvailability();
}

export async function startNativeDutyTracking() {
  if (!isNativeRepApp()) return { active: false, native: false };
  await ensureForegroundLocationPermission();
  const permission = await RepLocation.requestDutyPermissions();
  if (!permission.backgroundGranted) {
    await RepLocation.openAppSettings();
    throw new Error('للتتبع أثناء إغلاق التطبيق، فعّل «السماح طوال الوقت» وارجع إلى MADAR ثم أعد المحاولة.');
  }
  if (!permission.notificationsGranted) {
    throw new Error('اسمح بإشعارات MADAR لعرض تنبيه التتبع أثناء الوردية.');
  }
  return RepLocation.startDutyTracking();
}

export async function stopNativeDutyTracking() {
  if (!isNativeRepApp()) return { active: false };
  return RepLocation.stopDutyTracking();
}

export async function getNativeDutyTrackingState() {
  if (!isNativeRepApp()) return { active: false, mocked: false, lastLocation: null };
  return RepLocation.getDutyState();
}

export async function acknowledgeNativeDutyTracking(throughId) {
  if (!isNativeRepApp()) return { removed: 0 };
  return RepLocation.acknowledgeDutyTracking({ throughId: Number(throughId) });
}

export async function getNativeNetworkStatus() {
  if (!isNativeRepApp()) return null;
  return Network.getStatus();
}

export async function addNativeNetworkListener(callback) {
  if (!isNativeRepApp()) return null;
  return Network.addListener('networkStatusChange', callback);
}

export async function addNativeBackListener(callback) {
  if (!isNativeRepApp()) return null;
  return NativeApp.addListener('backButton', callback);
}

export async function addNativeAppStateListener(callback) {
  if (!isNativeRepApp()) return null;
  return NativeApp.addListener('appStateChange', callback);
}

export async function getNativeAppInfo() {
  if (!isNativeRepApp()) return null;
  try {
    return await NativeApp.getInfo();
  } catch {
    return null;
  }
}

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + chunkSize, bytes.length)));
    }
    return btoa(binary);
  });
}

function base64ToBlob(value, contentType = 'image/jpeg') {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: contentType });
}

function visitFolder(visitUuid) {
  return `${PENDING_ROOT}/${visitUuid}`;
}

function pendingPhotos(visit, phase) {
  const photos = visit?.[`${phase}Photos`];
  if (Array.isArray(photos)) return photos.map((photo) => photo?.blob ?? photo).filter(Boolean);
  const legacyPhoto = visit?.[`${phase}Photo`];
  return legacyPhoto ? [legacyPhoto] : [];
}

export async function saveNativePendingBackup(visit) {
  if (!isNativeRepApp()) return null;
  const toEntries = (phase) => pendingPhotos(visit, phase).map((photo, index) => {
    if (!photo?.path) throw new Error(`صورة ${phase} ليست محفوظة داخل مساحة التطبيق الداخلية.`);
    return {
      path: photo.path,
      capturedAt: visit.payload?.[`${phase}CapturedAt`]?.[index] ?? photo.capturedAt ?? visit.createdAt,
    };
  });
  const result = await RepEngine.enqueueVisit({
    visitUuid: visit.visitUuid,
    repId: Number(visit.repId),
    repUsername: visit.repUsername,
    createdAt: visit.createdAt,
    payload: visit.payload,
    beforePhotos: toEntries('before'),
    afterPhotos: toEntries('after'),
  });
  return result.nativeStoragePath;
}

export async function deleteNativePendingBackup(visitUuid) {
  if (!isNativeRepApp()) return;
  await Filesystem.rmdir({ path: visitFolder(visitUuid), directory: Directory.External, recursive: true });
}

export async function restoreNativePendingBackups(repId) {
  if (!isNativeRepApp()) return 0;
  let restoredNative = 0;
  try {
    const savedVisits = await listNativeVisits(repId);
    for (const visit of savedVisits) {
      if (visit.status === 'synced') {
        await deletePendingVisit(visit.visitUuid).catch(() => undefined);
        continue;
      }
      if (await getPendingVisit(visit.visitUuid)) continue;
      await addPendingVisit({ ...visit, beforePhotos: [], afterPhotos: [] });
      restoredNative += 1;
    }
  } catch (error) {
    console.warn('Could not restore native SQLite visit queue:', error);
  }
  let folders;
  try {
    folders = (await Filesystem.readdir({ path: PENDING_ROOT, directory: Directory.External })).files;
  } catch (error) {
    if (/does not exist|not found|ENOENT/i.test(error.message ?? '')) return restoredNative;
    throw error;
  }

  let restored = restoredNative;
  for (const entry of folders) {
    if (entry.type !== 'directory' || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    const folder = visitFolder(entry.name);
    try {
      const metadataFile = await Filesystem.readFile({ path: `${folder}/visit.json`, directory: Directory.External });
      const metadata = JSON.parse(metadataFile.data);
      if (Number(metadata.repId) !== Number(repId) || metadata.visitUuid !== entry.name) continue;
      if (await getPendingVisit(metadata.visitUuid)) continue;
      const readPhotos = async (phase) => {
        const entries = Array.isArray(metadata[`${phase}Photos`])
          ? metadata[`${phase}Photos`]
          : metadata[`${phase}Path`] ? [{ path: metadata[`${phase}Path`] }] : [];
        const photos = [];
        for (const entry of entries) {
          if (typeof entry?.path !== 'string' || !entry.path.startsWith(`${folder}/`)) {
            throw new Error('مسار صورة النسخة الاحتياطية غير صالح.');
          }
          const image = await Filesystem.readFile({ path: entry.path, directory: Directory.External });
          photos.push(base64ToBlob(image.data));
        }
        return photos;
      };
      const [beforePhotos, afterPhotos] = await Promise.all([readPhotos('before'), readPhotos('after')]);
      if (beforePhotos.length !== 3 || afterPhotos.length > 3) throw new Error('صور الزيارة الاحتياطية غير مكتملة.');
      await addPendingVisit({
        visitUuid: metadata.visitUuid,
        repId: Number(metadata.repId),
        repUsername: metadata.repUsername,
        createdAt: metadata.createdAt,
        payload: metadata.payload,
        beforePhotos,
        afterPhotos,
        status: 'queued',
        attempts: Number(metadata.attempts ?? 0),
        lastError: 'استُعيدت الزيارة من النسخة الاحتياطية المحلية للهاتف.',
        nativeStoragePath: folder,
      });
      restored += 1;
    } catch (error) {
      if (error.name === 'ConstraintError') continue;
      console.warn(`Could not restore native pending visit ${entry.name}:`, error);
    }
  }
  return restored;
}

async function serializePendingPhotoArray(photos, phase) {
  if (!Array.isArray(photos)) return [];
  const serialized = [];
  for (const [index, photo] of photos.entries()) {
    const blob = photo instanceof Blob ? photo : photo?.blob instanceof Blob ? photo.blob : null;
    if (blob) {
      serialized.push({
        phase,
        index,
        capturedAt: photo?.capturedAt ?? '',
        mimeType: blob.type || 'image/jpeg',
        byteSize: blob.size,
        bytesBase64: await blobToBase64(blob),
      });
      continue;
    }
    serialized.push({
      phase,
      index,
      capturedAt: photo?.capturedAt ?? '',
      mimeType: 'image/jpeg',
      byteSize: Number(photo?.sizeBytes ?? 0) || null,
      omitted: 'الصورة غير متاحة ككائن Blob في هذا التخزين.',
    });
  }
  return serialized;
}

async function serializePendingVisit(visit) {
  return {
    visitUuid: visit.visitUuid,
    repId: Number(visit.repId),
    repUsername: visit.repUsername ?? '',
    createdAt: visit.createdAt ?? '',
    status: visit.status ?? 'queued',
    attempts: Number(visit.attempts ?? 0),
    lastError: visit.lastError ?? '',
    payload: visit.payload ?? {},
    beforePhotos: await serializePendingPhotoArray(visit.beforePhotos, 'before'),
    afterPhotos: await serializePendingPhotoArray(visit.afterPhotos, 'after'),
  };
}

async function serializeMachineAction(action) {
  const { evidence, ...rest } = action;
  let serializedEvidence = null;
  if (evidence instanceof Blob) {
    serializedEvidence = {
      name: evidence.name || `${action.actionUuid || 'evidence'}.jpg`,
      mimeType: evidence.type || 'application/octet-stream',
      byteSize: evidence.size,
      bytesBase64: await blobToBase64(evidence),
    };
  } else if (evidence) {
    serializedEvidence = { omitted: 'نوع صورة الإثبات غير صالح أو غير متاح.' };
  }
  return { ...rest, evidence: serializedEvidence };
}

function exportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

/** Write a self-contained JSON backup of every unsynchronized item, including image bytes when locally available. */
export async function exportPendingQueue(repId, repUsername) {
  const numericRepId = Number(repId);
  const isNative = isNativeRepApp();
  let indexedVisits = [];
  let indexedActions = [];
  let indexedReadError = null;
  try {
    [indexedVisits, indexedActions] = await Promise.all([
      listPendingVisits(numericRepId),
      listPendingMachineActions(numericRepId),
    ]);
  } catch (error) {
    if (!isNative) throw error;
    indexedReadError = error;
  }

  let photoArchivePending = 0;
  let nativeVisits = [];
  let nativeMachineActions = [];
  let attendanceActions = [];
  let pendingGpsPoints = [];
  let rejectedGpsPoints = [];
  let localSessionId = globalThis.crypto?.randomUUID?.();
  if (isNative) {
    try {
      const [result, pendingAttendance, recoveryGps] = await Promise.all([
        RepEngine.exportPendingVisits({ repId: numericRepId }),
        listNativeAttendanceActions(numericRepId),
        getNativeRecoveryGps(numericRepId),
      ]);
      const parsed = JSON.parse(result?.json ?? '{}');
      photoArchivePending = Number(parsed.photoArchivePending ?? 0);
      nativeVisits = Array.isArray(parsed.visits) ? parsed.visits : [];
      attendanceActions = pendingAttendance;
      nativeMachineActions = Array.isArray(parsed.machineActions) ? parsed.machineActions : [];
      pendingGpsPoints = recoveryGps.pending;
      rejectedGpsPoints = recoveryGps.rejected;
      localSessionId = parsed.localSessionId || localSessionId;
    } catch (error) {
      throw new Error(`تعذر تجهيز نسخة الاسترداد الكاملة من طوابير أندرويد المحلية؛ لم يُنشأ ملف على أنه كامل. ${error.message || ''}`);
    }
  }

  const nativeIds = new Set(nativeVisits.map((visit) => visit.visitUuid));
  const visits = [...nativeVisits];
  for (const visit of indexedVisits) {
    if (nativeIds.has(visit.visitUuid)) continue;
    visits.push(await serializePendingVisit(visit));
  }
  const machineById = new Map();
  for (const action of nativeMachineActions) machineById.set(action.actionUuid, action);
  for (const action of indexedActions) if (!machineById.has(action.actionUuid)) machineById.set(action.actionUuid, { ...action, source: 'indexeddb' });
  const machineActions = await Promise.all([...machineById.values()].map(serializeRecoveryAction));
  const recoveryVisits = await Promise.all(visits.map(serializeRecoveryVisit));
  const recoveryAttendance = await Promise.all(attendanceActions.map(serializeRecoveryAttendance));
  const gps = await Promise.all([...pendingGpsPoints, ...rejectedGpsPoints].map(serializeRecoveryGps));
  const payload = {
    schemaVersion: REP_RECOVERY_SCHEMA_VERSION,
    type: REP_RECOVERY_PACKAGE_TYPE,
    exportedAt: new Date().toISOString(),
    repId: numericRepId,
    repUsername: repUsername ?? '',
    localSessionId: localSessionId || globalThis.crypto?.randomUUID?.() || `${Date.now()}-recovery-session`,
    source: isNative ? 'android-sqlite' : 'indexeddb',
    complete: true,
    omissions: indexedReadError ? [{ type: 'indexeddb-queues', reason: `تعذرت قراءة نسخة IndexedDB القديمة: ${indexedReadError.message || 'خطأ محلي'}` }] : [],
    visits: recoveryVisits,
    machineActions,
    attendanceActions: recoveryAttendance,
    pendingGpsPoints: gps.filter((point) => point.status !== 'rejected'),
    rejectedGpsPoints: gps.filter((point) => point.status === 'rejected'),
  };
  if (photoArchivePending > 0) payload.omissions.push({type:'phone-photo-archive',count:photoArchivePending,reason:'توجد صور بانتظار النسخ إلى المجلد المختار؛ أكمل النسخ قبل الاعتماد على حزمة نقل التطبيق.'});
  for (const visit of payload.visits) {
    for (const [phase, photos] of [['before', visit.beforePhotos], ['after', visit.afterPhotos]]) {
      for (const [index, photo] of photos.entries()) if (photo.omitted) {
        payload.omissions.push({ type: 'visit-photo', id: visit.visitUuid, phase, index, reason: photo.reason || 'الصورة الأصلية غير متاحة.' });
      }
    }
  }
  for (const action of payload.machineActions) if (action.evidence?.omitted) {
    payload.omissions.push({ type: 'machine-action-evidence', id: action.actionUuid, reason: action.evidence.reason || 'ملف الإثبات الأصلي غير متاح.' });
  }
  payload.complete = payload.omissions.length === 0;
  const serialized = JSON.stringify(payload);
  if (new TextEncoder().encode(serialized).length > 128 * 1024 * 1024) throw new Error('تعذر إنشاء الحزمة: تجاوزت حد الحجم 128 ميغابايت.');
  return savePendingQueueExport(payload, exportTimestamp());
}

async function fileObject(bytesBase64, { name = '', mimeType = 'application/octet-stream', capturedAt = '' } = {}) {
  if (typeof bytesBase64 !== 'string') return { omitted: true, name, mimeType, capturedAt };
  const binary = atob(bytesBase64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { name, mimeType, capturedAt, byteSize: bytes.length, sha256: await sha256Hex(bytes), bytesBase64 };
}

async function serializeRecoveryVisit(visit) {
  const convert = async (photos) => Promise.all((photos ?? []).map((photo) => photo.omitted
    ? { omitted: true, reason: photo.omitted, name: `${visit.visitUuid}-${photo.phase}-${photo.index}.jpg`, mimeType: 'image/jpeg', capturedAt: photo.capturedAt }
    : fileObject(photo.bytesBase64, {
      name: `${visit.visitUuid}-${photo.phase}-${photo.index}.jpg`, mimeType: photo.mimeType || 'image/jpeg', capturedAt: photo.capturedAt,
    })));
  const beforePhotos = await convert(visit.beforePhotos);
  const afterPhotos = await convert(visit.afterPhotos);
  const identity = {
    visitUuid: visit.visitUuid,
    repId: Number(visit.repId),
    payload: visit.payload,
    beforeHashes: beforePhotos.map((photo) => photo.sha256 ?? null),
    afterHashes: afterPhotos.map((photo) => photo.sha256 ?? null),
    beforeCapturedAt: beforePhotos.map((photo) => photo.capturedAt ?? ''),
    afterCapturedAt: afterPhotos.map((photo) => photo.capturedAt ?? ''),
  };
  return {
    ...visit,
    repId: Number(visit.repId), beforePhotos, afterPhotos, identity, identityHash: await sha256Json(identity),
    provenance: visit.provenance || visit.source || (visit.nativeStoragePath?.startsWith('internal://') ? 'native-sqlite' : 'indexeddb'),
  };
}

async function serializeRecoveryAction(action) {
  let evidence = null;
  if (action.evidenceBytesBase64) evidence = await fileObject(action.evidenceBytesBase64, { name: `${action.actionUuid}.evidence`, mimeType: action.evidenceContentType || 'image/jpeg' });
  else if (action.evidence instanceof Blob) evidence = await fileObject(await blobToBase64(action.evidence), { name: action.evidence.name, mimeType: action.evidence.type || 'image/jpeg' });
  else if (action.evidenceOmitted) evidence = { omitted: true, reason: action.evidenceOmitted };
  const payload = action.payload ?? {};
  const identity = { actionUuid: action.actionUuid, repId: Number(action.repId), type: action.type, machineId: Number(action.machineId), cardId: Number(action.cardId ?? payload.cardId), payload, evidenceSha256: evidence?.sha256 ?? null };
  return { ...action, repId: Number(action.repId), payload, evidence, identity, identityHash: await sha256Json(identity), provenance: action.source || (isNativeRepApp() ? 'native-sqlite' : 'indexeddb') };
}

async function serializeRecoveryAttendance(action) {
  const payload = action.payload ?? Object.fromEntries(Object.entries(action).filter(([key]) => !['status', 'attempts', 'lastError', 'createdAt', 'identity', 'identityHash', 'provenance'].includes(key)));
  const identity = { actionUuid: action.actionUuid, repId: Number(action.repId), action: action.action, payload };
  return { ...action, payload, repId: Number(action.repId), identity, identityHash: await sha256Json(identity), provenance: 'native-sqlite' };
}

async function serializeRecoveryGps(point) {
  const normalized = { ...point, trackId: Number(point.trackId), repId: Number(point.repId), capturedAt: point.capturedAt || new Date(Number(point.timestamp)).toISOString() };
  const identity = { trackId: normalized.trackId, repId: normalized.repId, timestamp: Number(normalized.timestamp), latitude: Number(normalized.latitude), longitude: Number(normalized.longitude), accuracy: Number(normalized.accuracy), speed: Number(normalized.speed ?? 0), reason: normalized.reason ?? '' };
  return { ...normalized, status: normalized.status || 'pending', identity, identityHash: await sha256Json(identity), provenance: 'native-gps-sqlite' };
}

async function savePendingQueueExport(payload, stamp) {
  const json = JSON.stringify(payload);
  const filename = `madar-rep-pending-queue-${stamp}.json`;
  if (isNativeRepApp()) {
    const archive = await getNativePhotoArchiveStatus();
    if (!archive?.configured) await chooseNativePhotoArchiveFolder();
    const saved = await RepEngine.saveRecoveryExport({ packageJson: json });
  return { filename: saved.filename, path: saved.path, visits: payload.visits.length, machineActions: payload.machineActions.length, attendanceActions: payload.attendanceActions.length, totalItems: payload.visits.length + payload.machineActions.length + payload.attendanceActions.length + payload.pendingGpsPoints.length + payload.rejectedGpsPoints.length, complete: payload.complete, omittedItems: payload.omissions.length };
  }

  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return { filename, path: filename, visits: payload.visits.length, machineActions: payload.machineActions.length, attendanceActions: payload.attendanceActions.length, totalItems: payload.visits.length + payload.machineActions.length + payload.attendanceActions.length + payload.pendingGpsPoints.length + payload.rejectedGpsPoints.length, complete: payload.complete, omittedItems: payload.omissions.length };
}
