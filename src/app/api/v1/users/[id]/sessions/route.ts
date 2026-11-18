import { actorFrom } from '@/lib/api/actor';
import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { listUserSessions, revokeUserSessions } from '@/server/user-service';

/**
 * /api/v1/users/[id]/sessions
 *
 * GET    - active sessions, with the caller's own marked so the UI can label it.
 * DELETE - signs the user out everywhere.
 */
export const GET = withApi<{ id: string }>(async ({ params }) => {
  const user = await requirePermission('user.read');
  const sessions = await listUserSessions(params.id, user.sessionId);
  return jsonOk(sessions);
});

export const DELETE = withApi<{ id: string }>(async ({ params, client }) => {
  const user = await requirePermission('user.revoke_sessions');
  const result = await revokeUserSessions(params.id, actorFrom(user, client));
  return jsonOk(result);
});
