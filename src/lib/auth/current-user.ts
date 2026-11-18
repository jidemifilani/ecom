import { cache } from 'react';

import { UnauthenticatedError } from '../api/errors';
import { db } from '../db';
import { assertCan, isSuperAdmin } from '../rbac/guard';
import { isPermissionKey, type PermissionKey } from '../rbac/permissions';
import { SessionScope, UserStatus, CustomerStatus } from '@/generated/prisma/enums';

import { readSessionToken, validateSessionToken } from './session';

/**
 * Request-scoped principal loading.
 *
 * `getCurrentUser` is wrapped in React's `cache`, so a page that checks
 * permissions in a layout, a page and three components still performs a single
 * database round-trip per request.
 *
 * The loaded user is the authority for every server-side check. A user whose
 * account has been suspended or archived resolves to `null` even while holding
 * a technically unexpired session cookie.
 */

export type CurrentUserRole = {
  key: string;
  name: string;
  level: number;
};

export type CurrentUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  jobTitle: string | null;
  locale: string;
  timezone: string;
  mustChangePassword: boolean;
  hasPassword: boolean;
  sessionId: string;
  roles: CurrentUserRole[];
  roleKeys: string[];
  permissions: Set<PermissionKey>;
  /** Lowest role level held; 1000 when the user holds no roles at all. */
  level: number;
  isSuperAdmin: boolean;
};

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readSessionToken(SessionScope.STAFF);
  if (!token) return null;

  const session = await validateSessionToken(token, SessionScope.STAFF);
  if (!session?.userId) return null;

  const user = await db.user.findFirst({
    where: { id: session.userId, deletedAt: null, status: UserStatus.ACTIVE },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      avatarUrl: true,
      jobTitle: true,
      locale: true,
      timezone: true,
      mustChangePassword: true,
      passwordHash: true,
      roles: {
        select: {
          role: {
            select: {
              key: true,
              name: true,
              level: true,
              deletedAt: true,
              permissions: { select: { permission: { select: { key: true } } } },
            },
          },
        },
      },
    },
  });

  if (!user) return null;

  const activeRoles = user.roles
    .map((assignment) => assignment.role)
    .filter((role) => role.deletedAt === null);

  const permissions = new Set<PermissionKey>();
  for (const role of activeRoles) {
    for (const entry of role.permissions) {
      // Ignore rows for permissions that no longer exist in the catalogue.
      if (isPermissionKey(entry.permission.key)) permissions.add(entry.permission.key);
    }
  }

  const roles: CurrentUserRole[] = activeRoles.map((role) => ({
    key: role.key,
    name: role.name,
    level: role.level,
  }));
  const roleKeys = roles.map((role) => role.key);
  const level = roles.length > 0 ? Math.min(...roles.map((role) => role.level)) : 1000;

  const principal = { permissions, roleKeys, level };

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    avatarUrl: user.avatarUrl,
    jobTitle: user.jobTitle,
    locale: user.locale,
    timezone: user.timezone,
    mustChangePassword: user.mustChangePassword,
    hasPassword: user.passwordHash !== null,
    sessionId: session.sessionId,
    roles,
    roleKeys,
    permissions,
    level,
    isSuperAdmin: isSuperAdmin(principal),
  };
});

/** Throws a 401 when there is no usable staff session. */
export const requireUser = async (): Promise<CurrentUser> => {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
};

/** Throws 401 when unauthenticated, 403 when under-privileged. */
export const requirePermission = async (
  ...permissions: readonly PermissionKey[]
): Promise<CurrentUser> => {
  const user = await requireUser();
  assertCan(user, ...permissions);
  return user;
};

// ── Storefront shopper ───────────────────────────────────────────────────────

export type CurrentCustomer = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  sessionId: string;
};

export const getCurrentCustomer = cache(async (): Promise<CurrentCustomer | null> => {
  const token = await readSessionToken(SessionScope.CUSTOMER);
  if (!token) return null;

  const session = await validateSessionToken(token, SessionScope.CUSTOMER);
  if (!session?.customerId) return null;

  const customer = await db.customer.findFirst({
    where: { id: session.customerId, deletedAt: null, status: CustomerStatus.ACTIVE },
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  if (!customer) return null;

  return {
    id: customer.id,
    email: customer.email,
    firstName: customer.firstName,
    lastName: customer.lastName,
    fullName: `${customer.firstName} ${customer.lastName}`.trim(),
    sessionId: session.sessionId,
  };
});

export const requireCustomer = async (): Promise<CurrentCustomer> => {
  const customer = await getCurrentCustomer();
  if (!customer) throw new UnauthenticatedError('Please sign in to your account to continue.');
  return customer;
};
