import { NotFoundError, PreconditionFailedError, ValidationError } from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { recordAudit } from '@/lib/audit';
import { db, type DbClient } from '@/lib/db';
import { serverEnv } from '@/lib/env';
import { deliver, orderShippedEmail } from '@/lib/mailer';
import { applyBasisPoints, formatMoney } from '@/lib/money';
import { notifyCustomer, notifyPermissionHolders } from '@/lib/notifications';
import {
  FulfillmentStatus,
  NotificationLevel,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ShipmentStatus,
  StockMovementType,
} from '@/generated/prisma/enums';
import type { AddressInput } from '@/validation/customer';
import type {
  CancelOrderInput,
  CreateOrderInput,
  FulfillOrderInput,
  OrderSortField,
  RecordPaymentInput,
  RefundOrderInput,
  UpdateOrderInput,
  UpdateOrderStatusInput,
} from '@/validation/order';

import { evaluateDiscount, redeemDiscount, type DiscountLine } from './discount-service';
import { consumeStock, fulfillReservation, releaseReservation, reserveStock } from './inventory-service';
import { getStoreConfig } from './settings-service';
import { auditActorFor, type ServiceActor } from './types';

/**
 * Orders.
 *
 * Money rules, all enforced server-side:
 *  * Line prices are snapshotted from the variant at the time of the order. A
 *    later price change never alters a placed order.
 *  * The client never supplies a total. Subtotal, discount, tax, shipping and
 *    grand total are all computed here from the catalogue and the settings.
 *  * Discounts are allocated across lines in proportion to line value, with the
 *    rounding remainder pushed onto the largest line so the parts always sum
 *    back to the order-level figure.
 *
 * Status changes go through `assertTransition`, so an order cannot jump from,
 * say, CANCELLED back to SHIPPED.
 */

// ── Order numbers ────────────────────────────────────────────────────────────

const ORDER_COUNTER_KEY = 'order_number';
const ORDER_NUMBER_BASE = 100_000;

/**
 * Allocates the next order number with a single atomic statement, so two
 * concurrent checkouts cannot be handed the same number.
 */
export const nextOrderNumber = async (prefix: string, client: DbClient): Promise<string> => {
  const rows = await client.$queryRaw<{ value: number }[]>`
    INSERT INTO counters ("key", "value")
    VALUES (${ORDER_COUNTER_KEY}, ${ORDER_NUMBER_BASE + 1})
    ON CONFLICT ("key") DO UPDATE SET "value" = counters."value" + 1
    RETURNING "value"
  `;

  const value = rows[0]?.value ?? ORDER_NUMBER_BASE + 1;
  return `${prefix}-${value}`;
};

// ── Pricing ──────────────────────────────────────────────────────────────────

export type PricedLine = {
  variantId: string;
  productId: string;
  categoryId: string | null;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineSubtotal: number;
  discountTotal: number;
  taxTotal: number;
  lineTotal: number;
  taxRateBps: number;
};

export type OrderTotals = {
  lines: PricedLine[];
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shippingTotal: number;
  grandTotal: number;
  currency: string;
  discountCode: string | null;
  discountId: string | null;
  discountMessage: string | null;
};

type RequestedLine = { variantId: string; quantity: number };

/**
 * Distributes `total` across `weights` proportionally, as integers.
 *
 * Guarantees, in order of importance:
 *  1. No single share exceeds its own weight. A line's discount can never be
 *     larger than the line is worth, which would produce a negative line total.
 *  2. The shares sum exactly to `min(total, sum(weights))`. Rounding remainders
 *     are handed out one minor unit at a time, heaviest line first.
 *
 * `total` is capped at the sum of the weights because of rule 1: asking to
 * allocate more than the lines are worth has no correct answer, and the
 * caller's own clamp (`clampDiscount`) already prevents it in practice. Capping
 * here keeps the function total rather than silently short-allocating.
 */
export const allocateProportionally = (
  requestedTotal: number,
  weights: readonly number[],
): number[] => {
  const sum = weights.reduce((running, weight) => running + weight, 0);
  if (sum <= 0 || requestedTotal <= 0) return weights.map(() => 0);

  const total = Math.min(requestedTotal, sum);

  const shares = weights.map((weight) => Math.floor((total * weight) / sum));
  const allocated = shares.reduce((running, share) => running + share, 0);
  let remainder = total - allocated;

  // Hand the remaining minor units to the largest lines, one each, so the
  // allocation stays stable and never exceeds a line's own value.
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight);

  for (const entry of order) {
    if (remainder <= 0) break;
    const current = shares[entry.index] ?? 0;
    if (current < entry.weight) {
      shares[entry.index] = current + 1;
      remainder -= 1;
    }
  }

  return shares;
};

