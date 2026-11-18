import { describe, expect, it } from 'vitest';

import { ForbiddenError } from '@/lib/api/errors';
import {
  assertCan,
  assertCanActOnLevel,
  assertCanGrantRoleLevel,
  can,
  canAll,
  canAny,
  isSuperAdmin,
} from '@/lib/rbac/guard';
import {
  ALL_PERMISSION_KEYS,
  PERMISSIONS,
  ROLE_PRESETS,
  SUPER_ADMIN_ROLE_KEY,
  isPermissionKey,
  resolvePresetPermissions,
  splitPermission,
  type PermissionKey,
} from '@/lib/rbac/permissions';

/**
 * Authorization tests.
 *
 * These cover the rules that stop privilege escalation, which is the single
 * most consequential piece of logic in the application. They deliberately
 * include the *negative* cases: what a principal must NOT be able to do.
 */

const principal = (
  permissions: PermissionKey[],
  roleKeys: string[] = [],
  level = 100,
) => ({ permissions: new Set(permissions), roleKeys, level });

describe('can', () => {
  it('grants a permission the principal holds', () => {
    expect(can(principal(['product.read']), 'product.read')).toBe(true);
  });

  it('denies a permission the principal does not hold', () => {
    expect(can(principal(['product.read']), 'product.delete')).toBe(false);
  });

  it('denies everything to a principal with no permissions', () => {
    const nobody = principal([], [], 1000);
    for (const key of ALL_PERMISSION_KEYS) {
      expect(can(nobody, key)).toBe(false);
    }
  });

  it('grants every permission to a super admin, including ones they lack explicitly', () => {
    // The empty permission set is the point: the role key alone must suffice,
    // so shipping a new permission can never lock the owner out.
    const owner = principal([], [SUPER_ADMIN_ROLE_KEY], 0);

    expect(isSuperAdmin(owner)).toBe(true);
    for (const key of ALL_PERMISSION_KEYS) {
      expect(can(owner, key)).toBe(true);
    }
  });

  it('accepts an array as well as a Set', () => {
    const asArray = { permissions: ['order.read'] as PermissionKey[], roleKeys: [], level: 50 };
    expect(can(asArray, 'order.read')).toBe(true);
    expect(can(asArray, 'order.refund')).toBe(false);
  });
});

describe('canAll and canAny', () => {
  const actor = principal(['order.read', 'order.update']);

  it('canAll requires every permission', () => {
    expect(canAll(actor, ['order.read', 'order.update'])).toBe(true);
    expect(canAll(actor, ['order.read', 'order.refund'])).toBe(false);
  });

  it('canAny requires at least one', () => {
    expect(canAny(actor, ['order.refund', 'order.read'])).toBe(true);
    expect(canAny(actor, ['order.refund', 'order.cancel'])).toBe(false);
  });

  it('canAll on an empty list is vacuously true', () => {
    expect(canAll(actor, [])).toBe(true);
  });
});

