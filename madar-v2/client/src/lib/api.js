export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers ?? {});
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
    cache: 'no-store',
    headers,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    const message = typeof payload === 'object' && payload?.error
      ? payload.error
      : `تعذر تنفيذ الطلب (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }
  return payload;
}

function uploadWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    });
    xhr.addEventListener('error', () => reject(new ApiError('تعذر الاتصال بالخادم أثناء رفع الملف.', 0)));
    xhr.addEventListener('load', () => {
      const contentType = xhr.getResponseHeader('content-type') ?? '';
      let payload;
      try { payload = contentType.includes('application/json') ? JSON.parse(xhr.responseText) : xhr.responseText; }
      catch { payload = {}; }
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new ApiError(payload?.error || `تعذر تنفيذ الطلب (${xhr.status})`, xhr.status, payload));
      } else resolve(payload);
    });
    xhr.send(formData);
  });
}

export const api = {
  get: (path, options = {}) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options = {}) => request(path, {
    ...options,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...options.headers },
    body: JSON.stringify(body ?? {}),
  }),
  patch: (path, body, options = {}) => request(path, {
    ...options,
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...options.headers },
    body: JSON.stringify(body ?? {}),
  }),
  delete: (path, options = {}) => request(path, { ...options, method: 'DELETE' }),
  upload: (path, formData, options = {}) => request(path, {
    ...options,
    method: 'POST',
    body: formData,
  }),
  uploadWithProgress,
};

export function queryString(parameters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}
