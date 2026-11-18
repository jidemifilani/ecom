import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { getCurrentUser } from '@/lib/auth/current-user';
import { clearSessionCookie, readSessionToken } from '@/lib/auth/session';
import { logoutStaff } from '@/server/auth-service';
import { SessionScope } from '@/generated/prisma/enums';

/**
 * POST /api/auth/logout
 *
 * Revokes the session server-side as well as clearing the cookie, so a copied
 * cookie value cannot be replayed after sign-out.
 */
export const POST = withApi(async ({ client }) => {
  const [user, token] = await Promise.all([
    getCurrentUser(),
    readSessionToken(SessionScope.STAFF),
  ]);

  if (token && user) {
    await logoutStaff(token, { id: user.id, email: user.email }, {
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
    });
  }

  const response = jsonOk({ signedOut: true });
  clearSessionCookie(response.cookies, SessionScope.STAFF);
  return response;
});
