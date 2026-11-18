import { db } from '@/lib/db';
import { percentChange } from '@/lib/utils';
import {
  CustomerStatus,
  FulfillmentStatus,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  ReviewStatus,
} from '@/generated/prisma/enums';

import { getStoreConfig } from './settings-service';

/**
 * Dashboard aggregates.
 *
 * Revenue counts paid orders only, net of refunds, and excludes cancelled
 * orders - a dashboard that counts unpaid baskets as revenue is worse than no
 * dashboard. Each KPI is returned with the equivalent figure for the preceding
 * period of the same length, so the UI can show a real trend rather than an
 * arbitrary one.
 */

const PAID_STATUSES = [PaymentStatus.PAID, PaymentStatus.PARTIALLY_REFUNDED];

export type Kpi = {
  value: number;
  previous: number;
  changePercent: number | null;
};

const toKpi = (value: number, previous: number): Kpi => ({
  value,
  previous,
  changePercent: percentChange(value, previous),
});

export type DashboardRange = 7 | 30 | 90 | 365;

export type DashboardData = {
  rangeDays: DashboardRange;
  currency: string;
  locale: string;
  revenue: Kpi;
  orders: Kpi;
  averageOrderValue: Kpi;
  newCustomers: Kpi;
  counts: {
    pendingOrders: number;
    unfulfilledOrders: number;
    lowStockVariants: number;
    outOfStockVariants: number;
    pendingReviews: number;
    activeProducts: number;
    draftProducts: number;
    totalCustomers: number;
  };
  salesSeries: { date: string; revenue: number; orders: number }[];
  statusBreakdown: { status: OrderStatus; count: number }[];
  topProducts: {
    productId: string | null;
    name: string;
    unitsSold: number;
    revenue: number;
  }[];
  recentOrders: {
    id: string;
    number: string;
    customerName: string;
    email: string;
    grandTotal: number;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    placedAt: Date;
  }[];
  recentActivity: {
    id: string;
    action: string;
    entityType: string;
    entityLabel: string | null;
    actorName: string | null;
    actorEmail: string | null;
    createdAt: Date;
  }[];
};

type RevenueRow = { gross: bigint | number | null; refunded: bigint | number | null; orders: bigint | number };

const asNumber = (value: bigint | number | null | undefined): number => {
  if (value === null || value === undefined) return 0;
  return typeof value === 'bigint' ? Number(value) : value;
};

/**
 * Permission-aware: callers without `dashboard.view_financials` get the
 * operational counts but zeroed money, so the page is useful to fulfilment
 * staff without exposing revenue.
 */
export const getDashboardData = async (
  rangeDays: DashboardRange,
  options: { includeFinancials: boolean },
): Promise<DashboardData> => {
  const config = await getStoreConfig();

  const now = new Date();
  const periodStart = new Date(now.getTime() - rangeDays * 24 * 60 * 60 * 1000);
  const previousStart = new Date(periodStart.getTime() - rangeDays * 24 * 60 * 60 * 1000);

  const revenueWhere = (from: Date, to: Date) => ({
    deletedAt: null,
    status: { notIn: [OrderStatus.CANCELLED] },
    paymentStatus: { in: PAID_STATUSES },
    placedAt: { gte: from, lt: to },
  });

  const [
    current,
    previous,
    newCustomersCurrent,
    newCustomersPrevious,
    pendingOrders,
    unfulfilledOrders,
    lowStockVariants,
    outOfStockVariants,
    pendingReviews,
    activeProducts,
    draftProducts,
    totalCustomers,
    statusGroups,
    recentOrders,
    recentActivity,
  ] = await Promise.all([
    db.order.aggregate({
      where: revenueWhere(periodStart, now),
      _sum: { grandTotal: true, refundedTotal: true },
      _count: { _all: true },
    }),
    db.order.aggregate({
      where: revenueWhere(previousStart, periodStart),
      _sum: { grandTotal: true, refundedTotal: true },
      _count: { _all: true },
    }),
    db.customer.count({
      where: { deletedAt: null, createdAt: { gte: periodStart, lt: now } },
    }),
    db.customer.count({
      where: { deletedAt: null, createdAt: { gte: previousStart, lt: periodStart } },
    }),
    db.order.count({ where: { deletedAt: null, status: OrderStatus.PENDING } }),
    db.order.count({
      where: {
        deletedAt: null,
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REFUNDED] },
        fulfillmentStatus: {
          in: [FulfillmentStatus.UNFULFILLED, FulfillmentStatus.PARTIALLY_FULFILLED],
        },
      },
    }),
    db.inventoryItem.count({
      where: {
        variant: { deletedAt: null },
        quantityOnHand: { gt: 0, lte: config.lowStockThreshold },
      },
    }),
    db.inventoryItem.count({
      where: { variant: { deletedAt: null }, quantityOnHand: { lte: 0 } },
    }),
    db.review.count({ where: { status: ReviewStatus.PENDING } }),
    db.product.count({ where: { deletedAt: null, status: ProductStatus.ACTIVE } }),
    db.product.count({ where: { deletedAt: null, status: ProductStatus.DRAFT } }),
    db.customer.count({ where: { deletedAt: null, status: CustomerStatus.ACTIVE } }),
    db.order.groupBy({
      by: ['status'],
      where: { deletedAt: null, placedAt: { gte: periodStart } },
      _count: { _all: true },
    }),
    db.order.findMany({
      where: { deletedAt: null },
      orderBy: { placedAt: 'desc' },
      take: 8,
      select: {
        id: true,
        number: true,
        email: true,
        grandTotal: true,
        status: true,
        paymentStatus: true,
        placedAt: true,
        customer: { select: { firstName: true, lastName: true } },
      },
    }),
    db.auditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityLabel: true,
        actorEmail: true,
        createdAt: true,
        actor: { select: { firstName: true, lastName: true } },
      },
    }),
  ]);

  const currentRevenue = Math.max(
    0,
    (current._sum.grandTotal ?? 0) - (current._sum.refundedTotal ?? 0),
  );
  const previousRevenue = Math.max(
    0,
    (previous._sum.grandTotal ?? 0) - (previous._sum.refundedTotal ?? 0),
  );
  const currentOrders = current._count._all;
  const previousOrders = previous._count._all;

  const salesSeries = await getSalesSeries(periodStart, now);
  const topProducts = await getTopProducts(periodStart, now, 5);

  const mask = (value: number): number => (options.includeFinancials ? value : 0);

  return {
    rangeDays,
    currency: config.currency,
    locale: config.locale,
    revenue: toKpi(mask(currentRevenue), mask(previousRevenue)),
    orders: toKpi(currentOrders, previousOrders),
    averageOrderValue: toKpi(
      mask(currentOrders > 0 ? Math.round(currentRevenue / currentOrders) : 0),
      mask(previousOrders > 0 ? Math.round(previousRevenue / previousOrders) : 0),
    ),
    newCustomers: toKpi(newCustomersCurrent, newCustomersPrevious),
    counts: {
      pendingOrders,
      unfulfilledOrders,
      lowStockVariants,
      outOfStockVariants,
      pendingReviews,
      activeProducts,
      draftProducts,
      totalCustomers,
    },
    salesSeries: options.includeFinancials
      ? salesSeries
      : salesSeries.map((point) => ({ ...point, revenue: 0 })),
    statusBreakdown: statusGroups
      .map((group) => ({ status: group.status, count: group._count._all }))
      .sort((a, b) => b.count - a.count),
    topProducts: options.includeFinancials
      ? topProducts
      : topProducts.map((product) => ({ ...product, revenue: 0 })),
    recentOrders: recentOrders.map((order) => ({
      id: order.id,
      number: order.number,
      customerName: order.customer
        ? `${order.customer.firstName} ${order.customer.lastName}`.trim()
        : 'Guest',
      email: order.email,
      grandTotal: mask(order.grandTotal),
      status: order.status,
      paymentStatus: order.paymentStatus,
      placedAt: order.placedAt,
    })),
    recentActivity: recentActivity.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityLabel: entry.entityLabel,
      actorName: entry.actor ? `${entry.actor.firstName} ${entry.actor.lastName}`.trim() : null,
      actorEmail: entry.actorEmail,
      createdAt: entry.createdAt,
    })),
  };
};

