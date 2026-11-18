import { db } from '@/lib/db';
import { OrderStatus, PaymentStatus } from '@/generated/prisma/enums';

import { getSalesSeries, getTopProducts } from './dashboard-service';
import { getStoreConfig } from './settings-service';

/**
 * Reporting.
 *
 * All revenue figures use the same definition as the dashboard: paid orders
 * only, net of refunds, cancelled orders excluded. Keeping that rule in one
 * shape across every report is what makes two reports reconcile.
 *
 * Aggregations run as SQL rather than being computed in Node, so a report over
 * a year of orders does not stream every row into memory.
 */

const asNumber = (value: bigint | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
};

export type ReportRange = { from: Date; to: Date };

export const resolveRange = (
  from: Date | undefined,
  to: Date | undefined,
  defaultDays = 30,
): ReportRange => {
  const end = to ?? new Date();
  const start = from ?? new Date(end.getTime() - defaultDays * 24 * 60 * 60 * 1000);
  return { from: start, to: end };
};

// ── Sales summary ────────────────────────────────────────────────────────────

export type SalesSummary = {
  range: ReportRange;
  currency: string;
  locale: string;
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
  discounts: number;
  tax: number;
  shipping: number;
  orderCount: number;
  unitsSold: number;
  averageOrderValue: number;
  series: { date: string; revenue: number; orders: number }[];
  byStatus: { status: OrderStatus; count: number; value: number }[];
  byPaymentProvider: { provider: string; count: number; value: number }[];
};

export const getSalesSummary = async (range: ReportRange): Promise<SalesSummary> => {
  const config = await getStoreConfig();

  const paidWhere = {
    deletedAt: null,
    status: { notIn: [OrderStatus.CANCELLED] },
    paymentStatus: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] },
    placedAt: { gte: range.from, lt: range.to },
  };

  const [totals, units, statusGroups, providerRows, series] = await Promise.all([
    db.order.aggregate({
      where: paidWhere,
      _sum: {
        grandTotal: true,
        refundedTotal: true,
        discountTotal: true,
        taxTotal: true,
        shippingTotal: true,
      },
      _count: { _all: true },
    }),
    db.orderItem.aggregate({
      where: { order: paidWhere },
      _sum: { quantity: true },
    }),
    db.order.groupBy({
      by: ['status'],
      where: { deletedAt: null, placedAt: { gte: range.from, lt: range.to } },
      _count: { _all: true },
      _sum: { grandTotal: true },
    }),
    db.$queryRaw<{ provider: string; count: bigint; value: bigint }[]>`
      SELECT p."provider" AS provider, COUNT(*) AS count, SUM(p."amount") AS value
      FROM payments p
      JOIN orders o ON o."id" = p."orderId"
      WHERE o."deletedAt" IS NULL
        AND p."status" = 'PAID'
        AND p."createdAt" >= ${range.from}
        AND p."createdAt" < ${range.to}
      GROUP BY p."provider"
      ORDER BY value DESC
    `,
    getSalesSeries(range.from, range.to),
  ]);

  const gross = totals._sum.grandTotal ?? 0;
  const refunds = totals._sum.refundedTotal ?? 0;
  const net = Math.max(0, gross - refunds);
  const orderCount = totals._count._all;

  return {
    range,
    currency: config.currency,
    locale: config.locale,
    grossRevenue: gross,
    refunds,
    netRevenue: net,
    discounts: totals._sum.discountTotal ?? 0,
    tax: totals._sum.taxTotal ?? 0,
    shipping: totals._sum.shippingTotal ?? 0,
    orderCount,
    unitsSold: units._sum.quantity ?? 0,
    averageOrderValue: orderCount > 0 ? Math.round(net / orderCount) : 0,
    series,
    byStatus: statusGroups
      .map((group) => ({
        status: group.status,
        count: group._count._all,
        value: group._sum.grandTotal ?? 0,
      }))
      .sort((a, b) => b.count - a.count),
    byPaymentProvider: providerRows.map((row) => ({
      provider: row.provider,
      count: asNumber(row.count),
      value: asNumber(row.value),
    })),
  };
};

// ── Product performance ──────────────────────────────────────────────────────

