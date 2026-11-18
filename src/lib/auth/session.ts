import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

import { db } from '../db';
import { isProduction, serverEnv } from '../env';
import { logger } from '../logger';
import { SessionScope } from '@/generated/prisma/enums';

import { generateToken, hashToken } from './tokens';

/**
 * Server-side session store.
 *
 * The cookie holds a random opaque token; the database holds only its SHA-256
 * hash. Sessions carry both a sliding idle expiry and an absolute ceiling, and
 * can be revoked individually or in bulk (used by "sign out everywhere", by
 * password changes, and by account suspension).
 *
 * Staff and shopper sessions use different cookies so the two scopes never
 * blur into one another.
 */

export const STAFF_SESSION_COOKIE = 'ecom_session';
export const CUSTOMER_SESSION_COOKIE = 'ecom_shop_session';

export const cookieNameFor = (scope: SessionScope): string =>
  scope === SessionScope.STAFF ? STAFF_SESSION_COOKIE : CUSTOMER_SESSION_COOKIE;

export type SessionPrincipal =
  | { scope: 'STAFF'; userId: string }
  | { scope: 'CUSTOMER'; customerId: string };

export type RequestContext = {
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
};

export type CreatedSession = {
  id: string;
  token: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
};

const idleMs = () => serverEnv.SESSION_IDLE_TIMEOUT_SECONDS * 1000;
const absoluteMs = () => serverEnv.SESSION_ABSOLUTE_TIMEOUT_SECONDS * 1000;

export const createSession = async (
  principal: SessionPrincipal,
  context: RequestContext = {},
): Promise<CreatedSession> => {
  const token = generateToken(32);
  const now = Date.now();
  const expiresAt = new Date(now + idleMs());
  const absoluteExpiresAt = new Date(now + absoluteMs());

  const session = await db.session.create({
    data: {
      tokenHash: hashToken(token),
      scope: principal.scope === 'STAFF' ? SessionScope.STAFF : SessionScope.CUSTOMER,
      userId: principal.scope === 'STAFF' ? principal.userId : null,
      customerId: principal.scope === 'CUSTOMER' ? principal.customerId : null,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent?.slice(0, 512) ?? null,
      expiresAt,
      absoluteExpiresAt,
    },
    select: { id: true },
  });

  return { id: session.id, token, expiresAt, absoluteExpiresAt };
};

export type ValidatedSession = {
  sessionId: string;
  scope: SessionScope;
  userId: string | null;
  customerId: string | null;
  expiresAt: Date;
};

/**
 * Looks up a session by its raw token and, if still valid, slides the idle
 * expiry forward. Returns null for anything unusable (unknown, revoked,
 * idle-expired or past its absolute ceiling).
 */
export const validateSessionToken = async (
  token: string,
  scope: SessionScope,
): Promise<ValidatedSession | null> => {
  if (token.length < 16) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      scope: true,
      userId: true,
      customerId: true,
      expiresAt: true,
      absoluteExpiresAt: true,
      revokedAt: true,
      lastSeenAt: true,
    },
  });

  if (!session || session.scope !== scope) return null;
  if (session.revokedAt) return null;

  const now = new Date();
  if (session.expiresAt <= now || session.absoluteExpiresAt <= now) return null;

  // Slide the idle window, but never past the absolute ceiling. Writing on
  // every request would be wasteful, so only refresh once a minute.
  const nextExpiry = new Date(
    Math.min(now.getTime() + idleMs(), session.absoluteExpiresAt.getTime()),
  );
  const shouldTouch = now.getTime() - session.lastSeenAt.getTime() > 60_000;

  if (shouldTouch) {
    await db.session
      .update({
        where: { id: session.id },
        data: { lastSeenAt: now, expiresAt: nextExpiry },
      })
      .catch((error: unknown) => {
        // A failed touch must not break the request; the session is still valid.
        logger.warn('Failed to refresh session expiry', { sessionId: session.id, error });
      });
  }

  return {
    sessionId: session.id,
    scope: session.scope,
    userId: session.userId,
    customerId: session.customerId,
    expiresAt: nextExpiry,
  };
};

export const readSessionToken = async (scope: SessionScope): Promise<string | null> => {
  const store = await cookies();
  return store.get(cookieNameFor(scope))?.value ?? null;
};

type CookieTarget = Pick<NextResponse['cookies'], 'set' | 'delete'>;

const cookieOptions = (expiresAt: Date) =>
  ({
    httpOnly: true,
    secure: isProduction,
    // `lax` rather than `strict`: the Entra ID redirect returns via a top-level
    // GET navigation, which `strict` would strip the cookie from.
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  }) satisfies Parameters<CookieTarget['set']>[2];

/** Attaches the session cookie to an outgoing response. */
export const setSessionCookie = (
  target: CookieTarget,
  scope: SessionScope,
  token: string,
  expiresAt: Date,
): void => {
  target.set(cookieNameFor(scope), token, cookieOptions(expiresAt));
};

export const clearSessionCookie = (target: CookieTarget, scope: SessionScope): void => {
  target.set(cookieNameFor(scope), '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
};

export const revokeSessionByToken = async (token: string, reason: string): Promise<void> => {
  await db.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 120) },
  });
};

export const revokeSessionById = async (sessionId: string, reason: string): Promise<void> => {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 120) },
  });
};

/** Revokes every session for a staff user. Used on password change, suspension and forced sign-out. */
export const revokeAllUserSessions = async (
  userId: string,
  reason: string,
  options?: { exceptSessionId?: string },
): Promise<number> => {
  const result = await db.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(options?.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 120) },
  });
  return result.count;
};

export const revokeAllCustomerSessions = async (
  customerId: string,
  reason: string,
  options?: { exceptSessionId?: string },
): Promise<number> => {
  const result = await db.session.updateMany({
    where: {
      customerId,
      revokedAt: null,
      ...(options?.exceptSessionId ? { id: { not: options.exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date(), revokedReason: reason.slice(0, 120) },
  });
  return result.count;
};

/** Housekeeping: drop rows that can no longer authenticate anyone. */
export const pruneExpiredSessions = async (): Promise<number> => {
  const result = await db.session.deleteMany({
    where: { absoluteExpiresAt: { lt: new Date() } },
  });
  return result.count;
};
