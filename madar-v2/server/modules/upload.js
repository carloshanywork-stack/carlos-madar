import multer from 'multer';
import { extname } from 'node:path';
import { HttpError, safeOriginalName } from './http.js';

export function memoryUpload({ maxBytes, extensions }) {
  const allowedExtensions = new Set(extensions.map((extension) => extension.toLowerCase()));
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 20, parts: 21 },
    fileFilter(req, file, callback) {
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
    },
  });
}
