import { NotFoundError, PreconditionFailedError, ValidationError } from '@/lib/api/errors';
import { generateToken } from '@/lib/auth/tokens';
import { db, type DbClient } from '@/lib/db';
import { CartStatus } from '@/generated/prisma/enums';
import type { AddToCartInput, CheckoutInput, UpdateCartItemInput } from '@/validation/cart';

import { priceOrder, placeOrder, type OrderTotals } from './order-service';
import { getStoreConfig } from './settings-service';
import { SYSTEM_ACTOR, type ServiceActor } from './types';

/**
 * Storefront cart.
 *
 * A guest cart is keyed by an opaque token held in a cookie; a signed-in
 * shopper's cart is keyed by their customer id. When a guest signs in, their
 * token cart is merged into their account cart rather than being discarded.
 *
 * Totals are never stored on the cart. They are recomputed by `priceOrder` on
 * every read, which is the same function the checkout uses - so the figure the
 * shopper sees in the basket is the figure they are charged.
 */

export const CART_COOKIE = 'ecom_cart';
const CART_TTL_DAYS = 30;
const MAX_CART_LINES = 50;
const MAX_LINE_QUANTITY = 999;

const expiryDate = (): Date => new Date(Date.now() + CART_TTL_DAYS * 24 * 60 * 60 * 1000);

export type CartIdentity = {
  token?: string | undefined;
  customerId?: string | undefined;
};

/**
 * Resolves the caller's active cart, creating one when needed.
 * Returns the cart id and the token to write back to the cookie.
 */
export const getOrCreateCart = async (
  identity: CartIdentity,
  client: DbClient = db,
): Promise<{ id: string; token: string }> => {
  const config = await getStoreConfig();

  if (identity.customerId) {
    const owned = await client.cart.findFirst({
      where: { customerId: identity.customerId, status: CartStatus.ACTIVE },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, token: true },
    });

    if (owned) {
      // A guest cart from before sign-in gets folded in.
      if (identity.token && identity.token !== owned.token) {
        await mergeGuestCart(identity.token, owned.id, client);
      }
      return owned;
    }

    // Adopt the guest cart if there is one, otherwise start fresh.
    if (identity.token) {
      const guest = await client.cart.findFirst({
        where: { token: identity.token, status: CartStatus.ACTIVE, customerId: null },
        select: { id: true, token: true },
      });
      if (guest) {
        await client.cart.update({
          where: { id: guest.id },
          data: { customerId: identity.customerId, expiresAt: expiryDate() },
        });
        return guest;
      }
    }

    const created = await client.cart.create({
      data: {
        token: generateToken(24),
        customerId: identity.customerId,
        currency: config.currency,
        expiresAt: expiryDate(),
      },
      select: { id: true, token: true },
    });
    return created;
  }

  if (identity.token) {
    const existing = await client.cart.findFirst({
      where: { token: identity.token, status: CartStatus.ACTIVE },
      select: { id: true, token: true },
    });
    if (existing) return existing;
  }

  const created = await client.cart.create({
    data: {
      token: generateToken(24),
      currency: config.currency,
      expiresAt: expiryDate(),
    },
    select: { id: true, token: true },
  });
  return created;
};

/** Folds a guest cart's lines into the target cart, then marks it converted. */
const mergeGuestCart = async (
  guestToken: string,
  targetCartId: string,
  client: DbClient,
): Promise<void> => {
  const guest = await client.cart.findFirst({
    where: { token: guestToken, status: CartStatus.ACTIVE, customerId: null },
    select: { id: true, items: { select: { variantId: true, quantity: true, unitPrice: true } } },
  });
  if (!guest || guest.items.length === 0) return;

  for (const item of guest.items) {
    const existing = await client.cartItem.findUnique({
      where: { cartId_variantId: { cartId: targetCartId, variantId: item.variantId } },
      select: { id: true, quantity: true },
    });

    if (existing) {
      await client.cartItem.update({
        where: { id: existing.id },
        data: {
          quantity: Math.min(MAX_LINE_QUANTITY, existing.quantity + item.quantity),
        },
      });
    } else {
      await client.cartItem.create({
        data: {
          cartId: targetCartId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        },
      });
    }
  }

  await client.cart.update({
    where: { id: guest.id },
    data: { status: CartStatus.CONVERTED },
  });
};

export type CartLineView = {
  variantId: string;
  productId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  imageUrl: string | null;
  imageAlt: string;
  available: number;
  /** True when the line exceeds what is in stock and must be reduced. */
  exceedsStock: boolean;
};

export type CartView = {
  id: string;
  token: string;
  itemCount: number;
  lines: CartLineView[];
  totals: Omit<OrderTotals, 'lines'> | null;
  discountCode: string | null;
  discountMessage: string | null;
  /** True when nothing blocks checkout. */
  checkoutReady: boolean;
};

