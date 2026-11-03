function fitText(context, text, maxWidth) {
  let value = String(text ?? '');
  if (context.measureText(value).width <= maxWidth) return value;
  while (value.length > 1 && context.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function toJpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('تعذر تجهيز الصورة على الهاتف.'));
    }, 'image/jpeg', quality);
  });
}

async function decodeImage(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file, { imageOrientation: 'from-image' });
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = sourceUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

/** Compress a capture and burn a useful on-device label; this is not tamper-proof evidence. */
export async function compressAndWatermark(file, { machineCode, regionName, phase, capturedAt, location }) {
  const image = await decodeImage(file);
  const naturalWidth = image.width || image.naturalWidth;
  const naturalHeight = image.height || image.naturalHeight;
  if (!naturalWidth || !naturalHeight) throw new Error('الصورة غير صالحة أو لا يمكن فتحها.');

  const scale = Math.min(1, 1600 / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('تعذر تجهيز الصورة على هذا الهاتف.');
  context.drawImage(image, 0, 0, width, height);
  image.close?.();

  const fontSize = Math.max(16, Math.round(width * 0.022));
  const lineHeight = Math.round(fontSize * 1.42);
  const padding = Math.max(14, Math.round(fontSize * 0.7));
  const bannerHeight = padding * 2 + lineHeight * 3;
  const bannerTop = Math.max(0, height - bannerHeight);
  context.fillStyle = 'rgba(7, 19, 31, 0.82)';
  context.fillRect(0, bannerTop, width, height - bannerTop);
  context.direction = 'rtl';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  context.font = `700 ${fontSize}px Arial, sans-serif`;
  context.fillStyle = '#ffffff';

  const dateLabel = new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(capturedAt);
  const locationLabel = location
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} (±${Math.round(location.accuracy)}م)`
    : 'الموقع غير متاح';
  const phaseLabel = phase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة';
  const maxTextWidth = Math.max(40, width - padding * 2);
  const lines = [
    `مَــدَارْ · ${machineCode} · ${regionName}`,
    dateLabel,
    `GPS: ${locationLabel} · ${phaseLabel}`,
  ];

  lines.forEach((line, index) => {
    const y = bannerTop + padding + lineHeight * index + lineHeight / 2;
    context.fillText(fitText(context, line, maxTextWidth), width - padding, y, maxTextWidth);
  });

  return toJpegBlob(canvas, 0.82);
}

export function locationPayload(location) {
  if (!location) return null;
  return {
    latitude: location.latitude,
    longitude: location.longitude,
    accuracy: location.accuracy,
    updatedAt: location.updatedAt,
  };
}
