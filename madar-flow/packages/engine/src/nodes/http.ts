import type { WorkflowNode } from '@madar/shared';
import type { Item, NodeExecutionArgs, NodeExecutionResult, RetryOptions } from '../types.js';
import {
  abortError,
  asItems,
  isPlainObject,
  resolveForItem,
  stringValue,
  truncate,
} from './helpers.js';

const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

export function retryOptions(node: WorkflowNode): RetryOptions {
  const raw = node.parameters.retry;
  if (isPlainObject(raw)) {
    const maxAttempts = Number(raw.maxAttempts ?? 1);
    const backoffMs = Number(raw.backoffMs ?? 0);
    return {
      maxAttempts: Number.isFinite(maxAttempts) ? Math.min(Math.max(Math.trunc(maxAttempts), 1), 10) : 1,
      backoffMs: Number.isFinite(backoffMs) ? Math.min(Math.max(Math.trunc(backoffMs), 0), 60_000) : 0,
    };
  }
  return { maxAttempts: 1, backoffMs: 0 };
}

function assertAllowedUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw Object.assign(new Error(`Invalid URL: ${url}`), { code: 'invalid_url' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw Object.assign(new Error('Only http and https URLs are allowed.'), {
      code: 'invalid_protocol',
    });
  }
  if (BLOCKED_HOSTS.has(parsed.hostname)) {
    throw Object.assign(new Error('This host is blocked.'), { code: 'blocked_host' });
  }
  return parsed;
}

function joinUrl(base: string, query: Record<string, unknown> | undefined): string {
  if (!query || Object.keys(query).length === 0) return base;
  const url = new URL(base);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, stringValue(value));
  }
  return url.toString();
}

function applyCredential(headers: Record<string, string>, credential: Record<string, unknown>): void {
  const type = String(credential.type ?? '');
  if (type === 'api_key') {
    const headerName = String(credential.headerName ?? 'x-api-key');
    const prefix = typeof credential.valuePrefix === 'string' ? credential.valuePrefix : '';
    headers[headerName] = `${prefix}${String(credential.secret ?? '')}`;
    return;
  }
  if (type === 'bearer') {
    headers.authorization = `Bearer ${String(credential.token ?? '')}`;
    return;
  }
  if (type === 'basic') {
    const encoded = Buffer.from(
      `${String(credential.username ?? '')}:${String(credential.password ?? '')}`,
      'utf8',
    ).toString('base64');
    headers.authorization = `Basic ${encoded}`;
    return;
  }
  throw Object.assign(new Error(`Unsupported HTTP credential type: ${type}`), {
    code: 'credential_type_invalid',
  });
}

function buildBody(
  parameters: Record<string, unknown>,
  resolvedBody: unknown,
): { body: string | URLSearchParams | undefined; contentType?: string } {
  const bodyType = stringValue(parameters.bodyType, 'none');
  if (bodyType === 'none' || resolvedBody === undefined || resolvedBody === null) {
    return { body: undefined };
  }

  if (bodyType === 'json') {
    if (typeof resolvedBody === 'string') {
      const trimmed = resolvedBody.trim();
      if (!trimmed) return { body: undefined };
      try {
        return { body: JSON.stringify(JSON.parse(trimmed)), contentType: 'application/json' };
      } catch {
        throw Object.assign(new Error('HTTP body is not valid JSON.'), { code: 'invalid_body' });
      }
    }
    return { body: JSON.stringify(resolvedBody), contentType: 'application/json' };
  }

  if (bodyType === 'form' && isPlainObject(resolvedBody)) {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(resolvedBody)) {
      form.set(key, stringValue(value));
    }
    return { body: form.toString(), contentType: 'application/x-www-form-urlencoded' };
  }

  return { body: stringValue(resolvedBody), contentType: 'text/plain; charset=utf-8' };
}

