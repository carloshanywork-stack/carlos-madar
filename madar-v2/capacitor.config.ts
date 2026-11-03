import 'dotenv/config';
import type { CapacitorConfig } from '@capacitor/cli';

const serverUrl = (process.env.MADAR_REP_SERVER_URL || 'http://localhost:3000').trim();
const parsedServerUrl = new URL(serverUrl);
if (!['http:', 'https:'].includes(parsedServerUrl.protocol)) {
  throw new Error('MADAR_REP_SERVER_URL must use HTTP or HTTPS.');
}

const config: CapacitorConfig = {
  appId: 'com.madar.rep',
  appName: 'مدار - متابعة المناديب',
  webDir: 'public/rep',
  server: {
    url: parsedServerUrl.toString().replace(/\/$/, ''),
    cleartext: parsedServerUrl.protocol === 'http:',
    allowNavigation: [parsedServerUrl.hostname],
  },
  android: {
    backgroundColor: '#f1f4f5',
    loggingBehavior: 'debug',
    webContentsDebuggingEnabled: false,
  },
};

export default config;