/**
 * Daily revenue and order counts, with zero-filled gaps so the chart has a
 * point for every day in the range rather than skipping quiet days.
 */
export const getSalesSeries = async (
  from: Date,
  to: Date,
): Promise<{ date: string; revenue: number; orders: number }[]> => {
  const rows = await db.$queryRaw<
    { day: Date; gross: bigint | null; refunded: bigint | null; orders: bigint }[]
  >`
    SELECT
      date_trunc('day', "placedAt") AS day,
      SUM("grandTotal")   AS gross,
      SUM("refundedTotal") AS refunded,
      COUNT(*)            AS orders
    FROM orders
    WHERE "deletedAt" IS NULL
      AND "status" <> 'CANCELLED'
      AND "paymentStatus" IN ('PAID', 'PARTIALLY_REFUNDED')
      AND "placedAt" >= ${from}
      AND "placedAt" < ${to}
    GROUP BY 1
    ORDER BY 1
  `;

  const byDay = new Map<string, { revenue: number; orders: number }>();
  for (const row of rows) {
    const key = row.day.toISOString().slice(0, 10);
    byDay.set(key, {
      revenue: Math.max(0, asNumber(row.gross) - asNumber(row.refunded)),
      orders: asNumber(row.orders),
    });
  }

  const series: { date: string; revenue: number; orders: number }[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );

  while (cursor < to) {
    const key = cursor.toISOString().slice(0, 10);
    const point = byDay.get(key);
    series.push({ date: key, revenue: point?.revenue ?? 0, orders: point?.orders ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return series;
};

export const getTopProducts = async (
  from: Date,
  to: Date,
  limit: number,
): Promise<{ productId: string | null; name: string; unitsSold: number; revenue: number }[]> => {
  const rows = await db.$queryRaw<
    { productId: string | null; name: string; units: bigint; revenue: bigint }[]
  >`
    SELECT
      oi."productId"              AS "productId",
      MAX(oi."productName")       AS name,
      SUM(oi."quantity")          AS units,
      SUM(oi."lineTotal")         AS revenue
    FROM order_items oi
    JOIN orders o ON o."id" = oi."orderId"
    WHERE o."deletedAt" IS NULL
      AND o."status" <> 'CANCELLED'
      AND o."paymentStatus" IN ('PAID', 'PARTIALLY_REFUNDED')
      AND o."placedAt" >= ${from}
      AND o."placedAt" < ${to}
    GROUP BY oi."productId"
    ORDER BY units DESC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    unitsSold: asNumber(row.units),
    revenue: asNumber(row.revenue),
  }));
};

export type { RevenueRow };
