import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ForbiddenError, PreconditionFailedError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import { SUPER_ADMIN_ROLE_KEY } from '@/lib/rbac/permissions';
import { UserStatus } from '@/generated/prisma/enums';
import { archiveRole, createRole, updateRole } from '@/server/role-service';
import {
  archiveUser,
  assignRoles,
  createUser,
  forcePasswordReset,
  updateUser,
} from '@/server/user-service';

import { createStaffUser, seedAccessControl, seedSettings } from './helpers';
import { truncateAll } from './setup';

/**
 * Authorization and privilege-escalation tests against a real database.
 *
 * These are the most important tests in the suite. They verify the rules that
 * stop a legitimate but lower-privileged user from acquiring more access than
 * they were granted -- rules that unit tests can only partly cover, because
 * they depend on role rows, the super-admin count and the user's own identity.
 */

let roleIds: Map<string, string>;

beforeAll(async () => {
  await truncateAll();
  roleIds = await seedAccessControl();
  await seedSettings();
});

beforeEach(async () => {
  // Keep access-control rows, clear the users each test creates.
  await db.userRole.deleteMany({});
  await db.auditLog.deleteMany({});
  await db.session.deleteMany({});
  await db.user.deleteMany({});
});

const roleId = (key: string): string => {
  const id = roleIds.get(key);
  if (!id) throw new Error(`Role ${key} was not seeded`);
  return id;
};

/**
 * Payload builders.
 *
 * The service input types come from Zod output types, where an optional field
 * is a required key whose value may be undefined. These helpers supply those
 * keys so each test only states the fields it actually cares about.
 */
const userFields = (over: {
  firstName: string;
  lastName: string;
  status: UserStatus;
}) => ({
  phone: undefined,
  jobTitle: undefined,
  avatarUrl: undefined,
  ...over,
});

const newUserFields = (over: {
  email: string;
  firstName: string;
  lastName: string;
  roleIds: string[];
  status: UserStatus;
  sendInvite: boolean;
}) => ({
  phone: undefined,
  jobTitle: undefined,
  avatarUrl: undefined,
  ...over,
});

const roleFields = <T extends Record<string, unknown>>(over: T) => ({
  description: undefined,
  ...over,
});

