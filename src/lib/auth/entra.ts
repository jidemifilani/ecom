import { createHash, randomBytes } from 'node:crypto';

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';

import { ForbiddenError, PreconditionFailedError } from '../api/errors';
import { db } from '../db';
import { entraAllowedDomains, isProduction, serverEnv } from '../env';
import { logger } from '../logger';
import { normalizeEmail } from '../utils';
import { AuthProvider, UserStatus } from '@/generated/prisma/enums';

/**
 * Optional Microsoft Entra ID single sign-on.
 *
 * Standard OIDC authorization-code flow with PKCE. The security-relevant
 * details:
 *  * `state` is bound to a short-lived httpOnly cookie, which is what stops an
 *    attacker from completing a login in the victim's browser (login CSRF).
 *  * `nonce` is echoed in the id_token and compared, binding the token to this
 *    specific authorization request.
 *  * The id_token signature is verified against the tenant's published JWKS,
 *    and the issuer and audience are both checked. An unverified id_token is
 *    just a JSON blob the caller chose.
 *  * SSO never creates a new account with privileges. A first-time user is
 *    provisioned with no roles and must be granted access by an administrator,
 *    so a valid tenant account is not automatically a back-office account.
 */

export const ENTRA_STATE_COOKIE = 'ecom_entra_tx';

export const isEntraEnabled = (): boolean =>
  serverEnv.AUTH_ENTRA_ENABLED &&
  Boolean(serverEnv.ENTRA_TENANT_ID) &&
  Boolean(serverEnv.ENTRA_CLIENT_ID) &&
  Boolean(serverEnv.ENTRA_CLIENT_SECRET);

const assertEnabled = (): void => {
  if (!isEntraEnabled()) {
    throw new PreconditionFailedError('Microsoft sign-in is not configured for this installation.');
  }
};

const tenantBase = (): string =>
  `https://login.microsoftonline.com/${serverEnv.ENTRA_TENANT_ID}/v2.0`;

const redirectUri = (): string =>
  serverEnv.ENTRA_REDIRECT_URI ?? `${serverEnv.APP_URL}/api/auth/entra/callback`;

const base64Url = (input: Buffer): string => input.toString('base64url');

export type EntraTransaction = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
};

export const createTransaction = (returnTo: string): EntraTransaction => ({
  state: base64Url(randomBytes(24)),
  nonce: base64Url(randomBytes(24)),
  codeVerifier: base64Url(randomBytes(48)),
  returnTo,
});

export const transactionCookieOptions = {
  httpOnly: true,
  secure: isProduction,
  // The callback is a top-level cross-site GET from Microsoft, which `strict`
  // would strip the cookie from, breaking the state check entirely.
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 600,
};

