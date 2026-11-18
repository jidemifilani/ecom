import { db, type DbClient } from './db';
import { logger, redact } from './logger';

/**
 * Audit trail.
 *
 * Writes are append-only: nothing in the application updates or deletes an
 * `audit_logs` row. Where a mutation already runs inside a transaction the
 * audit entry is written with the same client, so the record and its trail
 * commit or roll back together.
 *
 * Values are redacted before they are stored, so a password hash or token can
 * never end up in the trail by way of a careless `before`/`after` payload.
 */

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'ARCHIVE'
  | 'RESTORE'
  | 'DELETE'
  | 'LOGIN'
  | 'LOGIN_FAILED'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'PASSWORD_FORCE_RESET'
  | 'ROLES_ASSIGNED'
  | 'PERMISSIONS_CHANGED'
  | 'SESSIONS_REVOKED'
  | 'SETTING_UPDATED'
  | 'ORDER_STATUS_CHANGED'
  | 'ORDER_FULFILLED'
  | 'ORDER_CANCELLED'
  | 'ORDER_REFUNDED'
  | 'STOCK_ADJUSTED'
  | 'REVIEW_MODERATED'
  | 'EXPORTED';

export type AuditActor = {
  userId?: string | null;
  email?: string | null;
  type?: 'USER' | 'CUSTOMER' | 'SYSTEM';
};

export type AuditEntry = {
  actor: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  /** Short human label so the log reads well without joining other tables. */
  entityLabel?: string | null;
  before?: unknown;
  after?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
};

type JsonValue = Parameters<typeof JSON.stringify>[0];

const asJson = (value: unknown): JsonValue | undefined => {
  if (value === undefined || value === null) return undefined;
  return redact(value) as JsonValue;
};

/**
 * Writes one audit entry. Failures are logged but never thrown: losing a trail
 * row must not roll back a completed business action. Pass a transaction client
 * when atomicity with the mutation is required.
 */
export const recordAudit = async (entry: AuditEntry, client: DbClient = db): Promise<void> => {
  try {
    await client.auditLog.create({
      data: {
        actorUserId: entry.actor.userId ?? null,
        actorEmail: entry.actor.email ?? null,
        actorType: entry.actor.type ?? 'USER',
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        entityLabel: entry.entityLabel?.slice(0, 240) ?? null,
        before: asJson(entry.before) ?? null,
        after: asJson(entry.after) ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent?.slice(0, 512) ?? null,
        requestId: entry.requestId ?? null,
      },
    });
  } catch (error) {
    logger.error('Failed to write audit log entry', {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      error,
    });
  }
};

/**
 * Reduces two snapshots to only the fields that actually changed, so the trail
 * shows "price: 1999 -> 1799" rather than the whole record twice.
 */
export const diffSnapshots = <T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown> } => {
  const beforeDiff: Record<string, unknown> = {};
  const afterDiff: Record<string, unknown> = {};

  if (!before) return { before: {}, after: after ? { ...after } : {} };
  if (!after) return { before: { ...before }, after: {} };

  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const previous = before[key];
    const next = after[key];
    if (!isEqual(previous, next)) {
      beforeDiff[key] = previous ?? null;
      afterDiff[key] = next ?? null;
    }
  }

  return { before: beforeDiff, after: afterDiff };
};

const isEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return false;
};
