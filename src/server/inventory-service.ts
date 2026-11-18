import { NotFoundError, PreconditionFailedError } from '@/lib/api/errors';
import type { ListQuery } from '@/lib/api/query';
import type { Paginated } from '@/lib/api/responses';
import { recordAudit } from '@/lib/audit';
import { db, type DbClient } from '@/lib/db';
import { notifyPermissionHolders } from '@/lib/notifications';
import { NotificationLevel, StockMovementType } from '@/generated/prisma/enums';
import type {
  AdjustStockInput,
  InventorySortField,
  SetStockLevelInput,
  UpdateInventorySettingsInput,
} from '@/validation/inventory';

import { SYSTEM_ACTOR_ID, auditActorFor, type ServiceActor } from './types';

/**
 * Inventory.
 *
 * `inventory_items` holds the current figures and `stock_movements` is an
 * append-only ledger, so the present stock level is always explainable from
 * history rather than being a number someone typed.
 *
 * Concurrency: decrements use a conditional `updateMany` guarded by
 * `quantityOnHand >= needed`. If two checkouts race for the last unit, exactly
 * one update matches a row and the other is told the item is out of stock. A
 * read-then-write would oversell here.
 */

export const getOrCreateInventoryItem = async (
  variantId: string,
  client: DbClient = db,
): Promise<{ id: string; quantityOnHand: number; quantityReserved: number; allowBackorder: boolean }> => {
  const existing = await client.inventoryItem.findUnique({
    where: { variantId },
    select: { id: true, quantityOnHand: true, quantityReserved: true, allowBackorder: true },
  });
  if (existing) return existing;

  return client.inventoryItem.create({
    data: { variantId },
    select: { id: true, quantityOnHand: true, quantityReserved: true, allowBackorder: true },
  });
};

export type MovementRequest = {
  variantId: string;
  type: StockMovementType;
  /** Signed. Positive adds stock, negative removes it. */
  quantity: number;
  reason?: string | undefined;
  reference?: string | undefined;
};

/**
 * Appends a movement and moves the on-hand figure by the same amount.
 * Returns the new balance. Does not enforce availability - callers that must
 * not oversell use `consumeStock` instead.
 */
export const recordMovement = async (
  request: MovementRequest,
  actor: ServiceActor,
  client: DbClient = db,
): Promise<number> => {
  await getOrCreateInventoryItem(request.variantId, client);

  const updated = await client.inventoryItem.update({
    where: { variantId: request.variantId },
    data: { quantityOnHand: { increment: request.quantity } },
    select: { quantityOnHand: true },
  });

  await client.stockMovement.create({
    data: {
      variantId: request.variantId,
      type: request.type,
      quantity: request.quantity,
      balanceAfter: updated.quantityOnHand,
      reason: request.reason?.slice(0, 300) ?? null,
      reference: request.reference?.slice(0, 80) ?? null,
      createdById: actor.id === SYSTEM_ACTOR_ID ? null : actor.id,
    },
  });

  return updated.quantityOnHand;
};

/**
 * Atomically removes `quantity` units, refusing when not enough is available.
 * `available` is on-hand minus reserved, so stock already promised to an unpaid
 * order cannot be sold again.
 */
export const consumeStock = async (
  variantId: string,
  quantity: number,
  options: {
    type: StockMovementType;
    reference?: string | undefined;
    reason?: string | undefined;
    allowOversell?: boolean;
    client: DbClient;
    actor: ServiceActor;
  },
): Promise<number> => {
  const { client, actor } = options;
  const item = await getOrCreateInventoryItem(variantId, client);

  if (!options.allowOversell && !item.allowBackorder) {
    // Compare-and-set: only matches while enough stock remains unreserved.
    const result = await client.inventoryItem.updateMany({
      where: {
        variantId,
        quantityOnHand: { gte: quantity + item.quantityReserved },
      },
      data: { quantityOnHand: { decrement: quantity } },
    });

    if (result.count === 0) {
      const available = Math.max(0, item.quantityOnHand - item.quantityReserved);
      throw new PreconditionFailedError(
        `Only ${available} unit(s) of that item are available.`,
      );
    }
  } else {
    await client.inventoryItem.update({
      where: { variantId },
      data: { quantityOnHand: { decrement: quantity } },
    });
  }

  const current = await client.inventoryItem.findUniqueOrThrow({
    where: { variantId },
    select: { quantityOnHand: true },
  });

  await client.stockMovement.create({
    data: {
      variantId,
      type: options.type,
      quantity: -quantity,
      balanceAfter: current.quantityOnHand,
      reference: options.reference?.slice(0, 80) ?? null,
      reason: options.reason?.slice(0, 300) ?? null,
      createdById: actor.id === SYSTEM_ACTOR_ID ? null : actor.id,
    },
  });

  return current.quantityOnHand;
};

