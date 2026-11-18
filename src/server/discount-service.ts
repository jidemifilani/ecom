import { NotFoundError, PreconditionFailedError } from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { diffSnapshots, recordAudit } from '@/lib/audit';
import { db, type DbClient } from '@/lib/db';
import { clampDiscount, percentageDiscount } from '@/lib/money';
import { DiscountScope, DiscountType } from '@/generated/prisma/enums';
import type {
  CreateDiscountInput,
  DiscountSortField,
  UpdateDiscountInput,
} from '@/validation/discount';

import { auditActorFor, type ServiceActor } from './types';

/**
 * Discount codes.
 *
 * `evaluateDiscount` is the single place that decides whether a code applies
 * and what it is worth. Both the cart preview and the real checkout call it, so
 * the price a shopper is quoted is computed by the same code that charges them.
 */

export type DiscountListItem = {
  id: string;
  code: string;
  name: string;
  type: DiscountType;
  scope: DiscountScope;
  value: number;
  minSubtotal: number;
  usageLimit: number | null;
  usageCount: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  status: 'active' | 'scheduled' | 'expired' | 'exhausted' | 'disabled';
  createdAt: Date;
  deletedAt: Date | null;
};

const statusOf = (discount: {
  isActive: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  usageCount: number;
}): DiscountListItem['status'] => {
  if (!discount.isActive) return 'disabled';
  if (discount.usageLimit !== null && discount.usageCount >= discount.usageLimit) {
    return 'exhausted';
  }
  const now = new Date();
  if (discount.startsAt && discount.startsAt > now) return 'scheduled';
  if (discount.endsAt && discount.endsAt < now) return 'expired';
  return 'active';
};

export const listDiscounts = async (
  query: ListQuery<DiscountSortField>,
): Promise<Paginated<DiscountListItem>> => {
  const where = {
    ...(query.includeArchived ? {} : { deletedAt: null }),
    ...(query.filters.type ? { type: query.filters.type as DiscountType } : {}),
    ...(query.filters.isActive ? { isActive: query.filters.isActive === 'true' } : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: 'insensitive' as const } },
            { name: { contains: query.search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.discount.findMany({
      where,
      orderBy: { [query.sortBy]: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        code: true,
        name: true,
        type: true,
        scope: true,
        value: true,
        minSubtotal: true,
        usageLimit: true,
        usageCount: true,
        startsAt: true,
        endsAt: true,
        isActive: true,
        createdAt: true,
        deletedAt: true,
      },
    }),
    db.discount.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({ ...row, status: statusOf(row) })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export const getDiscount = async (id: string) => {
  const discount = await db.discount.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      type: true,
      scope: true,
      value: true,
      minSubtotal: true,
      maxDiscountAmount: true,
      usageLimit: true,
      usageCount: true,
      perCustomerLimit: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
      targetCategoryId: true,
      targetProductId: true,
      createdAt: true,
      updatedAt: true,
      deletedAt: true,
      _count: { select: { redemptions: true } },
    },
  });
  if (!discount) throw new NotFoundError('Discount');
  return { ...discount, status: statusOf(discount) };
};

export const createDiscount = async (input: CreateDiscountInput, actor: ServiceActor) => {
  const existing = await db.discount.findUnique({
    where: { code: input.code },
    select: { id: true },
  });
  if (existing) {
    throw new PreconditionFailedError('That discount code is already in use.');
  }

  const discount = await db.discount.create({
    data: {
      code: input.code,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      scope: input.scope,
      value: input.value,
      minSubtotal: input.minSubtotal,
      maxDiscountAmount: input.maxDiscountAmount ?? null,
      usageLimit: input.usageLimit ?? null,
      perCustomerLimit: input.perCustomerLimit ?? null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      isActive: input.isActive,
      targetCategoryId: input.scope === DiscountScope.CATEGORY ? input.targetCategoryId ?? null : null,
      targetProductId: input.scope === DiscountScope.PRODUCT ? input.targetProductId ?? null : null,
      createdById: actor.id,
    },
    select: { id: true },
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'CREATE',
    entityType: 'Discount',
    entityId: discount.id,
    entityLabel: input.code,
    after: { code: input.code, type: input.type, value: input.value },
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return getDiscount(discount.id);
};

export const updateDiscount = async (
  id: string,
  input: UpdateDiscountInput,
  actor: ServiceActor,
) => {
  const existing = await db.discount.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      type: true,
      scope: true,
      value: true,
      minSubtotal: true,
      maxDiscountAmount: true,
      usageLimit: true,
      perCustomerLimit: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
    },
  });
  if (!existing) throw new NotFoundError('Discount');

  if (input.code !== existing.code) {
    const clash = await db.discount.findFirst({
      where: { code: input.code, id: { not: id } },
      select: { id: true },
    });
    if (clash) throw new PreconditionFailedError('That discount code is already in use.');
  }

  const after = {
    code: input.code,
    name: input.name,
    description: input.description ?? null,
    type: input.type,
    scope: input.scope,
    value: input.value,
    minSubtotal: input.minSubtotal,
    maxDiscountAmount: input.maxDiscountAmount ?? null,
    usageLimit: input.usageLimit ?? null,
    perCustomerLimit: input.perCustomerLimit ?? null,
    startsAt: input.startsAt ?? null,
    endsAt: input.endsAt ?? null,
    isActive: input.isActive,
    targetCategoryId:
      input.scope === DiscountScope.CATEGORY ? input.targetCategoryId ?? null : null,
    targetProductId: input.scope === DiscountScope.PRODUCT ? input.targetProductId ?? null : null,
  };

  await db.discount.update({ where: { id }, data: after });

  const diff = diffSnapshots(existing, { id: existing.id, ...after });
  await recordAudit({
    actor: auditActorFor(actor),
    action: 'UPDATE',
    entityType: 'Discount',
    entityId: id,
    entityLabel: input.code,
    before: diff.before,
    after: diff.after,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return getDiscount(id);
};

export const archiveDiscount = async (id: string, actor: ServiceActor): Promise<void> => {
  const discount = await db.discount.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, code: true },
  });
  if (!discount) throw new NotFoundError('Discount');

  await db.discount.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false },
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'ARCHIVE',
    entityType: 'Discount',
    entityId: id,
    entityLabel: discount.code,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });
};

