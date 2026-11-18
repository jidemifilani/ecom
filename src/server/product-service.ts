import { ConflictError, NotFoundError, PreconditionFailedError } from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { diffSnapshots, recordAudit } from '@/lib/audit';
import { db, type DbClient } from '@/lib/db';
import { ProductStatus, ReviewStatus, StockMovementType } from '@/generated/prisma/enums';
import type {
  CreateProductInput,
  CreateVariantInput,
  ProductSortField,
  UpdateProductInput,
  UpdateVariantInput,
} from '@/validation/catalog';

import { uniqueSlug } from './catalog-service';
import { getOrCreateInventoryItem, recordMovement } from './inventory-service';
import { auditActorFor, type ServiceActor } from './types';

/**
 * Products and variants.
 *
 * Every product has at least one variant. A "simple" product is modelled as a
 * product with a single default variant, which means inventory, cart lines and
 * order lines always resolve to a variant and no code path needs a special
 * case for products without options.
 */

export type ProductListItem = {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  categoryName: string | null;
  brandName: string | null;
  isFeatured: boolean;
  primaryImageUrl: string | null;
  primaryImageAlt: string | null;
  variantCount: number;
  totalStock: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

const productListSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  basePrice: true,
  compareAtPrice: true,
  currency: true,
  isFeatured: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  category: { select: { name: true } },
  brand: { select: { name: true } },
  images: {
    where: { isPrimary: true },
    take: 1,
    select: { url: true, alt: true },
  },
  variants: {
    where: { deletedAt: null },
    select: { inventoryItem: { select: { quantityOnHand: true } } },
  },
} as const;

type ProductListRow = {
  id: string;
  name: string;
  slug: string;
  status: ProductStatus;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  isFeatured: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  category: { name: string } | null;
  brand: { name: string } | null;
  images: { url: string; alt: string }[];
  variants: { inventoryItem: { quantityOnHand: number } | null }[];
};

const toProductListItem = (row: ProductListRow): ProductListItem => ({
  id: row.id,
  name: row.name,
  slug: row.slug,
  status: row.status,
  basePrice: row.basePrice,
  compareAtPrice: row.compareAtPrice,
  currency: row.currency,
  categoryName: row.category?.name ?? null,
  brandName: row.brand?.name ?? null,
  isFeatured: row.isFeatured,
  primaryImageUrl: row.images[0]?.url ?? null,
  primaryImageAlt: row.images[0]?.alt ?? null,
  variantCount: row.variants.length,
  totalStock: row.variants.reduce(
    (total, variant) => total + (variant.inventoryItem?.quantityOnHand ?? 0),
    0,
  ),
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
});

export const listProducts = async (
  query: ListQuery<ProductSortField>,
): Promise<Paginated<ProductListItem>> => {
  const where = {
    ...(query.includeArchived ? {} : { deletedAt: null }),
    ...(query.filters.status ? { status: query.filters.status as ProductStatus } : {}),
    ...(query.filters.categoryId ? { categoryId: query.filters.categoryId } : {}),
    ...(query.filters.brandId ? { brandId: query.filters.brandId } : {}),
    ...(query.filters.isFeatured ? { isFeatured: query.filters.isFeatured === 'true' } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' as const } },
            { slug: { contains: query.search, mode: 'insensitive' as const } },
            { shortDescription: { contains: query.search, mode: 'insensitive' as const } },
            {
              variants: {
                some: { sku: { contains: query.search, mode: 'insensitive' as const } },
              },
            },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: productListSelect,
    }),
    db.product.count({ where }),
  ]);

  return {
    items: rows.map(toProductListItem),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

const productDetailSelect = {
  id: true,
  name: true,
  slug: true,
  shortDescription: true,
  description: true,
  status: true,
  categoryId: true,
  brandId: true,
  basePrice: true,
  compareAtPrice: true,
  costPrice: true,
  currency: true,
  taxRateBps: true,
  isFeatured: true,
  trackInventory: true,
  weightGrams: true,
  metaTitle: true,
  metaDescription: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  images: {
    orderBy: { position: 'asc' },
    select: { id: true, url: true, alt: true, position: true, isPrimary: true },
  },
  variants: {
    where: { deletedAt: null },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      sku: true,
      barcode: true,
      name: true,
      price: true,
      compareAtPrice: true,
      costPrice: true,
      weightGrams: true,
      position: true,
      isDefault: true,
      isActive: true,
      inventoryItem: {
        select: {
          quantityOnHand: true,
          quantityReserved: true,
          reorderPoint: true,
          reorderQuantity: true,
          binLocation: true,
          allowBackorder: true,
        },
      },
      optionValues: {
        select: {
          optionValue: {
            select: { id: true, value: true, option: { select: { id: true, name: true } } },
          },
        },
      },
    },
  },
} as const;

