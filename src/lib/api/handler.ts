import type { NextRequest, NextResponse } from 'next/server';

import { assertCsrfToken, assertSameOrigin, isSafeMethod } from '../csrf';
import { isProduction } from '../env';
import { logger } from '../logger';
import { getClientInfo, type ClientInfo } from '../request';

import { isAppError, mapPrismaError } from './errors';
import { jsonError } from './responses';

/**
 * The single entry point for every API route.
 *
 * Centralising this means no route can forget CSRF validation, error mapping or
 * request logging. Handlers are left to do one thing: authorize, then act.
 *
 * Responsibilities, in order:
 *  1. Collect request metadata (IP, user agent, request id).
 *  2. For mutating methods, verify the request origin and the CSRF token.
 *  3. Run the handler.
 *  4. Translate any thrown error into the standard failure envelope, logging
 *     5xx responses with full context and 4xx at debug level.
 */

export type ApiHandlerContext<TParams> = {
  request: NextRequest;
  params: TParams;
  client: ClientInfo;
  searchParams: URLSearchParams;
};

export type ApiHandler<TParams> = (
  context: ApiHandlerContext<TParams>,
) => Promise<Response | NextResponse>;

export type WithApiOptions = {
  /**
   * Set to false for endpoints that must accept a cross-origin or
   * non-browser caller (for example the Entra ID redirect callback, which
   * arrives as a top-level navigation from Microsoft).
   */
  csrf?: boolean;
};

type RouteContext<TParams> = { params: Promise<TParams> };

export const withApi = <TParams = Record<string, never>>(
  handler: ApiHandler<TParams>,
  options: WithApiOptions = {},
) => {
  return async (request: NextRequest, context?: RouteContext<TParams>): Promise<Response> => {
    const client = getClientInfo(request);
    const started = Date.now();

    try {
      if (!isSafeMethod(request.method) && options.csrf !== false) {
        assertSameOrigin(request);
        await assertCsrfToken(request);
      }

      const params = (context ? await context.params : ({} as TParams)) as TParams;

      const response = await handler({
        request,
        params,
        client,
        searchParams: new URL(request.url).searchParams,
      });

      response.headers.set('x-request-id', client.requestId);
      return response;
    } catch (error) {
      return toErrorResponse(error, client, {
        method: request.method,
        path: new URL(request.url).pathname,
        durationMs: Date.now() - started,
      });
    }
  };
};

const toErrorResponse = (
  error: unknown,
  client: ClientInfo,
  context: Record<string, unknown>,
): Response => {
  const appError = isAppError(error) ? error : mapPrismaError(error);

  if (appError) {
    const headers: Record<string, string> = { 'x-request-id': client.requestId };
    if (appError.retryAfter !== undefined) {
      headers['Retry-After'] = String(appError.retryAfter);
    }

    if (appError.status >= 500) {
      logger.error(appError.message, {
        ...context,
        requestId: client.requestId,
        code: appError.code,
        ...(appError.logContext ?? {}),
        stack: appError.stack,
      });
    } else {
      logger.debug(`${appError.code}: ${appError.message}`, {
        ...context,
        requestId: client.requestId,
        ...(appError.logContext ?? {}),
      });
    }

    return jsonError(
      appError.status,
      {
        code: appError.code,
        message: appError.message,
        ...(appError.fieldErrors ? { fieldErrors: appError.fieldErrors } : {}),
        requestId: client.requestId,
      },
      headers,
    );
  }

  // Anything reaching here is unexpected. Log everything, return nothing
  // specific: an internal message or stack trace must never reach the client.
  logger.error('Unhandled error in API route', {
    ...context,
    requestId: client.requestId,
    error: error instanceof Error ? { name: error.name, message: error.message } : error,
    stack: error instanceof Error ? error.stack : undefined,
  });

  return jsonError(
    500,
    {
      code: 'INTERNAL_ERROR',
      message: isProduction
        ? 'Something went wrong on our side. Please try again.'
        : `Unhandled server error: ${error instanceof Error ? error.message : String(error)}`,
      requestId: client.requestId,
    },
    { 'x-request-id': client.requestId },
  );
};
