import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * GET /api/auth/session
 *
 * Returns the current principal, or `null` when not signed in. Used by the
 * client shell to recover after a session expires mid-session.
 *
 * Only non-sensitive profile fields are returned. The permission list is
 * included because the UI uses it to hide controls -- the server still
 * re-checks every permission on every request.
 */
export const GET = withApi(async () => {
  const user = await getCurrentUser();

  if (!user) return jsonOk(null);

  return jsonOk({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    jobTitle: user.jobTitle,
    mustChangePassword: user.mustChangePassword,
    hasPassword: user.hasPassword,
    roles: user.roles,
    permissions: [...user.permissions],
    isSuperAdmin: user.isSuperAdmin,
  });
});
