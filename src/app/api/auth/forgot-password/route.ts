import { parseBody } from '@/lib/api/query';
import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { requestPasswordReset } from '@/server/auth-service';
import { SessionScope } from '@/generated/prisma/enums';
import { forgotPasswordSchema } from '@/validation/auth';

/**
 * POST /api/auth/forgot-password
 *
 * Always answers with the same message whether or not the address exists.
 * Anything else would turn this endpoint into an account-enumeration oracle.
 */
export const POST = withApi(async ({ request, client }) => {
  const body = await readJsonBody(request);
  const input = parseBody(forgotPasswordSchema, body);

  await requestPasswordReset(input.email, SessionScope.STAFF, {
    ipAddress: client.ipAddress,
    userAgent: client.userAgent,
  });

  return jsonOk({
    message:
      'If an account exists for that address, a reset link is on its way. The link expires in 60 minutes.',
  });
});
