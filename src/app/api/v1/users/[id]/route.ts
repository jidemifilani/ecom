import { itemRoute } from '@/lib/api/crud';
import { archiveUser, getUser, updateUser } from '@/server/user-service';
import { updateUserSchema } from '@/validation/user';

/**
 * /api/v1/users/[id]
 *
 * DELETE archives rather than hard-deletes, so audit history and
 * created-by references survive.
 */
export const { GET, PATCH, PUT, DELETE } = itemRoute({
  get: { permission: 'user.read', run: (id) => getUser(id) },
  update: {
    permission: 'user.update',
    schema: updateUserSchema,
    run: (id, input, actor) => updateUser(id, input, actor),
  },
  remove: { permission: 'user.delete', run: (id, actor) => archiveUser(id, actor) },
});
