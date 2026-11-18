import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonOk } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { attachCartCookie, resolveCartIdentity } from '@/lib/shop';
import { addToCart, updateCartItem } from '@/server/cart-service';
import { addToCartSchema, updateCartItemSchema } from '@/validation/cart';

/**
 * /api/shop/cart/items
 *
 * POST  adds to the basket, PATCH sets a line quantity (zero removes it).
 * Availability is checked against on-hand minus reserved on both paths, so a
 * shopper cannot stage an unfulfillable basket and discover it at checkout.
 */
export const POST = withApi(async ({ request }) => {
  const identity = await resolveCartIdentity();
  const body = await readJsonBody(request);
  const input = parseBody(addToCartSchema, body);

  const cart = await addToCart(identity, input);

  const response = jsonOk(cart);
  attachCartCookie(response.cookies, cart.token);
  return response;
});

export const PATCH = withApi(async ({ request }) => {
  const identity = await resolveCartIdentity();
  const body = await readJsonBody(request);
  const input = parseBody(updateCartItemSchema, body);

  const cart = await updateCartItem(identity, input);

  const response = jsonOk(cart);
  attachCartCookie(response.cookies, cart.token);
  return response;
});
