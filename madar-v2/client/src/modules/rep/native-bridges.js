import { App as NativeApp } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Geolocation } from '@capacitor/geolocation';
import { Network } from '@capacitor/network';
import { addPendingVisit, deletePendingVisit, getPendingVisit } from './offline-store.js';
import { isNativeRepApp, RepEngine } from './native-session.js';

const PENDING_ROOT = 'Pending';
const RepLocation = registerPlugin('RepLocation');

export { isNativeRepApp };

function isPermissionGranted(permissionStatus) {
  return permissionStatus === 'granted' || permissionStatus === 'limited';
}

export async function captureNativeCameraPhoto() {
  if (!isNativeRepApp()) throw new Error('الكاميرا الأصلية متاحة داخل تطبيق أندرويد فقط.');
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

export async function getNativePermissionState() {
  if (!isNativeRepApp()) return null;
  return RepEngine.getPermissionState();
}

export async function requestNativeInitialPermissions() {
  if (!isNativeRepApp()) return null;
  return RepEngine.requestInitialPermissions();
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

export async function deleteNativeVisitPhoto(visitUuid, phase, index) {
  if (!isNativeRepApp()) return null;
  return RepEngine.deleteVisitPhoto({ visitUuid, phase, index });
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
      if (!beforePhotos.length || !afterPhotos.length) throw new Error('صور الزيارة الاحتياطية غير مكتملة.');
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
