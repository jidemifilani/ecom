import { z } from 'zod';

import type { Optionalise } from '@/types/util';

import { PaymentProvider } from '@/generated/prisma/enums';

import { addressSchema } from './customer';
import {
  checkboxSchema,
  emailSchema,
  optionalText,
  phoneSchema,
  positiveQuantitySchema,
  quantitySchema,
  uuidSchema,
} from './common';

/** Storefront cart and checkout schemas. */

export const addToCartSchema = z.object({
  variantId: uuidSchema,
  quantity: positiveQuantitySchema.default(1),
});

export type AddToCartInput = Optionalise<z.infer<typeof addToCartSchema>>;

export const updateCartItemSchema = z.object({
  variantId: uuidSchema,
  /** Zero removes the line. */
  quantity: quantitySchema,
});

export type UpdateCartItemInput = Optionalise<z.infer<typeof updateCartItemSchema>>;

export const checkoutSchema = z
  .object({
    email: emailSchema,
    phone: phoneSchema,
    shippingAddress: addressSchema,
    /** Leave off, or set `billingSameAsShipping`, to bill the shipping address. */
    billingSameAsShipping: checkboxSchema,
    billingAddress: addressSchema.optional(),
    discountCode: optionalText(48),
    customerNote: optionalText(1000),
    paymentProvider: z
      .enum([
        PaymentProvider.CASH_ON_DELIVERY,
        PaymentProvider.BANK_TRANSFER,
        PaymentProvider.MANUAL,
      ])
      .default(PaymentProvider.CASH_ON_DELIVERY),
    /** Create an account from these details after the order is placed. */
    createAccount: checkboxSchema,
  })
  .refine((data) => data.billingSameAsShipping || data.billingAddress !== undefined, {
    path: ['billingAddress'],
    message: 'Enter a billing address, or bill to the shipping address.',
  });

export type CheckoutInput = Optionalise<z.infer<typeof checkoutSchema>>;