/**
 * Prices a set of requested lines. Used by the admin order builder, the cart
 * preview and the real checkout, so all three agree to the penny.
 */
export const priceOrder = async (
  requested: readonly RequestedLine[],
  options: {
    discountCode?: string | undefined;
    customerId?: string | undefined;
    shippingOverride?: number | undefined;
    client?: DbClient;
  } = {},
): Promise<OrderTotals> => {
  const client = options.client ?? db;
  const config = await getStoreConfig();

  if (requested.length === 0) {
    throw new ValidationError([{ path: 'items', message: 'Add at least one item.' }]);
  }

  const variants = await client.productVariant.findMany({
    where: { id: { in: requested.map((line) => line.variantId) }, deletedAt: null },
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      isDefault: true,
      isActive: true,
      product: {
        select: {
          id: true,
          name: true,
          categoryId: true,
          taxRateBps: true,
          currency: true,
          deletedAt: true,
        },
      },
    },
  });

  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  const lines: PricedLine[] = requested.map((line) => {
    const variant = byId.get(line.variantId);
    if (!variant || variant.product.deletedAt || !variant.isActive) {
      throw new ValidationError([
        { path: 'items', message: 'One of those items is no longer available.' },
      ]);
    }

    const lineSubtotal = variant.price * line.quantity;

    return {
      variantId: variant.id,
      productId: variant.product.id,
      categoryId: variant.product.categoryId,
      productName: variant.product.name,
      variantName: variant.isDefault ? 'Default' : variant.name,
      sku: variant.sku,
      unitPrice: variant.price,
      quantity: line.quantity,
      lineSubtotal,
      discountTotal: 0,
      taxTotal: 0,
      lineTotal: lineSubtotal,
      taxRateBps: variant.product.taxRateBps || config.taxRateBps,
    };
  });

  const subtotal = lines.reduce((total, line) => total + line.lineSubtotal, 0);

  // Discount
  let discountTotal = 0;
  let discountId: string | null = null;
  let discountCode: string | null = null;
  let discountMessage: string | null = null;
  let freeShipping = false;

  if (options.discountCode && options.discountCode.trim() !== '') {
    const discountLines: DiscountLine[] = lines.map((line) => ({
      variantId: line.variantId,
      productId: line.productId,
      categoryId: line.categoryId,
      lineTotal: line.lineSubtotal,
    }));

    const evaluation = await evaluateDiscount(options.discountCode, discountLines, {
      ...(options.customerId ? { customerId: options.customerId } : {}),
      client,
    });

    if (evaluation.applicable) {
      discountTotal = evaluation.amount;
      discountId = evaluation.discountId;
      discountCode = evaluation.code;
      discountMessage = evaluation.description;
      freeShipping = evaluation.freeShipping;
    } else {
      discountMessage = evaluation.reason;
    }
  }

  if (discountTotal > 0) {
    const allocations = allocateProportionally(
      discountTotal,
      lines.map((line) => line.lineSubtotal),
    );
    lines.forEach((line, index) => {
      line.discountTotal = allocations[index] ?? 0;
    });
  }

  // Tax, computed per line on the discounted amount.
  let taxTotal = 0;
  for (const line of lines) {
    const taxable = line.lineSubtotal - line.discountTotal;
    if (config.taxInclusivePricing) {
      // Price already contains tax: back it out for reporting but do not add it.
      line.taxTotal = line.taxRateBps > 0
        ? taxable - Math.round((taxable * 10_000) / (10_000 + line.taxRateBps))
        : 0;
    } else {
      line.taxTotal = applyBasisPoints(taxable, line.taxRateBps);
      taxTotal += line.taxTotal;
    }
    line.lineTotal = taxable + (config.taxInclusivePricing ? 0 : line.taxTotal);
  }

  // Shipping
  const goodsTotal = subtotal - discountTotal;
  let shippingTotal =
    options.shippingOverride !== undefined ? options.shippingOverride : config.flatShippingMinor;

  if (freeShipping) shippingTotal = 0;
  if (
    config.freeShippingThresholdMinor > 0 &&
    goodsTotal >= config.freeShippingThresholdMinor
  ) {
    shippingTotal = 0;
  }

  const grandTotal = goodsTotal + taxTotal + shippingTotal;

  return {
    lines,
    subtotal,
    discountTotal,
    taxTotal,
    shippingTotal,
    grandTotal,
    currency: config.currency,
    discountCode,
    discountId,
    discountMessage,
  };
};