export const getProduct = async (id: string) => {
  const product = await db.product.findUnique({ where: { id }, select: productDetailSelect });
  if (!product) throw new NotFoundError('Product');
  return product;
};

export type ProductDetail = Awaited<ReturnType<typeof getProduct>>;

const assertSkuAvailable = async (
  sku: string,
  client: DbClient,
  excludeVariantId?: string,
): Promise<void> => {
  const clash = await client.productVariant.findFirst({
    where: { sku, ...(excludeVariantId ? { id: { not: excludeVariantId } } : {}) },
    select: { id: true },
  });
  if (clash) {
    throw new ConflictError('That SKU is already in use.', [
      { path: 'sku', message: 'Already taken.' },
    ]);
  }
};

export const createProduct = async (input: CreateProductInput, actor: ServiceActor) => {
  const slug = await uniqueSlug(db.product, input.slug ?? input.name);
  await assertSkuAvailable(input.sku, db);

  // Exactly one image is primary. If the author marked none, the first wins.
  const images = input.images.map((image, index) => ({
    url: image.url,
    alt: image.alt,
    position: image.position || index,
    isPrimary: image.isPrimary,
  }));
  if (images.length > 0 && !images.some((image) => image.isPrimary)) {
    const first = images[0];
    if (first) first.isPrimary = true;
  }

  const created = await db.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: input.name,
        slug,
        shortDescription: input.shortDescription ?? null,
        description: input.description ?? null,
        status: input.status,
        categoryId: input.categoryId ?? null,
        brandId: input.brandId ?? null,
        basePrice: input.basePrice,
        compareAtPrice: input.compareAtPrice ?? null,
        costPrice: input.costPrice ?? null,
        currency: input.currency,
        taxRateBps: input.taxRateBps,
        isFeatured: input.isFeatured,
        trackInventory: input.trackInventory,
        weightGrams: input.weightGrams ?? null,
        metaTitle: input.metaTitle ?? null,
        metaDescription: input.metaDescription ?? null,
        publishedAt:
          input.publishedAt ?? (input.status === ProductStatus.ACTIVE ? new Date() : null),
        createdById: actor.id,
        updatedById: actor.id,
        images: { create: images },
        variants: {
          create: {
            sku: input.sku,
            name: 'Default',
            price: input.basePrice,
            compareAtPrice: input.compareAtPrice ?? null,
            costPrice: input.costPrice ?? null,
            weightGrams: input.weightGrams ?? null,
            isDefault: true,
            isActive: true,
            position: 0,
          },
        },
      },
      select: { id: true, variants: { select: { id: true } } },
    });

    const defaultVariant = product.variants[0];
    if (defaultVariant) {
      await tx.inventoryItem.create({
        data: {
          variantId: defaultVariant.id,
          quantityOnHand: 0,
          reorderPoint: input.reorderPoint,
        },
      });

      if (input.initialQuantity > 0) {
        await recordMovement(
          {
            variantId: defaultVariant.id,
            type: StockMovementType.RECEIPT,
            quantity: input.initialQuantity,
            reason: 'Opening stock',
          },
          actor,
          tx,
        );
      }
    }

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'CREATE',
        entityType: 'Product',
        entityId: product.id,
        entityLabel: input.name,
        after: {
          name: input.name,
          slug,
          sku: input.sku,
          status: input.status,
          basePrice: input.basePrice,
          currency: input.currency,
        },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );

    return product;
  });

  return getProduct(created.id);
};

