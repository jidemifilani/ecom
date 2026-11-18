import type { PermissionKey } from '@/lib/rbac/permissions';

/**
 * The actor passed into every service call.
 *
 * Services never read the request or the session themselves - the route (or
 * server component) resolves the principal and hands it down. That keeps the
 * service layer free of transport concerns and makes it directly testable:
 * a test constructs an actor object rather than faking cookies.
 *
 * It structurally satisfies `AuthorizablePrincipal`, so the pure guards in
 * `src/lib/rbac/guard.ts` accept it as-is.
 */
export type ServiceActor = {
  id: string;
  email: string;
  permissions: ReadonlySet<PermissionKey> | readonly PermissionKey[];
  roleKeys: readonly string[];
  level: number;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
  /** Present when the action came from a signed-in session. */
  sessionId?: string | undefined;
};

export const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

/** A system actor, for seeds, scheduled jobs and background tasks. */
export const SYSTEM_ACTOR: ServiceActor = {
  id: SYSTEM_ACTOR_ID,
  email: 'system@internal',
  permissions: [],
  roleKeys: ['super_admin'],
  level: 0,
};

/**
 * Converts an actor into the shape `recordAudit` expects.
 *
 * The system actor has no row in `users`, so its id must be written as null -
 * otherwise the audit insert would fail a foreign-key check. The email is still
 * recorded, so the trail shows who acted.
 */
export const auditActorFor = (
  actor: ServiceActor,
): { userId: string | null; email: string; type: 'USER' | 'SYSTEM' } => {
  const isSystem = actor.id === SYSTEM_ACTOR_ID;
  return {
    userId: isSystem ? null : actor.id,
    email: actor.email,
    type: isSystem ? 'SYSTEM' : 'USER',
  };
};