/** Holds stock for an order that is not yet paid. */
export const reserveStock = async (
  variantId: string,
  quantity: number,
  client: DbClient,
): Promise<void> => {
  const item = await getOrCreateInventoryItem(variantId, client);

  if (!item.allowBackorder) {
    const result = await client.inventoryItem.updateMany({
      where: { variantId, quantityOnHand: { gte: quantity + item.quantityReserved } },
      data: { quantityReserved: { increment: quantity } },
    });
    if (result.count === 0) {
      const available = Math.max(0, item.quantityOnHand - item.quantityReserved);
      throw new PreconditionFailedError(`Only ${available} unit(s) of that item are available.`);
    }
    return;
  }

  await client.inventoryItem.update({
    where: { variantId },
    data: { quantityReserved: { increment: quantity } },
  });
};

/** Releases a hold without shipping, e.g. when an order is cancelled. */
export const releaseReservation = async (
  variantId: string,
  quantity: number,
  client: DbClient,
): Promise<void> => {
  await client.inventoryItem.updateMany({
    where: { variantId },
    data: { quantityReserved: { decrement: quantity } },
  });

  // Guard against a negative reserved figure if bookkeeping ever drifts.
  await client.inventoryItem.updateMany({
    where: { variantId, quantityReserved: { lt: 0 } },
    data: { quantityReserved: 0 },
  });
};

/** Converts a reservation into a dispatch: reserved down, on-hand down. */
export const fulfillReservation = async (
  variantId: string,
  quantity: number,
  reference: string,
  actor: ServiceActor,
  client: DbClient,
): Promise<void> => {
  await releaseReservation(variantId, quantity, client);
  await consumeStock(variantId, quantity, {
    type: StockMovementType.SALE,
    reference,
    reason: 'Order fulfilled',
    allowOversell: true, // The units were already reserved for this order.
    client,
    actor,
  });
};

// ── Admin operations ─────────────────────────────────────────────────────────

export const adjustStock = async (
  input: AdjustStockInput,
  actor: ServiceActor,
): Promise<{ quantityOnHand: number }> => {
  const variant = await db.productVariant.findFirst({
    where: { id: input.variantId, deletedAt: null },
    select: { id: true, sku: true, name: true, product: { select: { name: true } } },
  });
  if (!variant) throw new NotFoundError('Variant');

  // RECEIPT and RETURN always add; DAMAGE always removes; ADJUSTMENT keeps the
  // sign the user supplied.
  const signed =
    input.type === StockMovementType.RECEIPT || input.type === StockMovementType.RETURN
      ? Math.abs(input.quantity)
      : input.type === StockMovementType.DAMAGE
        ? -Math.abs(input.quantity)
        : input.quantity;

  const balance = await db.$transaction(async (tx) => {
    const next = await recordMovement(
      {
        variantId: input.variantId,
        type: input.type,
        quantity: signed,
        reason: input.reason,
        reference: input.reference,
      },
      actor,
      tx,
    );

    if (next < 0) {
      throw new PreconditionFailedError(
        'That adjustment would take stock below zero. Record a stock count instead.',
      );
    }

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'STOCK_ADJUSTED',
        entityType: 'ProductVariant',
        entityId: input.variantId,
        entityLabel: `${variant.product.name} - ${variant.sku}`,
        after: { type: input.type, quantity: signed, balanceAfter: next, reason: input.reason },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );

    return next;
  });

  await notifyLowStock(input.variantId, `${variant.product.name} - ${variant.sku}`, balance);

  return { quantityOnHand: balance };
};

