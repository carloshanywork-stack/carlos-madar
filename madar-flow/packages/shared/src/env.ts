import { z } from 'zod';

const booleanString = (defaultValue: 'true' | 'false') =>
  z
    .string()
    .default(defaultValue)
    .transform((value) => value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  VALKEY_URL: z.string().min(1).default('redis://localhost:6379'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  /** Base64-encoded 32-byte key-encryption key for credentials and TOTP secrets. Required in production. */
  CREDENTIALS_KEK: z.string().optional(),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_SECONDS: z.coerce.number().int().min(3600).default(2_592_000),
  REFRESH_GRACE_SECONDS: z.coerce.number().int().min(1).max(120).default(10),
  SSE_TOKEN_TTL_SECONDS: z.coerce.number().int().min(10).max(300).default(60),
  COOKIE_SECURE: booleanString('false'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  TRUST_PROXY: booleanString('false'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(2),
  EXECUTION_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(3_600_000).default(300_000),
  BULLMQ_LOCK_DURATION_MS: z.coerce.number().int().min(30_000).max(900_000).default(120_000),
  SCHEDULER_SYNC_INTERVAL_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}
