import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PreconditionFailedError, ValidationError } from '@/lib/api/errors';
import { db } from '@/lib/db';
import {
  DiscountType,
  FulfillmentStatus,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  StockMovementType,
} from '@/generated/prisma/enums';
import { createDiscount, evaluateDiscount } from '@/server/discount-service';
import { adjustStock, setStockLevel } from '@/server/inventory-service';
import {
  cancelOrder,
  fulfillOrder,
  placeOrder,
  priceOrder,
  recordPayment,
  refundOrder,
} from '@/server/order-service';

import {
  createCategory,
  createCustomer,
  createProduct,
  createStaffUser,
  seedAccessControl,
  seedSettings,
  stockOf,
  type TestUser,
} from './helpers';
import { truncateAll } from './setup';

/**
 * Order, stock and discount integration tests.
 *
 * These exercise the transactional paths: a price computed from the catalogue,
 * stock reserved and then converted, a discount counted once, and -- most
 * importantly -- the compare-and-set that prevents overselling the last unit.
 */

const ADDRESS = {
  firstName: 'Test',
  lastName: 'Buyer',
  line1: '1 Test Street',
  city: 'Bristol',
  countryCode: 'GB',
  postalCode: 'BS1 4AA',
  isDefaultShipping: true,
  isDefaultBilling: true,
};

let owner: TestUser;

beforeAll(async () => {
  await truncateAll();
  await seedAccessControl();
  await seedSettings();
  owner = await createStaffUser('super_admin');
});

beforeEach(async () => {
  // Clear transactional data, keep access control and settings.
  await db.stockMovement.deleteMany({});
  await db.discountRedemption.deleteMany({});
  await db.orderEvent.deleteMany({});
  await db.refund.deleteMany({});
  await db.shipment.deleteMany({});
  await db.payment.deleteMany({});
  await db.orderAddress.deleteMany({});
  await db.orderItem.deleteMany({});
  await db.order.deleteMany({});
  await db.cartItem.deleteMany({});
  await db.cart.deleteMany({});
  await db.inventoryItem.deleteMany({});
  await db.productVariant.deleteMany({});
  await db.product.deleteMany({});
  await db.discount.deleteMany({});
  await db.counter.deleteMany({});
});

