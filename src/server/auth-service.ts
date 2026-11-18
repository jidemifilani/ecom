import {
  ConflictError,
  ForbiddenError,
  PreconditionFailedError,
  UnauthenticatedError,
  ValidationError,
} from '@/lib/api/errors';
import { recordAudit } from '@/lib/audit';
import {
  burnPasswordComparison,
  checkPasswordPolicy,
  hashPassword,
  verifyPassword,
} from '@/lib/auth/password';
import {
  createSession,
  revokeAllCustomerSessions,
  revokeAllUserSessions,
  revokeSessionByToken,
  type CreatedSession,
  type RequestContext,
} from '@/lib/auth/session';
import { generateToken, hashToken } from '@/lib/auth/tokens';
import { db } from '@/lib/db';
import { serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { deliver, passwordResetEmail } from '@/lib/mailer';
import { enforceRateLimit, resetRateLimit } from '@/lib/rate-limit';
import { normalizeEmail } from '@/lib/utils';
import { CustomerStatus, SessionScope, UserStatus } from '@/generated/prisma/enums';

/**
 * Authentication flows.
 *
 * Decisions worth knowing about:
 *  * Failure messages never distinguish "no such account" from "wrong
 *    password", and an unknown email still pays the cost of a bcrypt compare,
 *    so neither the message nor the timing enumerates accounts.
 *  * Lockout is per account (`failedLoginCount` / `lockedUntil`) and rate
 *    limiting is per account *and* per IP, so one attacker cannot lock out
 *    every user by guessing at their addresses.
 *  * Password resets are acknowledged identically whether or not the address
 *    exists.
 *  * Changing a password revokes other sessions by default, because a password
 *    change is usually a response to a suspected compromise.
 */

const RESET_TOKEN_TTL_MINUTES = 60;

/** Deliberately vague, and identical for every failure mode. */
const GENERIC_LOGIN_FAILURE = 'Those details do not match an account. Check them and try again.';

export type StaffLoginResult = {
  userId: string;
  email: string;
  firstName: string;
  mustChangePassword: boolean;
  session: CreatedSession;
};

const recordLoginAttempt = async (
  email: string,
  scope: SessionScope,
  successful: boolean,
  reason: string | null,
  context: RequestContext,
): Promise<void> => {
  await db.loginAttempt
    .create({
      data: {
        email: email.slice(0, 255),
        scope,
        successful,
        reason: reason?.slice(0, 64) ?? null,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent?.slice(0, 512) ?? null,
      },
    })
    .catch((error: unknown) => {
      logger.warn('Failed to record login attempt', { error });
    });
};

export const authenticateStaff = async (
  input: { email: string; password: string },
  context: RequestContext,
): Promise<StaffLoginResult> => {
  const email = normalizeEmail(input.email);

  // Per-account and per-IP buckets. The IP bucket is more generous so a shared
  // office address is not throttled by one colleague's typos.
  await enforceRateLimit('login', email);
  if (context.ipAddress) await enforceRateLimit('login-ip', context.ipAddress);

  const user = await db.user.findFirst({
    where: { email, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      status: true,
      passwordHash: true,
      mustChangePassword: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });

  if (!user || !user.passwordHash) {
    // Spend the same time as a real comparison before failing.
    await burnPasswordComparison(input.password);
    await recordLoginAttempt(email, SessionScope.STAFF, false, 'unknown_account', context);
    throw new UnauthenticatedError(GENERIC_LOGIN_FAILURE);
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000));
    await recordLoginAttempt(email, SessionScope.STAFF, false, 'locked', context);
    throw new ForbiddenError(
      `This account is temporarily locked after too many failed attempts. Try again in ${minutes} minute(s), or reset your password.`,
    );
  }

  const passwordMatches = await verifyPassword(input.password, user.passwordHash);

  if (!passwordMatches) {
    const attempts = user.failedLoginCount + 1;
    const shouldLock = attempts >= serverEnv.LOGIN_MAX_ATTEMPTS;

    await db.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + serverEnv.LOGIN_LOCKOUT_SECONDS * 1000)
          : null,
      },
    });

    await recordLoginAttempt(
      email,
      SessionScope.STAFF,
      false,
      shouldLock ? 'bad_password_locked' : 'bad_password',
      context,
    );

    await recordAudit({
      actor: { userId: user.id, email: user.email },
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.email,
      after: { failedAttempts: attempts, locked: shouldLock },
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    });

    throw new UnauthenticatedError(GENERIC_LOGIN_FAILURE);
  }

  // Password is correct. Status is checked only now, so a wrong password on a
  // suspended account still reports the generic failure.
  if (user.status !== UserStatus.ACTIVE && user.status !== UserStatus.INVITED) {
    await recordLoginAttempt(email, SessionScope.STAFF, false, 'inactive', context);
    throw new ForbiddenError(
      'This account has been suspended. Contact an administrator for access.',
    );
  }

  const session = await createSession({ scope: 'STAFF', userId: user.id }, context);

  await db.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now,
      lastLoginIp: context.ipAddress ?? null,
      // An INVITED account becomes ACTIVE on its first successful sign-in.
      ...(user.status === UserStatus.INVITED ? { status: UserStatus.ACTIVE } : {}),
    },
  });

  await Promise.all([
    resetRateLimit('login', email),
    recordLoginAttempt(email, SessionScope.STAFF, true, null, context),
    recordAudit({
      actor: { userId: user.id, email: user.email },
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      entityLabel: user.email,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
    }),
  ]);

  return {
    userId: user.id,
    email: user.email,
    firstName: user.firstName,
    mustChangePassword: user.mustChangePassword,
    session,
  };
};

