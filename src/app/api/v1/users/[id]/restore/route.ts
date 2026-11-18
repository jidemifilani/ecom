import { actionRoute } from '@/lib/api/crud';
import { restoreUser } from '@/server/user-service';

/**
 * POST /api/v1/users/[id]/restore
 *
 * Un-archives a user and reactivates the account. The service restores the
 * original email address where it is still free, and reports a conflict when
 * another account has taken it in the meantime.
 */
export const POST = actionRoute({
  permission: 'user.update',
  run: (id, _input, actor) => restoreUser(id, actor),
});