describe('priceOrder', () => {
  it('computes totals from the catalogue, ignoring any client-supplied price', async () => {
    const product = await createProduct({ name: 'Priced Item', price: 1999, quantity: 10 });

    const totals = await priceOrder([{ variantId: product.variantId, quantity: 3 }]);

    expect(totals.subtotal).toBe(5997);
    expect(totals.grandTotal).toBe(5997);
    expect(totals.lines[0]?.unitPrice).toBe(1999);
  });

  it('rejects a line for a product that is archived', async () => {
    const product = await createProduct({ name: 'Gone', price: 1000, quantity: 5 });
    await db.product.update({
      where: { id: product.productId },
      data: { deletedAt: new Date() },
    });

    await expect(
      priceOrder([{ variantId: product.variantId, quantity: 1 }]),
    ).rejects.toThrow(ValidationError);
  });

  it('applies tax per line on the discounted amount', async () => {
    await seedSettings({ 'checkout.taxRateBps': 2000 });

    const product = await createProduct({ name: 'Taxed', price: 10_000, quantity: 10 });
    const totals = await priceOrder([{ variantId: product.variantId, quantity: 1 }]);

    expect(totals.subtotal).toBe(10_000);
    expect(totals.taxTotal).toBe(2000);
    expect(totals.grandTotal).toBe(12_000);

    await seedSettings({ 'checkout.taxRateBps': 0 });
  });

  it('charges flat shipping, and waives it above the free threshold', async () => {
    await seedSettings({
      'checkout.flatShippingMinor': 500,
      'checkout.freeShippingThresholdMinor': 5000,
    });

    const product = await createProduct({ name: 'Shipped', price: 1000, quantity: 20 });

    const small = await priceOrder([{ variantId: product.variantId, quantity: 2 }]);
    expect(small.shippingTotal).toBe(500);
    expect(small.grandTotal).toBe(2500);

    const large = await priceOrder([{ variantId: product.variantId, quantity: 6 }]);
    expect(large.shippingTotal).toBe(0);
    expect(large.grandTotal).toBe(6000);

    await seedSettings({
      'checkout.flatShippingMinor': 0,
      'checkout.freeShippingThresholdMinor': 0,
    });
  });

  it('allocates a percentage discount across lines so the parts sum to the whole', async () => {
    await createDiscount(
      {
        code: 'TEN',
        name: 'Ten percent',
        type: DiscountType.PERCENTAGE,
        scope: 'ALL',
        value: 1000,
        minSubtotal: 0,
        isActive: true,
      },
      owner.actor,
    );

    const first = await createProduct({ name: 'Line A', price: 3333, quantity: 10 });
    const second = await createProduct({ name: 'Line B', price: 6667, quantity: 10 });

    const totals = await priceOrder(
      [
        { variantId: first.variantId, quantity: 1 },
        { variantId: second.variantId, quantity: 1 },
      ],
      { discountCode: 'TEN' },
    );

    expect(totals.subtotal).toBe(10_000);
    expect(totals.discountTotal).toBe(1000);

    const allocated = totals.lines.reduce((sum, line) => sum + line.discountTotal, 0);
    expect(allocated).toBe(totals.discountTotal);
  });

  it('reports why an inapplicable code did not apply, without failing', async () => {
    await createDiscount(
      {
        code: 'BIGSPEND',
        name: 'Big spenders',
        type: DiscountType.PERCENTAGE,
        scope: 'ALL',
        value: 2000,
        minSubtotal: 100_000,
        isActive: true,
      },
      owner.actor,
    );

    const product = await createProduct({ name: 'Cheap', price: 1000, quantity: 5 });

    const totals = await priceOrder([{ variantId: product.variantId, quantity: 1 }], {
      discountCode: 'BIGSPEND',
    });

    expect(totals.discountTotal).toBe(0);
    expect(totals.discountCode).toBeNull();
    expect(totals.discountMessage).toMatch(/minimum spend/i);
  });
});

describe('discount evaluation', () => {
  it('refuses an expired code', async () => {
    await createDiscount(
      {
        code: 'EXPIRED',
        name: 'Expired',
        type: DiscountType.PERCENTAGE,
        scope: 'ALL',
        value: 1000,
        minSubtotal: 0,
        isActive: true,
        endsAt: new Date(Date.now() - 86_400_000),
      },
      owner.actor,
    );

    const result = await evaluateDiscount('EXPIRED', [
      { variantId: 'x', productId: 'p', categoryId: null, lineTotal: 5000 },
    ]);

    expect(result.applicable).toBe(false);
    if (!result.applicable) expect(result.reason).toMatch(/expired/i);
  });

  it('refuses a code that has not started', async () => {
    await createDiscount(
      {
        code: 'FUTURE',
        name: 'Future',
        type: DiscountType.PERCENTAGE,
        scope: 'ALL',
        value: 1000,
        minSubtotal: 0,
        isActive: true,
        startsAt: new Date(Date.now() + 86_400_000),
      },
      owner.actor,
    );

    const result = await evaluateDiscount('FUTURE', [
      { variantId: 'x', productId: 'p', categoryId: null, lineTotal: 5000 },
    ]);

    expect(result.applicable).toBe(false);
    if (!result.applicable) expect(result.reason).toMatch(/not available yet/i);
  });

  it('refuses an unknown code without revealing anything', async () => {
    const result = await evaluateDiscount('NOPE', [
      { variantId: 'x', productId: 'p', categoryId: null, lineTotal: 5000 },
    ]);

    expect(result.applicable).toBe(false);
    if (!result.applicable) expect(result.reason).toMatch(/not recognised/i);
  });

  it('applies a category-scoped code only to matching lines', async () => {
    const categoryId = await createCategory('Eligible');
    const other = await createCategory('Other');

    await createDiscount(
      {
        code: 'CATONLY',
        name: 'Category only',
        type: DiscountType.PERCENTAGE,
        scope: 'CATEGORY',
        value: 5000,
        minSubtotal: 0,
        isActive: true,
        targetCategoryId: categoryId,
      },
      owner.actor,
    );

    const result = await evaluateDiscount('CATONLY', [
      { variantId: 'a', productId: 'p1', categoryId, lineTotal: 2000 },
      { variantId: 'b', productId: 'p2', categoryId: other, lineTotal: 8000 },
    ]);

    expect(result.applicable).toBe(true);
    // 50% of the eligible 2000 only, not of the 10000 basket.
    if (result.applicable) expect(result.amount).toBe(1000);
  });

  it('caps a percentage discount at the configured maximum', async () => {
    await createDiscount(
      {
        code: 'CAPPED',
        name: 'Capped',
        type: DiscountType.PERCENTAGE,
        scope: 'ALL',
        value: 5000,
        minSubtotal: 0,
        maxDiscountAmount: 1500,
        isActive: true,
      },
      owner.actor,
    );

    const result = await evaluateDiscount('CAPPED', [
      { variantId: 'x', productId: 'p', categoryId: null, lineTotal: 20_000 },
    ]);

    expect(result.applicable).toBe(true);
    if (result.applicable) expect(result.amount).toBe(1500);
  });

  it('refuses a code that has reached its usage limit', async () => {
    const discount = await createDiscount(
      {
        code: 'ONESHOT',
        name: 'One shot',
        type: DiscountType.FIXED_AMOUNT,
        scope: 'ALL',
        value: 500,
        minSubtotal: 0,
        usageLimit: 1,
        isActive: true,
      },
      owner.actor,
    );

    await db.discount.update({ where: { id: discount.id }, data: { usageCount: 1 } });

    const result = await evaluateDiscount('ONESHOT', [
      { variantId: 'x', productId: 'p', categoryId: null, lineTotal: 5000 },
    ]);

    expect(result.applicable).toBe(false);
    if (!result.applicable) expect(result.reason).toMatch(/usage limit/i);
  });
});

