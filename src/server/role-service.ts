import { ConflictError, NotFoundError, PreconditionFailedError } from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { recordAudit, diffSnapshots } from '@/lib/audit';
import { db } from '@/lib/db';
import { assertCanActOnLevel, assertCanGrantRoleLevel, isSuperAdmin } from '@/lib/rbac/guard';
import {
  PERMISSIONS,
  SUPER_ADMIN_ROLE_KEY,
  isPermissionKey,
  type PermissionKey,
} from '@/lib/rbac/permissions';
import type { CreateRoleInput, UpdateRoleInput, RoleSortField } from '@/validation/role';

import { auditActorFor, type ServiceActor } from './types';

/**
 * Role and permission management.
 *
 * Two invariants are enforced here rather than in the UI:
 *  * A user may never create, edit or grant a role that outranks their own,
 *    which is what stops an Admin from promoting themselves to Super Admin.
 *  * The Super Admin role is immutable. Its permission set is "everything" by
 *    definition, so editing it could only ever remove access.
 */

export type RoleListItem = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  level: number;
  isSystem: boolean;
  userCount: number;
  permissionCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export const listRoles = async (
  query: ListQuery<RoleSortField>,
): Promise<Paginated<RoleListItem>> => {
  const where = {
    deletedAt: null,
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { key: { contains: query.search, mode: 'insensitive' as const } },
            { description: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.role.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        key: true,
        name: true,
        description: true,
        level: true,
        isSystem: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { users: true, permissions: true } },
      },
    }),
    db.role.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      level: row.level,
      isSystem: row.isSystem,
      userCount: row._count.users,
      permissionCount: row._count.permissions,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export type RoleDetail = RoleListItem & {
  permissions: PermissionKey[];
};

export const getRole = async (id: string): Promise<RoleDetail> => {
  const role = await db.role.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      level: true,
      isSystem: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { users: true, permissions: true } },
      permissions: { select: { permission: { select: { key: true } } } },
    },
  });

  if (!role) throw new NotFoundError('Role');

  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    level: role.level,
    isSystem: role.isSystem,
    userCount: role._count.users,
    permissionCount: role._count.permissions,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
    permissions: role.permissions
      .map((entry) => entry.permission.key)
      .filter((key): key is PermissionKey => isPermissionKey(key)),
  };
};

/** Resolves permission keys to ids, rejecting any that are not in the catalogue. */
const resolvePermissionIds = async (keys: readonly string[]): Promise<string[]> => {
  const valid = keys.filter((key): key is PermissionKey => isPermissionKey(key));
  if (valid.length === 0) return [];

  const rows = await db.permission.findMany({
    where: { key: { in: valid } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
};

export const createRole = async (
  input: CreateRoleInput,
  actor: ServiceActor,
): Promise<RoleDetail> => {
  // A role you could not yourself be granted must not be creatable.
  assertCanGrantRoleLevel(actor, input.level, input.name);

  const existing = await db.role.findUnique({ where: { key: input.key }, select: { id: true } });
  if (existing) {
    throw new ConflictError('A role with that key already exists.', [
      { path: 'key', message: 'Already taken.' },
    ]);
  }

  const permissionIds = await resolvePermissionIds(input.permissions);

  const created = await db.$transaction(async (tx) => {
    const role = await tx.role.create({
      data: {
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        level: input.level,
        isSystem: false,
        permissions: {
          create: permissionIds.map((permissionId) => ({ permissionId })),
        },
      },
      select: { id: true },
    });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'CREATE',
        entityType: 'Role',
        entityId: role.id,
        entityLabel: input.name,
        after: {
          key: input.key,
          name: input.name,
          level: input.level,
          permissions: input.permissions,
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );

    return role;
  });

  return getRole(created.id);
};

export const updateRole = async (
  id: string,
  input: UpdateRoleInput,
  actor: ServiceActor,
): Promise<RoleDetail> => {
  const role = await db.role.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      key: true,
      name: true,
      description: true,
      level: true,
      isSystem: true,
      permissions: { select: { permission: { select: { id: true, key: true } } } },
    },
  });

  if (!role) throw new NotFoundError('Role');

  if (role.key === SUPER_ADMIN_ROLE_KEY) {
    throw new PreconditionFailedError(
      'The Super Admin role cannot be edited. It holds every permission by definition.',
    );
  }

  // You cannot edit a role that outranks you, nor raise one above your own rank.
  assertCanActOnLevel(actor, role.level, `the "${role.name}" role`);
  assertCanGrantRoleLevel(actor, input.level, input.name);

  const permissionIds = await resolvePermissionIds(input.permissions);
  const previousKeys = role.permissions.map((entry) => entry.permission.key).sort();
  const nextKeys = [...input.permissions].sort();

  await db.$transaction(async (tx) => {
    await tx.role.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description ?? null,
        // A system role keeps its authority level; only custom roles can move.
        ...(role.isSystem ? {} : { level: input.level }),
      },
    });

    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    if (permissionIds.length > 0) {
      await tx.rolePermission.createMany({
        data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })),
      });
    }

    const diff = diffSnapshots(
      { name: role.name, description: role.description, level: role.level },
      { name: input.name, description: input.description ?? null, level: input.level },
    );

    const permissionsChanged = previousKeys.join(',') !== nextKeys.join(',');

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: permissionsChanged ? 'PERMISSIONS_CHANGED' : 'UPDATE',
        entityType: 'Role',
        entityId: id,
        entityLabel: input.name,
        before: {
          ...diff.before,
          ...(permissionsChanged ? { permissions: previousKeys } : {}),
        },
        after: {
          ...diff.after,
          ...(permissionsChanged ? { permissions: nextKeys } : {}),
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  return getRole(id);
};