export const getCartView = async (identity: CartIdentity): Promise<CartView> => {
  const cart = await getOrCreateCart(identity);

  const record = await db.cart.findUniqueOrThrow({
    where: { id: cart.id },
    select: {
      id: true,
      token: true,
      discountCode: true,
      customerId: true,
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          variantId: true,
          quantity: true,
          unitPrice: true,
          variant: {
            select: {
              id: true,
              sku: true,
              name: true,
              price: true,
              isDefault: true,
              isActive: true,
              deletedAt: true,
              inventoryItem: {
                select: { quantityOnHand: true, quantityReserved: true, allowBackorder: true },
              },
              product: {
                select: {
                  id: true,
                  name: true,
                  slug: true,
                  deletedAt: true,
                  status: true,
                  images: { orderBy: { position: 'asc' }, take: 1, select: { url: true, alt: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  // Silently drop lines whose product has gone away, so a stale cart cannot
  // block the basket page from rendering.
  const live = record.items.filter(
    (item) =>
      item.variant.deletedAt === null &&
      item.variant.isActive &&
      item.variant.product.deletedAt === null &&
      item.variant.product.status === 'ACTIVE',
  );

  const lines: CartLineView[] = live.map((item) => {
    const inventory = item.variant.inventoryItem;
    const available = inventory?.allowBackorder
      ? Number.MAX_SAFE_INTEGER
      : Math.max(0, (inventory?.quantityOnHand ?? 0) - (inventory?.quantityReserved ?? 0));

    return {
      variantId: item.variantId,
      productId: item.variant.product.id,
      productSlug: item.variant.product.slug,
      productName: item.variant.product.name,
      variantName: item.variant.isDefault ? '' : item.variant.name,
      sku: item.variant.sku,
      // Always price from the live catalogue, not the stored snapshot.
      unitPrice: item.variant.price,
      quantity: item.quantity,
      lineTotal: item.variant.price * item.quantity,
      imageUrl: item.variant.product.images[0]?.url ?? null,
      imageAlt: item.variant.product.images[0]?.alt ?? item.variant.product.name,
      available,
      exceedsStock: item.quantity > available,
    };
  });

  if (lines.length === 0) {
    return {
      id: record.id,
      token: record.token,
      itemCount: 0,
      lines: [],
      totals: null,
      discountCode: record.discountCode,
      discountMessage: null,
      checkoutReady: false,
    };
  }

  const priced = await priceOrder(
    lines.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
    {
      discountCode: record.discountCode ?? undefined,
      customerId: record.customerId ?? undefined,
    },
  );

  const { lines: _pricedLines, ...totals } = priced;

  return {
    id: record.id,
    token: record.token,
    itemCount: lines.reduce((total, line) => total + line.quantity, 0),
    lines,
    totals,
    discountCode: priced.discountCode,
    discountMessage: priced.discountMessage,
    checkoutReady: lines.length > 0 && !lines.some((line) => line.exceedsStock),
  };
};

export const addToCart = async (
  identity: CartIdentity,
  input: AddToCartInput,
): Promise<CartView> => {
  const cart = await getOrCreateCart(identity);

  const variant = await db.productVariant.findFirst({
    where: {
      id: input.variantId,
      deletedAt: null,
      isActive: true,
      product: { deletedAt: null, status: 'ACTIVE' },
    },
    select: {
      id: true,
      price: true,
      inventoryItem: {
        select: { quantityOnHand: true, quantityReserved: true, allowBackorder: true },
      },
    },
  });

  if (!variant) throw new NotFoundError('That item');

  const inventory = variant.inventoryItem;
  const available = inventory?.allowBackorder
    ? MAX_LINE_QUANTITY
    : Math.max(0, (inventory?.quantityOnHand ?? 0) - (inventory?.quantityReserved ?? 0));

  const existing = await db.cartItem.findUnique({
    where: { cartId_variantId: { cartId: cart.id, variantId: input.variantId } },
    select: { id: true, quantity: true },
  });

  const lineCount = await db.cartItem.count({ where: { cartId: cart.id } });
  if (!existing && lineCount >= MAX_CART_LINES) {
    throw new PreconditionFailedError(
      `A basket can hold up to ${MAX_CART_LINES} different items.`,
    );
  }

  const desired = (existing?.quantity ?? 0) + input.quantity;

  if (desired > available) {
    throw new PreconditionFailedError(
      available === 0
        ? 'That item is out of stock.'
        : `Only ${available} unit(s) of that item are available.`,
    );
  }

  const quantity = Math.min(desired, MAX_LINE_QUANTITY);

  if (existing) {
    await db.cartItem.update({ where: { id: existing.id }, data: { quantity } });
  } else {
    await db.cartItem.create({
      data: {
        cartId: cart.id,
        variantId: input.variantId,
        quantity,
        unitPrice: variant.price,
      },
    });
  }

  await db.cart.update({ where: { id: cart.id }, data: { expiresAt: expiryDate() } });

  return getCartView({ ...identity, token: cart.token });
};

export const updateCartItem = async (
  identity: CartIdentity,
  input: UpdateCartItemInput,
): Promise<CartView> => {
  const cart = await getOrCreateCart(identity);

  if (input.quantity === 0) {
    await db.cartItem.deleteMany({ where: { cartId: cart.id, variantId: input.variantId } });
    return getCartView({ ...identity, token: cart.token });
  }

  const variant = await db.productVariant.findFirst({
    where: { id: input.variantId, deletedAt: null },
    select: {
      id: true,
      inventoryItem: {
        select: { quantityOnHand: true, quantityReserved: true, allowBackorder: true },
      },
    },
  });
  if (!variant) throw new NotFoundError('That item');

  const inventory = variant.inventoryItem;
  const available = inventory?.allowBackorder
    ? MAX_LINE_QUANTITY
    : Math.max(0, (inventory?.quantityOnHand ?? 0) - (inventory?.quantityReserved ?? 0));

  if (input.quantity > available) {
    throw new PreconditionFailedError(
      available === 0
        ? 'That item is out of stock.'
        : `Only ${available} unit(s) of that item are available.`,
    );
  }

  await db.cartItem.updateMany({
    where: { cartId: cart.id, variantId: input.variantId },
    data: { quantity: Math.min(input.quantity, MAX_LINE_QUANTITY) },
  });

  return getCartView({ ...identity, token: cart.token });
};

export const clearCart = async (identity: CartIdentity): Promise<CartView> => {
  const cart = await getOrCreateCart(identity);
  await db.cartItem.deleteMany({ where: { cartId: cart.id } });
  await db.cart.update({ where: { id: cart.id }, data: { discountCode: null } });
  return getCartView({ ...identity, token: cart.token });
};

export const applyCartDiscount = async (
  identity: CartIdentity,
  code: string | null,
): Promise<CartView> => {
  const cart = await getOrCreateCart(identity);
  await db.cart.update({
    where: { id: cart.id },
    data: { discountCode: code ? code.trim().toUpperCase() : null },
  });
  return getCartView({ ...identity, token: cart.token });
};

// ── Checkout ─────────────────────────────────────────────────────────────────

export type CheckoutResult = {
  orderId: string;
  orderNumber: string;
  grandTotal: number;
  currency: string;
};

/**
 * Turns the cart into an order.
 *
 * Re-validates everything at the point of sale: stock, prices and the discount
 * are all recomputed, so a basket that has gone stale (or been tampered with on
 * the client) fails here rather than producing a mispriced order.
 */
export const checkout = async (
  identity: CartIdentity,
  input: CheckoutInput,
  context: { ipAddress?: string | undefined; userAgent?: string | undefined },
): Promise<CheckoutResult> => {
  const config = await getStoreConfig();

  if (config.maintenanceMode) {
    throw new PreconditionFailedError(
      'The store is temporarily closed for maintenance. Please try again shortly.',
    );
  }

  if (!config.allowGuestCheckout && !identity.customerId) {
    throw new PreconditionFailedError('Please sign in or create an account to check out.');
  }

  const view = await getCartView(identity);

  if (view.lines.length === 0) {
    throw new PreconditionFailedError('Your basket is empty.');
  }

  const blocked = view.lines.filter((line) => line.exceedsStock);
  if (blocked.length > 0) {
    throw new ValidationError(
      blocked.map((line) => ({
        path: 'items',
        message: `${line.productName}: only ${line.available} left. Reduce the quantity to continue.`,
      })),
    );
  }

  const actor: ServiceActor = {
    ...SYSTEM_ACTOR,
    email: input.email,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
  };

  const order = await placeOrder(
    {
      items: view.lines.map((line) => ({
        variantId: line.variantId,
        quantity: line.quantity,
      })),
      email: input.email,
      phone: input.phone,
      customerId: identity.customerId,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingSameAsShipping ? undefined : input.billingAddress,
      discountCode: view.discountCode ?? undefined,
      customerNote: input.customerNote,
      channel: 'web',
      ipAddress: context.ipAddress,
    },
    actor,
  );

  await db.cart.update({
    where: { id: view.id },
    data: { status: CartStatus.CONVERTED },
  });

  return {
    orderId: order.id,
    orderNumber: order.number,
    grandTotal: order.grandTotal,
    currency: order.currency,
  };
};

/** Housekeeping: mark long-idle carts abandoned so reports stay meaningful. */
export const markAbandonedCarts = async (): Promise<number> => {
  const result = await db.cart.updateMany({
    where: { status: CartStatus.ACTIVE, expiresAt: { lt: new Date() } },
    data: { status: CartStatus.ABANDONED },
  });
  return result.count;
};
