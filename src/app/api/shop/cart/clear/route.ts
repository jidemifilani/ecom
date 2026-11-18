import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { attachCartCookie, resolveCartIdentity } from '@/lib/shop';
import { clearCart } from '@/server/cart-service';

/** POST /api/shop/cart/clear -- empties the basket and drops any discount. */
export const POST = withApi(async () => {
  const identity = await resolveCartIdentity();
  const cart = await clearCart(identity);

  const response = jsonOk(cart);
  attachCartCookie(response.cookies, cart.token);
  return response;
});