export type ProductPerformanceRow = {
  productId: string | null;
  name: string;
  sku: string;
  unitsSold: number;
  revenue: number;
  discountGiven: number;
  orderCount: number;
};

export const getProductPerformance = async (
  range: ReportRange,
  limit = 100,
): Promise<ProductPerformanceRow[]> => {
  const rows = await db.$queryRaw<
    {
      productId: string | null;
      name: string;
      sku: string;
      units: bigint;
      revenue: bigint;
      discount: bigint;
      orders: bigint;
    }[]
  >`
    SELECT
      oi."productId"                    AS "productId",
      MAX(oi."productName")             AS name,
      MAX(oi."sku")                     AS sku,
      SUM(oi."quantity")                AS units,
      SUM(oi."lineTotal")               AS revenue,
      SUM(oi."discountTotal")           AS discount,
      COUNT(DISTINCT oi."orderId")      AS orders
    FROM order_items oi
    JOIN orders o ON o."id" = oi."orderId"
    WHERE o."deletedAt" IS NULL
      AND o."status" <> 'CANCELLED'
      AND o."paymentStatus" IN ('PAID', 'PARTIALLY_REFUNDED')
      AND o."placedAt" >= ${range.from}
      AND o."placedAt" < ${range.to}
    GROUP BY oi."productId"
    ORDER BY revenue DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    sku: row.sku,
    unitsSold: asNumber(row.units),
    revenue: asNumber(row.revenue),
    discountGiven: asNumber(row.discount),
    orderCount: asNumber(row.orders),
  }));
};

// ── Inventory valuation ──────────────────────────────────────────────────────

export type InventoryValuationRow = {
  variantId: string;
  productName: string;
  sku: string;
  quantityOnHand: number;
  quantityReserved: number;
  costPrice: number | null;
  retailPrice: number;
  costValue: number;
  retailValue: number;
  isLow: boolean;
};

export type InventoryValuation = {
  rows: InventoryValuationRow[];
  totalCostValue: number;
  totalRetailValue: number;
  totalUnits: number;
  currency: string;
  locale: string;
};

export const getInventoryValuation = async (
  options: { lowOnly?: boolean; limit?: number } = {},
): Promise<InventoryValuation> => {
  const config = await getStoreConfig();

  const items = await db.inventoryItem.findMany({
    where: {
      variant: { deletedAt: null, product: { deletedAt: null } },
      ...(options.lowOnly ? { quantityOnHand: { lte: config.lowStockThreshold } } : {}),
    },
    orderBy: { quantityOnHand: 'asc' },
    take: options.limit ?? 1000,
    select: {
      variantId: true,
      quantityOnHand: true,
      quantityReserved: true,
      reorderPoint: true,
      variant: {
        select: {
          sku: true,
          price: true,
          costPrice: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  const rows: InventoryValuationRow[] = items.map((item) => {
    const cost = item.variant.costPrice;
    const onHand = item.quantityOnHand;
    return {
      variantId: item.variantId,
      productName: item.variant.product.name,
      sku: item.variant.sku,
      quantityOnHand: onHand,
      quantityReserved: item.quantityReserved,
      costPrice: cost,
      retailPrice: item.variant.price,
      costValue: (cost ?? 0) * Math.max(0, onHand),
      retailValue: item.variant.price * Math.max(0, onHand),
      isLow: onHand <= Math.max(item.reorderPoint, config.lowStockThreshold),
    };
  });

  return {
    rows,
    totalCostValue: rows.reduce((total, row) => total + row.costValue, 0),
    totalRetailValue: rows.reduce((total, row) => total + row.retailValue, 0),
    totalUnits: rows.reduce((total, row) => total + Math.max(0, row.quantityOnHand), 0),
    currency: config.currency,
    locale: config.locale,
  };
};

// ── Customers ────────────────────────────────────────────────────────────────

export type CustomerReportRow = {
  customerId: string;
  name: string;
  email: string;
  orderCount: number;
  netSpend: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
};

export type CustomerReport = {
  topCustomers: CustomerReportRow[];
  newCustomers: number;
  returningCustomers: number;
  repeatRate: number;
  currency: string;
  locale: string;
};

export const getCustomerReport = async (
  range: ReportRange,
  limit = 50,
): Promise<CustomerReport> => {
  const config = await getStoreConfig();

  const [rows, newCustomers, returningRows] = await Promise.all([
    db.$queryRaw<
      {
        customerId: string;
        name: string;
        email: string;
        orders: bigint;
        spend: bigint;
        first: Date | null;
        last: Date | null;
      }[]
    >`
      SELECT
        c."id"                                           AS "customerId",
        (c."firstName" || ' ' || c."lastName")           AS name,
        c."email"                                        AS email,
        COUNT(o."id")                                    AS orders,
        SUM(o."grandTotal" - o."refundedTotal")          AS spend,
        MIN(o."placedAt")                                AS first,
        MAX(o."placedAt")                                AS last
      FROM customers c
      JOIN orders o ON o."customerId" = c."id"
      WHERE c."deletedAt" IS NULL
        AND o."deletedAt" IS NULL
        AND o."status" <> 'CANCELLED'
        AND o."paymentStatus" IN ('PAID', 'PARTIALLY_REFUNDED')
        AND o."placedAt" >= ${range.from}
        AND o."placedAt" < ${range.to}
      GROUP BY c."id", c."firstName", c."lastName", c."email"
      ORDER BY spend DESC
      LIMIT ${limit}
    `,
    db.customer.count({
      where: { deletedAt: null, createdAt: { gte: range.from, lt: range.to } },
    }),
    db.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) AS count FROM (
        SELECT o."customerId"
        FROM orders o
        WHERE o."customerId" IS NOT NULL
          AND o."deletedAt" IS NULL
          AND o."status" <> 'CANCELLED'
          AND o."paymentStatus" IN ('PAID', 'PARTIALLY_REFUNDED')
        GROUP BY o."customerId"
        HAVING COUNT(o."id") > 1
      ) AS repeat_buyers
    `,
  ]);

  const returningCustomers = asNumber(returningRows[0]?.count);
  const totalBuyers = await db.order
    .groupBy({
      by: ['customerId'],
      where: {
        customerId: { not: null },
        deletedAt: null,
        status: { notIn: [OrderStatus.CANCELLED] },
        paymentStatus: { in: [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED] },
      },
    })
    .then((groups) => groups.length);

  return {
    topCustomers: rows.map((row) => ({
      customerId: row.customerId,
      name: row.name,
      email: row.email,
      orderCount: asNumber(row.orders),
      netSpend: Math.max(0, asNumber(row.spend)),
      firstOrderAt: row.first,
      lastOrderAt: row.last,
    })),
    newCustomers,
    returningCustomers,
    repeatRate: totalBuyers > 0 ? (returningCustomers / totalBuyers) * 100 : 0,
    currency: config.currency,
    locale: config.locale,
  };
};

