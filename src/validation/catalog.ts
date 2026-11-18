import { z } from 'zod';

import type { Optionalise } from '@/types/util';

import { ProductStatus, ReviewStatus } from '@/generated/prisma/enums';

import {
  basisPointsSchema,
  checkboxSchema,
  currencyCodeSchema,
  isoDateSchema,
  moneyMinorSchema,
  optionalMoneyMinorSchema,
  optionalText,
  quantitySchema,
  requiredText,
  slugSchema,
  urlSchema,
  uuidSchema,
} from './common';

/** Catalog schemas: categories, brands, products, variants and reviews. */

// ── Categories ───────────────────────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: requiredText('a category name', 160),
  /** Left blank, the server derives the slug from the name. */
  slug: slugSchema.optional(),
  description: optionalText(2000),
  imageUrl: urlSchema,
  parentId: uuidSchema.nullish(),
  position: z.coerce.number().int().min(0).max(9999).default(0),
  isActive: checkboxSchema,
  metaTitle: optionalText(200),
  metaDescription: optionalText(320),
});

export type CreateCategoryInput = Optionalise<z.infer<typeof createCategorySchema>>;

export const updateCategorySchema = createCategorySchema;
export type UpdateCategoryInput = Optionalise<z.infer<typeof updateCategorySchema>>;

export const CATEGORY_SORT_FIELDS = ['position', 'name', 'createdAt'] as const;

// ── Brands ───────────────────────────────────────────────────────────────────

export const createBrandSchema = z.object({
  name: requiredText('a brand name', 160),
  slug: slugSchema.optional(),
  logoUrl: urlSchema,
  isActive: checkboxSchema,
});

export type CreateBrandInput = Optionalise<z.infer<typeof createBrandSchema>>;
export const updateBrandSchema = createBrandSchema;
export type UpdateBrandInput = Optionalise<z.infer<typeof updateBrandSchema>>;

// ── Products ─────────────────────────────────────────────────────────────────

export const skuSchema = z
  .string()
  .trim()
  .min(1, 'Enter a SKU.')
  .max(80, 'That SKU is too long.')
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'Use letters, numbers, dots, dashes and underscores.');

const productImageSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Enter an image URL.')
    .max(2048)
    .refine(
      (value) => /^https?:\/\//.test(value) || value.startsWith('/'),
      'Enter an absolute http(s) URL or a path beginning with /.',
    ),
  /** Required, not optional: a decorative-only product image fails WCAG 1.1.1. */
  alt: requiredText('alt text describing the image', 300),
  position: z.coerce.number().int().min(0).max(99).default(0),
  isPrimary: z.boolean().default(false),
});

const productCoreSchema = z.object({
  name: requiredText('a product name', 240),
  slug: slugSchema.optional(),
  shortDescription: optionalText(500),
  description: optionalText(20_000),
  status: z.enum(ProductStatus).default(ProductStatus.DRAFT),
  categoryId: uuidSchema.nullish(),
  brandId: uuidSchema.nullish(),
  basePrice: moneyMinorSchema('price'),
  compareAtPrice: optionalMoneyMinorSchema('compare-at price'),
  costPrice: optionalMoneyMinorSchema('cost price'),
  currency: currencyCodeSchema.default('USD'),
  taxRateBps: basisPointsSchema.default(0),
  isFeatured: checkboxSchema,
  trackInventory: checkboxSchema,
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).optional(),
  metaTitle: optionalText(200),
  metaDescription: optionalText(320),
  publishedAt: isoDateSchema,
  images: z.array(productImageSchema).max(12, 'A product can have up to 12 images.').default([]),
});

export const createProductSchema = productCoreSchema
  .extend({
    /** SKU for the automatically created default variant. */
    sku: skuSchema,
    initialQuantity: quantitySchema.default(0),
    reorderPoint: quantitySchema.default(0),
  })
  .refine(
    (data) => data.compareAtPrice === undefined || data.compareAtPrice > data.basePrice,
    {
      path: ['compareAtPrice'],
      message: 'The compare-at price must be higher than the selling price.',
    },
  );

export type CreateProductInput = Optionalise<z.infer<typeof createProductSchema>>;

export const updateProductSchema = productCoreSchema.refine(
  (data) => data.compareAtPrice === undefined || data.compareAtPrice > data.basePrice,
  {
    path: ['compareAtPrice'],
    message: 'The compare-at price must be higher than the selling price.',
  },
);

export type UpdateProductInput = Optionalise<z.infer<typeof updateProductSchema>>;

export const PRODUCT_SORT_FIELDS = [
  'createdAt',
  'updatedAt',
  'name',
  'basePrice',
  'status',
] as const;

export type ProductSortField = (typeof PRODUCT_SORT_FIELDS)[number];

// ── Variants ─────────────────────────────────────────────────────────────────

/** An option axis and its value for this variant, e.g. { Size, Large }. */
const variantAttributeSchema = z.object({
  name: requiredText('an option name', 80),
  value: requiredText('an option value', 80),
});

export const createVariantSchema = z.object({
  sku: skuSchema,
  name: requiredText('a variant name', 240),
  price: moneyMinorSchema('price'),
  compareAtPrice: optionalMoneyMinorSchema('compare-at price'),
  costPrice: optionalMoneyMinorSchema('cost price'),
  barcode: optionalText(80),
  weightGrams: z.coerce.number().int().min(0).max(1_000_000).optional(),
  position: z.coerce.number().int().min(0).max(999).default(0),
  isActive: checkboxSchema,
  attributes: z.array(variantAttributeSchema).max(4, 'Use up to four options per variant.').default([]),
  initialQuantity: quantitySchema.default(0),
  reorderPoint: quantitySchema.default(0),
});

export type CreateVariantInput = Optionalise<z.infer<typeof createVariantSchema>>;

export const updateVariantSchema = createVariantSchema.omit({ initialQuantity: true });
export type UpdateVariantInput = Optionalise<z.infer<typeof updateVariantSchema>>;

// ── Reviews ──────────────────────────────────────────────────────────────────

export const createReviewSchema = z.object({
  productId: uuidSchema,
  authorName: requiredText('your name', 120),
  rating: z.coerce
    .number({ error: 'Choose a rating.' })
    .int()
    .min(1, 'Choose a rating between 1 and 5.')
    .max(5, 'Choose a rating between 1 and 5.'),
  title: optionalText(200),
  body: requiredText('your review', 4000),
});

export type CreateReviewInput = Optionalise<z.infer<typeof createReviewSchema>>;

export const moderateReviewSchema = z.object({
  status: z.enum([ReviewStatus.APPROVED, ReviewStatus.REJECTED]),
});

export type ModerateReviewInput = Optionalise<z.infer<typeof moderateReviewSchema>>;