export const archiveRole = async (id: string, actor: ServiceActor): Promise<void> => {
  const role = await db.role.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      key: true,
      name: true,
      level: true,
      isSystem: true,
      _count: { select: { users: true } },
    },
  });

  if (!role) throw new NotFoundError('Role');

  if (role.isSystem) {
    throw new PreconditionFailedError(
      `"${role.name}" is a built-in role and cannot be deleted. Remove it from users instead.`,
    );
  }

  assertCanActOnLevel(actor, role.level, `the "${role.name}" role`);

  if (role._count.users > 0) {
    throw new PreconditionFailedError(
      `"${role.name}" is still assigned to ${role._count.users} user(s). Reassign them first.`,
    );
  }

  await db.$transaction(async (tx) => {
    await tx.role.update({ where: { id }, data: { deletedAt: new Date() } });
    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ARCHIVE',
        entityType: 'Role',
        entityId: id,
        entityLabel: role.name,
        before: { key: role.key, name: role.name, deletedAt: null },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });
};

export type PermissionCatalogEntry = {
  key: PermissionKey;
  group: string;
  description: string;
};

/** The permission catalogue, for rendering the role editor. */
export const listPermissionCatalog = (): Record<string, PermissionCatalogEntry[]> => {
  const grouped: Record<string, PermissionCatalogEntry[]> = {};
  for (const [key, definition] of Object.entries(PERMISSIONS)) {
    (grouped[definition.group] ??= []).push({
      key: key as PermissionKey,
      group: definition.group,
      description: definition.description,
    });
  }
  return grouped;
};

/** Every live role, for filter dropdowns where authority is irrelevant. */
export const listRoleOptions = async (): Promise<
  { id: string; key: string; name: string; level: number }[]
> =>
  db.role.findMany({
    where: { deletedAt: null },
    orderBy: { level: 'asc' },
    select: { id: true, key: true, name: true, level: true },
  });

/** Roles an actor is allowed to assign, used to populate role pickers. */
export const listAssignableRoles = async (
  actor: ServiceActor,
): Promise<{ id: string; key: string; name: string; level: number }[]> => {
  const roles = await db.role.findMany({
    where: {
      deletedAt: null,
      ...(isSuperAdmin(actor) ? {} : { level: { gte: actor.level } }),
    },
    orderBy: { level: 'asc' },
    select: { id: true, key: true, name: true, level: true },
  });
  return roles;
};
