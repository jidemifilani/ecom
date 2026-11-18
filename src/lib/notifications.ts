import { db, type DbClient } from './db';
import { logger } from './logger';
import type { PermissionKey } from './rbac/permissions';
import { NotificationLevel, UserStatus } from '@/generated/prisma/enums';

/**
 * In-app notifications.
 *
 * Staff notifications are addressed by *permission*, not by role or by name:
 * "tell everyone who can read orders" survives any later reorganisation of
 * roles. Super admins always receive permission-targeted notifications, since
 * they implicitly hold every permission.
 */

export type NotificationInput = {
  type: string;
  title: string;
  body: string;
  level?: NotificationLevel;
  entityType?: string;
  entityId?: string;
  actionUrl?: string;
};

export const notifyUser = async (
  userId: string,
  input: NotificationInput,
  client: DbClient = db,
): Promise<void> => {
  try {
    await client.notification.create({
      data: {
        userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
        level: input.level ?? NotificationLevel.INFO,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
      },
    });
  } catch (error) {
    logger.error('Failed to create notification', { userId, type: input.type, error });
  }
};

export const notifyCustomer = async (
  customerId: string,
  input: NotificationInput,
  client: DbClient = db,
): Promise<void> => {
  try {
    await client.notification.create({
      data: {
        customerId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
        level: input.level ?? NotificationLevel.INFO,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
      },
    });
  } catch (error) {
    logger.error('Failed to create customer notification', { customerId, type: input.type, error });
  }
};

/**
 * Fans a notification out to every active staff user who holds `permission`
 * (directly or by being a super admin).
 */
export const notifyPermissionHolders = async (
  permission: PermissionKey,
  input: NotificationInput,
  options?: { excludeUserId?: string; client?: DbClient },
): Promise<number> => {
  const client = options?.client ?? db;

  try {
    const recipients = await client.user.findMany({
      where: {
        deletedAt: null,
        status: UserStatus.ACTIVE,
        ...(options?.excludeUserId ? { id: { not: options.excludeUserId } } : {}),
        roles: {
          some: {
            role: {
              deletedAt: null,
              OR: [
                { key: 'super_admin' },
                { permissions: { some: { permission: { key: permission } } } },
              ],
            },
          },
        },
      },
      select: { id: true },
    });

    if (recipients.length === 0) return 0;

    await client.notification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
        level: input.level ?? NotificationLevel.INFO,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        actionUrl: input.actionUrl ?? null,
      })),
    });

    return recipients.length;
  } catch (error) {
    logger.error('Failed to fan out notification', { permission, type: input.type, error });
    return 0;
  }
};

export const countUnread = async (userId: string): Promise<number> =>
  db.notification.count({ where: { userId, readAt: null } });

export const markAllRead = async (userId: string): Promise<number> => {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
};
