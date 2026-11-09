import { randomBytes } from 'node:crypto';

const HEX = '0123456789abcdef';

/**
 * Generates a UUIDv7 (time-ordered UUID) without external dependencies.
 *
 * Layout: 48-bit Unix timestamp in milliseconds, 4-bit version (7),
 * 12 bits of randomness, 2-bit variant (10), 62 bits of randomness.
 */
export function uuidv7(now: number = Date.now()): string {
  if (!Number.isFinite(now) || now < 0) {
    throw new TypeError('uuidv7 requires a non-negative millisecond timestamp.');
  }

  const bytes = randomBytes(16);
  const timestamp = BigInt(Math.trunc(now));

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);

  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  let output = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    output += HEX[byte >> 4]! + HEX[byte & 0x0f]!;
    if (index === 3 || index === 5 || index === 7 || index === 9) output += '-';
  }
  return output;
}

export function extractUuidv7Timestamp(id: string): number | null {
  const match = /^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.exec(id);
  if (!match) return null;
  return Number.parseInt(`${match[1]}${match[2]}`, 16);
}

export function isUuidv7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
