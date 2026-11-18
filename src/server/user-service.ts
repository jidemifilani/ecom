import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  PreconditionFailedError,
} from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { diffSnapshots, recordAudit } from '@/lib/audit';
import { generateTemporaryPassword, hashPassword } from '@/lib/auth/password';
import { revokeAllUserSessions } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { serverEnv } from '@/lib/env';
import { deliver, staffInviteEmail } from '@/lib/mailer';
import { assertCanActOnLevel, assertCanGrantRoleLevel, isSuperAdmin } from '@/lib/rbac/guard';
import { SUPER_ADMIN_ROLE_KEY } from '@/lib/rbac/permissions';
import { normalizeEmail } from '@/lib/utils';
import { UserStatus } from '@/generated/prisma/enums';
import type {
  AssignRolesInput,
  CreateUserInput,
  UpdateUserInput,
  UserSortField,
} from '@/validation/user';

import { auditActorFor, type ServiceActor } from './types';

/**
 * Staff user management.
 *
 * Three safety rules are enforced here, none of which can be expressed in the
 * schema:
 *  * You cannot act on a user who outranks you.
 *  * You cannot change your own roles or status - that is how an administrator
 *    accidentally locks themselves out.
 *  * The last active Super Admin cannot be archived, suspended or demoted,
 *    which would leave the installation with no one able to fix it.
 */

const userSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  jobTitle: true,
  avatarUrl: true,
  status: true,
  authProvider: true,
  locale: true,
  timezone: true,
  mustChangePassword: true,
  lastLoginAt: true,
  lastLoginIp: true,
  lockedUntil: true,
  failedLoginCount: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  roles: {
    select: {
      assignedAt: true,
      role: { select: { id: true, key: true, name: true, level: true } },
    },
  },
} as const;

export type UserListItem = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  roles: { id: string; key: string; name: string; level: number }[];
  level: number;
  lastLoginAt: Date | null;
  isLocked: boolean;
  createdAt: Date;
  deletedAt: Date | null;
};

type UserRow = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  avatarUrl: string | null;
  status: UserStatus;
  lastLoginAt: Date | null;
  lockedUntil: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
  roles: { role: { id: string; key: string; name: string; level: number } }[];
};

const toListItem = (row: UserRow): UserListItem => {
  const roles = row.roles.map((entry) => entry.role);
  return {
    id: row.id,
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
    jobTitle: row.jobTitle,
    avatarUrl: row.avatarUrl,
    status: row.status,
    roles,
    level: roles.length > 0 ? Math.min(...roles.map((role) => role.level)) : 1000,
    lastLoginAt: row.lastLoginAt,
    isLocked: row.lockedUntil !== null && row.lockedUntil > new Date(),
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  };
};

