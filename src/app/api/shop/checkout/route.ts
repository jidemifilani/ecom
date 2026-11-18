import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonCreated } from '@/lib/api/responses';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readJsonBody } from '@/lib/request';
import { resolveCartIdentity } from '@/lib/shop';
import { checkout } from '@/server/cart-service';
import { checkoutSchema } from '@/validation/cart';

/**
 * POST /api/shop/checkout
 *
 * Converts the basket into an order. Everything is re-validated at this point
 * -- stock, live prices and the discount code -- so a basket that has gone
 * stale fails here rather than producing a mispriced order. The request body
 * carries no prices at all.
 */
export const POST = withApi(async ({ request, client }) => {
  await enforceRateLimit('checkout', client.ipAddress ?? 'unknown');

  const identity = await resolveCartIdentity();
  const body = await readJsonBody(request);
  const input = parseBody(checkoutSchema, body);

  const result = await checkout(identity, input, {
    ipAddress: client.ipAddress,
    userAgent: client.userAgent,
  });

  return jsonCreated(result);
});
