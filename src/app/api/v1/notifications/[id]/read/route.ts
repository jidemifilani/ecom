import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { requireUser } from '@/lib/auth/current-user';
import { markNotificationRead } from '@/server/notification-service';

/**
 * /api/v1/notifications/[id]/read
 *
 * POST marks read, DELETE marks unread again. Both updates are scoped by the
 * session's user id, so guessing another user's notification id changes
 * nothing and returns 404.
 */
export const POST = withApi<{ id: string }>(async ({ params }) => {
  const user = await requireUser();
  await markNotificationRead(params.id, user.id, true);
  return jsonOk({ read: true });
});

export const DELETE = withApi<{ id: string }>(async ({ params }) => {
  const user = await requireUser();
  await markNotificationRead(params.id, user.id, false);
  return jsonOk({ read: false });
});
