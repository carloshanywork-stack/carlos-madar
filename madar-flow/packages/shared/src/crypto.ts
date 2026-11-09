import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/**
 * Envelope encryption for credentials and TOTP secrets.
 *
 * Every value gets a random 256-bit data key. The payload is encrypted with
 * AES-256-GCM using that data key, and the data key itself is wrapped with the
 * KEK (also AES-256-GCM). Rotating the KEK therefore only re-wraps data keys,
 * which is why the wrapped key is stored next to the payload.
 */

interface Sealed {
  iv: string;
  tag: string;
  data: string;
}

interface Envelope {
  v: 1;
  keyVersion: number;
  wrappedKey: Sealed;
  payload: Sealed;
}

const KEY_VERSION = 1;
const PAYLOAD_AAD = Buffer.from('madar-flow:credential-payload:v1');
const WRAP_AAD = Buffer.from('madar-flow:credential-dek:v1');

function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function open(key: Buffer, sealed: Sealed, aad: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'));
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]);
}

/**
 * Resolves the KEK. Production must supply `CREDENTIALS_KEK` explicitly;
 * development derives a deterministic key from the JWT secret so local setups
 * work without extra configuration. Never use the derived fallback in
 * production: the caller is responsible for failing closed there.
 */
export function resolveCredentialsKey(env: {
  CREDENTIALS_KEK?: string;
  JWT_ACCESS_SECRET: string;
  NODE_ENV: string;
}): Buffer {
  if (env.CREDENTIALS_KEK) {
    const decoded = Buffer.from(env.CREDENTIALS_KEK, 'base64');
    if (decoded.length !== 32) {
      throw new Error('CREDENTIALS_KEK must be a base64-encoded 32-byte key.');
    }
    return decoded;
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('CREDENTIALS_KEK is required in production.');
  }
  return createHash('sha256').update(`madar-flow-dev-kek:${env.JWT_ACCESS_SECRET}`).digest();
}

export function encryptSecret(kek: Buffer, value: unknown): string {
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const dataKey = randomBytes(32);
  const payload = seal(dataKey, plaintext, PAYLOAD_AAD);
  const wrappedKey = seal(kek, dataKey, WRAP_AAD);
  const envelope: Envelope = { v: 1, keyVersion: KEY_VERSION, wrappedKey, payload };
  return JSON.stringify(envelope);
}

export function decryptSecret<T = unknown>(kek: Buffer, serialized: string): T {
  const envelope = JSON.parse(serialized) as Envelope;
  if (envelope.v !== 1) throw new Error(`Unsupported credential envelope version: ${envelope.v}`);
  const dataKey = open(kek, envelope.wrappedKey, WRAP_AAD);
  const plaintext = open(dataKey, envelope.payload, PAYLOAD_AAD);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function randomBase32(byteLength: number): string {
  return base32Encode(randomBytes(byteLength));
}

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  const normalized = input.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index === -1) throw new Error('Invalid base32 character.');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
