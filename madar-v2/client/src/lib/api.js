import { getNativeAuthorizationHeaders } from '../modules/rep/native-session.js';

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

const REP_ACCOUNT_DISABLED_MESSAGE = 'تم تعطيل حسابك من قبل الإدارة';
const API_BASE_URL = typeof __MADAR_API_BASE_URL__ === 'undefined' ? '' : __MADAR_API_BASE_URL__;

export function apiUrl(path) {
  if (!API_BASE_URL || /^[a-z][a-z\d+.-]*:/i.test(path)) return path;
  return new URL(path, `${API_BASE_URL}/`).toString();
}

function notifyDisabledRep(payload) {
  if (payload?.message !== REP_ACCOUNT_DISABLED_MESSAGE || typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('madar-rep-account-disabled', {
    detail: { message: REP_ACCOUNT_DISABLED_MESSAGE },
  }));
}

async function request(path, options = {}) {
  const { timeoutMs = 0, signal: callerSignal, ...fetchOptions } = options;
  const headers = new Headers(options.headers ?? {});
  const nativeHeaders = await getNativeAuthorizationHeaders();
  for (const [name, value] of Object.entries(nativeHeaders)) headers.set(name, value);
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  headers.set('Pragma', 'no-cache');
  headers.set('Expires', '0');
  const controller = new AbortController();
  let timedOut = false;
  let timeout;
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }
  let response;
  try {
    response = await fetch(apiUrl(path), {
      credentials: 'include',
      ...fetchOptions,
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) throw new ApiError('انتهت مهلة الطلب؛ حاول مرة أخرى عند استقرار الاتصال.', 0);
    throw error;
  } finally {
    if (timeout) window.clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    notifyDisabledRep(payload);
    const message = typeof payload === 'object' && (payload?.message || payload?.error)
      ? payload.message || payload.error
      : `تعذر تنفيذ الطلب (${response.status})`;
    throw new ApiError(message, response.status, payload);
  }
  return payload;
}

function uploadWithProgress(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    getNativeAuthorizationHeaders().then((nativeHeaders) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', apiUrl(path));
      xhr.withCredentials = true;
      for (const [name, value] of Object.entries(nativeHeaders)) xhr.setRequestHeader(name, value);
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
          notifyDisabledRep(payload);
          reject(new ApiError(payload?.message || payload?.error || `تعذر تنفيذ الطلب (${xhr.status})`, xhr.status, payload));
        } else resolve(payload);
      });
      xhr.send(formData);
    }).catch(reject);
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
  put: (path, body, options = {}) => request(path, {
    ...options,
    method: 'PUT',
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
