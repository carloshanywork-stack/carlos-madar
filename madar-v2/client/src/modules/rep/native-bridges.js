import { App as NativeApp } from '@capacitor/app';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Geolocation } from '@capacitor/geolocation';
import { Network } from '@capacitor/network';
import { addPendingVisit, getPendingVisit } from './offline-store.js';

const PENDING_ROOT = 'Pending';
const RepLocation = registerPlugin('RepLocation');

export const isNativeRepApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

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
  const response = await fetch(photo.webPath);
  if (!response.ok) throw new Error('تعذر قراءة الصورة من الكاميرا.');
  return response.blob();
}

async function ensureForegroundLocationPermission() {
  let status = await Geolocation.checkPermissions();
  if (!isPermissionGranted(status.location) && !isPermissionGranted(status.coarseLocation)) {
    status = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] });
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

export async function saveNativePendingBackup(visit) {
  if (!isNativeRepApp()) return null;
  const folder = visitFolder(visit.visitUuid);
  const beforePath = `${folder}/before.jpg`;
  const afterPath = `${folder}/after.jpg`;
  const metadataPath = `${folder}/visit.json`;
  await Filesystem.writeFile({
    path: beforePath,
    data: await blobToBase64(visit.beforePhoto),
    directory: Directory.External,
    recursive: true,
  });
  try {
    await Filesystem.writeFile({
      path: afterPath,
      data: await blobToBase64(visit.afterPhoto),
      directory: Directory.External,
      recursive: true,
    });
    await Filesystem.writeFile({
      path: metadataPath,
      data: JSON.stringify({
        visitUuid: visit.visitUuid,
        repId: visit.repId,
        repUsername: visit.repUsername,
        createdAt: visit.createdAt,
        payload: visit.payload,
        status: visit.status,
        attempts: visit.attempts,
        beforePath,
        afterPath,
      }),
      directory: Directory.External,
      recursive: true,
    });
    return folder;
  } catch (error) {
    await deleteNativePendingBackup(visit.visitUuid).catch(() => undefined);
    throw error;
  }
}

export async function deleteNativePendingBackup(visitUuid) {
  if (!isNativeRepApp()) return;
  await Filesystem.rmdir({ path: visitFolder(visitUuid), directory: Directory.External, recursive: true });
}

export async function restoreNativePendingBackups(repId) {
  if (!isNativeRepApp()) return 0;
  let folders;
  try {
    folders = (await Filesystem.readdir({ path: PENDING_ROOT, directory: Directory.External })).files;
  } catch (error) {
    if (/does not exist|not found|ENOENT/i.test(error.message ?? '')) return 0;
    throw error;
  }

  let restored = 0;
  for (const entry of folders) {
    if (entry.type !== 'directory' || !/^[0-9a-f-]{36}$/i.test(entry.name)) continue;
    const folder = visitFolder(entry.name);
    try {
      const metadataFile = await Filesystem.readFile({ path: `${folder}/visit.json`, directory: Directory.External });
      const metadata = JSON.parse(metadataFile.data);
      if (Number(metadata.repId) !== Number(repId) || metadata.visitUuid !== entry.name) continue;
      if (await getPendingVisit(metadata.visitUuid)) continue;
      const [beforeFile, afterFile] = await Promise.all([
        Filesystem.readFile({ path: metadata.beforePath, directory: Directory.External }),
        Filesystem.readFile({ path: metadata.afterPath, directory: Directory.External }),
      ]);
      await addPendingVisit({
        visitUuid: metadata.visitUuid,
        repId: Number(metadata.repId),
        repUsername: metadata.repUsername,
        createdAt: metadata.createdAt,
        payload: metadata.payload,
        beforePhoto: base64ToBlob(beforeFile.data),
        afterPhoto: base64ToBlob(afterFile.data),
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