export const updateProduct = async (
  id: string,
  input: UpdateProductInput,
  actor: ServiceActor,
) => {
  const existing = await db.product.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      shortDescription: true,
      description: true,
      status: true,
      categoryId: true,
      brandId: true,
      basePrice: true,
      compareAtPrice: true,
      costPrice: true,
      currency: true,
      taxRateBps: true,
      isFeatured: true,
      trackInventory: true,
      weightGrams: true,
      metaTitle: true,
      metaDescription: true,
      publishedAt: true,
    },
  });
  if (!existing) throw new NotFoundError('Product');

  const slug =
    input.slug && input.slug !== existing.slug
      ? await uniqueSlug(db.product, input.slug, id)
      : existing.slug;

  const images = input.images.map((image, index) => ({
    url: image.url,
    alt: image.alt,
    position: image.position || index,
    isPrimary: image.isPrimary,
  }));
  if (images.length > 0 && !images.some((image) => image.isPrimary)) {
    const first = images[0];
    if (first) first.isPrimary = true;
  }

  const after = {
    name: input.name,
    slug,
    shortDescription: input.shortDescription ?? null,
    description: input.description ?? null,
    status: input.status,
    categoryId: input.categoryId ?? null,
    brandId: input.brandId ?? null,
    basePrice: input.basePrice,
    compareAtPrice: input.compareAtPrice ?? null,
    costPrice: input.costPrice ?? null,
    currency: input.currency,
    taxRateBps: input.taxRateBps,
    isFeatured: input.isFeatured,
    trackInventory: input.trackInventory,
    weightGrams: input.weightGrams ?? null,
    metaTitle: input.metaTitle ?? null,
    metaDescription: input.metaDescription ?? null,
    publishedAt:
      input.publishedAt ??
      existing.publishedAt ??
      (input.status === ProductStatus.ACTIVE ? new Date() : null),
  };

  await db.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: { ...after, updatedById: actor.id },
    });

    // Images are replaced wholesale: the editor always submits the full set,
    // so a removed row means the author deleted it.
    await tx.productImage.deleteMany({ where: { productId: id } });
    if (images.length > 0) {
      await tx.productImage.createMany({
        data: images.map((image) => ({ ...image, productId: id })),
      });
    }

    // Keep the default variant's price aligned with the product price so a
    // simple product never shows two different figures.
    await tx.productVariant.updateMany({
      where: { productId: id, isDefault: true },
      data: {
        price: input.basePrice,
        compareAtPrice: input.compareAtPrice ?? null,
        costPrice: input.costPrice ?? null,
      },
    });

    const diff = diffSnapshots(existing, { id: existing.id, ...after });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'UPDATE',
        entityType: 'Product',
        entityId: id,
        entityLabel: input.name,
        before: diff.before,
        after: diff.after,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  return getProduct(id);
};

export const archiveProduct = async (id: string, actor: ServiceActor): Promise<void> => {
  const product = await db.product.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, status: true },
  });
  if (!product) throw new NotFoundError('Product');

  await db.$transaction(async (tx) => {
    await tx.product.update({
      where: { id },
      data: { deletedAt: new Date(), status: ProductStatus.ARCHIVED, updatedById: actor.id },
    });
    // Remove from every active cart so a shopper cannot check out an archived
    // item that is no longer purchasable.
    await tx.cartItem.deleteMany({
      where: { variant: { productId: id }, cart: { status: 'ACTIVE' } },
    });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ARCHIVE',
        entityType: 'Product',
        entityId: id,
        entityLabel: product.name,
        before: { status: product.status, deletedAt: null },
        after: { status: ProductStatus.ARCHIVED, deletedAt: new Date() },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });
};