export const listUsers = async (
  query: ListQuery<UserSortField>,
): Promise<Paginated<UserListItem>> => {
  const statusFilter = query.filters.status;
  const roleFilter = query.filters.roleId;

  const where = {
    ...(query.includeArchived ? {} : { deletedAt: null }),
    ...(statusFilter ? { status: statusFilter as UserStatus } : {}),
    ...(roleFilter ? { roles: { some: { roleId: roleFilter } } } : {}),
    ...(query.search
      ? {
          OR: [
            { firstName: { contains: query.search, mode: 'insensitive' as const } },
            { lastName: { contains: query.search, mode: 'insensitive' as const } },
            { email: { contains: query.search, mode: 'insensitive' as const } },
            { jobTitle: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        jobTitle: true,
        avatarUrl: true,
        status: true,
        lastLoginAt: true,
        lockedUntil: true,
        createdAt: true,
        deletedAt: true,
        roles: { select: { role: { select: { id: true, key: true, name: true, level: true } } } },
      },
    }),
    db.user.count({ where }),
  ]);

  return {
    items: rows.map(toListItem),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export type UserDetail = UserListItem & {
  phone: string | null;
  locale: string;
  timezone: string;
  mustChangePassword: boolean;
  authProvider: string;
  lastLoginIp: string | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  activeSessionCount: number;
  updatedAt: Date;
};

export const getUser = async (id: string): Promise<UserDetail> => {
  const [user, activeSessionCount] = await Promise.all([
    db.user.findUnique({ where: { id }, select: userSelect }),
    db.session.count({
      where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  ]);

  if (!user) throw new NotFoundError('User');

  return {
    ...toListItem(user),
    phone: user.phone,
    locale: user.locale,
    timezone: user.timezone,
    mustChangePassword: user.mustChangePassword,
    authProvider: user.authProvider,
    lastLoginIp: user.lastLoginIp,
    failedLoginCount: user.failedLoginCount,
    lockedUntil: user.lockedUntil,
    activeSessionCount,
    updatedAt: user.updatedAt,
  };
};

/** The lowest role level a user holds, i.e. their effective authority. */
const levelOf = (roles: { level: number }[]): number =>
  roles.length > 0 ? Math.min(...roles.map((role) => role.level)) : 1000;

const loadTarget = async (id: string) => {
  const user = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      jobTitle: true,
      avatarUrl: true,
      status: true,
      locale: true,
      timezone: true,
      deletedAt: true,
      roles: { select: { role: { select: { id: true, key: true, name: true, level: true } } } },
    },
  });
  if (!user) throw new NotFoundError('User');
  return user;
};

/** Counts active super admins, excluding one id. Guards the lockout rule. */
const countOtherActiveSuperAdmins = async (excludeUserId: string): Promise<number> =>
  db.user.count({
    where: {
      id: { not: excludeUserId },
      deletedAt: null,
      status: UserStatus.ACTIVE,
      roles: { some: { role: { key: SUPER_ADMIN_ROLE_KEY, deletedAt: null } } },
    },
  });

const assertNotLastSuperAdmin = async (
  target: { id: string; roles: { role: { key: string } }[] },
  action: string,
): Promise<void> => {
  const isTargetSuperAdmin = target.roles.some(
    (entry) => entry.role.key === SUPER_ADMIN_ROLE_KEY,
  );
  if (!isTargetSuperAdmin) return;

  const others = await countOtherActiveSuperAdmins(target.id);
  if (others === 0) {
    throw new PreconditionFailedError(
      `This is the only active Super Admin, so it cannot be ${action}. Promote another user first.`,
    );
  }
};

export const createUser = async (
  input: CreateUserInput,
  actor: ServiceActor,
): Promise<UserDetail> => {
  const email = normalizeEmail(input.email);

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, deletedAt: true },
  });
  if (existing) {
    throw new ConflictError(
      existing.deletedAt
        ? 'An archived user already uses that email address.'
        : 'A user with that email address already exists.',
      [{ path: 'email', message: 'Already taken.' }],
    );
  }

  const roles = await db.role.findMany({
    where: { id: { in: input.roleIds }, deletedAt: null },
    select: { id: true, name: true, level: true, key: true },
  });

  if (roles.length !== input.roleIds.length) {
    throw new ConflictError('One or more of the selected roles no longer exists.', [
      { path: 'roleIds', message: 'Select the roles again.' },
    ]);
  }

  // You cannot create a user more powerful than yourself.
  for (const role of roles) {
    assertCanGrantRoleLevel(actor, role.level, role.name);
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const created = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone ?? null,
        jobTitle: input.jobTitle ?? null,
        avatarUrl: input.avatarUrl ?? null,
        status: input.status,
        passwordHash,
        passwordSetAt: new Date(),
        mustChangePassword: true,
        createdById: actor.id,
        updatedById: actor.id,
        roles: {
          create: roles.map((role) => ({ roleId: role.id, assignedById: actor.id })),
        },
      },
      select: { id: true },
    });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'CREATE',
        entityType: 'User',
        entityId: user.id,
        entityLabel: `${input.firstName} ${input.lastName} <${email}>`,
        after: {
          email,
          firstName: input.firstName,
          lastName: input.lastName,
          status: input.status,
          roles: roles.map((role) => role.key),
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );

    return user;
  });

  if (input.sendInvite) {
    await deliver(
      staffInviteEmail(
        input.firstName,
        `${serverEnv.APP_URL}/login`,
        temporaryPassword,
      ),
      email,
    );
  }

  return getUser(created.id);
};

