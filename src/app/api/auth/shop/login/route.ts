import { parseBody } from '@/lib/api/query';
import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { setSessionCookie } from '@/lib/auth/session';
import { authenticateCustomer } from '@/server/auth-service';
import { SessionScope } from '@/generated/prisma/enums';
import { customerLoginSchema } from '@/validation/auth';

/** POST /api/auth/shop/login -- storefront shopper sign-in. */
export const POST = withApi(async ({ request, client }) => {
  const body = await readJsonBody(request);
  const input = parseBody(customerLoginSchema, body);

  const result = await authenticateCustomer(input, {
    ipAddress: client.ipAddress,
    userAgent: client.userAgent,
  });

  const response = jsonOk({
    customerId: result.customerId,
    firstName: result.firstName,
    redirectTo: '/account',
  });

  setSessionCookie(
    response.cookies,
    SessionScope.CUSTOMER,
    result.session.token,
    result.session.expiresAt,
  );

  return response;
});
