import { z } from 'zod';

import type { Optionalise } from '@/types/util';

import {
  FulfillmentStatus,
  OrderStatus,
  PaymentProvider,
  PaymentStatus,
  ShipmentStatus,
} from '@/generated/prisma/enums';

import { addressSchema } from './customer';
import {
  emailSchema,
  moneyMinorSchema,
  optionalText,
  phoneSchema,
  positiveQuantitySchema,
  requiredText,
  uuidSchema,
} from './common';

/** Order, fulfilment, payment and refund schemas. */

const orderLineSchema = z.object({
  variantId: uuidSchema,
  quantity: positiveQuantitySchema,
});

/** Back-office order creation, e.g. for a phone order. */
export const createOrderSchema = z.object({
  customerId: uuidSchema.nullish(),
  email: emailSchema,
  phone: phoneSchema,
  items: z.array(orderLineSchema).min(1, 'Add at least one item.').max(100),
  shippingAddress: addressSchema,
  /** Omit to bill to the shipping address. */
  billingAddress: addressSchema.optional(),
  discountCode: optionalText(48),
  shippingTotal: moneyMinorSchema('shipping cost').default(0),
  customerNote: optionalText(2000),
  internalNote: optionalText(2000),
});

export type CreateOrderInput = Optionalise<z.infer<typeof createOrderSchema>>;

export const updateOrderSchema = z.object({
  email: emailSchema,
  phone: phoneSchema,
  customerNote: optionalText(2000),
  internalNote: optionalText(2000),
  shippingAddress: addressSchema.optional(),
  billingAddress: addressSchema.optional(),
});

export type UpdateOrderInput = Optionalise<z.infer<typeof updateOrderSchema>>;

/**
 * Status transitions are validated server-side against the state machine in
 * `src/server/order-service.ts`; this schema only checks the shape.
 */
export const updateOrderStatusSchema = z.object({
  status: z.enum(OrderStatus),
  note: optionalText(500),
});

export type UpdateOrderStatusInput = Optionalise<z.infer<typeof updateOrderStatusSchema>>;

export const recordPaymentSchema = z.object({
  provider: z.enum(PaymentProvider),
  amount: moneyMinorSchema('amount').refine((value) => value > 0, 'Enter an amount above zero.'),
  reference: optionalText(120),
  status: z
    .enum([PaymentStatus.PAID, PaymentStatus.AUTHORIZED, PaymentStatus.FAILED])
    .default(PaymentStatus.PAID),
  failureReason: optionalText(300),
});

export type RecordPaymentInput = Optionalise<z.infer<typeof recordPaymentSchema>>;

export const fulfillOrderSchema = z.object({
  carrier: requiredText('a carrier name', 80),
  trackingNumber: optionalText(120),
  /**
   * Which lines, and how many of each, this shipment covers. Omit to fulfil
   * every outstanding unit on the order.
   */
  lines: z
    .array(
      z.object({
        orderItemId: uuidSchema,
        quantity: positiveQuantitySchema,
      }),
    )
    .optional(),
  notifyCustomer: z.boolean().default(true),
});

export type FulfillOrderInput = Optionalise<z.infer<typeof fulfillOrderSchema>>;

export const updateShipmentSchema = z.object({
  status: z.enum(ShipmentStatus),
  trackingNumber: optionalText(120),
});

export type UpdateShipmentInput = Optionalise<z.infer<typeof updateShipmentSchema>>;

export const refundOrderSchema = z.object({
  amount: moneyMinorSchema('refund amount').refine(
    (value) => value > 0,
    'Enter a refund amount above zero.',
  ),
  reason: requiredText('a reason for the refund', 300),
  /** Return the refunded units to sellable stock. */
  restock: z.boolean().default(false),
});

export type RefundOrderInput = Optionalise<z.infer<typeof refundOrderSchema>>;

export const cancelOrderSchema = z.object({
  reason: requiredText('a reason for cancelling', 300),
  /** Release reserved stock back to available. */
  restock: z.boolean().default(true),
});

export type CancelOrderInput = Optionalise<z.infer<typeof cancelOrderSchema>>;

export const ORDER_SORT_FIELDS = [
  'placedAt',
  'number',
  'grandTotal',
  'status',
  'paymentStatus',
] as const;

export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export const orderFilterKeys = [
  'status',
  'paymentStatus',
  'fulfillmentStatus',
  'customerId',
] as const;

export { OrderStatus, PaymentStatus, FulfillmentStatus };