export const restoreProduct = async (id: string, actor: ServiceActor) => {
  const product = await db.product.findUnique({
    where: { id },
    select: { id: true, name: true, deletedAt: true },
  });
  if (!product) throw new NotFoundError('Product');
  if (!product.deletedAt) throw new PreconditionFailedError('That product is not archived.');

  await db.product.update({
    where: { id },
    data: { deletedAt: null, status: ProductStatus.DRAFT, updatedById: actor.id },
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'RESTORE',
    entityType: 'Product',
    entityId: id,
    entityLabel: product.name,
    after: { status: ProductStatus.DRAFT, deletedAt: null },
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return getProduct(id);
};

// ── Variants ─────────────────────────────────────────────────────────────────

/** Upserts the option axes and values a variant refers to. */
const resolveOptionValueIds = async (
  productId: string,
  attributes: readonly { name: string; value: string }[],
  tx: DbClient,
): Promise<string[]> => {
  const ids: string[] = [];

  for (const [index, attribute] of attributes.entries()) {
    const option = await tx.productOption.upsert({
      where: { productId_name: { productId, name: attribute.name } },
      create: { productId, name: attribute.name, position: index },
      update: {},
      select: { id: true },
    });

    const value = await tx.productOptionValue.upsert({
      where: { optionId_value: { optionId: option.id, value: attribute.value } },
      create: { optionId: option.id, value: attribute.value, position: index },
      update: {},
      select: { id: true },
    });

    ids.push(value.id);
  }

  return ids;
};

export const createVariant = async (
  productId: string,
  input: CreateVariantInput,
  actor: ServiceActor,
) => {
  const product = await db.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!product) throw new NotFoundError('Product');

  await assertSkuAvailable(input.sku, db);

  const variantId = await db.$transaction(async (tx) => {
    const optionValueIds = await resolveOptionValueIds(productId, input.attributes, tx);

    const variant = await tx.productVariant.create({
      data: {
        productId,
        sku: input.sku,
        barcode: input.barcode ?? null,
        name: input.name,
        price: input.price,
        compareAtPrice: input.compareAtPrice ?? null,
        costPrice: input.costPrice ?? null,
        weightGrams: input.weightGrams ?? null,
        position: input.position,
        isActive: input.isActive,
        isDefault: false,
        optionValues: {
          create: optionValueIds.map((optionValueId) => ({ optionValueId })),
        },
      },
      select: { id: true },
    });

    await tx.inventoryItem.create({
      data: {
        variantId: variant.id,
        quantityOnHand: 0,
        reorderPoint: input.reorderPoint,
      },
    });

    if (input.initialQuantity > 0) {
      await recordMovement(
        {
          variantId: variant.id,
          type: StockMovementType.RECEIPT,
          quantity: input.initialQuantity,
          reason: 'Opening stock',
        },
        actor,
        tx,
      );
    }

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'CREATE',
        entityType: 'ProductVariant',
        entityId: variant.id,
        entityLabel: `${product.name} - ${input.sku}`,
        after: { sku: input.sku, name: input.name, price: input.price },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );

    return variant.id;
  });

  return db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      isActive: true,
      isDefault: true,
      inventoryItem: { select: { quantityOnHand: true } },
    },
  });
};

export const updateVariant = async (
  variantId: string,
  input: UpdateVariantInput,
  actor: ServiceActor,
) => {
  const existing = await db.productVariant.findFirst({
    where: { id: variantId, deletedAt: null },
    select: {
      id: true,
      productId: true,
      sku: true,
      barcode: true,
      name: true,
      price: true,
      compareAtPrice: true,
      costPrice: true,
      weightGrams: true,
      position: true,
      isActive: true,
      isDefault: true,
      product: { select: { name: true } },
    },
  });
  if (!existing) throw new NotFoundError('Variant');

  if (input.sku !== existing.sku) {
    await assertSkuAvailable(input.sku, db, variantId);
  }

  const after = {
    sku: input.sku,
    barcode: input.barcode ?? null,
    name: input.name,
    price: input.price,
    compareAtPrice: input.compareAtPrice ?? null,
    costPrice: input.costPrice ?? null,
    weightGrams: input.weightGrams ?? null,
    position: input.position,
    isActive: input.isActive,
  };

  await db.$transaction(async (tx) => {
    await tx.productVariant.update({ where: { id: variantId }, data: after });

    if (input.attributes.length > 0) {
      const optionValueIds = await resolveOptionValueIds(
        existing.productId,
        input.attributes,
        tx,
      );
      await tx.variantOptionValue.deleteMany({ where: { variantId } });
      await tx.variantOptionValue.createMany({
        data: optionValueIds.map((optionValueId) => ({ variantId, optionValueId })),
      });
    }

    await tx.inventoryItem.updateMany({
      where: { variantId },
      data: { reorderPoint: input.reorderPoint },
    });

    const diff = diffSnapshots(
      {
        sku: existing.sku,
        barcode: existing.barcode,
        name: existing.name,
        price: existing.price,
        compareAtPrice: existing.compareAtPrice,
        costPrice: existing.costPrice,
        weightGrams: existing.weightGrams,
        position: existing.position,
        isActive: existing.isActive,
      },
      after,
    );

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'UPDATE',
        entityType: 'ProductVariant',
        entityId: variantId,
        entityLabel: `${existing.product.name} - ${input.sku}`,
        before: diff.before,
        after: diff.after,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });

  return db.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      isActive: true,
      isDefault: true,
      inventoryItem: { select: { quantityOnHand: true } },
    },
  });
};

