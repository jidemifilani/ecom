import { z } from 'zod';

import type { Optionalise } from '@/types/util';

import { DiscountScope, DiscountType } from '@/generated/prisma/enums';

import {
  basisPointsSchema,
  checkboxSchema,
  isoDateSchema,
  moneyMinorSchema,
  optionalMoneyMinorSchema,
  optionalText,
  requiredText,
  uuidSchema,
} from './common';

/** Discount-code schemas. */

export const discountCodeSchema = z
  .string()
  .trim()
  .min(3, 'Use at least three characters.')
  .max(48, 'That code is too long.')
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]*$/, 'Use letters, numbers, dashes and underscores.');

const baseDiscountSchema = z.object({
  code: discountCodeSchema,
  name: requiredText('a name', 160),
  description: optionalText(500),
  type: z.enum(DiscountType),
  scope: z.enum(DiscountScope).default(DiscountScope.ALL),
  /**
   * Interpreted per type: basis points for PERCENTAGE (1000 = 10%), minor
   * units for FIXED_AMOUNT, ignored for FREE_SHIPPING.
   */
  value: z.coerce.number({ error: 'Enter a value.' }).int().min(0),
  minSubtotal: moneyMinorSchema('minimum subtotal').default(0),
  maxDiscountAmount: optionalMoneyMinorSchema('maximum discount'),
  usageLimit: z.coerce.number().int().min(1).max(1_000_000).optional(),
  perCustomerLimit: z.coerce.number().int().min(1).max(1000).optional(),
  startsAt: isoDateSchema,
  endsAt: isoDateSchema,
  isActive: checkboxSchema,
  targetCategoryId: uuidSchema.nullish(),
  targetProductId: uuidSchema.nullish(),
});

const withDiscountRules = <T extends typeof baseDiscountSchema>(schema: T) =>
  schema
    .refine(
      (data) => data.type !== DiscountType.PERCENTAGE || basisPointsSchema.safeParse(data.value).success,
      { path: ['value'], message: 'A percentage must be between 0 and 10000 basis points.' },
    )
    .refine((data) => data.type !== DiscountType.FIXED_AMOUNT || data.value > 0, {
      path: ['value'],
      message: 'Enter an amount above zero.',
    })
    .refine(
      (data) => !data.startsAt || !data.endsAt || data.startsAt < data.endsAt,
      { path: ['endsAt'], message: 'The end date must be after the start date.' },
    )
    .refine(
      (data) => data.scope !== DiscountScope.CATEGORY || Boolean(data.targetCategoryId),
      { path: ['targetCategoryId'], message: 'Choose the category this code applies to.' },
    )
    .refine(
      (data) => data.scope !== DiscountScope.PRODUCT || Boolean(data.targetProductId),
      { path: ['targetProductId'], message: 'Choose the product this code applies to.' },
    );

export const createDiscountSchema = withDiscountRules(baseDiscountSchema);
export type CreateDiscountInput = Optionalise<z.infer<typeof createDiscountSchema>>;

export const updateDiscountSchema = createDiscountSchema;
export type UpdateDiscountInput = Optionalise<z.infer<typeof updateDiscountSchema>>;

export const applyDiscountSchema = z.object({
  code: discountCodeSchema,
});

export type ApplyDiscountInput = Optionalise<z.infer<typeof applyDiscountSchema>>;

export const DISCOUNT_SORT_FIELDS = ['createdAt', 'code', 'usageCount', 'endsAt'] as const;

export type DiscountSortField = (typeof DISCOUNT_SORT_FIELDS)[number];