export const logoutStaff = async (
  token: string,
  actor: { id: string; email: string },
  context: RequestContext,
): Promise<void> => {
  await revokeSessionByToken(token, 'Signed out');
  await recordAudit({
    actor: { userId: actor.id, email: actor.email },
    action: 'LOGOUT',
    entityType: 'User',
    entityId: actor.id,
    entityLabel: actor.email,
    ipAddress: context.ipAddress ?? null,
    userAgent: context.userAgent ?? null,
  });
};

// ── Password reset ───────────────────────────────────────────────────────────

/**
 * Starts a reset. Always resolves, whether or not the address is registered -
 * the response must not reveal which addresses exist.
 */
export const requestPasswordReset = async (
  email: string,
  scope: SessionScope,
  context: RequestContext,
): Promise<void> => {
  const normalized = normalizeEmail(email);

  await enforceRateLimit('password-forgot', normalized);
  if (context.ipAddress) {
    await enforceRateLimit('password-forgot', `ip:${context.ipAddress}`, { limit: 15 });
  }

  const principal =
    scope === SessionScope.STAFF
      ? await db.user.findFirst({
          where: { email: normalized, deletedAt: null, status: { not: UserStatus.SUSPENDED } },
          select: { id: true, firstName: true, email: true },
        })
      : await db.customer.findFirst({
          where: { email: normalized, deletedAt: null, status: CustomerStatus.ACTIVE },
          select: { id: true, firstName: true, email: true },
        });

  if (!principal) {
    logger.info('Password reset requested for unknown address', { scope });
    return;
  }

  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MINUTES * 60 * 1000);

  await db.$transaction(async (tx) => {
    // Invalidate any outstanding tokens so only the newest link works.
    await tx.passwordResetToken.updateMany({
      where: {
        ...(scope === SessionScope.STAFF
          ? { userId: principal.id }
          : { customerId: principal.id }),
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });

    await tx.passwordResetToken.create({
      data: {
        tokenHash: hashToken(token),
        ...(scope === SessionScope.STAFF
          ? { userId: principal.id }
          : { customerId: principal.id }),
        expiresAt,
        requestedIp: context.ipAddress ?? null,
      },
    });

    await recordAudit(
      {
        actor:
          scope === SessionScope.STAFF
            ? { userId: principal.id, email: principal.email }
            : { userId: null, email: principal.email, type: 'CUSTOMER' },
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: scope === SessionScope.STAFF ? 'User' : 'Customer',
        entityId: principal.id,
        entityLabel: principal.email,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
      tx,
    );
  });

  const basePath = scope === SessionScope.STAFF ? '/reset-password' : '/account/reset-password';
  const resetUrl = `${serverEnv.APP_URL}${basePath}?token=${encodeURIComponent(token)}`;

  await deliver(
    passwordResetEmail(principal.firstName, resetUrl, RESET_TOKEN_TTL_MINUTES),
    principal.email,
  );
};

export const resetPassword = async (
  input: { token: string; password: string },
  scope: SessionScope,
  context: RequestContext,
): Promise<void> => {
  await enforceRateLimit('password-reset', context.ipAddress ?? 'unknown');

  const record = await db.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(input.token) },
    select: {
      id: true,
      userId: true,
      customerId: true,
      expiresAt: true,
      usedAt: true,
      user: { select: { id: true, email: true, firstName: true, lastName: true, deletedAt: true } },
      customer: {
        select: { id: true, email: true, firstName: true, lastName: true, deletedAt: true },
      },
    },
  });

  const invalid = new PreconditionFailedError(
    'That reset link is no longer valid. Request a new one.',
  );

  if (!record || record.usedAt || record.expiresAt <= new Date()) throw invalid;

  const isStaff = scope === SessionScope.STAFF;
  const principal = isStaff ? record.user : record.customer;
  if (!principal || principal.deletedAt) throw invalid;
  if (isStaff ? !record.userId : !record.customerId) throw invalid;

  const issues = checkPasswordPolicy(input.password, {
    email: principal.email,
    firstName: principal.firstName,
    lastName: principal.lastName,
  });
  if (issues.length > 0) {
    throw new ValidationError(
      issues.map((issue) => ({ path: 'password', message: `Your password needs: ${issue.toLowerCase()}.` })),
    );
  }

  const passwordHash = await hashPassword(input.password);

  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });

    if (isStaff) {
      await tx.user.update({
        where: { id: principal.id },
        data: {
          passwordHash,
          passwordSetAt: new Date(),
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
    } else {
      await tx.customer.update({
        where: { id: principal.id },
        data: {
          passwordHash,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
    }

    await recordAudit(
      {
        actor: isStaff
          ? { userId: principal.id, email: principal.email }
          : { userId: null, email: principal.email, type: 'CUSTOMER' },
        action: 'PASSWORD_RESET_COMPLETED',
        entityType: isStaff ? 'User' : 'Customer',
        entityId: principal.id,
        entityLabel: principal.email,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
      tx,
    );
  });

  // Every existing session is now suspect: the reset may have been triggered
  // because the account was compromised.
  if (isStaff) {
    await revokeAllUserSessions(principal.id, 'Password reset');
  } else {
    await revokeAllCustomerSessions(principal.id, 'Password reset');
  }
};

export const changeStaffPassword = async (
  userId: string,
  input: { currentPassword: string; password: string; revokeOtherSessions: boolean },
  context: RequestContext & { sessionId?: string | undefined },
): Promise<{ revokedSessions: number }> => {
  const user = await db.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      passwordHash: true,
    },
  });

  if (!user) throw new UnauthenticatedError();

  if (!user.passwordHash) {
    throw new PreconditionFailedError(
      'This account signs in with Microsoft Entra ID and has no password to change.',
    );
  }

  const matches = await verifyPassword(input.currentPassword, user.passwordHash);
  if (!matches) {
    throw new ValidationError([
      { path: 'currentPassword', message: 'That is not your current password.' },
    ]);
  }

  const issues = checkPasswordPolicy(input.password, {
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
  });
  if (issues.length > 0) {
    throw new ValidationError(
      issues.map((issue) => ({
        path: 'password',
        message: `Your password needs: ${issue.toLowerCase()}.`,
      })),
    );
  }

  const reused = await verifyPassword(input.password, user.passwordHash);
  if (reused) {
    throw new ValidationError([
      { path: 'password', message: 'Choose a password you have not used before.' },
    ]);
  }

  const passwordHash = await hashPassword(input.password);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        mustChangePassword: false,
      },
    });

    await recordAudit(
      {
        actor: { userId: user.id, email: user.email },
        action: 'PASSWORD_CHANGED',
        entityType: 'User',
        entityId: user.id,
        entityLabel: user.email,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
      },
      tx,
    );
  });

  let revokedSessions = 0;
  if (input.revokeOtherSessions) {
    revokedSessions = await revokeAllUserSessions(userId, 'Password changed', {
      ...(context.sessionId ? { exceptSessionId: context.sessionId } : {}),
    });
  }

  return { revokedSessions };
};