// ── Status machine ───────────────────────────────────────────────────────────

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  /*
   * PENDING can reach SHIPPED directly. Dispatching before payment is a real
   * flow (cash on delivery, invoiced accounts), and without this edge a
   * fulfilled order would keep its PENDING status -- which previously left it
   * eligible for cancellation after the goods had already gone out.
   */
  [OrderStatus.PENDING]: [
    OrderStatus.CONFIRMED,
    OrderStatus.PROCESSING,
    OrderStatus.SHIPPED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.CONFIRMED]: [
    OrderStatus.PROCESSING,
    OrderStatus.SHIPPED,
    OrderStatus.CANCELLED,
    OrderStatus.REFUNDED,
  ],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.REFUNDED],
  [OrderStatus.DELIVERED]: [OrderStatus.REFUNDED],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUNDED]: [],
};

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean =>
  from === to || (ALLOWED_TRANSITIONS[from] ?? []).includes(to);

/**
 * Transitions reachable from `from` that the plain status endpoint accepts.
 *
 * Cancellation and refund are excluded: both have side effects on stock and
 * money, so they go through their own endpoints which capture a reason. The UI
 * uses this to populate its status picker, so it can only ever offer a move the
 * server would allow.
 */
export const allowedTransitions = (from: OrderStatus): OrderStatus[] =>
  (ALLOWED_TRANSITIONS[from] ?? []).filter(
    (status) => status !== OrderStatus.CANCELLED && status !== OrderStatus.REFUNDED,
  );

export const assertTransition = (from: OrderStatus, to: OrderStatus): void => {
  if (!canTransition(from, to)) {
    const allowed = ALLOWED_TRANSITIONS[from] ?? [];
    throw new PreconditionFailedError(
      allowed.length === 0
        ? `An order that is ${from.toLowerCase()} can no longer change status.`
        : `An order cannot go from ${from.toLowerCase()} to ${to.toLowerCase()}. Allowed: ${allowed
            .map((status) => status.toLowerCase())
            .join(', ')}.`,
    );
  }
};

// ── Reads ────────────────────────────────────────────────────────────────────

export type OrderListItem = {
  id: string;
  number: string;
  email: string;
  customerName: string | null;
  customerId: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  currency: string;
  grandTotal: number;
  refundedTotal: number;
  itemCount: number;
  placedAt: Date;
  deletedAt: Date | null;
};

export const listOrders = async (
  query: ListQuery<OrderSortField>,
): Promise<Paginated<OrderListItem>> => {
  const where = {
    ...(query.includeArchived ? {} : { deletedAt: null }),
    ...(query.filters.status ? { status: query.filters.status as OrderStatus } : {}),
    ...(query.filters.paymentStatus
      ? { paymentStatus: query.filters.paymentStatus as PaymentStatus }
      : {}),
    ...(query.filters.fulfillmentStatus
      ? { fulfillmentStatus: query.filters.fulfillmentStatus as FulfillmentStatus }
      : {}),
    ...(query.filters.customerId ? { customerId: query.filters.customerId } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          placedAt: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { number: { contains: query.search, mode: 'insensitive' as const } },
            { email: { contains: query.search, mode: 'insensitive' as const } },
            {
              customer: {
                OR: [
                  { firstName: { contains: query.search, mode: 'insensitive' as const } },
                  { lastName: { contains: query.search, mode: 'insensitive' as const } },
                ],
              },
            },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        number: true,
        email: true,
        customerId: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        currency: true,
        grandTotal: true,
        refundedTotal: true,
        placedAt: true,
        deletedAt: true,
        customer: { select: { firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    }),
    db.order.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      number: row.number,
      email: row.email,
      customerId: row.customerId,
      customerName: row.customer
        ? `${row.customer.firstName} ${row.customer.lastName}`.trim()
        : null,
      status: row.status,
      paymentStatus: row.paymentStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      currency: row.currency,
      grandTotal: row.grandTotal,
      refundedTotal: row.refundedTotal,
      itemCount: row._count.items,
      placedAt: row.placedAt,
      deletedAt: row.deletedAt,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

const orderDetailSelect = {
  id: true,
  number: true,
  email: true,
  phone: true,
  customerId: true,
  status: true,
  paymentStatus: true,
  fulfillmentStatus: true,
  currency: true,
  subtotal: true,
  discountTotal: true,
  taxTotal: true,
  shippingTotal: true,
  grandTotal: true,
  refundedTotal: true,
  discountCode: true,
  channel: true,
  customerNote: true,
  internalNote: true,
  ipAddress: true,
  placedAt: true,
  cancelledAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  customer: { select: { id: true, firstName: true, lastName: true, email: true } },
  items: {
    select: {
      id: true,
      variantId: true,
      productId: true,
      productName: true,
      variantName: true,
      sku: true,
      unitPrice: true,
      quantity: true,
      quantityFulfilled: true,
      discountTotal: true,
      taxTotal: true,
      lineTotal: true,
    },
  },
  addresses: {
    select: {
      id: true,
      type: true,
      firstName: true,
      lastName: true,
      company: true,
      line1: true,
      line2: true,
      city: true,
      state: true,
      postalCode: true,
      countryCode: true,
      phone: true,
    },
  },
  payments: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      provider: true,
      reference: true,
      amount: true,
      status: true,
      capturedAt: true,
      failureReason: true,
      createdAt: true,
    },
  },
  shipments: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      carrier: true,
      trackingNumber: true,
      status: true,
      shippedAt: true,
      deliveredAt: true,
      createdAt: true,
    },
  },
  refunds: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      amount: true,
      reason: true,
      restock: true,
      createdAt: true,
      createdBy: { select: { firstName: true, lastName: true } },
    },
  },
  events: {
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      message: true,
      createdAt: true,
      createdBy: { select: { firstName: true, lastName: true } },
    },
  },
} as const;

