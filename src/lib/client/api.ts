'use client';

import type { FieldError } from '@/lib/api/errors';

/**
 * Browser-side API client.
 *
 * Every mutating call automatically echoes the CSRF cookie into the
 * `x-csrf-token` header, so no caller has to remember to. Responses are
 * unwrapped from the `{ data, meta }` envelope, and failures become a typed
 * `ApiError` carrying the field errors, so a form can map them back onto its
 * own inputs.
 */

const CSRF_COOKIE = 'ecom_csrf';
const CSRF_HEADER = 'x-csrf-token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: FieldError[];
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    fieldErrors: FieldError[] = [],
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.requestId = requestId;
  }

  /** Field errors keyed by path, ready for react-hook-form's setError. */
  get byField(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const error of this.fieldErrors) {
      map[error.path] ??= error.message;
    }
    return map;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

const readCsrfToken = (): string | null => {
  if (typeof document === 'undefined') return null;

  const match = document.cookie
    .split('; ')
    .find((entry) => entry.startsWith(`${CSRF_COOKIE}=`));

  return match ? decodeURIComponent(match.slice(CSRF_COOKIE.length + 1)) : null;
};

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Returned alongside the data when the caller needs pagination info. */
  withMeta?: boolean;
};

type Envelope<T> = {
  data?: T;
  meta?: Record<string, unknown>;
  error?: { code: string; message: string; fieldErrors?: FieldError[]; requestId: string };
};

const request = async <T,>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T; meta: Record<string, unknown> | undefined }> => {
  const method = options.method ?? 'GET';

  const headers: Record<string, string> = { Accept: 'application/json' };

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  if (method !== 'GET') {
    const token = readCsrfToken();
    if (token) headers[CSRF_HEADER] = token;
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers,
      // Same-origin only: the session cookie must never be sent cross-site.
      credentials: 'same-origin',
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    // A network failure is not an HTTP status, so give it one the UI can branch on.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'Could not reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 204) {
    return { data: undefined as T, meta: undefined };
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (response.ok) return { data: undefined as T, meta: undefined };
    throw new ApiError(
      response.status,
      'UNEXPECTED_RESPONSE',
      'The server returned an unexpected response.',
      [],
      response.headers.get('x-request-id') ?? undefined,
    );
  }

  const payload = (await response.json()) as Envelope<T>;

  if (!response.ok || payload.error) {
    const error = payload.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? 'The request could not be completed.',
      error?.fieldErrors ?? [],
      error?.requestId ?? response.headers.get('x-request-id') ?? undefined,
    );
  }

  return { data: payload.data as T, meta: payload.meta };
};

export const api = {
  get: async <T,>(path: string, signal?: AbortSignal): Promise<T> =>
    (await request<T>(path, signal ? { signal } : {})).data,

  /** GET that also returns the pagination/meta block. */
  getWithMeta: async <T,>(
    path: string,
    signal?: AbortSignal,
  ): Promise<{ data: T; meta: Record<string, unknown> | undefined }> =>
    request<T>(path, signal ? { signal } : {}),

  post: async <T,>(path: string, body?: unknown): Promise<T> =>
    (await request<T>(path, { method: 'POST', body })).data,

  patch: async <T,>(path: string, body?: unknown): Promise<T> =>
    (await request<T>(path, { method: 'PATCH', body })).data,

  put: async <T,>(path: string, body?: unknown): Promise<T> =>
    (await request<T>(path, { method: 'PUT', body })).data,

  delete: async <T,>(path: string): Promise<T> =>
    (await request<T>(path, { method: 'DELETE' })).data,
};

/** Turns any thrown value into a message safe to show a user. */
export const toErrorMessage = (error: unknown): string => {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Something went wrong. Please try again.';
};
