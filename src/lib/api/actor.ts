import type { CurrentUser } from '../auth/current-user';
import type { ServiceActor } from '@/server/types';

import type { ClientInfo } from '../request';

/**
 * Bridges the authenticated principal and the request metadata into the
 * `ServiceActor` the service layer expects.
 *
 * Services deliberately know nothing about cookies or requests, so this is the
 * one place where the two worlds meet.
 */
export const actorFrom = (user: CurrentUser, client: ClientInfo): ServiceActor => ({
  id: user.id,
  email: user.email,
  permissions: user.permissions,
  roleKeys: user.roleKeys,
  level: user.level,
  ipAddress: client.ipAddress,
  userAgent: client.userAgent,
  requestId: client.requestId,
  sessionId: user.sessionId,
});
