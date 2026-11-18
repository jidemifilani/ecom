import { actionRoute } from '@/lib/api/crud';
import { assignRoles } from '@/server/user-service';
import { assignRolesSchema } from '@/validation/user';

/**
 * PUT /api/v1/users/[id]/roles
 *
 * Replaces a user's role set. Guarded against self-modification and against
 * granting a role more powerful than the caller's own.
 */
export const PUT = actionRoute({
  permission: 'user.assign_roles',
  schema: assignRolesSchema,
  run: (id, input, actor) => assignRoles(id, input, actor),
});

export const POST = PUT;
