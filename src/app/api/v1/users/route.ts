import { collectionRoute } from '@/lib/api/crud';
import { createUser, listUsers } from '@/server/user-service';
import { createUserSchema, USER_SORT_FIELDS } from '@/validation/user';

/**
 * /api/v1/users
 *
 * GET  - paginated, searchable staff directory.
 * POST - invites a new staff user. The service refuses to grant a role that
 *        outranks the caller, so this endpoint cannot be used to escalate.
 */
export const { GET, POST } = collectionRoute({
  list: {
    permission: 'user.read',
    sortable: USER_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: ['status', 'roleId'],
    run: (query) => listUsers(query),
  },
  create: {
    permission: 'user.create',
    schema: createUserSchema,
    run: (input, actor) => createUser(input, actor),
    location: (created) =>
      typeof created === 'object' && created !== null && 'id' in created
        ? `/api/v1/users/${String((created as { id: string }).id)}`
        : undefined,
  },
});
