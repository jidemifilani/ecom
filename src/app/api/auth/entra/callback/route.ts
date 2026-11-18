import { NextResponse, type NextRequest } from 'next/server';

import { recordAudit } from '@/lib/audit';
import {
  ENTRA_STATE_COOKIE,
  completeEntraLogin,
  isEntraEnabled,
  type EntraTransaction,
} from '@/lib/auth/entra';
import { createSession, setSessionCookie } from '@/lib/auth/session';
import { verifySignature } from '@/lib/auth/tokens';
import { logger } from '@/lib/logger';
import { getClientInfo } from '@/lib/request';
import { SessionScope } from '@/generated/prisma/enums';

/**
 * GET /api/auth/entra/callback
 *
 * Completes the Entra ID sign-in. Every step that could be forged is checked:
 * the signed transaction cookie, the `state` match, the PKCE verifier, and the
 * id_token's signature, issuer, audience and nonce.
 *
 * Failures redirect to /login with a generic code rather than rendering an
 * error, because this URL is reached by browser navigation.
 */

const failTo = (request: NextRequest, code: string): NextResponse => {
  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = `?error=${encodeURIComponent(code)}`;
  const response = NextResponse.redirect(url);
  response.cookies.delete(ENTRA_STATE_COOKIE);
  return response;
};

const readTransaction = (raw: string | undefined): EntraTransaction | null => {
  if (!raw) return null;

  const separator = raw.lastIndexOf('.');
  if (separator <= 0) return null;

  const encoded = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);

  if (!verifySignature(encoded, signature)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as EntraTransaction).state !== 'string' ||
      typeof (parsed as EntraTransaction).nonce !== 'string' ||
      typeof (parsed as EntraTransaction).codeVerifier !== 'string'
    ) {
      return null;
    }
    return parsed as EntraTransaction;
  } catch {
    return null;
  }
};

export const GET = async (request: NextRequest): Promise<NextResponse> => {
  if (!isEntraEnabled()) return failTo(request, 'sso_unavailable');

  const params = request.nextUrl.searchParams;

  if (params.get('error')) {
    logger.warn('Entra returned an error on callback', {
      error: params.get('error'),
      description: params.get('error_description'),
    });
    return failTo(request, 'sso_denied');
  }

  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return failTo(request, 'sso_invalid');

  const transaction = readTransaction(request.cookies.get(ENTRA_STATE_COOKIE)?.value);
  if (!transaction) return failTo(request, 'sso_expired');

  // The state in the URL must match the state we issued to this browser.
  if (transaction.state !== state) return failTo(request, 'sso_state_mismatch');

  const client = getClientInfo(request);

  try {
    const result = await completeEntraLogin(code, transaction);

    const session = await createSession(
      { scope: 'STAFF', userId: result.userId },
      { ipAddress: client.ipAddress, userAgent: client.userAgent },
    );

    await recordAudit({
      actor: { userId: result.userId, email: result.email },
      action: 'LOGIN',
      entityType: 'User',
      entityId: result.userId,
      entityLabel: result.email,
      after: { provider: 'ENTRA_ID', provisioned: result.provisioned },
      ipAddress: client.ipAddress ?? null,
      userAgent: client.userAgent ?? null,
      requestId: client.requestId,
    });

    const url = request.nextUrl.clone();
    url.search = '';
    // A freshly provisioned SSO user holds no roles yet, so sending them to the
    // dashboard would show an empty shell. Explain the state instead.
    url.pathname = result.hasRoles ? transaction.returnTo : '/no-access';

    const response = NextResponse.redirect(url);
    response.cookies.delete(ENTRA_STATE_COOKIE);
    setSessionCookie(response.cookies, SessionScope.STAFF, session.token, session.expiresAt);

    return response;
  } catch (error) {
    logger.error('Entra sign-in failed', {
      error: error instanceof Error ? error.message : error,
    });
    return failTo(request, 'sso_failed');
  }
};