export const getOrder = async (id: string) => {
  const order = await db.order.findUnique({ where: { id }, select: orderDetailSelect });
  if (!order) throw new NotFoundError('Order');
  return order;
};

export const getOrderByNumber = async (number: string, customerId?: string) => {
  const order = await db.order.findFirst({
    where: {
      number,
      deletedAt: null,
      ...(customerId ? { customerId } : {}),
    },
    select: orderDetailSelect,
  });
  if (!order) throw new NotFoundError('Order');
  return order;
};

export type OrderDetail = Awaited<ReturnType<typeof getOrder>>;

// ── Writes ───────────────────────────────────────────────────────────────────

const addressData = (input: AddressInput, type: 'SHIPPING' | 'BILLING') => ({
  type,
  firstName: input.firstName,
  lastName: input.lastName,
  company: input.company ?? null,
  line1: input.line1,
  line2: input.line2 ?? null,
  city: input.city,
  state: input.state ?? null,
  postalCode: input.postalCode ?? null,
  countryCode: input.countryCode,
  phone: input.phone ?? null,
});

const addEvent = async (
  orderId: string,
  type: string,
  message: string,
  actor: ServiceActor,
  client: DbClient,
): Promise<void> => {
  await client.orderEvent.create({
    data: {
      orderId,
      type,
      message: message.slice(0, 500),
      createdById: auditActorFor(actor).userId,
    },
  });
};

export type PlaceOrderInput = {
  items: readonly RequestedLine[];
  email: string;
  phone?: string | undefined;
  customerId?: string | undefined;
  shippingAddress: AddressInput;
  billingAddress?: AddressInput | undefined;
  discountCode?: string | undefined;
  shippingOverride?: number | undefined;
  customerNote?: string | undefined;
  internalNote?: string | undefined;
  channel?: string;
  ipAddress?: string | undefined;
};

/**
 * Creates an order, reserves its stock and records the opening event.
 *
 * Shared by the storefront checkout and the back-office order builder so there
 * is exactly one implementation of "what happens when an order is placed".
 */
export const placeOrder = async (input: PlaceOrderInput, actor: ServiceActor) => {
  const config = await getStoreConfig();

  const orderId = await db.$transaction(async (tx) => {
    const totals = await priceOrder(input.items, {
      discountCode: input.discountCode,
      customerId: input.customerId,
      shippingOverride: input.shippingOverride,
      client: tx,
    });

    const number = await nextOrderNumber(config.orderNumberPrefix, tx);

    const order = await tx.order.create({
      data: {
        number,
        customerId: input.customerId ?? null,
        email: input.email,
        phone: input.phone ?? null,
        status: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.UNPAID,
        fulfillmentStatus: FulfillmentStatus.UNFULFILLED,
        currency: totals.currency,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        shippingTotal: totals.shippingTotal,
        grandTotal: totals.grandTotal,
        discountCode: totals.discountCode,
        channel: input.channel ?? 'web',
        customerNote: input.customerNote ?? null,
        internalNote: input.internalNote ?? null,
        ipAddress: input.ipAddress ?? null,
        items: {
          create: totals.lines.map((line) => ({
            variantId: line.variantId,
            productId: line.productId,
            productName: line.productName,
            variantName: line.variantName,
            sku: line.sku,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            discountTotal: line.discountTotal,
            taxTotal: line.taxTotal,
            lineTotal: line.lineTotal,
          })),
        },
        addresses: {
          create: [
            addressData(input.shippingAddress, 'SHIPPING'),
            addressData(input.billingAddress ?? input.shippingAddress, 'BILLING'),
          ],
        },
      },
      select: { id: true, number: true, grandTotal: true, currency: true },
    });

    // Hold the stock so it cannot be sold twice while payment is outstanding.
    if (config.reserveOnOrder) {
      for (const line of totals.lines) {
        await reserveStock(line.variantId, line.quantity, tx);
      }
    } else {
      for (const line of totals.lines) {
        await consumeStock(line.variantId, line.quantity, {
          type: StockMovementType.SALE,
          reference: order.number,
          reason: 'Order placed',
          allowOversell: config.allowOversell,
          client: tx,
          actor,
        });
      }
    }

    if (totals.discountId) {
      await redeemDiscount(
        totals.discountId,
        order.id,
        input.customerId ?? null,
        totals.discountTotal,
        tx,
      );
    }

    await addEvent(
      order.id,
      'order.placed',
      `Order placed for ${formatMoney(order.grandTotal, order.currency, config.locale)}.`,
      actor,
      tx,
    );

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'CREATE',
        entityType: 'Order',
        entityId: order.id,
        entityLabel: order.number,
        after: {
          number: order.number,
          grandTotal: totals.grandTotal,
          currency: totals.currency,
          items: totals.lines.length,
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );

    return order.id;
  });

  const created = await getOrder(orderId);

  await notifyPermissionHolders('order.read', {
    type: 'order.placed',
    level: NotificationLevel.SUCCESS,
    title: `New order ${created.number}`,
    body: `${formatMoney(created.grandTotal, created.currency, config.locale)} from ${created.email}.`,
    entityType: 'Order',
    entityId: created.id,
    actionUrl: `/orders/${created.id}`,
  });

  return created;
};

