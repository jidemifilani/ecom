import { withApi } from '@/lib/api/handler';
import { parseListQuery } from '@/lib/api/query';
import { jsonPaginated } from '@/lib/api/responses';
import { requireUser } from '@/lib/auth/current-user';
import { listNotifications } from '@/server/notification-service';

/**
 * GET /api/v1/notifications
 *
 * Scoped to the signed-in user. The recipient id is taken from the session,
 * never from the query string, and no permission exists that would let one
 * user read another user's notifications.
 */
export const GET = withApi(async ({ searchParams }) => {
  const user = await requireUser();

  const query = parseListQuery(searchParams, {
    sortable: ['createdAt'] as const,
    defaultSort: 'createdAt',
    filterKeys: ['unread', 'level'],
  });

  const result = await listNotifications(user.id, query);

  return jsonPaginated(result, { unreadCount: result.unreadCount });
});