// ── Storefront shoppers ──────────────────────────────────────────────────────

export type CustomerAuthResult = {
  customerId: string;
  email: string;
  firstName: string;
  session: CreatedSession;
};

export const registerCustomer = async (
  input: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | undefined;
    password: string;
    marketingOptIn: boolean;
  },
  context: RequestContext,
): Promise<CustomerAuthResult> => {
  const email = normalizeEmail(input.email);
  await enforceRateLimit('customer-register', context.ipAddress ?? email);

  const issues = checkPasswordPolicy(input.password, {
    email,
    firstName: input.firstName,
    lastName: input.lastName,
  });
  if (issues.length > 0) {
    throw new ValidationError(
      issues.map((issue) => ({
        path: 'password',
        message: `Your password needs: ${issue.toLowerCase()}.`,
      })),
    );
  }

  const existing = await db.customer.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, deletedAt: true },
  });

  const passwordHash = await hashPassword(input.password);

  // A guest who has ordered before exists as a Customer with no password.
  // Registering with the same address claims that record rather than failing.
  if (existing && !existing.deletedAt && existing.passwordHash === null) {
    const claimed = await db.customer.update({
      where: { id: existing.id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
        passwordHash,
        marketingOptIn: input.marketingOptIn,
      },
      select: { id: true, email: true, firstName: true },
    });

    const session = await createSession({ scope: 'CUSTOMER', customerId: claimed.id }, context);
    return {
      customerId: claimed.id,
      email: claimed.email,
      firstName: claimed.firstName,
      session,
    };
  }

  if (existing) {
    throw new ConflictError('An account already exists for that email address.', [
      { path: 'email', message: 'Already registered. Try signing in instead.' },
    ]);
  }

  const customer = await db.customer.create({
    data: {
      email,
      firstName: input.firstName,
      lastName: input.lastName,
      phone: input.phone ?? null,
      passwordHash,
      marketingOptIn: input.marketingOptIn,
      status: CustomerStatus.ACTIVE,
    },
    select: { id: true, email: true, firstName: true },
  });

  const session = await createSession({ scope: 'CUSTOMER', customerId: customer.id }, context);

  return {
    customerId: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    session,
  };
};