/** Sets the absolute figure, recording the delta as an ADJUSTMENT. */
export const setStockLevel = async (
  input: SetStockLevelInput,
  actor: ServiceActor,
): Promise<{ quantityOnHand: number }> => {
  const variant = await db.productVariant.findFirst({
    where: { id: input.variantId, deletedAt: null },
    select: { id: true, sku: true, product: { select: { name: true } } },
  });
  if (!variant) throw new NotFoundError('Variant');

  const balance = await db.$transaction(async (tx) => {
    const item = await getOrCreateInventoryItem(input.variantId, tx);
    const delta = input.quantityOnHand - item.quantityOnHand;

    if (delta === 0) return item.quantityOnHand;

    const next = await recordMovement(
      {
        variantId: input.variantId,
        type: StockMovementType.ADJUSTMENT,
        quantity: delta,
        reason: input.reason,
        reference: 'stock-count',
      },
      actor,
      tx,
    );

    await recordAudit(
      {
        actor: auditActorFor(actor),
        action: 'STOCK_ADJUSTED',
        entityType: 'ProductVariant',
        entityId: input.variantId,
        entityLabel: `${variant.product.name} - ${variant.sku}`,
        before: { quantityOnHand: item.quantityOnHand },
        after: { quantityOnHand: next, reason: input.reason },
        ipAddress: actor.ipAddress ?? null,
        userAgent: actor.userAgent ?? null,
        requestId: actor.requestId ?? null,
      },
      tx,
    );

    return next;
  });

  return { quantityOnHand: balance };
};

export const updateInventorySettings = async (
  variantId: string,
  input: UpdateInventorySettingsInput,
  actor: ServiceActor,
) => {
  await getOrCreateInventoryItem(variantId);

  const item = await db.inventoryItem.update({
    where: { variantId },
    data: {
      reorderPoint: input.reorderPoint,
      reorderQuantity: input.reorderQuantity,
      binLocation: input.binLocation ?? null,
      allowBackorder: input.allowBackorder,
    },
    select: {
      variantId: true,
      quantityOnHand: true,
      quantityReserved: true,
      reorderPoint: true,
      reorderQuantity: true,
      binLocation: true,
      allowBackorder: true,
    },
  });

  await recordAudit({
    actor: auditActorFor(actor),
    action: 'UPDATE',
    entityType: 'InventoryItem',
    entityId: variantId,
    after: { ...input },
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    requestId: actor.requestId ?? null,
  });

  return item;
};

/** Raises an in-app notification once stock reaches the reorder point. */
const notifyLowStock = async (
  variantId: string,
  label: string,
  balance: number,
): Promise<void> => {
  const item = await db.inventoryItem.findUnique({
    where: { variantId },
    select: { reorderPoint: true },
  });

  if (!item || item.reorderPoint <= 0 || balance > item.reorderPoint) return;

  await notifyPermissionHolders('inventory.read', {
    type: 'inventory.low_stock',
    level: balance === 0 ? NotificationLevel.ERROR : NotificationLevel.WARNING,
    title: balance === 0 ? 'Out of stock' : 'Low stock',
    body: `${label} is down to ${balance} unit(s), at or below its reorder point of ${item.reorderPoint}.`,
    entityType: 'ProductVariant',
    entityId: variantId,
    actionUrl: '/inventory',
  });
};

// ── Reads ────────────────────────────────────────────────────────────────────

export type InventoryListItem = {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string;
  sku: string;
  quantityOnHand: number;
  quantityReserved: number;
  available: number;
  reorderPoint: number;
  binLocation: string | null;
  allowBackorder: boolean;
  isLow: boolean;
  updatedAt: Date;
};

