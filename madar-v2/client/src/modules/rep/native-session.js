import { Capacitor, registerPlugin } from '@capacitor/core';

export const RepEngine = registerPlugin('RepEngine');

export const isNativeRepApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';

export async function getNativeAuthorizationHeaders() {
  if (!isNativeRepApp()) return {};
  const headers = { 'x-madar-native-client': 'android' };
  try {
    const session = await RepEngine.getSessionAuthorization();
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  } catch {
    // Rep login itself runs before the token is stored; the native-client marker remains.
  }
  return headers;
}

export async function saveNativeSession(token, rep) {
  if (!isNativeRepApp() || !token || rep?.role !== 'rep') return null;
  return RepEngine.saveSession({ token, rep });
}

export async function clearNativeSession() {
  if (!isNativeRepApp()) return null;
  return RepEngine.clearSession();
}