export const createOrderForCustomer = async (
  input: CreateOrderInput,
  actor: ServiceActor,
) =>
  placeOrder(
    {
      items: input.items,
      email: input.email,
      phone: input.phone,
      customerId: input.customerId ?? undefined,
      shippingAddress: input.shippingAddress,
      billingAddress: input.billingAddress,
      discountCode: input.discountCode,
      shippingOverride: input.shippingTotal,
      customerNote: input.customerNote,
      internalNote: input.internalNote,
      channel: 'admin',
      ipAddress: actor.ipAddress,
    },
    actor,
  );

export const updateOrder = async (
  id: string,
  input: UpdateOrderInput,
  actor: ServiceActor,
) => {
  const order = await db.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, number: true, email: true, phone: true, customerNote: true, internalNote: true },
  });
  if (!order) throw new NotFoundError('Order');

  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id },
      data: {
        email: input.email,
        phone: input.phone ?? null,
        customerNote: input.customerNote ?? null,
        internalNote: input.internalNote ?? null,
      },
    });

    if (input.shippingAddress) {
      await tx.orderAddress.upsert({
        where: { orderId_type: { orderId: id, type: 'SHIPPING' } },
        create: { orderId: id, ...addressData(input.shippingAddress, 'SHIPPING') },
        update: addressData(input.shippingAddress, 'SHIPPING'),
      });
    }
    if (input.billingAddress) {
      await tx.orderAddress.upsert({
        where: { orderId_type: { orderId: id, type: 'BILLING' } },
        create: { orderId: id, ...addressData(input.billingAddress, 'BILLING') },
        update: addressData(input.billingAddress, 'BILLING'),
      });
    }

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'UPDATE',
        entityType: 'Order',
        entityId: id,
        entityLabel: order.number,
        before: { email: order.email, phone: order.phone },
        after: { email: input.email, phone: input.phone ?? null },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  return getOrder(id);
};

export const changeOrderStatus = async (
  id: string,
  input: UpdateOrderStatusInput,
  actor: ServiceActor,
) => {
  const order = await db.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, number: true, status: true, customerId: true },
  });
  if (!order) throw new NotFoundError('Order');

  assertTransition(order.status, input.status);

  if (input.status === OrderStatus.CANCELLED) {
    throw new PreconditionFailedError(
      'Use the cancel action instead, so stock is released and a reason is recorded.',
    );
  }
  if (input.status === OrderStatus.REFUNDED) {
    throw new PreconditionFailedError(
      'Use the refund action instead, so the amount and reason are recorded.',
    );
  }

  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id }, data: { status: input.status } });

    await addEvent(
      id,
      'order.status_changed',
      `Status changed from ${order.status} to ${input.status}${input.note ? ` - ${input.note}` : ''}.`,
      actor,
      tx,
    );

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'Order',
        entityId: id,
        entityLabel: order.number,
        before: { status: order.status },
        after: { status: input.status, note: input.note ?? null },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  if (order.customerId) {
    await notifyCustomer(order.customerId, {
      type: 'order.status',
      title: `Order ${order.number} updated`,
      body: `Your order is now ${input.status.toLowerCase()}.`,
      entityType: 'Order',
      entityId: id,
      actionUrl: `/account/orders/${order.number}`,
    });
  }

  return getOrder(id);
};