export const listInventory = async (
  query: ListQuery<InventorySortField>,
  lowStockThreshold: number,
): Promise<Paginated<InventoryListItem>> => {
  const onlyLow = query.filters.lowStock === 'true';
  const onlyOut = query.filters.outOfStock === 'true';

  const where = {
    variant: {
      deletedAt: null,
      ...(query.search
        ? {
            OR: [
              { sku: { contains: query.search, mode: 'insensitive' as const } },
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { product: { name: { contains: query.search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    },
    ...(onlyOut
      ? { quantityOnHand: { lte: 0 } }
      : onlyLow
        ? { quantityOnHand: { lte: lowStockThreshold } }
        : {}),
  };

  const orderBy =
    query.sortBy === 'sku'
      ? { variant: { sku: query.sortOrder } }
      : query.sortBy === 'name'
        ? { variant: { name: query.sortOrder } }
        : { [query.sortBy]: query.sortOrder };

  const [rows, total] = await Promise.all([
    db.inventoryItem.findMany({
      where,
      orderBy,
      skip: query.skip,
      take: query.take,
      select: {
        variantId: true,
        quantityOnHand: true,
        quantityReserved: true,
        reorderPoint: true,
        binLocation: true,
        allowBackorder: true,
        updatedAt: true,
        variant: {
          select: {
            sku: true,
            name: true,
            productId: true,
            product: { select: { name: true } },
          },
        },
      },
    }),
    db.inventoryItem.count({ where }),
  ]);

  return {
    items: rows.map((row) => {
      const available = row.quantityOnHand - row.quantityReserved;
      return {
        variantId: row.variantId,
        productId: row.variant.productId,
        productName: row.variant.product.name,
        variantName: row.variant.name,
        sku: row.variant.sku,
        quantityOnHand: row.quantityOnHand,
        quantityReserved: row.quantityReserved,
        available,
        reorderPoint: row.reorderPoint,
        binLocation: row.binLocation,
        allowBackorder: row.allowBackorder,
        isLow: row.quantityOnHand <= Math.max(row.reorderPoint, lowStockThreshold),
        updatedAt: row.updatedAt,
      };
    }),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export type StockMovementListItem = {
  id: string;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  reference: string | null;
  reason: string | null;
  createdByName: string | null;
  createdAt: Date;
  sku: string;
  productName: string;
};

export const listStockMovements = async (
  query: ListQuery<'createdAt'>,
  variantId?: string,
): Promise<Paginated<StockMovementListItem>> => {
  const where = {
    ...(variantId ? { variantId } : {}),
    ...(query.filters.type ? { type: query.filters.type as StockMovementType } : {}),
    ...(query.dateFrom || query.dateTo
      ? {
          createdAt: {
            ...(query.dateFrom ? { gte: query.dateFrom } : {}),
            ...(query.dateTo ? { lte: query.dateTo } : {}),
          },
        }
      : {}),
    ...(query.search
      ? {
          OR: [
            { reference: { contains: query.search, mode: 'insensitive' as const } },
            { variant: { sku: { contains: query.search, mode: 'insensitive' as const } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    db.stockMovement.findMany({
      where,
      orderBy: { createdAt: query.sortOrder },
      skip: query.skip,
      take: query.take,
      select: {
        id: true,
        type: true,
        quantity: true,
        balanceAfter: true,
        reference: true,
        reason: true,
        createdAt: true,
        createdBy: { select: { firstName: true, lastName: true } },
        variant: { select: { sku: true, product: { select: { name: true } } } },
      },
    }),
    db.stockMovement.count({ where }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      quantity: row.quantity,
      balanceAfter: row.balanceAfter,
      reference: row.reference,
      reason: row.reason,
      createdByName: row.createdBy
        ? `${row.createdBy.firstName} ${row.createdBy.lastName}`.trim()
        : null,
      createdAt: row.createdAt,
      sku: row.variant.sku,
      productName: row.variant.product.name,
    })),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
};

export const countLowStock = async (threshold: number): Promise<number> =>
  db.inventoryItem.count({
    where: { variant: { deletedAt: null }, quantityOnHand: { lte: threshold } },
  });