export const authenticateCustomer = async (
  input: { email: string; password: string },
  context: RequestContext,
): Promise<CustomerAuthResult> => {
  const email = normalizeEmail(input.email);
  await enforceRateLimit('customer-login', email);
  if (context.ipAddress) await enforceRateLimit('login-ip', context.ipAddress);

  const customer = await db.customer.findFirst({
    where: { email, deletedAt: null },
    select: {
      id: true,
      email: true,
      firstName: true,
      status: true,
      passwordHash: true,
      failedLoginCount: true,
      lockedUntil: true,
    },
  });

  if (!customer?.passwordHash) {
    await burnPasswordComparison(input.password);
    await recordLoginAttempt(email, SessionScope.CUSTOMER, false, 'unknown_account', context);
    throw new UnauthenticatedError(GENERIC_LOGIN_FAILURE);
  }

  const now = new Date();
  if (customer.lockedUntil && customer.lockedUntil > now) {
    const minutes = Math.max(
      1,
      Math.ceil((customer.lockedUntil.getTime() - now.getTime()) / 60_000),
    );
    throw new ForbiddenError(
      `Your account is temporarily locked. Try again in ${minutes} minute(s), or reset your password.`,
    );
  }

  const matches = await verifyPassword(input.password, customer.passwordHash);

  if (!matches) {
    const attempts = customer.failedLoginCount + 1;
    const shouldLock = attempts >= serverEnv.LOGIN_MAX_ATTEMPTS;
    await db.customer.update({
      where: { id: customer.id },
      data: {
        failedLoginCount: attempts,
        lockedUntil: shouldLock
          ? new Date(Date.now() + serverEnv.LOGIN_LOCKOUT_SECONDS * 1000)
          : null,
      },
    });
    await recordLoginAttempt(email, SessionScope.CUSTOMER, false, 'bad_password', context);
    throw new UnauthenticatedError(GENERIC_LOGIN_FAILURE);
  }

  if (customer.status !== CustomerStatus.ACTIVE) {
    throw new ForbiddenError('This account is not available. Please contact support.');
  }

  const session = await createSession({ scope: 'CUSTOMER', customerId: customer.id }, context);

  await Promise.all([
    db.customer.update({
      where: { id: customer.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now },
    }),
    resetRateLimit('customer-login', email),
    recordLoginAttempt(email, SessionScope.CUSTOMER, true, null, context),
  ]);

  return {
    customerId: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    session,
  };
};