export const archiveVariant = async (variantId: string, actor: ServiceActor): Promise<void> => {
  const variant = await db.productVariant.findFirst({
    where: { id: variantId, deletedAt: null },
    select: {
      id: true,
      sku: true,
      isDefault: true,
      productId: true,
      product: { select: { name: true, _count: { select: { variants: true } } } },
    },
  });
  if (!variant) throw new NotFoundError('Variant');

  if (variant.isDefault) {
    throw new PreconditionFailedError(
      'The default variant cannot be removed. Archive the product instead.',
    );
  }

  await db.$transaction(async (tx) => {
    await tx.productVariant.update({
      where: { id: variantId },
      data: { deletedAt: new Date(), isActive: false },
    });
    await tx.cartItem.deleteMany({ where: { variantId, cart: { status: 'ACTIVE' } } });

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'ARCHIVE',
        entityType: 'ProductVariant',
        entityId: variantId,
        entityLabel: `${variant.product.name} - ${variant.sku}`,
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );
  });
};

// ── Storefront reads ─────────────────────────────────────────────────────────

export type StorefrontProduct = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  categoryName: string | null;
  categorySlug: string | null;
  brandName: string | null;
  images: { url: string; alt: string }[];
  variants: {
    id: string;
    sku: string;
    name: string;
    price: number;
    available: number;
    isDefault: boolean;
    options: { name: string; value: string }[];
  }[];
  averageRating: number | null;
  reviewCount: number;
  inStock: boolean;
};

const storefrontProductWhere = {
  deletedAt: null,
  status: ProductStatus.ACTIVE,
};

