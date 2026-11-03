import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import sharp from 'sharp';
import { compressFieldImage } from '../server/modules/upload.js';

test('field image compression emits an EXIF-free Full HD JPEG and reports measured savings', async () => {
  const width = 2400;
  const height = 1800;
  const pixels = randomBytes(width * height * 3);
  const source = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer();
  const compressed = await compressFieldImage(source);
  const metadata = await sharp(compressed.buffer).metadata();
  const savingsPercent = Math.round((1 - compressed.outputBytes / compressed.inputBytes) * 1000) / 10;

  assert.equal(compressed.format, 'jpeg');
  assert.ok(metadata.width <= 1920 && metadata.height <= 1080);
  assert.equal(metadata.format, 'jpeg');
  assert.equal(metadata.exif, undefined, 'metadata is stripped from the stored derivative');
  assert.ok(compressed.outputBytes < compressed.inputBytes);
  assert.ok(savingsPercent > 0);
  console.log(`Synthetic ${width}x${height} field-image fixture: ${compressed.inputBytes} -> ${compressed.outputBytes} bytes (${savingsPercent}% smaller).`);
});
