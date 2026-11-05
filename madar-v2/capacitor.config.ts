import type { CapacitorConfig } from '@capacitor/cli';
import { config as loadDotEnv } from 'dotenv';

loadDotEnv();

const serverUrlValue = process.env.MADAR_REP_SERVER_URL?.trim() || 'https://carlos-pc.tail852ef0.ts.net';
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
const liveReloadBuild = !releaseBuild && process.env.MADAR_REP_LIVE_RELOAD === 'true';
// Package the UI for every normal Android build; only explicit live reload
// should navigate the WebView to a network host such as localhost.
const standaloneBuild = !liveReloadBuild;

if (serverUrl.protocol === 'http:' && !liveReloadBuild) {
  throw new Error('Android builds require HTTPS by default. For localhost testing only, set MADAR_REP_LIVE_RELOAD=true and use adb reverse.');
}

if (standaloneBuild && serverUrl.protocol !== 'https:') {
  throw new Error('Standalone Android builds require MADAR_REP_SERVER_URL to use HTTPS for API requests.');
}

const config: CapacitorConfig = {
  appId: 'com.madar.rep.app',
  appName: 'مدار - متابعة المناديب',
  webDir: 'public/rep',
  ...(liveReloadBuild ? {
    server: {
      url: serverUrl.toString(),
      cleartext: serverUrl.protocol === 'http:',
      allowNavigation: [serverUrl.hostname],
    },
  } : {}),
  android: {
    backgroundColor: '#f1f4f5',
    loggingBehavior: releaseBuild ? 'none' : 'debug',
    webContentsDebuggingEnabled: !releaseBuild,
  },
  plugins: {
    CapacitorHttp: { enabled: standaloneBuild },
    CapacitorCookies: { enabled: standaloneBuild },
  },
};

export default config;