export const recordPayment = async (
  id: string,
  input: RecordPaymentInput,
  actor: ServiceActor,
) => {
  const order = await db.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      grandTotal: true,
      paymentStatus: true,
      payments: { where: { status: PaymentStatus.PAID }, select: { amount: true } },
      items: { select: { variantId: true, quantity: true } },
    },
  });
  if (!order) throw new NotFoundError('Order');

  if (order.status === OrderStatus.CANCELLED) {
    throw new PreconditionFailedError('A cancelled order cannot take a payment.');
  }

  const alreadyPaid = order.payments.reduce((total, payment) => total + payment.amount, 0);
  const config = await getStoreConfig();

  await db.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        orderId: id,
        provider: input.provider,
        reference: input.reference ?? null,
        amount: input.amount,
        currency: order.currency,
        status: input.status,
        capturedAt: input.status === PaymentStatus.PAID ? new Date() : null,
        failureReason: input.failureReason ?? null,
      },
    });

    if (input.status === PaymentStatus.PAID) {
      const paid = alreadyPaid + input.amount;
      const fullyPaid = paid >= order.grandTotal;

      await tx.order.update({
        where: { id },
        data: {
          paymentStatus: fullyPaid ? PaymentStatus.PAID : PaymentStatus.AUTHORIZED,
          // Taking payment on a pending order confirms it.
          ...(fullyPaid && order.status === OrderStatus.PENDING
            ? { status: OrderStatus.CONFIRMED }
            : {}),
        },
      });
    } else if (input.status === PaymentStatus.FAILED) {
      await tx.order.update({ where: { id }, data: { paymentStatus: PaymentStatus.FAILED } });
    }

    await addEvent(
      id,
      'payment.recorded',
      `${input.status === PaymentStatus.PAID ? 'Payment received' : `Payment ${input.status.toLowerCase()}`}: ${formatMoney(input.amount, order.currency, config.locale)} via ${input.provider}.`,
      actor,
      tx,
    );

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'UPDATE',
        entityType: 'Payment',
        entityId: id,
        entityLabel: order.number,
        after: { amount: input.amount, provider: input.provider, status: input.status },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  return getOrder(id);
};

export const fulfillOrder = async (
  id: string,
  input: FulfillOrderInput,
  actor: ServiceActor,
) => {
  const order = await db.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      email: true,
      customerId: true,
      items: {
        select: {
          id: true,
          variantId: true,
          quantity: true,
          quantityFulfilled: true,
          productName: true,
        },
      },
    },
  });
  if (!order) throw new NotFoundError('Order');

  if (order.status === OrderStatus.CANCELLED || order.status === OrderStatus.REFUNDED) {
    throw new PreconditionFailedError(
      `An order that is ${order.status.toLowerCase()} cannot be fulfilled.`,
    );
  }

  // Default to everything still outstanding.
  const requested =
    input.lines ??
    order.items
      .filter((item) => item.quantity > item.quantityFulfilled)
      .map((item) => ({
        orderItemId: item.id,
        quantity: item.quantity - item.quantityFulfilled,
      }));

  if (requested.length === 0) {
    throw new PreconditionFailedError('Every line on this order has already been fulfilled.');
  }

  const itemsById = new Map(order.items.map((item) => [item.id, item]));

  for (const line of requested) {
    const item = itemsById.get(line.orderItemId);
    if (!item) {
      throw new ValidationError([
        { path: 'lines', message: 'One of those lines is not on this order.' },
      ]);
    }
    const outstanding = item.quantity - item.quantityFulfilled;
    if (line.quantity > outstanding) {
      throw new ValidationError([
        {
          path: 'lines',
          message: `Only ${outstanding} unit(s) of ${item.productName} are still to be fulfilled.`,
        },
      ]);
    }
  }

  const config = await getStoreConfig();

  await db.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({
      data: {
        orderId: id,
        carrier: input.carrier,
        trackingNumber: input.trackingNumber ?? null,
        status: ShipmentStatus.IN_TRANSIT,
        shippedAt: new Date(),
      },
      select: { id: true },
    });

    for (const line of requested) {
      const item = itemsById.get(line.orderItemId);
      if (!item?.variantId) continue;

      await tx.orderItem.update({
        where: { id: line.orderItemId },
        data: { quantityFulfilled: { increment: line.quantity } },
      });

      if (config.reserveOnOrder) {
        await fulfillReservation(item.variantId, line.quantity, order.number, actor, tx);
      }
    }

    // Recompute the roll-up from the lines rather than guessing.
    const refreshed = await tx.orderItem.findMany({
      where: { orderId: id },
      select: { quantity: true, quantityFulfilled: true },
    });

    const allFulfilled = refreshed.every((item) => item.quantityFulfilled >= item.quantity);
    const anyFulfilled = refreshed.some((item) => item.quantityFulfilled > 0);

    await tx.order.update({
      where: { id },
      data: {
        fulfillmentStatus: allFulfilled
          ? FulfillmentStatus.FULFILLED
          : anyFulfilled
            ? FulfillmentStatus.PARTIALLY_FULFILLED
            : FulfillmentStatus.UNFULFILLED,
        ...(allFulfilled && canTransition(order.status, OrderStatus.SHIPPED)
          ? { status: OrderStatus.SHIPPED }
          : {}),
      },
    });

    await addEvent(
      id,
      'order.fulfilled',
      `${allFulfilled ? 'Order' : 'Part of the order'} shipped with ${input.carrier}${input.trackingNumber ? ` (${input.trackingNumber})` : ''}.`,
      actor,
      tx,
    );

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ORDER_FULFILLED',
        entityType: 'Order',
        entityId: id,
        entityLabel: order.number,
        after: {
          shipmentId: shipment.id,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber ?? null,
          lines: requested,
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  if (input.notifyCustomer) {
    await deliver(
      orderShippedEmail(
        order.email.split('@')[0] ?? 'there',
        order.number,
        input.carrier,
        input.trackingNumber ?? null,
        `${serverEnv.APP_URL}/account/orders/${order.number}`,
      ),
      order.email,
    );

    if (order.customerId) {
      await notifyCustomer(order.customerId, {
        type: 'order.shipped',
        level: NotificationLevel.SUCCESS,
        title: `Order ${order.number} shipped`,
        body: `On its way with ${input.carrier}.`,
        entityType: 'Order',
        entityId: id,
        actionUrl: `/account/orders/${order.number}`,
      });
    }
  }

  return getOrder(id);
};