export const updateUser = async (
  id: string,
  input: UpdateUserInput,
  actor: ServiceActor,
): Promise<UserDetail> => {
  const target = await loadTarget(id);
  if (target.deletedAt) throw new NotFoundError('User');

  const targetLevel = levelOf(target.roles.map((entry) => entry.role));
  assertCanActOnLevel(actor, targetLevel, 'this user');

  const isSelf = target.id === actor.id;

  // Changing your own status is the classic self-lockout. Everything else about
  // your own profile is editable from /profile.
  if (isSelf && input.status !== target.status) {
    throw new ForbiddenError('You cannot change your own account status.');
  }

  if (input.status !== UserStatus.ACTIVE && target.status === UserStatus.ACTIVE) {
    await assertNotLastSuperAdmin(target, 'suspended');
  }

  const after = {
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone ?? null,
    jobTitle: input.jobTitle ?? null,
    avatarUrl: input.avatarUrl ?? null,
    status: input.status,
    ...(input.timezone ? { timezone: input.timezone } : {}),
    ...(input.locale ? { locale: input.locale } : {}),
  };

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { ...after, updatedById: actor.id },
    });

    const diff = diffSnapshots(
      {
        firstName: target.firstName,
        lastName: target.lastName,
        phone: target.phone,
        jobTitle: target.jobTitle,
        avatarUrl: target.avatarUrl,
        status: target.status,
        timezone: target.timezone,
        locale: target.locale,
      },
      { ...after, timezone: input.timezone ?? target.timezone, locale: input.locale ?? target.locale },
    );

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'UPDATE',
        entityType: 'User',
        entityId: id,
        entityLabel: `${input.firstName} ${input.lastName} <${target.email}>`,
        before: diff.before,
        after: diff.after,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  // A suspended user must lose their active sessions immediately, or the
  // suspension would not take effect until their cookie happened to expire.
  if (input.status === UserStatus.SUSPENDED && target.status !== UserStatus.SUSPENDED) {
    await revokeAllUserSessions(id, 'Account suspended');
  }

  return getUser(id);
};

/**
 * Self-service profile update.
 *
 * Separate from `updateUser` on purpose: this path can never touch status,
 * roles or any other field that would change what the account is allowed to
 * do, so it needs no permission beyond being signed in.
 */
export const updateOwnProfile = async (
  userId: string,
  input: {
    firstName: string;
    lastName: string;
    phone?: string | undefined;
    jobTitle?: string | undefined;
    timezone: string;
    locale: string;
  },
  actor: ServiceActor,
): Promise<UserDetail> => {
  const existing = await db.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      firstName: true,
      lastName: true,
      phone: true,
      jobTitle: true,
      timezone: true,
      locale: true,
    },
  });
  if (!existing) throw new NotFoundError('User');

  const after = {
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone ?? null,
    jobTitle: input.jobTitle ?? null,
    timezone: input.timezone,
    locale: input.locale,
  };

  await db.user.update({ where: { id: userId }, data: { ...after, updatedById: userId } });

  const diff = diffSnapshots(existing, after);
  await recordAudit({
    actor: auditActorFor(actor),
    action: 'UPDATE',
    entityType: 'User',
    entityId: userId,
    entityLabel: `${input.firstName} ${input.lastName} (own profile)`,
    before: diff.before,
    after: diff.after,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return getUser(userId);
};

export const assignRoles = async (
  id: string,
  input: AssignRolesInput,
  actor: ServiceActor,
): Promise<UserDetail> => {
  const target = await loadTarget(id);
  if (target.deletedAt) throw new NotFoundError('User');

  if (target.id === actor.id) {
    throw new ForbiddenError(
      'You cannot change your own roles. Ask another administrator to do it.',
    );
  }

  const targetLevel = levelOf(target.roles.map((entry) => entry.role));
  assertCanActOnLevel(actor, targetLevel, 'this user');

  const roles = await db.role.findMany({
    where: { id: { in: input.roleIds }, deletedAt: null },
    select: { id: true, key: true, name: true, level: true },
  });

  if (roles.length !== input.roleIds.length) {
    throw new ConflictError('One or more of the selected roles no longer exists.', [
      { path: 'roleIds', message: 'Select the roles again.' },
    ]);
  }

  for (const role of roles) {
    assertCanGrantRoleLevel(actor, role.level, role.name);
  }

  const losesSuperAdmin =
    target.roles.some((entry) => entry.role.key === SUPER_ADMIN_ROLE_KEY) &&
    !roles.some((role) => role.key === SUPER_ADMIN_ROLE_KEY);

  if (losesSuperAdmin) {
    await assertNotLastSuperAdmin(target, 'demoted');
  }

  const previousKeys = target.roles.map((entry) => entry.role.key).sort();
  const nextKeys = roles.map((role) => role.key).sort();

  await db.$transaction(async (tx) => {
    await tx.userRole.deleteMany({ where: { userId: id } });
    await tx.userRole.createMany({
      data: roles.map((role) => ({ userId: id, roleId: role.id, assignedById: actor.id })),
    });
    await tx.user.update({ where: { id }, data: { updatedById: actor.id } });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ROLES_ASSIGNED',
        entityType: 'User',
        entityId: id,
        entityLabel: `${target.firstName} ${target.lastName} <${target.email}>`,
        before: { roles: previousKeys },
        after: { roles: nextKeys },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  // Permissions are read from the database on every request, so the change
  // takes effect at once. Sessions are left intact deliberately: a role change
  // is not a security event that warrants signing the user out.
  return getUser(id);
};

export const archiveUser = async (id: string, actor: ServiceActor): Promise<void> => {
  const target = await loadTarget(id);
  if (target.deletedAt) throw new NotFoundError('User');

  if (target.id === actor.id) {
    throw new ForbiddenError('You cannot archive your own account.');
  }

  const targetLevel = levelOf(target.roles.map((entry) => entry.role));
  assertCanActOnLevel(actor, targetLevel, 'this user');
  await assertNotLastSuperAdmin(target, 'archived');

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: UserStatus.SUSPENDED,
        updatedById: actor.id,
        // Free the address so it can be re-invited later without a collision.
        email: `${target.email}.archived.${Date.now()}`.slice(0, 255),
      },
    });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ARCHIVE',
        entityType: 'User',
        entityId: id,
        entityLabel: `${target.firstName} ${target.lastName} <${target.email}>`,
        before: { email: target.email, status: target.status, deletedAt: null },
        after: { status: UserStatus.SUSPENDED, deletedAt: new Date() },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  await revokeAllUserSessions(id, 'Account archived');
};

