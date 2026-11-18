import { parseBody } from '@/lib/api/query';
import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { resetPassword } from '@/server/auth-service';
import { SessionScope } from '@/generated/prisma/enums';
import { resetPasswordSchema } from '@/validation/auth';

/**
 * POST /api/auth/reset-password
 *
 * Consumes a single-use token. Every session for the account is revoked on
 * success, since a reset is often a response to a suspected compromise.
 */
export const POST = withApi(async ({ request, client }) => {
  const body = await readJsonBody(request);
  const input = parseBody(resetPasswordSchema, body);

  await resetPassword(
    { token: input.token, password: input.password },
    SessionScope.STAFF,
    { ipAddress: client.ipAddress, userAgent: client.userAgent },
  );

  return jsonOk({
    message: 'Your password has been changed. Sign in with your new password.',
  });
});
