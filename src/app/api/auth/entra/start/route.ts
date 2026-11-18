import { NextResponse, type NextRequest } from 'next/server';

import { sign } from '@/lib/auth/tokens';
import {
  ENTRA_STATE_COOKIE,
  buildAuthorizationUrl,
  createTransaction,
  isEntraEnabled,
  transactionCookieOptions,
} from '@/lib/auth/entra';
import { logger } from '@/lib/logger';

/**
 * GET /api/auth/entra/start
 *
 * Begins the Entra ID sign-in. The transaction (state, nonce, PKCE verifier,
 * return path) is stored in a short-lived httpOnly cookie, signed with
 * AUTH_SECRET so it cannot be tampered with in transit.
 *
 * This is a top-level navigation, not an API call, so it redirects rather than
 * returning JSON and is exempt from the CSRF token check. The `state` cookie is
 * what protects the flow.
 */
export const GET = async (request: NextRequest): Promise<NextResponse> => {
  if (!isEntraEnabled()) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '?error=sso_unavailable';
    return NextResponse.redirect(url);
  }

  // Only same-origin relative paths are honoured, so `next` cannot be used to
  // bounce the user to another site after a successful login.
  const requested = request.nextUrl.searchParams.get('next') ?? '/dashboard';
  const returnTo = requested.startsWith('/') && !requested.startsWith('//')
    ? requested
    : '/dashboard';

  const transaction = createTransaction(returnTo);

  try {
    const authorizeUrl = buildAuthorizationUrl(transaction);
    const response = NextResponse.redirect(authorizeUrl);

    const payload = JSON.stringify(transaction);
    const encoded = Buffer.from(payload, 'utf8').toString('base64url');
    response.cookies.set(
      ENTRA_STATE_COOKIE,
      `${encoded}.${sign(encoded)}`,
      transactionCookieOptions,
    );

    return response;
  } catch (error) {
    logger.error('Failed to start Entra sign-in', { error });
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '?error=sso_unavailable';
    return NextResponse.redirect(url);
  }
};
