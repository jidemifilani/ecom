import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';

import { getCurrentCustomer } from './auth/current-user';
import { isProduction } from './env';
import { CART_COOKIE, type CartIdentity } from '@/server/cart-service';

/**
 * Storefront request helpers.
 *
 * The cart is addressed either by the signed-in customer or by an opaque token
 * cookie for guests. Resolving both here keeps every shop route from
 * re-implementing the same precedence rule.
 */

export const resolveCartIdentity = async (): Promise<CartIdentity> => {
  const [store, customer] = await Promise.all([cookies(), getCurrentCustomer()]);

  return {
    token: store.get(CART_COOKIE)?.value,
    customerId: customer?.id,
  };
};

/**
 * Writes the cart token back to the browser. Called on every cart response
 * because a guest's first action is what creates the cart in the first place.
 *
 * httpOnly: the token identifies a basket, and client code never needs to read
 * it -- all cart operations go through the API.
 */
export const attachCartCookie = (
  target: Pick<NextResponse['cookies'], 'set'>,
  token: string,
): void => {
  target.set(CART_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
};