export const cancelOrder = async (
  id: string,
  input: CancelOrderInput,
  actor: ServiceActor,
) => {
  const order = await db.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      customerId: true,
      items: {
        select: { variantId: true, quantity: true, quantityFulfilled: true },
      },
    },
  });
  if (!order) throw new NotFoundError('Order');

  assertTransition(order.status, OrderStatus.CANCELLED);

  /*
   * Integrity guard, independent of status: goods that have left the warehouse
   * cannot be un-sent. Cancelling here would release stock the business no
   * longer holds, overstating availability. A dispatched order is corrected
   * with a refund, not a cancellation.
   */
  const shippedUnits = order.items.reduce((total, item) => total + item.quantityFulfilled, 0);
  if (shippedUnits > 0) {
    throw new PreconditionFailedError(
      `${shippedUnits} unit(s) on this order have already shipped, so it cannot be cancelled. Issue a refund instead.`,
    );
  }

  const config = await getStoreConfig();

  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id },
      data: {
        status: OrderStatus.CANCELLED,
        cancelledAt: new Date(),
        internalNote: input.reason,
      },
    });

    if (input.restock) {
      for (const item of order.items) {
        if (!item.variantId) continue;

        const unshipped = item.quantity - item.quantityFulfilled;
        if (unshipped <= 0) continue;

        if (config.reserveOnOrder) {
          // Stock was only held, never taken: releasing the hold is enough.
          await releaseReservation(item.variantId, unshipped, tx);
        } else {
          await tx.inventoryItem.update({
            where: { variantId: item.variantId },
            data: { quantityOnHand: { increment: unshipped } },
          });
          const current = await tx.inventoryItem.findUniqueOrThrow({
            where: { variantId: item.variantId },
            select: { quantityOnHand: true },
          });
          await tx.stockMovement.create({
            data: {
              variantId: item.variantId,
              type: StockMovementType.RELEASE,
              quantity: unshipped,
              balanceAfter: current.quantityOnHand,
              reference: order.number,
              reason: 'Order cancelled',
              createdById: auditActorFor(actor).userId,
            },
          });
        }
      }
    }

    await addEvent(id, 'order.cancelled', `Order cancelled: ${input.reason}`, actor, tx);

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ORDER_CANCELLED',
        entityType: 'Order',
        entityId: id,
        entityLabel: order.number,
        before: { status: order.status },
        after: { status: OrderStatus.CANCELLED, reason: input.reason, restocked: input.restock },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  if (order.customerId) {
    await notifyCustomer(order.customerId, {
      type: 'order.cancelled',
      level: NotificationLevel.WARNING,
      title: `Order ${order.number} cancelled`,
      body: input.reason,
      entityType: 'Order',
      entityId: id,
      actionUrl: `/account/orders/${order.number}`,
    });
  }

  return getOrder(id);
};

