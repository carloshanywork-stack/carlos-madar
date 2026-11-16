import { gzipSync } from 'node:zlib';

const COMPRESSIBLE_TYPES = /^(?:text\/|application\/(?:json|javascript|xml))/i;
const MIN_BYTES = 1024; // Compress payloads > 1KB

export function compressionMiddleware(req, res, next) {
  const acceptEncoding = req.get('Accept-Encoding') || '';
  if (!acceptEncoding.includes('gzip')) {
    next();
    return;
  }

  const originalSend = res.send;
  res.send = function (body) {
    if (res.headersSent || !body) {
      return originalSend.call(this, body);
    }

    const contentType = res.get('Content-Type') || '';
    if (!COMPRESSIBLE_TYPES.test(contentType)) {
      return originalSend.call(this, body);
    }

    const buffer = Buffer.isBuffer(body)
      ? body
      : typeof body === 'string'
        ? Buffer.from(body)
        : Buffer.from(JSON.stringify(body));

    if (buffer.length < MIN_BYTES) {
      return originalSend.call(this, body);
    }

    try {
      const gzipped = gzipSync(buffer);
      res.set('Content-Encoding', 'gzip');
      res.removeHeader('Content-Length');
      return originalSend.call(this, gzipped);
    } catch {
      return originalSend.call(this, body);
    }
  };

  next();
}