export const buildAuthorizationUrl = (transaction: EntraTransaction): string => {
  assertEnabled();

  const challenge = base64Url(
    createHash('sha256').update(transaction.codeVerifier, 'utf8').digest(),
  );

  const params = new URLSearchParams({
    client_id: serverEnv.ENTRA_CLIENT_ID ?? '',
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: 'openid profile email',
    state: transaction.state,
    nonce: transaction.nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return `${tenantBase()}/authorize?${params.toString()}`;
};

type TokenResponse = {
  id_token?: string;
  access_token?: string;
  error?: string;
  error_description?: string;
};

const exchangeCode = async (code: string, codeVerifier: string): Promise<string> => {
  const body = new URLSearchParams({
    client_id: serverEnv.ENTRA_CLIENT_ID ?? '',
    client_secret: serverEnv.ENTRA_CLIENT_SECRET ?? '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(),
    code_verifier: codeVerifier,
    scope: 'openid profile email',
  });

  const response = await fetch(`${tenantBase()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const payload = (await response.json()) as TokenResponse;

  if (!response.ok || !payload.id_token) {
    logger.error('Entra token exchange failed', {
      status: response.status,
      error: payload.error,
      description: payload.error_description,
    });
    throw new ForbiddenError('Microsoft sign-in could not be completed. Please try again.');
  }

  return payload.id_token;
};

// Cached across requests: the JWKS is fetched once and refreshed by `jose`.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

const getJwks = (): ReturnType<typeof createRemoteJWKSet> => {
  jwks ??= createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${serverEnv.ENTRA_TENANT_ID}/discovery/v2.0/keys`),
  );
  return jwks;
};

export type EntraIdentity = {
  objectId: string;
  email: string;
  firstName: string;
  lastName: string;
};

type EntraClaims = JWTPayload & {
  oid?: string;
  nonce?: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
};

export const verifyIdToken = async (
  idToken: string,
  expectedNonce: string,
): Promise<EntraIdentity> => {
  const { payload } = await jwtVerify(idToken, getJwks(), {
    issuer: `https://login.microsoftonline.com/${serverEnv.ENTRA_TENANT_ID}/v2.0`,
    audience: serverEnv.ENTRA_CLIENT_ID ?? '',
    clockTolerance: 60,
  });

  const claims = payload as EntraClaims;

  if (!claims.nonce || claims.nonce !== expectedNonce) {
    throw new ForbiddenError('Microsoft sign-in could not be verified. Please try again.');
  }

  const objectId = claims.oid ?? claims.sub;
  if (!objectId) {
    throw new ForbiddenError('Microsoft did not return a usable account identifier.');
  }

  const rawEmail = claims.email ?? claims.preferred_username;
  if (!rawEmail || !rawEmail.includes('@')) {
    throw new ForbiddenError(
      'Your Microsoft account did not include an email address, which is required to sign in.',
    );
  }

  const email = normalizeEmail(rawEmail);

  const allowed = entraAllowedDomains();
  if (allowed.length > 0) {
    const domain = email.split('@')[1] ?? '';
    if (!allowed.includes(domain)) {
      throw new ForbiddenError('Your Microsoft account domain is not permitted to sign in here.');
    }
  }

  // Fall back to splitting `name` when the tenant does not release the
  // granular claims.
  const nameParts = (claims.name ?? '').trim().split(/\s+/);
  const firstName = claims.given_name ?? nameParts[0] ?? email.split('@')[0] ?? 'User';
  const lastName = claims.family_name ?? (nameParts.length > 1 ? nameParts.slice(1).join(' ') : '-');

  return { objectId, email, firstName, lastName: lastName || '-' };
};

export const completeEntraLogin = async (
  code: string,
  transaction: EntraTransaction,
): Promise<{ userId: string; email: string; provisioned: boolean; hasRoles: boolean }> => {
  assertEnabled();

  const idToken = await exchangeCode(code, transaction.codeVerifier);
  const identity = await verifyIdToken(idToken, transaction.nonce);

  // Match on the stable object id first; fall back to email so an existing
  // password account can be linked rather than duplicated.
  const existing =
    (await db.user.findFirst({
      where: { externalId: identity.objectId },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        _count: { select: { roles: true } },
      },
    })) ??
    (await db.user.findFirst({
      where: { email: identity.email },
      select: {
        id: true,
        email: true,
        status: true,
        deletedAt: true,
        _count: { select: { roles: true } },
      },
    }));

  if (existing) {
    if (existing.deletedAt) {
      throw new ForbiddenError('That account has been archived. Contact an administrator.');
    }
    if (existing.status === UserStatus.SUSPENDED) {
      throw new ForbiddenError('That account has been suspended. Contact an administrator.');
    }

    await db.user.update({
      where: { id: existing.id },
      data: {
        externalId: identity.objectId,
        authProvider: AuthProvider.ENTRA_ID,
        emailVerifiedAt: new Date(),
        firstName: identity.firstName,
        lastName: identity.lastName,
        ...(existing.status === UserStatus.INVITED ? { status: UserStatus.ACTIVE } : {}),
      },
    });

    return {
      userId: existing.id,
      email: existing.email,
      provisioned: false,
      hasRoles: existing._count.roles > 0,
    };
  }

  // First sign-in: provision with no roles. The user can authenticate but
  // cannot see or do anything until an administrator grants a role.
  const created = await db.user.create({
    data: {
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
      externalId: identity.objectId,
      authProvider: AuthProvider.ENTRA_ID,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date(),
      passwordHash: null,
      mustChangePassword: false,
    },
    select: { id: true, email: true },
  });

  logger.info('Provisioned a new user from Entra ID with no roles', { userId: created.id });

  return { userId: created.id, email: created.email, provisioned: true, hasRoles: false };
};
