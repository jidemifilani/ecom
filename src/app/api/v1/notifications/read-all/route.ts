import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { requireUser } from '@/lib/auth/current-user';
import { markAllNotificationsRead } from '@/server/notification-service';

/** POST /api/v1/notifications/read-all -- clears the caller's unread badge. */
export const POST = withApi(async () => {
  const user = await requireUser();
  const count = await markAllNotificationsRead(user.id);
  return jsonOk({ markedRead: count });
});
