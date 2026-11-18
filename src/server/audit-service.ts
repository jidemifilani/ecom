import type { ListQuery } from '@/lib/api/query';
import { dateRangeFilter } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { db } from '@/lib/db';

/**
 * Audit-log reads.
 *
 * There are deliberately no write, update or delete operations here. Entries
 * are only ever created by `recordAudit`, which keeps the trail append-only in
 * practice as well as by intent.
 */

export type AuditLogListItem = {
  id: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  actorType: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
};

export const AUDIT_SORT_FIELDS = ['createdAt', 'action', 'entityType'] as const;
export type AuditSortField = (typeof AUDIT_SORT_FIELDS)[number];

export const listAuditLogs = async (
  query: ListQuery<AuditSortField>,
): Promise<Paginated<AuditLogListItem>> => {
  const createdAt = dateRangeFilter(query.dateFrom, query.dateTo);

  const where = {
    ...(query.filters.action ? { action: query.filters.action } : {}),
    ...(query.filters.entityType ? { entityType: query.filters.entityType } : {}),
    ...(query.filters.entityId ? { entityId: query.filters.entityId } : {}),
    ...(query.filters.actorUserId ? { actorUserId: query.filters.actorUserId } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(query.search
      ? {
          OR: [
            { actorEmail: { contains: query.search, mode: 'insensitive' as const } },
            { entityLabel: { contains: query.search, mode: 'insensitive' as const } },
            { entityId: { contains: query.search, mode: 'insensitive' as const } },
            { ipAddress: { contains: query.search, mode: 'insensitive' as const } },
            { requestId: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        actorUserId: true,
        actorEmail: true,
        actorType: true,
        action: true,
        entityType: true,
        entityId: true,
        entityLabel: true,
        before: true,
        after: true,
        ipAddress: true,
        userAgent: true,
        requestId: true,
        createdAt: true,
        actor: { select: { firstName: true, lastName: true } },
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      actorUserId: row.actorUserId,
      actorEmail: row.actorEmail,
      actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}`.trim() : null,
      actorType: row.actorType,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      entityLabel: row.entityLabel,
      before: row.before,
      after: row.after,
      ipAddress: row.ipAddress,
      userAgent: row.userAgent,
      requestId: row.requestId,
      createdAt: row.createdAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

/** Distinct values for the filter dropdowns on /audit-logs. */
export const getAuditFilterOptions = async (): Promise<{
  actions: string[];
  entityTypes: string[];
}> => {
  const [actions, entityTypes] = await Promise.all([
    db.auditLog.findMany({
      distinct: ['action'],
      select: { action: true },
      orderBy: { action: 'asc' },
      take: 100,
    }),
    db.auditLog.findMany({
      distinct: ['entityType'],
      select: { entityType: true },
      orderBy: { entityType: 'asc' },
      take: 100,
    }),
  ]);

  return {
    actions: actions.map((row) => row.action),
    entityTypes: entityTypes.map((row) => row.entityType),
  };
};

/** The trail for one record, shown on its detail page. */
export const getEntityHistory = async (
  entityType: string,
  entityId: string,
  limit = 50,
): Promise<AuditLogListItem[]> => {
  const rows = await db.auditLog.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      actorUserId: true,
      actorEmail: true,
      actorType: true,
      action: true,
      entityType: true,
      entityId: true,
      entityLabel: true,
      before: true,
      after: true,
      ipAddress: true,
      userAgent: true,
      requestId: true,
      createdAt: true,
      actor: { select: { firstName: true, lastName: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    actorUserId: row.actorUserId,
    actorEmail: row.actorEmail,
    actorName: row.actor ? `${row.actor.firstName} ${row.actor.lastName}`.trim() : null,
    actorType: row.actorType,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityLabel: row.entityLabel,
    before: row.before,
    after: row.after,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    requestId: row.requestId,
    createdAt: row.createdAt,
  }));
};

export type LoginAttemptListItem = {
  id: string;
  email: string;
  scope: string;
  successful: boolean;
  reason: string | null;
  ipAddress: string | null;
  createdAt: Date;
};

/** Recent authentication attempts, for the security tab. */
export const listLoginAttempts = async (
  query: ListQuery<'createdAt'>,
): Promise<Paginated<LoginAttemptListItem>> => {
  const createdAt = dateRangeFilter(query.dateFrom, query.dateTo);

  const where = {
    ...(query.filters.successful ? { successful: query.filters.successful === 'true' } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(query.search
      ? {
          OR: [
            { email: { contains: query.search, mode: 'insensitive' as const } },
            { ipAddress: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.loginAttempt.findMany({
      where,
      orderBy: { createdAt: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        email: true,
        scope: true,
        successful: true,
        reason: true,
        ipAddress: true,
        createdAt: true,
      },
    }),
    db.loginAttempt.count({ where }),
  ]);

  return { items: rows, total, page: query.page, pageSize: query.pageSize };
};
