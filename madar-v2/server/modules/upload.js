import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import sharp from 'sharp';
import { HttpError, safeOriginalName } from './http.js';

const supportedPhotoFormats = new Set(['jpeg', 'png', 'webp', 'heif', 'avif', 'tiff', 'gif']);

/** Create an orientation-correct JPEG derivative, bounded to Full HD and stripped of metadata. */
export async function compressFieldImage(imageBuffer, { width = 1920, height = 1080, quality = 80 } = {}) {
  if (!Buffer.isBuffer(imageBuffer) || !imageBuffer.length) throw new TypeError('Image data is empty.');
  const options = { failOn: 'error', limitInputPixels: 40_000_000 };
  const metadata = await sharp(imageBuffer, options).metadata();
  if (!supportedPhotoFormats.has(metadata.format) || !metadata.width || !metadata.height) {
    throw new TypeError('Unsupported or invalid image data.');
  }
  const buffer = await sharp(imageBuffer, options)
    .rotate()
    .resize({ width, height, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
  return {
    buffer,
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    inputBytes: imageBuffer.length,
    outputBytes: buffer.length,
  };
}

function createFileFilter(extensions) {
  const allowedExtensions = new Set(extensions.map((extension) => extension.toLowerCase()));
  return (req, file, callback) => {
    try {
      const originalName = safeOriginalName(file.originalname);
      const extension = extname(originalName).toLowerCase();
      if (!allowedExtensions.has(extension)) {
        return callback(new HttpError(400, `Unsupported file extension: ${extension || '(none)'}.`));
      }
      callback(null, true);
    } catch (error) {
      callback(error);
    }
  };
}

export function memoryUpload({ maxBytes, extensions }) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 20, parts: 21 },
    fileFilter: createFileFilter(extensions),
  });
}

function createDiskUpload({ maxBytes, extensions, destination, limits }) {
  const storage = multer.diskStorage({
    destination(req, file, callback) {
      Promise.resolve(typeof destination === 'function' ? destination(req, file) : destination)
        .then((directory) => callback(null, directory), callback);
    },
    filename(req, file, callback) {
      callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
    },
  });
  return multer({
    storage,
    limits,
    fileFilter: createFileFilter(extensions),
  });
}

export function diskUpload({ maxBytes, extensions, destination }) {
  return createDiskUpload({
    maxBytes,
    extensions,
    destination,
    limits: { fileSize: maxBytes, files: 1, fields: 20, parts: 21 },
  });
}

/** Disk-backed multipart upload with no file-count cap; every file remains individually size-limited. */
export function diskUploadMany({ maxBytes, extensions, destination, fields = 1, fieldSize = 64 * 1024 }) {
  return createDiskUpload({
    maxBytes,
    extensions,
    destination,
    limits: { fileSize: maxBytes, fields, fieldSize },
  });
}