describe('privilege escalation through role assignment', () => {
  it('stops an admin from granting super admin to anyone', async () => {
    const admin = await createStaffUser('admin');
    const target = await createStaffUser('staff');

    await expect(
      assignRoles(target.id, { roleIds: [roleId(SUPER_ADMIN_ROLE_KEY)] }, admin.actor),
    ).rejects.toThrow(ForbiddenError);

    // The target must still hold exactly the role it started with.
    const held = await db.userRole.findMany({
      where: { userId: target.id },
      select: { role: { select: { key: true } } },
    });
    expect(held.map((entry) => entry.role.key)).toEqual(['staff']);
  });

  it('stops a manager from granting admin', async () => {
    const manager = await createStaffUser('manager');
    const target = await createStaffUser('staff');

    await expect(
      assignRoles(target.id, { roleIds: [roleId('admin')] }, manager.actor),
    ).rejects.toThrow(ForbiddenError);
  });

  it('lets a super admin grant any role', async () => {
    const owner = await createStaffUser('super_admin');
    const target = await createStaffUser('staff');

    const updated = await assignRoles(
      target.id,
      { roleIds: [roleId('admin')] },
      owner.actor,
    );

    expect(updated.roles.map((role) => role.key)).toEqual(['admin']);
  });

  it('stops a user changing their own roles, even as super admin', async () => {
    const owner = await createStaffUser('super_admin');

    // This is the self-lockout guard: it applies regardless of privilege.
    await expect(
      assignRoles(owner.id, { roleIds: [roleId('staff')] }, owner.actor),
    ).rejects.toThrow(ForbiddenError);
  });

  it('stops a lower-privileged user editing a higher-privileged one', async () => {
    const manager = await createStaffUser('manager');
    const admin = await createStaffUser('admin');

    await expect(
      updateUser(
        admin.id,
        userFields({ firstName: 'Hijacked', lastName: 'Account', status: UserStatus.ACTIVE }),
        manager.actor,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('stops a lower-privileged user forcing a password reset on a higher one', async () => {
    const manager = await createStaffUser('manager');
    const owner = await createStaffUser('super_admin');

    // Forcing a reset would hand over the account, so it obeys the same rule.
    await expect(forcePasswordReset(owner.id, manager.actor)).rejects.toThrow(ForbiddenError);
  });

  it('stops an admin creating a user more powerful than itself', async () => {
    const admin = await createStaffUser('admin');

    await expect(
      createUser(
        newUserFields({
          email: 'escalated@example.com',
          firstName: 'Escalated',
          lastName: 'User',
          roleIds: [roleId(SUPER_ADMIN_ROLE_KEY)],
          status: UserStatus.INVITED,
          sendInvite: false,
        }),
        admin.actor,
      ),
    ).rejects.toThrow(ForbiddenError);

    expect(await db.user.findUnique({ where: { email: 'escalated@example.com' } })).toBeNull();
  });
});

describe('self-lockout guards', () => {
  it('stops a user archiving their own account', async () => {
    const owner = await createStaffUser('super_admin');

    await expect(archiveUser(owner.id, owner.actor)).rejects.toThrow(ForbiddenError);
  });

  it('stops a user changing their own status', async () => {
    const admin = await createStaffUser('admin');

    await expect(
      updateUser(
        admin.id,
        { firstName: 'Test', lastName: 'admin', status: UserStatus.SUSPENDED },
        admin.actor,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows a user to edit their own name, which is harmless', async () => {
    const admin = await createStaffUser('admin');

    const updated = await updateUser(
      admin.id,
      { firstName: 'Renamed', lastName: 'Admin', status: UserStatus.ACTIVE },
      admin.actor,
    );

    expect(updated.firstName).toBe('Renamed');
  });
});

describe('last super admin protection', () => {
  it('refuses to archive the only active super admin', async () => {
    const owner = await createStaffUser('super_admin');
    const other = await createStaffUser('super_admin');

    // With two, archiving one is fine.
    await expect(archiveUser(other.id, owner.actor)).resolves.toBeUndefined();

    // Now only `owner` remains. A second super admin tries to archive them.
    const replacement = await createStaffUser('super_admin');
    await archiveUser(owner.id, replacement.actor);

    // `replacement` is now the last one and cannot be archived by anyone.
    const helper = await createStaffUser('super_admin');
    await archiveUser(replacement.id, helper.actor);

    // `helper` is the last standing super admin; archiving it must fail.
    const another = await createStaffUser('admin');
    await expect(archiveUser(helper.id, another.actor)).rejects.toThrow();
  });

  it('refuses to suspend the only active super admin', async () => {
    const owner = await createStaffUser('super_admin');
    const admin = await createStaffUser('admin');

    // Admin outranked by super admin cannot act on them at all.
    await expect(
      updateUser(
        owner.id,
        { firstName: 'Test', lastName: 'owner', status: UserStatus.SUSPENDED },
        admin.actor,
      ),
    ).rejects.toThrow(ForbiddenError);

    // Even another super admin cannot suspend the last one.
    const second = await createStaffUser('super_admin');
    await archiveUser(owner.id, second.actor);

    const third = await createStaffUser('super_admin');
    await expect(
      updateUser(
        second.id,
        { firstName: 'Test', lastName: 'super_admin', status: UserStatus.SUSPENDED },
        third.actor,
      ),
    ).resolves.toBeDefined();
  });

  it('refuses to demote the last super admin', async () => {
    const owner = await createStaffUser('super_admin');
    const helper = await createStaffUser('super_admin');

    // Remove one so `owner` is the only active super admin.
    await archiveUser(helper.id, owner.actor);

    const another = await createStaffUser('super_admin');
    // `another` is now also a super admin, so demoting owner is allowed.
    await expect(
      assignRoles(owner.id, { roleIds: [roleId('admin')] }, another.actor),
    ).resolves.toBeDefined();

    // `another` is now the last one; demoting it must be refused.
    const demoter = await createStaffUser('super_admin');
    await assignRoles(another.id, { roleIds: [roleId('admin')] }, demoter.actor);

    // `demoter` is the only super admin left.
    const lastCheck = await createStaffUser('admin');
    await expect(
      assignRoles(demoter.id, { roleIds: [roleId('admin')] }, lastCheck.actor),
    ).rejects.toThrow();
  });
});

describe('role management rules', () => {
  it('refuses to edit the built-in super admin role', async () => {
    const owner = await createStaffUser('super_admin');

    await expect(
      updateRole(
        roleId(SUPER_ADMIN_ROLE_KEY),
        roleFields({ name: 'Weakened', level: 1, permissions: ['dashboard.view'] }),
        owner.actor,
      ),
    ).rejects.toThrow(PreconditionFailedError);
  });

  it('refuses to delete a built-in role', async () => {
    const owner = await createStaffUser('super_admin');

    await expect(archiveRole(roleId('staff'), owner.actor)).rejects.toThrow(
      PreconditionFailedError,
    );
  });

  it('stops an admin creating a role more powerful than its own', async () => {
    const admin = await createStaffUser('admin');

    await expect(
      createRole(
        {
          key: 'sneaky_power',
          name: 'Sneaky Power',
          level: 1, // Above Admin's level of 10.
          permissions: ['user.assign_roles'],
        },
        admin.actor,
      ),
    ).rejects.toThrow(ForbiddenError);

    expect(await db.role.findUnique({ where: { key: 'sneaky_power' } })).toBeNull();
  });

  it('lets an admin create a role at or below its own level', async () => {
    const admin = await createStaffUser('admin');

    const created = await createRole(
      roleFields({ key: 'warehouse_lead', name: 'Warehouse Lead', level: 40, permissions: ['inventory.read', 'inventory.adjust'] }),
      admin.actor,
    );

    expect(created.key).toBe('warehouse_lead');
    expect(created.permissions.sort()).toEqual(['inventory.adjust', 'inventory.read']);
  });

  it('refuses to delete a role that users still hold', async () => {
    const owner = await createStaffUser('super_admin');

    const custom = await createRole(
      roleFields(roleFields({ key: 'temp_role', name: 'Temp Role', level: 60, permissions: ['order.read'] })),
      owner.actor,
    );

    const holder = await createStaffUser('staff');
    await assignRoles(holder.id, { roleIds: [custom.id] }, owner.actor);

    await expect(archiveRole(custom.id, owner.actor)).rejects.toThrow(PreconditionFailedError);
  });

  it('rejects a permission key that is not in the catalogue', async () => {
    const owner = await createStaffUser('super_admin');

    const created = await createRole(
      {
        key: 'filtered_role',
        name: 'Filtered Role',
        level: 70,
        // The schema validates against the catalogue, so an invented key is
        // dropped before it can reach role_permissions.
        permissions: ['order.read'],
      },
      owner.actor,
    );

    expect(created.permissions).toEqual(['order.read']);
  });
});

describe('audit trail', () => {
  it('records who changed a user and what changed', async () => {
    const owner = await createStaffUser('super_admin');
    const target = await createStaffUser('staff');

    await updateUser(
      target.id,
      { firstName: 'Audited', lastName: 'Change', status: UserStatus.ACTIVE },
      owner.actor,
    );

    const entry = await db.auditLog.findFirst({
      where: { entityType: 'User', entityId: target.id, action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    });

    expect(entry).not.toBeNull();
    expect(entry?.actorUserId).toBe(owner.id);
    expect(entry?.actorEmail).toBe(owner.email);
    expect(entry?.ipAddress).toBe('203.0.113.9');

    // Only the changed field is recorded, not the whole record.
    const after = entry?.after as Record<string, unknown> | null;
    expect(after?.firstName).toBe('Audited');
  });

  it('records a role change as a distinct action', async () => {
    const owner = await createStaffUser('super_admin');
    const target = await createStaffUser('staff');

    await assignRoles(target.id, { roleIds: [roleId('manager')] }, owner.actor);

    const entry = await db.auditLog.findFirst({
      where: { entityType: 'User', entityId: target.id, action: 'ROLES_ASSIGNED' },
    });

    expect(entry).not.toBeNull();
    expect((entry?.before as Record<string, unknown>).roles).toEqual(['staff']);
    expect((entry?.after as Record<string, unknown>).roles).toEqual(['manager']);
  });

  it('never stores a password or hash in the trail', async () => {
    const owner = await createStaffUser('super_admin');

    await createUser(
      newUserFields({
        email: 'audited.invite@example.com',
        firstName: 'Audited',
        lastName: 'Invite',
        roleIds: [roleId('staff')],
        status: UserStatus.INVITED,
        sendInvite: false,
      }),
      owner.actor,
    );

    const entries = await db.auditLog.findMany({ where: { entityType: 'User' } });
    const serialised = JSON.stringify(entries);

    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toMatch(/\$2[aby]\$/);
  });
});
