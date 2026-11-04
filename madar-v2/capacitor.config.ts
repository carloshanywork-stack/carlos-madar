import type { CapacitorConfig } from '@capacitor/cli';
import { config as loadDotEnv } from 'dotenv';

loadDotEnv();

const serverUrlValue = process.env.MADAR_REP_SERVER_URL?.trim() || 'http://localhost:3000';
let serverUrl: URL;
try {
  serverUrl = new URL(serverUrlValue);
} catch {
  throw new Error('MADAR_REP_SERVER_URL must be a valid absolute HTTP(S) URL.');
}

if (!['http:', 'https:'].includes(serverUrl.protocol) || serverUrl.username || serverUrl.password) {
  throw new Error('MADAR_REP_SERVER_URL must use HTTP(S) and must not contain credentials.');
}
if (serverUrl.protocol === 'http:' && serverUrl.hostname !== 'localhost') {
  throw new Error('Non-local MADAR_REP_SERVER_URL must use HTTPS; cleartext is permitted only for localhost testing.');
}

const releaseBuild = process.env.MADAR_ANDROID_BUILD_TYPE === 'release';

const config: CapacitorConfig = {
  appId: 'com.madar.rep.app',
  appName: 'مدار - متابعة المناديب',
  webDir: 'public/rep',
  server: {
    url: serverUrl.toString(),
    cleartext: serverUrl.protocol === 'http:',
    allowNavigation: [serverUrl.hostname],
  },
  android: {
    backgroundColor: '#f1f4f5',
    loggingBehavior: releaseBuild ? 'none' : 'debug',
    webContentsDebuggingEnabled: !releaseBuild,
  },
};

export default config;
