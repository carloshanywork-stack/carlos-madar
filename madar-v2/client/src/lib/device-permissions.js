import { Capacitor, registerPlugin } from '@capacitor/core';

const RepDevice = registerPlugin('RepDevice');

export function isNativeRepApp() {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

export async function getNativePermissionStatus() {
  if (!isNativeRepApp()) return null;
  try {
    return await RepDevice.getStatus();
  } catch {
    // A debug WebView may run against an older APK that predates this plugin.
    return null;
  }
}

export async function requestNativeInitialPermissions() {
  if (!isNativeRepApp()) return null;
  return RepDevice.requestInitialPermissions();
}

export async function requestNativeBatteryExemption() {
  if (!isNativeRepApp()) return null;
  return RepDevice.requestIgnoreBatteryOptimizations();
}

export async function openNativeAppSettings() {
  if (!isNativeRepApp()) return null;
  return RepDevice.openAppSettings();
}
