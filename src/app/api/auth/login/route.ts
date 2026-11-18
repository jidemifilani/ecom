import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { parseBody } from '@/lib/api/query';
import { setSessionCookie } from '@/lib/auth/session';
import { authenticateStaff } from '@/server/auth-service';
import { SessionScope } from '@/generated/prisma/enums';
import { loginSchema } from '@/validation/auth';

/**
 * POST /api/auth/login
 *
 * Staff sign-in. The session cookie is set on the response rather than through
 * `cookies()` so the Set-Cookie header is attached to exactly this response.
 *
 * CSRF is intentionally left on: the login form reads the double-submit token
 * from its cookie like every other mutating request, which blocks login-CSRF
 * (an attacker silently signing a victim into an account they control).
 */
export const POST = withApi(async ({ request, client }) => {
  const body = await readJsonBody(request);
  const input = parseBody(loginSchema, body);

  const result = await authenticateStaff(
    { email: input.email, password: input.password },
    { ipAddress: client.ipAddress, userAgent: client.userAgent },
  );

  const response = jsonOk({
    userId: result.userId,
    email: result.email,
    firstName: result.firstName,
    mustChangePassword: result.mustChangePassword,
    // The client uses this to decide where to send the user next.
    redirectTo: result.mustChangePassword ? '/profile?changePassword=1' : '/dashboard',
  });

  setSessionCookie(
    response.cookies,
    SessionScope.STAFF,
    result.session.token,
    result.session.expiresAt,
  );

  return response;
});
