import { createHmac } from 'node:crypto';
import { base32Decode, randomBase32 } from '@madar/shared';

const STEP_SECONDS = 30;
const DIGITS = 6;

export function generateTotpSecret(): string {
  return randomBase32(20);
}

export function totpCode(secret: string, counter: number): string {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return (binary % 10 ** DIGITS).toString().padStart(DIGITS, '0');
}

export interface TotpVerification {
  valid: boolean;
  step: number;
}

export function verifyTotpCode(
  secret: string,
  code: string,
  window = 1,
  now = Date.now(),
): TotpVerification {
  const normalized = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(normalized)) return { valid: false, step: -1 };
  const current = Math.floor(now / 1000 / STEP_SECONDS);
  for (let offset = -window; offset <= window; offset += 1) {
    const step = current + offset;
    if (totpCode(secret, step) === normalized) return { valid: true, step };
  }
  return { valid: false, step: -1 };
}

export function otpauthUrl(email: string, secret: string): string {
  const label = encodeURIComponent(`Madar Flow:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer: 'Madar Flow',
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => `${randomBase32(5)}-${randomBase32(5)}`);
}

export function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}
