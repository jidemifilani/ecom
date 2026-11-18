import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { attachCartCookie, resolveCartIdentity } from '@/lib/shop';
import { getCartView } from '@/server/cart-service';

/**
 * GET /api/shop/cart
 *
 * Returns the basket with freshly computed totals. Prices and stock are read
 * live, so a basket left open overnight shows today's prices and flags lines
 * that have since sold out.
 */
export const GET = withApi(async () => {
  const identity = await resolveCartIdentity();
  const cart = await getCartView(identity);

  const response = jsonOk(cart);
  attachCartCookie(response.cookies, cart.token);
  return response;
});