export const restoreUser = async (id: string, actor: ServiceActor): Promise<UserDetail> => {
  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, email: true, firstName: true, lastName: true, deletedAt: true },
  });
  if (!target) throw new NotFoundError('User');
  if (!target.deletedAt) throw new PreconditionFailedError('That user is not archived.');

  // Strip the `.archived.<timestamp>` suffix added on archive.
  const restoredEmail = target.email.replace(/\.archived\.\d+$/, '');
  const clash = await db.user.findFirst({
    where: { email: restoredEmail, id: { not: id } },
    select: { id: true },
  });

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        deletedAt: null,
        status: UserStatus.ACTIVE,
        updatedById: actor.id,
        ...(clash ? {} : { email: restoredEmail }),
      },
    });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'RESTORE',
        entityType: 'User',
        entityId: id,
        entityLabel: `${target.firstName} ${target.lastName}`,
        after: { status: UserStatus.ACTIVE, deletedAt: null },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  if (clash) {
    throw new ConflictError(
      'The user was restored, but their original email address is now used by another account. Set a new address on their profile.',
    );
  }

  return getUser(id);
};

/** Issues a new temporary password, forces a change and signs the user out. */
export const forcePasswordReset = async (
  id: string,
  actor: ServiceActor,
): Promise<{ temporaryPassword: string }> => {
  const target = await loadTarget(id);
  if (target.deletedAt) throw new NotFoundError('User');

  const targetLevel = levelOf(target.roles.map((entry) => entry.role));
  assertCanActOnLevel(actor, targetLevel, 'this user');

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedById: actor.id,
      },
    });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'PASSWORD_FORCE_RESET',
        entityType: 'User',
        entityId: id,
        entityLabel: `${target.firstName} ${target.lastName} <${target.email}>`,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  await revokeAllUserSessions(id, 'Password reset by administrator');

  await deliver(
    staffInviteEmail(target.firstName, `${serverEnv.APP_URL}/login`, temporaryPassword),
    target.email,
  );

  return { temporaryPassword };
};

export const revokeUserSessions = async (
  id: string,
  actor: ServiceActor,
): Promise<{ revoked: number }> => {
  const target = await loadTarget(id);
  const targetLevel = levelOf(target.roles.map((entry) => entry.role));
  assertCanActOnLevel(actor, targetLevel, 'this user');

  const revoked = await revokeAllUserSessions(id, `Signed out by ${actor.email}`);

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'SESSIONS_REVOKED',
    entityType: 'User',
    entityId: id,
    entityLabel: `${target.firstName} ${target.lastName} <${target.email}>`,
    after: { revokedSessions: revoked },
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return { revoked };
};

export type UserSessionSummary = {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
};

export const listUserSessions = async (
  userId: string,
  currentSessionId?: string,
): Promise<UserSessionSummary[]> => {
  const sessions = await db.session.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: {
      id: true,
      ipAddress: true,
      userAgent: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
    },
  });

  return sessions.map((session) => ({
    ...session,
    isCurrent: session.id === currentSessionId,
  }));
};

/** Lightweight directory for assignee pickers. */
export const listActiveUserOptions = async (): Promise<
  { id: string; name: string; email: string }[]
> => {
  const users = await db.user.findMany({
    where: { deletedAt: null, status: UserStatus.ACTIVE },
    orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, email: true },
    take: 500,
  });
  return users.map((user) => ({
    id: user.id,
    name: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
  }));
};

export { isSuperAdmin };
