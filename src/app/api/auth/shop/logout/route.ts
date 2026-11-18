import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { clearSessionCookie, readSessionToken, revokeSessionByToken } from '@/lib/auth/session';
import { SessionScope } from '@/generated/prisma/enums';

/** POST /api/auth/shop/logout -- revokes the shopper session server-side. */
export const POST = withApi(async () => {
  const token = await readSessionToken(SessionScope.CUSTOMER);
  if (token) await revokeSessionByToken(token, 'Signed out');

  const response = jsonOk({ signedOut: true });
  clearSessionCookie(response.cookies, SessionScope.CUSTOMER);
  return response;
});
