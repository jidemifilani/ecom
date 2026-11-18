import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonOk } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { attachCartCookie, resolveCartIdentity } from '@/lib/shop';
import { applyCartDiscount } from '@/server/cart-service';
import { applyDiscountSchema } from '@/validation/discount';

/**
 * /api/shop/cart/discount
 *
 * POST attaches a code, DELETE removes it. The code is stored on the cart, not
 * the amount: the saving is recomputed on every read and again at checkout, so
 * a code that expires mid-session cannot be banked.
 *
 * An inapplicable code is not an error. It is stored and the reason is
 * returned in `discountMessage`, so the shopper sees why it did not apply
 * instead of a dead form.
 */
export const POST = withApi(async ({ request }) => {
  const identity = await resolveCartIdentity();
  const body = await readJsonBody(request);
  const input = parseBody(applyDiscountSchema, body);

  const cart = await applyCartDiscount(identity, input.code);

  const response = jsonOk(cart);
  attachCartCookie(response.cookies, cart.token);
  return response;
});

export const DELETE = withApi(async () => {
  const identity = await resolveCartIdentity();
  const cart = await applyCartDiscount(identity, null);

  const response = jsonOk(cart);
  attachCartCookie(response.cookies, cart.token);
  return response;
});
