import { actorFrom } from '@/lib/api/actor';
import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonOk } from '@/lib/api/responses';
import { requireUser } from '@/lib/auth/current-user';
import { readJsonBody } from '@/lib/request';
import { updateOwnProfile } from '@/server/user-service';
import { updateProfileSchema } from '@/validation/auth';

/**
 * /api/v1/profile
 *
 * The signed-in user's own record. Needs no permission beyond a valid session,
 * because the schema cannot express a change to status or roles -- those go
 * through /api/v1/users/[id], which is permission-gated.
 *
 * The target id comes from the session, never from the request body, so this
 * cannot be pointed at another account.
 */
export const GET = withApi(async () => {
  const user = await requireUser();

  return jsonOk({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    jobTitle: user.jobTitle,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    timezone: user.timezone,
    roles: user.roles,
    hasPassword: user.hasPassword,
    mustChangePassword: user.mustChangePassword,
  });
});

export const PATCH = withApi(async ({ request, client }) => {
  const user = await requireUser();
  const body = await readJsonBody(request);
  const input = parseBody(updateProfileSchema, body);

  const updated = await updateOwnProfile(user.id, input, actorFrom(user, client));

  return jsonOk(updated);
});

export const PUT = PATCH;