export const getStorefrontProduct = async (slug: string): Promise<StorefrontProduct | null> => {
  const product = await db.product.findFirst({
    where: { ...storefrontProductWhere, slug },
    select: {
      id: true,
      name: true,
      slug: true,
      shortDescription: true,
      description: true,
      basePrice: true,
      compareAtPrice: true,
      currency: true,
      category: { select: { name: true, slug: true } },
      brand: { select: { name: true } },
      images: { orderBy: { position: 'asc' }, select: { url: true, alt: true } },
      variants: {
        where: { deletedAt: null, isActive: true },
        orderBy: { position: 'asc' },
        select: {
          id: true,
          sku: true,
          name: true,
          price: true,
          isDefault: true,
          inventoryItem: {
            select: { quantityOnHand: true, quantityReserved: true, allowBackorder: true },
          },
          optionValues: {
            select: {
              optionValue: { select: { value: true, option: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });

  if (!product) return null;

  const ratings = await db.review.aggregate({
    where: { productId: product.id, status: ReviewStatus.APPROVED },
    _avg: { rating: true },
    _count: { _all: true },
  });

  const variants = product.variants.map((variant) => {
    const onHand = variant.inventoryItem?.quantityOnHand ?? 0;
    const reserved = variant.inventoryItem?.quantityReserved ?? 0;
    const backorder = variant.inventoryItem?.allowBackorder ?? false;
    return {
      id: variant.id,
      sku: variant.sku,
      name: variant.name,
      price: variant.price,
      available: backorder ? Number.MAX_SAFE_INTEGER : Math.max(0, onHand - reserved),
      isDefault: variant.isDefault,
      options: variant.optionValues.map((entry) => ({
        name: entry.optionValue.option.name,
        value: entry.optionValue.value,
      })),
    };
  });

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    shortDescription: product.shortDescription,
    description: product.description,
    basePrice: product.basePrice,
    compareAtPrice: product.compareAtPrice,
    currency: product.currency,
    categoryName: product.category?.name ?? null,
    categorySlug: product.category?.slug ?? null,
    brandName: product.brand?.name ?? null,
    images: product.images,
    variants,
    averageRating: ratings._avg.rating,
    reviewCount: ratings._count._all,
    inStock: variants.some((variant) => variant.available > 0),
  };
};

export type StorefrontListItem = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  imageUrl: string | null;
  imageAlt: string;
  inStock: boolean;
  brandName: string | null;
};

export type StorefrontListOptions = {
  categorySlug?: string | undefined;
  search?: string | undefined;
  brandId?: string | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  featuredOnly?: boolean;
  sort?: 'newest' | 'price-asc' | 'price-desc' | 'name';
  page: number;
  pageSize: number;
  includeOutOfStock: boolean;
};

export const listStorefrontProducts = async (
  options: StorefrontListOptions,
): Promise<Paginated<StorefrontListItem>> => {
  const where = {
    ...storefrontProductWhere,
    ...(options.categorySlug
      ? {
          category: {
            OR: [
              { slug: options.categorySlug },
              { parent: { slug: options.categorySlug } },
            ],
          },
        }
      : {}),
    ...(options.brandId ? { brandId: options.brandId } : {}),
    ...(options.featuredOnly ? { isFeatured: true } : {}),
    ...(options.minPrice !== undefined || options.maxPrice !== undefined
      ? {
          basePrice: {
            ...(options.minPrice !== undefined ? { gte: options.minPrice } : {}),
            ...(options.maxPrice !== undefined ? { lte: options.maxPrice } : {}),
          },
        }
      : {}),
    ...(options.search
      ? {
          OR: [
            { name: { contains: options.search, mode: 'insensitive' as const } },
            { shortDescription: { contains: options.search, mode: 'insensitive' as const } },
            { description: { contains: options.search, mode: 'insensitive' as const } },
            { brand: { name: { contains: options.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
    ...(options.includeOutOfStock
      ? {}
      : {
          variants: {
            some: {
              deletedAt: null,
              isActive: true,
              OR: [
                { inventoryItem: { quantityOnHand: { gt: 0 } } },
                { inventoryItem: { allowBackorder: true } },
              ],
            },
          },
        }),
  };

  const orderBy =
    options.sort === 'price-asc'
      ? { basePrice: 'asc' as const }
      : options.sort === 'price-desc'
        ? { basePrice: 'desc' as const }
        : options.sort === 'name'
          ? { name: 'asc' as const }
          : { createdAt: 'desc' as const };

  const [rows, total] = await Promise.all([
    db.product.findMany({
      where,
      orderBy,
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: {
        id: true,
        name: true,
        slug: true,
        shortDescription: true,
        basePrice: true,
        compareAtPrice: true,
        currency: true,
        brand: { select: { name: true } },
        images: { orderBy: { position: 'asc' }, take: 1, select: { url: true, alt: true } },
        variants: {
          where: { deletedAt: null, isActive: true },
          select: {
            inventoryItem: {
              select: { quantityOnHand: true, quantityReserved: true, allowBackorder: true },
            },
          },
        },
      },
    }),
    db.product.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      shortDescription: row.shortDescription,
      basePrice: row.basePrice,
      compareAtPrice: row.compareAtPrice,
      currency: row.currency,
      imageUrl: row.images[0]?.url ?? null,
      imageAlt: row.images[0]?.alt ?? row.name,
      brandName: row.brand?.name ?? null,
      inStock: row.variants.some((variant) => {
        const item = variant.inventoryItem;
        if (!item) return false;
        return item.allowBackorder || item.quantityOnHand - item.quantityReserved > 0;
      }),
    })),
    total,
    page: options.page,
    pageSize: options.pageSize,
  };
};

/** Lightweight product list for select inputs (discount targeting, pickers). */
export const listProductOptions = async (
  limit = 200,
): Promise<{ id: string; name: string }[]> =>
  db.product.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
    take: limit,
  });

/** Variant options for order-builder and cart pickers. */
export const listVariantOptions = async (
  search: string | undefined,
): Promise<
  { id: string; label: string; sku: string; price: number; available: number }[]
> => {
  const variants = await db.productVariant.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      product: { deletedAt: null },
      ...(search
        ? {
            OR: [
              { sku: { contains: search, mode: 'insensitive' as const } },
              { name: { contains: search, mode: 'insensitive' as const } },
              { product: { name: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    },
    orderBy: { product: { name: 'asc' } },
    take: 50,
    select: {
      id: true,
      sku: true,
      name: true,
      price: true,
      isDefault: true,
      product: { select: { name: true } },
      inventoryItem: { select: { quantityOnHand: true, quantityReserved: true } },
    },
  });

  return variants.map((variant) => ({
    id: variant.id,
    label: variant.isDefault
      ? variant.product.name
      : `${variant.product.name} - ${variant.name}`,
    sku: variant.sku,
    price: variant.price,
    available: Math.max(
      0,
      (variant.inventoryItem?.quantityOnHand ?? 0) -
        (variant.inventoryItem?.quantityReserved ?? 0),
    ),
  }));
};

export { getOrCreateInventoryItem };
