import { actorFrom } from '@/lib/api/actor';
import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { listAssignableRoles, listPermissionCatalog } from '@/server/role-service';

/**
 * GET /api/v1/permissions
 *
 * The permission catalogue (grouped, for the role editor) plus the roles the
 * caller is allowed to assign. The assignable list is filtered by the caller's
 * own authority, so a role picker never offers something the server would then
 * reject.
 */
export const GET = withApi(async ({ client }) => {
  const user = await requirePermission('role.read');

  const [groups, assignableRoles] = await Promise.all([
    Promise.resolve(listPermissionCatalog()),
    listAssignableRoles(actorFrom(user, client)),
  ]);

  return jsonOk({ groups, assignableRoles });
});
