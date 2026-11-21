export function sanitizeWindowsFilename(input, fallback = 'image.jpg') {
  if (!input || typeof input !== 'string') return fallback;
  // Replace illegal Windows characters: \ / : * ? " < > | and control chars (0-31)
  let clean = input.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim();
  // Strip reserved DOS device names
  const reservedRegex = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
  if (reservedRegex.test(clean)) {
    clean = `_${clean}`;
  }
  // Remove trailing dots and spaces
  clean = clean.replace(/[. ]+$/, '');
  return clean || fallback;
}

export function buildOperationalFilename({
  machineCode,
  phase,
  timestamp,
  index = 0,
  fallback = 'photo.jpg',
  originalUrl = '',
}) {
  const parts = ['MADAR'];
  if (machineCode) parts.push(sanitizeWindowsFilename(machineCode));
  if (phase) parts.push(sanitizeWindowsFilename(phase));
  if (timestamp) {
    try {
      const date = new Date(timestamp);
      if (!Number.isNaN(date.valueOf())) {
        const iso = date.toISOString().replace(/[:.]/g, '-');
        parts.push(iso.slice(0, 19));
      }
    } catch {
      // ignore invalid date
    }
  }
  if (Number.isFinite(index) && index >= 0) parts.push(String(index + 1));

  let ext = 'jpg';
  try {
    const parsed = new URL(originalUrl, 'http://localhost');
    const pathExt = parsed.pathname.split('.').pop()?.toLowerCase();
    if (pathExt && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg', 'bmp'].includes(pathExt)) {
      ext = pathExt === 'jpeg' ? 'jpg' : pathExt;
    }
  } catch {
    // fallback to jpg
  }

  const base = parts.join('_');
  return sanitizeWindowsFilename(`${base}.${ext}`, fallback);
}