describe('placeOrder', () => {
  it('creates an order, reserves stock and records the event', async () => {
    const product = await createProduct({ name: 'Reserved', price: 2500, quantity: 10 });

    const order = await placeOrder(
      {
        items: [{ variantId: product.variantId, quantity: 2 }],
        email: 'buyer@example.com',
        shippingAddress: ADDRESS,
      },
      owner.actor,
    );

    expect(order.number).toMatch(/^ORD-\d+$/);
    expect(order.status).toBe(OrderStatus.PENDING);
    expect(order.paymentStatus).toBe(PaymentStatus.UNPAID);
    expect(order.grandTotal).toBe(5000);

    // Reserved, not deducted: the goods are held but not yet dispatched.
    const stock = await stockOf(product.variantId);
    expect(stock.onHand).toBe(10);
    expect(stock.reserved).toBe(2);
    expect(stock.available).toBe(8);

    const events = await db.orderEvent.findMany({ where: { orderId: order.id } });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('order.placed');
  });

  it('issues sequential, unique order numbers', async () => {
    const product = await createProduct({ name: 'Numbered', price: 1000, quantity: 50 });

    const numbers: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const order = await placeOrder(
        {
          items: [{ variantId: product.variantId, quantity: 1 }],
          email: `buyer${index}@example.com`,
          shippingAddress: ADDRESS,
        },
        owner.actor,
      );
      numbers.push(order.number);
    }

    expect(new Set(numbers).size).toBe(5);

    const sequence = numbers.map((number) => Number(number.split('-')[1]));
    for (let index = 1; index < sequence.length; index += 1) {
      expect(sequence[index]).toBe((sequence[index - 1] as number) + 1);
    }
  });

  it('refuses to oversell the last units', async () => {
    const product = await createProduct({ name: 'Scarce', price: 1000, quantity: 3 });

    await expect(
      placeOrder(
        {
          items: [{ variantId: product.variantId, quantity: 4 }],
          email: 'greedy@example.com',
          shippingAddress: ADDRESS,
        },
        owner.actor,
      ),
    ).rejects.toThrow(PreconditionFailedError);

    // Nothing was reserved, and no order survived the failed transaction.
    const stock = await stockOf(product.variantId);
    expect(stock.reserved).toBe(0);
    expect(await db.order.count()).toBe(0);
  });

  it('does not let two orders reserve the same last unit', async () => {
    const product = await createProduct({ name: 'Last One', price: 1000, quantity: 1 });

    const place = (email: string) =>
      placeOrder(
        {
          items: [{ variantId: product.variantId, quantity: 1 }],
          email,
          shippingAddress: ADDRESS,
        },
        owner.actor,
      );

    // Two concurrent attempts at a single unit: exactly one must succeed.
    const results = await Promise.allSettled([place('a@example.com'), place('b@example.com')]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const stock = await stockOf(product.variantId);
    expect(stock.reserved).toBe(1);
    expect(stock.available).toBe(0);
  });

  it('records a discount redemption exactly once and bumps the counter', async () => {
    await createDiscount(
      {
        code: 'ONCE',
        name: 'Once',
        type: DiscountType.FIXED_AMOUNT,
        scope: 'ALL',
        value: 500,
        minSubtotal: 0,
        isActive: true,
      },
      owner.actor,
    );

    const product = await createProduct({ name: 'Discounted', price: 5000, quantity: 10 });

    const order = await placeOrder(
      {
        items: [{ variantId: product.variantId, quantity: 1 }],
        email: 'saver@example.com',
        shippingAddress: ADDRESS,
        discountCode: 'ONCE',
      },
      owner.actor,
    );

    expect(order.discountTotal).toBe(500);
    expect(order.grandTotal).toBe(4500);

    const redemptions = await db.discountRedemption.findMany({ where: { orderId: order.id } });
    expect(redemptions).toHaveLength(1);
    expect(redemptions[0]?.amount).toBe(500);

    const discount = await db.discount.findUniqueOrThrow({ where: { code: 'ONCE' } });
    expect(discount.usageCount).toBe(1);
  });

  it('snapshots the address so a later change does not rewrite history', async () => {
    const product = await createProduct({ name: 'Snapshot', price: 1000, quantity: 5 });

    const order = await placeOrder(
      {
        items: [{ variantId: product.variantId, quantity: 1 }],
        email: 'snap@example.com',
        shippingAddress: ADDRESS,
      },
      owner.actor,
    );

    const addresses = await db.orderAddress.findMany({ where: { orderId: order.id } });
    expect(addresses).toHaveLength(2);
    expect(addresses.map((address) => address.type).sort()).toEqual(['BILLING', 'SHIPPING']);
    expect(addresses[0]?.line1).toBe('1 Test Street');
  });
});