// ── Evaluation ───────────────────────────────────────────────────────────────

export type DiscountLine = {
  variantId: string;
  productId: string;
  categoryId: string | null;
  lineTotal: number;
};

export type DiscountEvaluation =
  | {
      applicable: true;
      discountId: string;
      code: string;
      type: DiscountType;
      /** Amount to take off the order subtotal, in minor units. */
      amount: number;
      /** True when the code makes shipping free rather than reducing goods. */
      freeShipping: boolean;
      description: string;
    }
  | { applicable: false; reason: string };

/**
 * Decides whether `code` applies to the given lines and what it is worth.
 *
 * Every rejection path returns a reason suitable for showing the shopper, and
 * no path trusts a client-supplied amount: the value is always recomputed here.
 */
export const evaluateDiscount = async (
  code: string,
  lines: readonly DiscountLine[],
  options: { customerId?: string | undefined; client?: DbClient } = {},
): Promise<DiscountEvaluation> => {
  const client = options.client ?? db;
  const normalized = code.trim().toUpperCase();

  if (normalized === '') return { applicable: false, reason: 'Enter a discount code.' };

  const discount = await client.discount.findFirst({
    where: { code: normalized, deletedAt: null },
    select: {
      id: true,
      code: true,
      name: true,
      type: true,
      scope: true,
      value: true,
      minSubtotal: true,
      maxDiscountAmount: true,
      usageLimit: true,
      usageCount: true,
      perCustomerLimit: true,
      startsAt: true,
      endsAt: true,
      isActive: true,
      targetCategoryId: true,
      targetProductId: true,
    },
  });

  if (!discount) {
    return { applicable: false, reason: 'That discount code was not recognised.' };
  }
  if (!discount.isActive) {
    return { applicable: false, reason: 'That discount code is no longer active.' };
  }

  const now = new Date();
  if (discount.startsAt && discount.startsAt > now) {
    return { applicable: false, reason: 'That discount code is not available yet.' };
  }
  if (discount.endsAt && discount.endsAt < now) {
    return { applicable: false, reason: 'That discount code has expired.' };
  }
  if (discount.usageLimit !== null && discount.usageCount >= discount.usageLimit) {
    return { applicable: false, reason: 'That discount code has reached its usage limit.' };
  }

  if (discount.perCustomerLimit !== null && options.customerId) {
    const used = await client.discountRedemption.count({
      where: { discountId: discount.id, customerId: options.customerId },
    });
    if (used >= discount.perCustomerLimit) {
      return { applicable: false, reason: 'You have already used that discount code.' };
    }
  }

  // Which lines the code applies to depends on its scope.
  const eligible = lines.filter((line) => {
    if (discount.scope === DiscountScope.ALL) return true;
    if (discount.scope === DiscountScope.CATEGORY) {
      return line.categoryId !== null && line.categoryId === discount.targetCategoryId;
    }
    return line.productId === discount.targetProductId;
  });

  const eligibleSubtotal = eligible.reduce((total, line) => total + line.lineTotal, 0);
  const orderSubtotal = lines.reduce((total, line) => total + line.lineTotal, 0);

  if (eligible.length === 0) {
    return {
      applicable: false,
      reason: 'That discount code does not apply to anything in your basket.',
    };
  }

  // The minimum is measured against the whole order, which is what shoppers
  // expect from "spend X to save".
  if (orderSubtotal < discount.minSubtotal) {
    return {
      applicable: false,
      reason: 'Your basket does not meet the minimum spend for that code.',
    };
  }

  if (discount.type === DiscountType.FREE_SHIPPING) {
    return {
      applicable: true,
      discountId: discount.id,
      code: discount.code,
      type: discount.type,
      amount: 0,
      freeShipping: true,
      description: `${discount.name} - free shipping`,
    };
  }

  const raw =
    discount.type === DiscountType.PERCENTAGE
      ? percentageDiscount(eligibleSubtotal, discount.value, discount.maxDiscountAmount)
      : Math.min(discount.value, discount.maxDiscountAmount ?? discount.value);

  const amount = clampDiscount(eligibleSubtotal, raw);

  if (amount <= 0) {
    return { applicable: false, reason: 'That discount code has no value on this basket.' };
  }

  return {
    applicable: true,
    discountId: discount.id,
    code: discount.code,
    type: discount.type,
    amount,
    freeShipping: false,
    description:
      discount.type === DiscountType.PERCENTAGE
        ? `${discount.name} - ${(discount.value / 100).toFixed(discount.value % 100 === 0 ? 0 : 2)}% off`
        : discount.name,
  };
};

/** Records that a code was used on an order and bumps its counter. */
export const redeemDiscount = async (
  discountId: string,
  orderId: string,
  customerId: string | null,
  amount: number,
  client: DbClient,
): Promise<void> => {
  await client.discountRedemption.create({
    data: { discountId, orderId, customerId, amount },
  });
  await client.discount.update({
    where: { id: discountId },
    data: { usageCount: { increment: 1 } },
  });
};

export const listDiscountOptions = async (): Promise<
  { id: string; code: string; name: string }[]
> =>
  db.discount.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { code: 'asc' },
    select: { id: true, code: true, name: true },
    take: 200,
  });
