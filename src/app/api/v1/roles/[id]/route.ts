import { itemRoute } from '@/lib/api/crud';
import { archiveRole, getRole, updateRole } from '@/server/role-service';
import { updateRoleSchema } from '@/validation/role';

/**
 * /api/v1/roles/[id]
 *
 * The Super Admin role is immutable and built-in roles cannot be deleted;
 * both rules are enforced in the service.
 */
export const { GET, PATCH, PUT, DELETE } = itemRoute({
  get: { permission: 'role.read', run: (id) => getRole(id) },
  update: {
    permission: 'role.update',
    schema: updateRoleSchema,
    run: (id, input, actor) => updateRole(id, input, actor),
  },
  remove: { permission: 'role.delete', run: (id, actor) => archiveRole(id, actor) },
});
