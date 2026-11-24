import { Capacitor, registerPlugin } from '@capacitor/core';
import { api } from './api.js';

const NativeAppUpdate = registerPlugin('AppUpdate');

export const isNativeAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
export const isNativeApp = isNativeAndroidApp;

export async function getNativeAppInfo() {
  if (!isNativeAndroidApp()) return null;
  try {
    return await NativeAppUpdate.getAppInfo();
  } catch (err) {
    console.warn('Could not read native app info:', err);
    return null;
  }
}

export async function checkAppUpdate({ target = 'system' } = {}) {
  if (isNativeAndroidApp()) {
    try {
      const serverUrl = typeof __MADAR_API_BASE_URL__ !== 'undefined' ? __MADAR_API_BASE_URL__ : window.location.origin;
      const res = await NativeAppUpdate.checkForUpdate({ target, serverUrl });
      return {
        isNative: true,
        updateAvailable: Boolean(res.updateAvailable),
        currentVersionCode: Number(res.currentVersionCode || 0),
        latestVersionCode: Number(res.latestVersionCode || 0),
        versionName: res.versionName || '',
        releaseNotes: res.releaseNotes || '',
        sha256: res.sha256 || '',
        apkUrl: res.apkUrl || `/download/apk?target=${target}`,
      };
    } catch (nativeErr) {
      console.warn('Native update check failed, falling back to HTTP:', nativeErr);
    }
  }

  // Web / fallback check
  try {
    const versionRes = await api.get(`/api/app-version?target=${target}`);
    const statusRes = await api.get(`/download/apk/status?target=${target}`).catch(() => null);
    const latestVersionCode = Number(versionRes.latestVersionCode || statusRes?.releaseMetadata?.versionCode || 0);
    const versionName = versionRes.versionName || statusRes?.releaseMetadata?.versionName || '';
    const sha256 = versionRes.sha256 || statusRes?.releaseMetadata?.apkSha256 || '';
    const releaseNotes = versionRes.releaseNotes || '';
    const available = Boolean(statusRes?.available || versionRes.latestVersionCode > 0);

    return {
      isNative: false,
      updateAvailable: available,
      currentVersionCode: 0,
      latestVersionCode,
      versionName,
      releaseNotes,
      sha256,
      apkUrl: `/download/apk?target=${target}`,
    };
  } catch (error) {
    console.warn('Web update check failed:', error);
    return {
      isNative: false,
      updateAvailable: false,
      currentVersionCode: 0,
      latestVersionCode: 0,
      versionName: '',
      releaseNotes: '',
      sha256: '',
      apkUrl: `/download/apk?target=${target}`,
      error: error.message,
    };
  }
}

export async function downloadAndInstallUpdate({ target = 'system', expectedSha256 = '', expectedVersionCode = 0, onProgress = null } = {}) {
  if (isNativeAndroidApp()) {
    let removeListener = null;
    if (typeof onProgress === 'function') {
      const listener = await NativeAppUpdate.addListener('updateProgress', (data) => {
        onProgress(data);
      });
      removeListener = () => listener.remove();
    }

    try {
      const serverUrl = typeof __MADAR_API_BASE_URL__ !== 'undefined' ? __MADAR_API_BASE_URL__ : window.location.origin;
      const res = await NativeAppUpdate.downloadAndInstall({
        target,
        serverUrl,
        expectedSha256,
        expectedVersionCode,
      });
      return res;
    } finally {
      if (removeListener) removeListener();
    }
  }

  // Browser download fallback
  const downloadLink = document.createElement('a');
  downloadLink.href = `/download/apk?target=${target}`;
  downloadLink.download = target === 'system' ? 'madar-manager.apk' : 'madar-rep.apk';
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
  return { success: true, downloaded: true };
}