async function performRequest(
  args: NodeExecutionArgs,
  attempt: number,
): Promise<NodeExecutionResult> {
  const { node, input } = args;
  const parameters = node.parameters;
  const first = input[0] ?? { json: null };

  const method = stringValue(parameters.method, 'GET').toUpperCase();
  const resolvedUrl = stringValue(await resolveForItem(parameters.url, args, first));
  const baseUrl = assertAllowedUrl(resolvedUrl).toString();

  const headers: Record<string, string> = {
    accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
  };
  if (isPlainObject(parameters.headers)) {
    for (const [key, value] of Object.entries(parameters.headers)) {
      headers[key] = stringValue(await resolveForItem(value, args, first));
    }
  }

  const credentialId =
    typeof parameters.credentialId === 'string' ? parameters.credentialId : null;
  if (credentialId) {
    if (!args.context.credentials) {
      throw Object.assign(new Error('Credential resolution is not available.'), {
        code: 'credential_unavailable',
      });
    }
    const credential = await args.context.credentials.get(credentialId);
    if (!credential) {
      throw Object.assign(new Error('Credential was not found or has been revoked.'), {
        code: 'credential_unavailable',
      });
    }
    applyCredential(headers, credential);
  }

  let url = baseUrl;
  if (isPlainObject(parameters.query)) {
    const queryEntries = await Promise.all(
      Object.entries(parameters.query).map(async ([key, value]) => [
        key,
        await resolveForItem(value, args, first),
      ]),
    );
    url = joinUrl(baseUrl, Object.fromEntries(queryEntries));
  }

  return performFetch(args, attempt, url, headers, method, first);
}

async function performFetch(
  args: NodeExecutionArgs,
  attempt: number,
  url: string,
  headers: Record<string, string>,
  method: string,
  first: Item,
): Promise<NodeExecutionResult> {
  const { node, context } = args;
  const parameters = node.parameters;

  const resolvedBody =
    parameters.body === undefined ? undefined : await resolveForItem(parameters.body, args, first);
  const { body, contentType } = buildBody(parameters, resolvedBody);

  const finalHeaders: Record<string, string> = { ...headers };
  if (contentType && !Object.keys(finalHeaders).some((key) => key.toLowerCase() === 'content-type')) {
    finalHeaders['content-type'] = contentType;
  }

  const timeoutMs = Math.min(
    Math.max(Number(parameters.timeoutMs ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS, 1_000),
    MAX_TIMEOUT_MS,
  );

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([context.signal, timeoutSignal]);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: method === 'GET' || method === 'HEAD' ? undefined : body,
      signal,
      redirect: 'follow',
    });
  } catch (caught) {
    if (context.signal.aborted) throw abortError(context.signal);
    const message =
      caught instanceof Error
        ? caught.name === 'TimeoutError'
          ? `Request timed out after ${timeoutMs}ms`
          : caught.message
        : 'Request failed';
    throw Object.assign(new Error(message), {
      code: 'request_failed',
      attempt,
      retryable: true,
    });
  }

  const text = await response.text();
  let parsed: unknown = text;
  const responseType = response.headers.get('content-type') ?? '';
  if (text && (responseType.includes('json') || /^[[{"]/.test(text.trim()))) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const status = response.status;
    const error = Object.assign(
      new Error(`HTTP ${status} ${response.statusText}`.trim()),
      {
        code: 'http_error',
        retryable: status === 408 || status === 429 || status >= 500,
        details: {
          status,
          body: truncate(
            typeof parsed === 'string' ? parsed : JSON.stringify(parsed),
            2_000,
          ),
        },
      },
    );
    throw error;
  }

  const items = Array.isArray(parsed) ? asItems(parsed) : [{ json: parsed }];
  return {
    outputs: { main: items },
    meta: {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    },
  };
}

/**
 * Performs a single HTTP attempt. Retries (attempt count + back-off) are
 * owned by the executor, which honors the same `parameters.retry` contract
 * for every node type and only retries errors flagged as retryable.
 */
export async function executeHttpNode(args: NodeExecutionArgs): Promise<NodeExecutionResult> {
  if (args.context.signal.aborted) throw abortError(args.context.signal);
  return performRequest(args, 1);
}