describe('payment, fulfilment and refunds', () => {
  const placeTestOrder = async (quantity = 2, price = 2500) => {
    const product = await createProduct({ name: 'Lifecycle', price, quantity: 10 });
    const order = await placeOrder(
      {
        items: [{ variantId: product.variantId, quantity }],
        email: 'lifecycle@example.com',
        shippingAddress: ADDRESS,
      },
      owner.actor,
    );
    return { order, product };
  };

  it('confirms the order once it is paid in full', async () => {
    const { order } = await placeTestOrder();

    const updated = await recordPayment(
      order.id,
      {
        provider: PaymentProvider.BANK_TRANSFER,
        amount: order.grandTotal,
        status: PaymentStatus.PAID,
      },
      owner.actor,
    );

    expect(updated.paymentStatus).toBe(PaymentStatus.PAID);
    expect(updated.status).toBe(OrderStatus.CONFIRMED);
  });

  it('marks a part payment as authorised, not paid', async () => {
    const { order } = await placeTestOrder();

    const updated = await recordPayment(
      order.id,
      {
        provider: PaymentProvider.BANK_TRANSFER,
        amount: Math.floor(order.grandTotal / 2),
        status: PaymentStatus.PAID,
      },
      owner.actor,
    );

    expect(updated.paymentStatus).toBe(PaymentStatus.AUTHORIZED);
    expect(updated.status).toBe(OrderStatus.PENDING);
  });

  it('converts the reservation into a dispatch on fulfilment', async () => {
    const { order, product } = await placeTestOrder(2);

    const before = await stockOf(product.variantId);
    expect(before).toEqual({ onHand: 10, reserved: 2, available: 8 });

    const updated = await fulfillOrder(
      order.id,
      { carrier: 'Test Courier', notifyCustomer: false },
      owner.actor,
    );

    expect(updated.fulfillmentStatus).toBe(FulfillmentStatus.FULFILLED);
    expect(updated.status).toBe(OrderStatus.SHIPPED);

    const after = await stockOf(product.variantId);
    expect(after).toEqual({ onHand: 8, reserved: 0, available: 8 });

    const movement = await db.stockMovement.findFirst({
      where: { variantId: product.variantId, type: StockMovementType.SALE },
    });
    expect(movement?.quantity).toBe(-2);
    expect(movement?.balanceAfter).toBe(8);
    expect(movement?.reference).toBe(order.number);
  });

  it('supports a partial shipment and reports partial fulfilment', async () => {
    const { order, product } = await placeTestOrder(4);
    const itemId = order.items[0]?.id;
    expect(itemId).toBeDefined();

    const updated = await fulfillOrder(
      order.id,
      {
        carrier: 'Test Courier',
        lines: [{ orderItemId: itemId as string, quantity: 1 }],
        notifyCustomer: false,
      },
      owner.actor,
    );

    expect(updated.fulfillmentStatus).toBe(FulfillmentStatus.PARTIALLY_FULFILLED);
    expect(updated.items[0]?.quantityFulfilled).toBe(1);

    const stock = await stockOf(product.variantId);
    expect(stock.onHand).toBe(9);
    expect(stock.reserved).toBe(3);
  });

  it('refuses to fulfil more than was ordered', async () => {
    const { order } = await placeTestOrder(2);
    const itemId = order.items[0]?.id as string;

    await expect(
      fulfillOrder(
        order.id,
        {
          carrier: 'Test Courier',
          lines: [{ orderItemId: itemId, quantity: 99 }],
          notifyCustomer: false,
        },
        owner.actor,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('releases the reservation when an order is cancelled', async () => {
    const { order, product } = await placeTestOrder(3);

    await cancelOrder(order.id, { reason: 'Customer changed mind', restock: true }, owner.actor);

    const stock = await stockOf(product.variantId);
    expect(stock).toEqual({ onHand: 10, reserved: 0, available: 10 });

    const cancelled = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(cancelled.status).toBe(OrderStatus.CANCELLED);
    expect(cancelled.cancelledAt).not.toBeNull();
  });

  it('refuses to cancel an order that has already shipped', async () => {
    const { order } = await placeTestOrder(1);

    await fulfillOrder(
      order.id,
      { carrier: 'Test Courier', notifyCustomer: false },
      owner.actor,
    );

    await expect(
      cancelOrder(order.id, { reason: 'Too late', restock: true }, owner.actor),
    ).rejects.toThrow(PreconditionFailedError);
  });

  it('refuses to refund more than the order is worth', async () => {
    const { order } = await placeTestOrder(1, 1000);

    await recordPayment(
      order.id,
      {
        provider: PaymentProvider.CARD,
        amount: order.grandTotal,
        status: PaymentStatus.PAID,
      },
      owner.actor,
    );

    await expect(
      refundOrder(
        order.id,
        { amount: order.grandTotal + 1, reason: 'Too much', restock: false },
        owner.actor,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('tracks a partial then full refund without over-refunding', async () => {
    const { order } = await placeTestOrder(1, 10_000);

    await recordPayment(
      order.id,
      { provider: PaymentProvider.CARD, amount: 10_000, status: PaymentStatus.PAID },
      owner.actor,
    );

    const partial = await refundOrder(
      order.id,
      { amount: 4000, reason: 'Partial return', restock: false },
      owner.actor,
    );

    expect(partial.refundedTotal).toBe(4000);
    expect(partial.paymentStatus).toBe(PaymentStatus.PARTIALLY_REFUNDED);
    expect(partial.status).not.toBe(OrderStatus.REFUNDED);

    const full = await refundOrder(
      order.id,
      { amount: 6000, reason: 'Rest of it', restock: false },
      owner.actor,
    );

    expect(full.refundedTotal).toBe(10_000);
    expect(full.paymentStatus).toBe(PaymentStatus.REFUNDED);
    expect(full.status).toBe(OrderStatus.REFUNDED);

    // A further refund has nothing left to take.
    await expect(
      refundOrder(order.id, { amount: 1, reason: 'Again', restock: false }, owner.actor),
    ).rejects.toThrow(PreconditionFailedError);
  });

  it('links a customer order to the customer record', async () => {
    const customer = await createCustomer();
    const product = await createProduct({ name: 'For Customer', price: 1500, quantity: 5 });

    const order = await placeOrder(
      {
        items: [{ variantId: product.variantId, quantity: 1 }],
        email: customer.email,
        customerId: customer.id,
        shippingAddress: ADDRESS,
      },
      owner.actor,
    );

    expect(order.customerId).toBe(customer.id);
    expect(order.customer?.email).toBe(customer.email);
  });
});

describe('inventory adjustments', () => {
  it('records a receipt and moves the balance', async () => {
    const product = await createProduct({ name: 'Receiving', price: 1000, quantity: 5 });

    const result = await adjustStock(
      {
        variantId: product.variantId,
        type: StockMovementType.RECEIPT,
        quantity: 20,
        reason: 'Delivery arrived',
      },
      owner.actor,
    );

    expect(result.quantityOnHand).toBe(25);

    const movement = await db.stockMovement.findFirstOrThrow({
      where: { variantId: product.variantId, type: StockMovementType.RECEIPT },
      orderBy: { createdAt: 'desc' },
    });
    expect(movement.quantity).toBe(20);
    expect(movement.balanceAfter).toBe(25);
  });

  it('always subtracts for a damage write-off, whatever sign is given', async () => {
    const product = await createProduct({ name: 'Damaged', price: 1000, quantity: 10 });

    const result = await adjustStock(
      {
        variantId: product.variantId,
        type: StockMovementType.DAMAGE,
        // A positive number here still means "write off 3".
        quantity: 3,
        reason: 'Water damage',
      },
      owner.actor,
    );

    expect(result.quantityOnHand).toBe(7);
  });

  it('refuses an adjustment that would take stock below zero', async () => {
    const product = await createProduct({ name: 'Nearly Out', price: 1000, quantity: 2 });

    await expect(
      adjustStock(
        {
          variantId: product.variantId,
          type: StockMovementType.ADJUSTMENT,
          quantity: -5,
          reason: 'Mistake',
        },
        owner.actor,
      ),
    ).rejects.toThrow(PreconditionFailedError);

    expect((await stockOf(product.variantId)).onHand).toBe(2);
  });

  it('records a stock count as the difference, keeping history continuous', async () => {
    const product = await createProduct({ name: 'Counted', price: 1000, quantity: 10 });

    const result = await setStockLevel(
      { variantId: product.variantId, quantityOnHand: 7, reason: 'Quarterly count' },
      owner.actor,
    );

    expect(result.quantityOnHand).toBe(7);

    const movement = await db.stockMovement.findFirstOrThrow({
      where: { variantId: product.variantId, type: StockMovementType.ADJUSTMENT },
      orderBy: { createdAt: 'desc' },
    });

    // The delta is recorded, not the absolute figure.
    expect(movement.quantity).toBe(-3);
    expect(movement.balanceAfter).toBe(7);
  });

  it('writes no movement when a count matches the system figure', async () => {
    const product = await createProduct({ name: 'Unchanged', price: 1000, quantity: 8 });
    await db.stockMovement.deleteMany({ where: { variantId: product.variantId } });

    const result = await setStockLevel(
      { variantId: product.variantId, quantityOnHand: 8, reason: 'Count matched' },
      owner.actor,
    );

    expect(result.quantityOnHand).toBe(8);
    expect(await db.stockMovement.count({ where: { variantId: product.variantId } })).toBe(0);
  });

  it('allows a backorder-enabled variant to go below available', async () => {
    const product = await createProduct({
      name: 'Backordered',
      price: 1000,
      quantity: 1,
      allowBackorder: true,
    });

    const order = await placeOrder(
      {
        items: [{ variantId: product.variantId, quantity: 5 }],
        email: 'backorder@example.com',
        shippingAddress: ADDRESS,
      },
      owner.actor,
    );

    expect(order.grandTotal).toBe(5000);
    expect((await stockOf(product.variantId)).reserved).toBe(5);
  });
});
