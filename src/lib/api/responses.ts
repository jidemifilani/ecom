import { NextResponse } from 'next/server';

import type { ErrorCode, FieldError } from './errors';

/**
 * Every API response uses one of exactly two envelopes, so clients never have
 * to guess at the shape:
 *
 *   success -> { data, meta? }
 *   failure -> { error: { code, message, fieldErrors?, requestId } }
 */

export type PageMeta = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

export type ApiSuccess<T> = {
  data: T;
  meta?: PageMeta & Record<string, unknown>;
};

export type ApiFailure = {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: FieldError[];
    requestId: string;
  };
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

const noStore = { 'Cache-Control': 'no-store, max-age=0' } as const;

export const jsonOk = <T,>(
  data: T,
  init?: { meta?: ApiSuccess<T>['meta']; status?: number; headers?: HeadersInit },
): NextResponse<ApiSuccess<T>> =>
  NextResponse.json<ApiSuccess<T>>(
    init?.meta ? { data, meta: init.meta } : { data },
    {
      status: init?.status ?? 200,
      headers: { ...noStore, ...(init?.headers ?? {}) },
    },
  );

export const jsonCreated = <T,>(data: T, location?: string): NextResponse<ApiSuccess<T>> =>
  jsonOk(data, {
    status: 201,
    headers: location ? { Location: location } : undefined,
  });

export const jsonNoContent = (): NextResponse =>
  new NextResponse(null, { status: 204, headers: noStore });

export const jsonError = (
  status: number,
  body: ApiFailure['error'],
  headers?: HeadersInit,
): NextResponse<ApiFailure> =>
  NextResponse.json<ApiFailure>(
    { error: body },
    { status, headers: { ...noStore, ...(headers ?? {}) } },
  );

export const buildPageMeta = (page: number, pageSize: number, total: number): PageMeta => {
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
  return {
    page,
    pageSize,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrevious: page > 1,
  };
};

/** Shape returned by every list service, so the route layer stays uniform. */
export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export const jsonPaginated = <T,>(
  result: Paginated<T>,
  extraMeta?: Record<string, unknown>,
): NextResponse<ApiSuccess<T[]>> =>
  jsonOk(result.items, {
    meta: { ...buildPageMeta(result.page, result.pageSize, result.total), ...extraMeta },
  });
