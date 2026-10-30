export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'include',
    ...options,
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
  upload: (path, formData, options = {}) => request(path, {
    ...options,
    method: 'POST',
    body: formData,
  }),
};

export function queryString(parameters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const suffix = query.toString();
  return suffix ? `?${suffix}` : '';
}
