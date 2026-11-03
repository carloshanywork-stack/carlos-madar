import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: resolve(projectRoot, '.env'), quiet: true });
// MADAR's shared deployment variables and JWT secret live in the repository-root .env.
dotenv.config({ path: resolve(projectRoot, '../.env'), quiet: true });

function readPort(value) {
  const port = Number(value ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
if (!['development', 'test', 'production'].includes(nodeEnv)) {
  throw new Error('NODE_ENV must be development, test, or production.');
}

const jwtSecret = process.env.MADAR_V2_JWT_SECRET ?? process.env.JWT_SECRET ?? '';
if (Buffer.byteLength(jwtSecret, 'utf8') < 32) {
  throw new Error('MADAR_V2_JWT_SECRET or JWT_SECRET must contain at least 32 bytes.');
}

const cookieSecureValue = process.env.COOKIE_SECURE;
const cookieSecure = cookieSecureValue === undefined
  ? nodeEnv === 'production'
  : ['true', '1', 'yes'].includes(cookieSecureValue.trim().toLowerCase());

export const env = Object.freeze({
  projectRoot,
  nodeEnv,
  host: process.env.HOST ?? '127.0.0.1',
  port: readPort(process.env.PORT),
  storageMountPath: process.env.STORAGE_MOUNT_PATH?.trim() || undefined,
  dataDirectory: process.env.MADAR_V2_DATA_DIR?.trim() || undefined,
  databasePath: process.env.MADAR_V2_DATABASE_PATH?.trim() || undefined,
  storageRoot: process.env.MADAR_V2_STORAGE_ROOT?.trim() || undefined,
  backupRoot: process.env.MADAR_V2_BACKUP_ROOT?.trim() || undefined,
  repApkPath: process.env.MADAR_REP_APK_PATH?.trim() || undefined,
  initialAdminPassword: process.env.MADAR_INITIAL_ADMIN_PASSWORD ?? '',
  jwtSecret,
  authCookieName: 'madar_token',
  authCookieSecure: cookieSecure,
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
});