export const refundOrder = async (
  id: string,
  input: RefundOrderInput,
  actor: ServiceActor,
) => {
  const order = await db.order.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      currency: true,
      grandTotal: true,
      refundedTotal: true,
      customerId: true,
      items: { select: { variantId: true, quantity: true } },
    },
  });
  if (!order) throw new NotFoundError('Order');

  const remaining = order.grandTotal - order.refundedTotal;
  if (remaining <= 0) {
    throw new PreconditionFailedError('This order has already been refunded in full.');
  }
  if (input.amount > remaining) {
    const config = await getStoreConfig();
    throw new ValidationError([
      {
        path: 'amount',
        message: `The most that can still be refunded is ${formatMoney(remaining, order.currency, config.locale)}.`,
      },
    ]);
  }

  const config = await getStoreConfig();
  const refundedTotal = order.refundedTotal + input.amount;
  const isFullRefund = refundedTotal >= order.grandTotal;

  await db.$transaction(async (tx) => {
    await tx.refund.create({
      data: {
        orderId: id,
        amount: input.amount,
        currency: order.currency,
        reason: input.reason,
        restock: input.restock,
        createdById: auditActorFor(actor).userId,
      },
    });

    await tx.order.update({
      where: { id },
      data: {
        refundedTotal,
        paymentStatus: isFullRefund
          ? PaymentStatus.REFUNDED
          : PaymentStatus.PARTIALLY_REFUNDED,
        ...(isFullRefund && canTransition(order.status, OrderStatus.REFUNDED)
          ? { status: OrderStatus.REFUNDED }
          : {}),
      },
    });

    if (input.restock && isFullRefund) {
      for (const item of order.items) {
        if (!item.variantId) continue;
        await tx.inventoryItem.update({
          where: { variantId: item.variantId },
          data: { quantityOnHand: { increment: item.quantity } },
        });
        const current = await tx.inventoryItem.findUniqueOrThrow({
          where: { variantId: item.variantId },
          select: { quantityOnHand: true },
        });
        await tx.stockMovement.create({
          data: {
            variantId: item.variantId,
            type: StockMovementType.RETURN,
            quantity: item.quantity,
            balanceAfter: current.quantityOnHand,
            reference: order.number,
            reason: 'Refunded and restocked',
            createdById: auditActorFor(actor).userId,
          },
        });
      }
    }

    await addEvent(
      id,
      'order.refunded',
      `Refunded ${formatMoney(input.amount, order.currency, config.locale)}: ${input.reason}`,
      actor,
      tx,
    );

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ORDER_REFUNDED',
        entityType: 'Order',
        entityId: id,
        entityLabel: order.number,
        before: { refundedTotal: order.refundedTotal },
        after: { refundedTotal, amount: input.amount, reason: input.reason },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  if (order.customerId) {
    await notifyCustomer(order.customerId, {
      type: 'order.refunded',
      title: `Refund issued for ${order.number}`,
      body: `${formatMoney(input.amount, order.currency, config.locale)} has been refunded.`,
      entityType: 'Order',
      entityId: id,
      actionUrl: `/account/orders/${order.number}`,
    });
  }

  return getOrder(id);
};

export const archiveOrder = async (id: string, actor: ServiceActor): Promise<void> => {
  const order = await db.order.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, number: true, status: true },
  });
  if (!order) throw new NotFoundError('Order');

  if (
    order.status !== OrderStatus.CANCELLED &&
    order.status !== OrderStatus.REFUNDED &&
    order.status !== OrderStatus.DELIVERED
  ) {
    throw new PreconditionFailedError(
      'Only delivered, cancelled or refunded orders can be archived.',
    );
  }

  await db.order.update({ where: { id }, data: { deletedAt: new Date() } });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'ARCHIVE',
    entityType: 'Order',
    entityId: id,
    entityLabel: order.number,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });
};

/** A customer's own order history, for the storefront account area. */
export const listCustomerOrders = async (
  customerId: string,
  page: number,
  pageSize: number,
): Promise<Paginated<OrderListItem>> => {
  const where = { customerId, deletedAt: null };

  const [rows, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { placedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        number: true,
        email: true,
        customerId: true,
        status: true,
        paymentStatus: true,
        fulfillmentStatus: true,
        currency: true,
        grandTotal: true,
        refundedTotal: true,
        placedAt: true,
        deletedAt: true,
        _count: { select: { items: true } },
      },
    }),
    db.order.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      number: row.number,
      email: row.email,
      customerId: row.customerId,
      customerName: null,
      status: row.status,
      paymentStatus: row.paymentStatus,
      fulfillmentStatus: row.fulfillmentStatus,
      currency: row.currency,
      grandTotal: row.grandTotal,
      refundedTotal: row.refundedTotal,
      itemCount: row._count.items,
      placedAt: row.placedAt,
      deletedAt: row.deletedAt,
    })),
    total,
    page,
    pageSize,
  };
};

export { OrderStatus, PaymentStatus, FulfillmentStatus, PaymentProvider };
