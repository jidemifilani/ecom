import { collectionRoute } from '@/lib/api/crud';
import { createRole, listRoles } from '@/server/role-service';
import { createRoleSchema, ROLE_SORT_FIELDS } from '@/validation/role';

/** /api/v1/roles -- list and create roles. */
export const { GET, POST } = collectionRoute({
  list: {
    permission: 'role.read',
    sortable: ROLE_SORT_FIELDS,
    defaultSort: 'level',
    defaultSortOrder: 'asc',
    run: (query) => listRoles(query),
  },
  create: {
    permission: 'role.create',
    schema: createRoleSchema,
    run: (input, actor) => createRole(input, actor),
  },
});
