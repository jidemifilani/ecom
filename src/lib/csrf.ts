import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

import { ForbiddenError } from './api/errors';
import { isProduction, serverEnv } from './env';
import { generateToken, safeEqual } from './auth/tokens';

/**
 * CSRF protection, in two independent layers.
 *
 * 1. Origin / Referer check. For any state-changing request the browser-sent
 *    origin must match the configured APP_URL. This is the primary defence and
 *    is what OWASP recommends for cookie-authenticated APIs.
 * 2. Double-submit token. A random value is stored in a readable cookie and
 *    must be echoed in the `x-csrf-token` header. An attacker on another origin
 *    cannot read the cookie, so they cannot produce a matching header.
 *
 * Session cookies are additionally `SameSite=Lax`, which already stops
 * cross-site form posts. All three must fail before a forgery can land.
 */

export const CSRF_COOKIE = 'ecom_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const isSafeMethod = (method: string): boolean => SAFE_METHODS.has(method.toUpperCase());

const originOf = (value: string | null): string | null => {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

/** Throws a 403 when a mutating request did not come from this application. */
export const assertSameOrigin = (request: Request): void => {
  if (isSafeMethod(request.method)) return;

  // Primary expected origin: the configured APP_URL.
  const configuredOrigin = new URL(serverEnv.APP_URL).origin;

  // Secondary expected origin: derived from the Host header of this very
  // request, using the same scheme as APP_URL. This keeps the check working
  // when Next.js picks a different port than APP_URL names (e.g. 3001/3002
  // because 3000 is busy) and when the server sits behind a reverse proxy
  // that terminates TLS. The security property is preserved: an attacker on
  // a different origin cannot spoof the Host header of a same-origin request.
  const hostHeader = request.headers.get('host');
  const scheme = serverEnv.APP_URL.startsWith('https') ? 'https' : 'http';
  const hostDerivedOrigin = hostHeader ? `${scheme}://${hostHeader}` : null;

  const origin = originOf(request.headers.get('origin'));
  const referer = originOf(request.headers.get('referer'));
  const actual = origin ?? referer;

  if (actual === null) {
    // A browser always sends Origin on cross-origin mutating requests. A
    // missing value means a non-browser client, which must authenticate per
    // request rather than ride on a session cookie.
    throw new ForbiddenError('This request is missing its origin and was rejected.');
  }

  if (actual !== configuredOrigin && actual !== hostDerivedOrigin) {
    throw new ForbiddenError('This request came from an unrecognised origin.');
  }
};

export const getCsrfToken = async (): Promise<string | null> => {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? null;
};

/** Issues a CSRF token if the visitor does not already have one. */
export const ensureCsrfCookie = async (): Promise<string> => {
  const existing = await getCsrfToken();
  if (existing) return existing;

  const token = generateToken(24);
  const store = await cookies();
  store.set(CSRF_COOKIE, token, {
    // Deliberately readable by client JavaScript: that is how the token gets
    // echoed back in the request header. It is not a credential on its own.
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
  return token;
};

export const setCsrfCookie = (target: Pick<NextResponse['cookies'], 'set'>, token: string): void => {
  target.set(CSRF_COOKIE, token, {
    httpOnly: false,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 12,
  });
};

/** Verifies the double-submit token on a mutating request. */
export const assertCsrfToken = async (request: Request): Promise<void> => {
  if (isSafeMethod(request.method)) return;

  const header = request.headers.get(CSRF_HEADER);
  const cookie = await getCsrfToken();

  if (!header || !cookie) {
    throw new ForbiddenError(
      'Your session security token is missing. Refresh the page and try again.',
    );
  }

  if (!safeEqual(header, cookie)) {
    throw new ForbiddenError(
      'Your session security token did not match. Refresh the page and try again.',
    );
  }
};
