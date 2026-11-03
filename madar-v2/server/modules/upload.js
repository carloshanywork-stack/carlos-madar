import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { HttpError, safeOriginalName } from './http.js';

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
