import { NotFoundError } from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { db } from '@/lib/db';
import { NotificationLevel } from '@/generated/prisma/enums';

/** Reads and read-state changes for in-app notifications. */

export type NotificationListItem = {
  id: string;
  type: string;
  level: NotificationLevel;
  title: string;
  body: string;
  entityType: string | null;
  entityId: string | null;
  actionUrl: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export const NOTIFICATION_SORT_FIELDS = ['createdAt'] as const;

export const listNotifications = async (
  userId: string,
  query: ListQuery<'createdAt'>,
): Promise<Paginated<NotificationListItem> & { unreadCount: number }> => {
  const where = {
    userId,
    ...(query.filters.unread === 'true' ? { readAt: null } : {}),
    ...(query.filters.level ? { level: query.filters.level as NotificationLevel } : {}),
    ...(query.search
      ? {
          OR: [
            { title: { contains: query.search, mode: 'insensitive' as const } },
            { body: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        type: true,
        level: true,
        title: true,
        body: true,
        entityType: true,
        entityId: true,
        actionUrl: true,
        readAt: true,
        createdAt: true,
      },
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);

  return {
    items: rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    unreadCount,
  };
};

/** The newest few, for the topbar dropdown. */
export const getNotificationPreview = async (
  userId: string,
  limit = 6,
): Promise<{ items: NotificationListItem[]; unreadCount: number }> => {
  const [items, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        type: true,
        level: true,
        title: true,
        body: true,
        entityType: true,
        entityId: true,
        actionUrl: true,
        readAt: true,
        createdAt: true,
      },
    }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);

  return { items, unreadCount };
};

/**
 * Marks one notification read. Scoped by `userId` so a caller cannot touch
 * somebody else's row by guessing its id.
 */
export const markNotificationRead = async (
  id: string,
  userId: string,
  read = true,
): Promise<void> => {
  const result = await db.notification.updateMany({
    where: { id, userId },
    data: { readAt: read ? new Date() : null },
  });
  if (result.count === 0) throw new NotFoundError('Notification');
};

export const markAllNotificationsRead = async (userId: string): Promise<number> => {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
};

export const deleteNotification = async (id: string, userId: string): Promise<void> => {
  const result = await db.notification.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new NotFoundError('Notification');
};

export const listCustomerNotifications = async (
  customerId: string,
  limit = 20,
): Promise<NotificationListItem[]> =>
  db.notification.findMany({
    where: { customerId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      level: true,
      title: true,
      body: true,
      entityType: true,
      entityId: true,
      actionUrl: true,
      readAt: true,
      createdAt: true,
    },
  });
