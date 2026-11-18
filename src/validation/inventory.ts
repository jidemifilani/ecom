import { z } from 'zod';

import type { Optionalise } from '@/types/util';

import { StockMovementType } from '@/generated/prisma/enums';

import { optionalText, quantitySchema, requiredText, uuidSchema } from './common';

/** Inventory adjustment schemas. */

/**
 * Manual stock change. `quantity` is signed for ADJUSTMENT and DAMAGE and
 * positive for RECEIPT and RETURN; the service normalises the sign so the
 * ledger always records the real direction of travel.
 */
export const adjustStockSchema = z.object({
  variantId: uuidSchema,
  type: z.enum([
    StockMovementType.RECEIPT,
    StockMovementType.RETURN,
    StockMovementType.ADJUSTMENT,
    StockMovementType.DAMAGE,
  ]),
  quantity: z.coerce
    .number({ error: 'Enter a quantity.' })
    .int('Quantities must be whole numbers.')
    .refine((value) => value !== 0, 'Enter a quantity other than zero.')
    .refine((value) => Math.abs(value) <= 1_000_000, 'That quantity is too large.'),
  reason: requiredText('a reason for the adjustment', 300),
  reference: optionalText(80),
});

export type AdjustStockInput = Optionalise<z.infer<typeof adjustStockSchema>>;

/** Sets the absolute on-hand figure, e.g. after a physical stock count. */
export const setStockLevelSchema = z.object({
  variantId: uuidSchema,
  quantityOnHand: quantitySchema,
  reason: requiredText('a reason for the correction', 300),
});

export type SetStockLevelInput = Optionalise<z.infer<typeof setStockLevelSchema>>;

export const updateInventorySettingsSchema = z.object({
  reorderPoint: quantitySchema,
  reorderQuantity: quantitySchema,
  binLocation: optionalText(80),
  allowBackorder: z.boolean().default(false),
});

export type UpdateInventorySettingsInput = Optionalise<z.infer<typeof updateInventorySettingsSchema>>;

export const INVENTORY_SORT_FIELDS = ['quantityOnHand', 'sku', 'name', 'updatedAt'] as const;

export type InventorySortField = (typeof INVENTORY_SORT_FIELDS)[number];