describe('assertCan', () => {
  it('passes silently when the permission is held', () => {
    expect(() => assertCan(principal(['user.read']), 'user.read')).not.toThrow();
  });

  it('throws a 403 naming the missing permissions in the log context', () => {
    try {
      assertCan(principal(['user.read']), 'user.read', 'user.delete');
      expect.unreachable('assertCan should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      const forbidden = error as ForbiddenError;
      expect(forbidden.status).toBe(403);
      expect(forbidden.code).toBe('FORBIDDEN');
      expect(forbidden.logContext?.missingPermissions).toEqual(['user.delete']);
      // The user-facing message must not leak the permission key.
      expect(forbidden.message).not.toContain('user.delete');
    }
  });
});

describe('privilege escalation guards', () => {
  const admin = principal(['user.update'], ['admin'], 10);
  const manager = principal(['user.update'], ['manager'], 30);
  const owner = principal([], [SUPER_ADMIN_ROLE_KEY], 0);

  it('lets a principal act on an equal or lower-ranked target', () => {
    expect(() => assertCanActOnLevel(admin, 10)).not.toThrow();
    expect(() => assertCanActOnLevel(admin, 30)).not.toThrow();
    expect(() => assertCanActOnLevel(admin, 1000)).not.toThrow();
  });

  it('refuses to let a principal act on a higher-ranked target', () => {
    // Admin (10) must not touch Super Admin (0).
    expect(() => assertCanActOnLevel(admin, 0, 'this user')).toThrow(ForbiddenError);
    // Manager (30) must not touch Admin (10).
    expect(() => assertCanActOnLevel(manager, 10, 'this user')).toThrow(ForbiddenError);
  });

  it('exempts a super admin from the level check', () => {
    expect(() => assertCanActOnLevel(owner, 0)).not.toThrow();
  });

  it('blocks granting a role more powerful than the granter', () => {
    // This is the self-promotion attack: Admin granting itself Super Admin.
    expect(() => assertCanGrantRoleLevel(admin, 0, 'Super Admin')).toThrow(ForbiddenError);

    try {
      assertCanGrantRoleLevel(admin, 0, 'Super Admin');
    } catch (error) {
      // The message names the role so the UI can explain the refusal.
      expect((error as ForbiddenError).message).toContain('Super Admin');
    }
  });

  it('allows granting a role at or below the granter', () => {
    expect(() => assertCanGrantRoleLevel(admin, 10, 'Admin')).not.toThrow();
    expect(() => assertCanGrantRoleLevel(admin, 50, 'Staff')).not.toThrow();
  });

  it('lets a super admin grant anything', () => {
    expect(() => assertCanGrantRoleLevel(owner, 0, 'Super Admin')).not.toThrow();
  });
});

describe('permission catalogue', () => {
  it('uses the resource.action shape for every key', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
      const { resource, action } = splitPermission(key);
      expect(resource.length).toBeGreaterThan(0);
      expect(action.length).toBeGreaterThan(0);
      expect(`${resource}.${action}`).toBe(key);
    }
  });

  it('gives every permission a group and a description', () => {
    for (const key of ALL_PERMISSION_KEYS) {
      expect(PERMISSIONS[key].group.length).toBeGreaterThan(0);
      expect(PERMISSIONS[key].description.length).toBeGreaterThan(0);
    }
  });

  it('recognises real keys and rejects invented ones', () => {
    expect(isPermissionKey('product.read')).toBe(true);
    expect(isPermissionKey('product.teleport')).toBe(false);
    expect(isPermissionKey('')).toBe(false);
  });
});

describe('role presets', () => {
  it('gives super admin every permission', () => {
    const preset = ROLE_PRESETS.find((role) => role.key === SUPER_ADMIN_ROLE_KEY);
    expect(preset).toBeDefined();
    expect(resolvePresetPermissions(preset!)).toHaveLength(ALL_PERMISSION_KEYS.length);
  });

  it('declares strictly decreasing authority down the list', () => {
    const levels = ROLE_PRESETS.map((role) => role.level);
    expect(levels).toEqual([...levels].sort((a, b) => a - b));
    expect(new Set(levels).size).toBe(levels.length);
  });

  it('reserves level 0 for super admin alone', () => {
    const atZero = ROLE_PRESETS.filter((role) => role.level === 0);
    expect(atZero).toHaveLength(1);
    expect(atZero[0]?.key).toBe(SUPER_ADMIN_ROLE_KEY);
  });

  it('withholds role mutation from admin, so only super admin can reshape access', () => {
    const admin = ROLE_PRESETS.find((role) => role.key === 'admin');
    const granted = resolvePresetPermissions(admin!);

    expect(granted).not.toContain('role.create');
    expect(granted).not.toContain('role.update');
    expect(granted).not.toContain('role.delete');
    // But it can still read them, to see what exists.
    expect(granted).toContain('role.read');
  });

  it('gives staff no destructive or financial permissions', () => {
    const staff = ROLE_PRESETS.find((role) => role.key === 'staff');
    const granted = resolvePresetPermissions(staff!);

    for (const forbidden of [
      'product.delete',
      'order.refund',
      'order.cancel',
      'customer.delete',
      'user.create',
      'setting.update',
      'dashboard.view_financials',
    ] as PermissionKey[]) {
      expect(granted).not.toContain(forbidden);
    }
  });

  it('references only permissions that exist in the catalogue', () => {
    for (const preset of ROLE_PRESETS) {
      for (const key of resolvePresetPermissions(preset)) {
        expect(isPermissionKey(key)).toBe(true);
      }
    }
  });
});
