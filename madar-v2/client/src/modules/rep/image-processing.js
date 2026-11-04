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

function localDateParts(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error('وقت التقاط الصورة غير صالح.');
  const dateParts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map(({ type, value: partValue }) => [type, partValue]));
  return {
    date: `${dateParts.year}-${dateParts.month}-${dateParts.day}`,
    weekday: new Intl.DateTimeFormat('ar-EG', { timeZone: 'Africa/Cairo', weekday: 'long' }).format(date),
    time: new Intl.DateTimeFormat('en-US', {
      timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    }).format(date),
  };
}

export function buildWatermarkLines({ machineCode, machineName, regionName, areaName, phase, capturedAt, location }) {
  const { date, weekday, time } = localDateParts(capturedAt);
  const locationLabel = location
    ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)} · ±${Math.round(location.accuracy)}م`
    : 'الموقع غير متاح';
  return [
    `مَــدَارْ · ${phase === 'before' ? 'قبل الصيانة' : 'بعد الصيانة'}`,
    `التاريخ: ${date} · ${weekday}`,
    `الوقت: ${time}`,
    `GPS: ${locationLabel}`,
    `المحافظة/المنطقة المسجلة: ${[regionName, areaName].filter((value, index, values) => value && values.indexOf(value) === index).join(' · ') || 'غير محددة'}`,
    `الماكينة: ${machineCode} · ${machineName || `ماكينة ${machineCode}`}`,
  ];
}

export function getWatermarkLayout(width, height) {
  const fontSize = Math.max(15, Math.round(width * 0.022));
  const lineHeight = Math.round(fontSize * 1.38);
  const padding = Math.max(12, Math.round(fontSize * 0.65));
  const panelWidth = Math.min(width, Math.max(Math.round(width * 0.58), 300));
  const panelHeight = Math.min(height, padding * 2 + lineHeight * 6);
  return {
    fontSize, lineHeight, padding, panelWidth, panelHeight,
    panelTop: Math.max(0, height - panelHeight),
  };
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

/** Compress a capture and permanently burn the visit label into the derived JPEG pixels. */
export async function compressAndWatermark(file, { machineCode, machineName, regionName, areaName, phase, capturedAt, location }) {
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

  const { fontSize, lineHeight, padding, panelWidth, panelHeight, panelTop } = getWatermarkLayout(width, height);
  context.fillStyle = 'rgba(7, 19, 31, 0.82)';
  context.fillRect(0, panelTop, panelWidth, panelHeight);
  context.direction = 'rtl';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  context.font = `800 ${fontSize}px Arial, sans-serif`;
  context.fillStyle = '#ffffff';
  const maxTextWidth = Math.max(40, panelWidth - padding * 2);
  const lines = buildWatermarkLines({ machineCode, machineName, regionName, areaName, phase, capturedAt, location });

  lines.forEach((line, index) => {
    const y = panelTop + padding + lineHeight * index + lineHeight / 2;
    context.fillText(fitText(context, line, maxTextWidth), panelWidth - padding, y, maxTextWidth);
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