// ── Discounts ────────────────────────────────────────────────────────────────

export type DiscountReportRow = {
  code: string;
  name: string;
  redemptions: number;
  discountGiven: number;
  revenueInfluenced: number;
};

export const getDiscountReport = async (range: ReportRange): Promise<DiscountReportRow[]> => {
  const rows = await db.$queryRaw<
    { code: string; name: string; redemptions: bigint; given: bigint; influenced: bigint }[]
  >`
    SELECT
      d."code"                  AS code,
      d."name"                  AS name,
      COUNT(r."id")             AS redemptions,
      SUM(r."amount")           AS given,
      SUM(o."grandTotal")       AS influenced
    FROM discount_redemptions r
    JOIN discounts d ON d."id" = r."discountId"
    JOIN orders o ON o."id" = r."orderId"
    WHERE o."deletedAt" IS NULL
      AND o."status" <> 'CANCELLED'
      AND r."createdAt" >= ${range.from}
      AND r."createdAt" < ${range.to}
    GROUP BY d."code", d."name"
    ORDER BY given DESC
    LIMIT 100
  `;

  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    redemptions: asNumber(row.redemptions),
    discountGiven: asNumber(row.given),
    revenueInfluenced: asNumber(row.influenced),
  }));
};

export { getTopProducts };
