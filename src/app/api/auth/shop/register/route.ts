import { parseBody } from '@/lib/api/query';
import { withApi } from '@/lib/api/handler';
import { jsonCreated } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { setSessionCookie } from '@/lib/auth/session';
import { registerCustomer } from '@/server/auth-service';
import { SessionScope } from '@/generated/prisma/enums';
import { customerRegisterSchema } from '@/validation/auth';

/**
 * POST /api/auth/shop/register
 *
 * Creates a shopper account and signs them straight in. A guest who has
 * ordered before with the same address claims that existing record rather than
 * being told the email is taken.
 */
export const POST = withApi(async ({ request, client }) => {
  const body = await readJsonBody(request);
  const input = parseBody(customerRegisterSchema, body);

  const result = await registerCustomer(
    {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      password: input.password,
      marketingOptIn: input.marketingOptIn,
    },
    { ipAddress: client.ipAddress, userAgent: client.userAgent },
  );

  const response = jsonCreated({
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
