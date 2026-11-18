import { parseBody } from '@/lib/api/query';
import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { requestPasswordReset } from '@/server/auth-service';
import { SessionScope } from '@/generated/prisma/enums';
import { forgotPasswordSchema } from '@/validation/auth';

/** POST /api/auth/shop/forgot-password -- non-enumerable shopper reset request. */
export const POST = withApi(async ({ request, client }) => {
  const body = await readJsonBody(request);
  const input = parseBody(forgotPasswordSchema, body);

  await requestPasswordReset(input.email, SessionScope.CUSTOMER, {
    ipAddress: client.ipAddress,
    userAgent: client.userAgent,
  });

  return jsonOk({
    message: 'If an account exists for that address, a reset link is on its way.',
  });
});
