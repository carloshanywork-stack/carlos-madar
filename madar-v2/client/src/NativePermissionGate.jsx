import { useEffect } from 'react';
import { isNativeRepApp, RepEngine } from './modules/rep/native-session.js';

export async function requestAppBackgroundPermission() {
  return RepEngine.requestBackgroundPermission?.();
}

export async function openDeviceAppSettings() {
  return RepEngine.openAppSettings?.();
}

export async function requestDeviceBatteryExemption() {
  return RepEngine.requestBatteryExemption?.();
}

/**
 * Non-blocking permission gate:
 * Representatives only need notification permission so the system can notify them of updates.
 * No mandatory blocking gates or screens are shown.
 */
export default function NativePermissionGate({ children }) {
  const nativeAndroid = isNativeRepApp();

  useEffect(() => {
    if (!nativeAndroid) return;
    let active = true;

    const requestPermissionsQuietly = async () => {
      try {
        const permissions = await RepEngine.getPermissionState();
        if (!active) return;
        // Request essential permissions (location, camera, notification) quietly if not yet granted
        if ((!permissions?.notifications || !permissions?.fineLocation) && !permissions?.initialRequestMade) {
          await RepEngine.requestInitialPermissions().catch(() => undefined);
        }
      } catch (err) {
        console.warn('[NativePermissionGate] Soft permission check:', err);
      }
    };

    void requestPermissionsQuietly();
    return () => { active = false; };
  }, [nativeAndroid]);

  // Never block the user - immediately render the application
  return children;
}
