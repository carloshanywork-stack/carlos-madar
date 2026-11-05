import { Capacitor, registerPlugin } from '@capacitor/core';

export const RepEngine = registerPlugin('RepEngine');

export const isNativeRepApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function saveNativeSession(token, rep) {
  if (!isNativeRepApp() || !token || rep?.role !== 'rep') return null;
  return RepEngine.saveSession({ token, rep });
}

export async function clearNativeSession() {
  if (!isNativeRepApp()) return null;
  return RepEngine.clearSession();
}
