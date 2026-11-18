import { ForbiddenError } from '../api/errors';

import { SUPER_ADMIN_ROLE_KEY, type PermissionKey } from './permissions';

/**
 * Pure authorization predicates.
 *
 * Nothing here touches the database or the request - it operates on an already
 * loaded principal. That keeps the rules trivially unit-testable and means the
 * same functions can be used on the server (to enforce) and in the UI (to hide
 * controls the user cannot use). The UI use is cosmetic only: every mutation is
 * re-checked server-side.
 */

export type AuthorizablePrincipal = {
  readonly permissions: ReadonlySet<PermissionKey> | readonly PermissionKey[];
  readonly roleKeys: readonly string[];
  /** Lowest (most authoritative) role level the principal holds. */
  readonly level: number;
};

/** Narrows the permission bag, which callers may supply as a Set or an array. */
const isPermissionArray = (
  value: AuthorizablePrincipal['permissions'],
): value is readonly PermissionKey[] => Array.isArray(value);

const hasPermissionKey = (
  permissions: AuthorizablePrincipal['permissions'],
  key: PermissionKey,
): boolean =>
  isPermissionArray(permissions) ? permissions.includes(key) : permissions.has(key);

export const isSuperAdmin = (principal: AuthorizablePrincipal): boolean =>
  principal.roleKeys.includes(SUPER_ADMIN_ROLE_KEY);

/** True when the principal holds the permission (super admins hold all of them). */
export const can = (principal: AuthorizablePrincipal, permission: PermissionKey): boolean =>
  isSuperAdmin(principal) || hasPermissionKey(principal.permissions, permission);

export const canAll = (
  principal: AuthorizablePrincipal,
  permissions: readonly PermissionKey[],
): boolean => permissions.every((permission) => can(principal, permission));

export const canAny = (
  principal: AuthorizablePrincipal,
  permissions: readonly PermissionKey[],
): boolean => permissions.some((permission) => can(principal, permission));

/** Throws a 403 unless the principal holds every listed permission. */
export const assertCan = (
  principal: AuthorizablePrincipal,
  ...permissions: readonly PermissionKey[]
): void => {
  const missing = permissions.filter((permission) => !can(principal, permission));
  if (missing.length > 0) {
    throw new ForbiddenError('You do not have permission to do that.', {
      missingPermissions: missing,
      roleKeys: principal.roleKeys,
    });
  }
};

/**
 * Privilege-escalation guard.
 *
 * A principal may only act on accounts and roles at or below its own authority,
 * and may never grant a role more powerful than its own. Without this, an Admin
 * could assign Super Admin to themselves and escape every other check.
 *
 * Super admins are exempt, since they already hold maximum authority.
 */
export const canActOnLevel = (principal: AuthorizablePrincipal, targetLevel: number): boolean =>
  isSuperAdmin(principal) || principal.level <= targetLevel;

export const assertCanActOnLevel = (
  principal: AuthorizablePrincipal,
  targetLevel: number,
  what = 'that record',
): void => {
  if (!canActOnLevel(principal, targetLevel)) {
    throw new ForbiddenError(`You cannot modify ${what}, which outranks your own role.`, {
      principalLevel: principal.level,
      targetLevel,
    });
  }
};

/** Blocks granting a role the actor does not themselves outrank. */
export const assertCanGrantRoleLevel = (
  principal: AuthorizablePrincipal,
  roleLevel: number,
  roleName: string,
): void => {
  if (!canActOnLevel(principal, roleLevel)) {
    throw new ForbiddenError(
      `You cannot grant the "${roleName}" role because it outranks your own.`,
      { principalLevel: principal.level, roleLevel },
    );
  }
};
