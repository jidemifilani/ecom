import { parseBody } from '@/lib/api/query';
import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { resetPassword } from '@/server/auth-service';
import { SessionScope } from '@/generated/prisma/enums';
import { resetPasswordSchema } from '@/validation/auth';

/** POST /api/auth/shop/reset-password -- consumes a shopper reset token. */
export const POST = withApi(async ({ request, client }) => {
  const body = await readJsonBody(request);
  const input = parseBody(resetPasswordSchema, body);

  await resetPassword(
    { token: input.token, password: input.password },
    SessionScope.CUSTOMER,
    { ipAddress: client.ipAddress, userAgent: client.userAgent },
  );

  return jsonOk({ message: 'Your password has been changed. Please sign in.' });
});
