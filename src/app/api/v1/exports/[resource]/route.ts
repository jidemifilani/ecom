import { NotFoundError } from '@/lib/api/errors';
import { withApi } from '@/lib/api/handler';
import { parseListQuery, type ListQuery } from '@/lib/api/query';
import { recordAudit } from '@/lib/audit';
import { requirePermission, type CurrentUser } from '@/lib/auth/current-user';
import { csvResponse, timestampedFilename, toCsv, type CsvColumn } from '@/lib/export';
import { formatMoney, toMajorString } from '@/lib/money';
import type { PermissionKey } from '@/lib/rbac/permissions';
import { AUDIT_SORT_FIELDS, listAuditLogs } from '@/server/audit-service';
import { listCustomers } from '@/server/customer-service';
import { listInventory } from '@/server/inventory-service';
import { listOrders } from '@/server/order-service';
import { listProducts } from '@/server/product-service';
import { getStoreConfig } from '@/server/settings-service';
import { CUSTOMER_SORT_FIELDS } from '@/validation/customer';
import { INVENTORY_SORT_FIELDS } from '@/validation/inventory';
import { PRODUCT_SORT_FIELDS } from '@/validation/catalog';
import { ORDER_SORT_FIELDS, orderFilterKeys } from '@/validation/order';

/**
 * GET /api/v1/exports/[resource]
 *
 * One endpoint for every CSV export, because the shape is always the same:
 * check the export permission, run the same list query the table uses (so the
 * file matches what the user is looking at, filters included), map rows to
 * columns, and record the export in the audit trail.
 *
 * Exports are capped well above a normal page but still bounded, so a single
 * request cannot stream the whole database into memory.
 *
 * Money is written as a plain major-unit decimal ("19.99") rather than a
 * formatted string, so the file opens as numbers in a spreadsheet. Values that
 * a spreadsheet would treat as a formula are neutralised in `src/lib/export.ts`.
 */

const EXPORT_LIMIT = 5000;

type ExportDefinition = {
  permission: PermissionKey;
  filename: string;
  entityType: string;
  run: (
    searchParams: URLSearchParams,
    user: CurrentUser,
  ) => Promise<{ rows: unknown[]; columns: CsvColumn<never>[] }>;
};

/** Reuses the table's query parser, then overrides paging to the export cap. */
const exportQuery = <TSort extends string>(
  searchParams: URLSearchParams,
  sortable: readonly TSort[],
  defaultSort: TSort,
  filterKeys: readonly string[],
): ListQuery<TSort> => {
  const query = parseListQuery<TSort>(searchParams, {
    sortable,
    defaultSort,
    filterKeys,
  });

  return { ...query, page: 1, pageSize: EXPORT_LIMIT, skip: 0, take: EXPORT_LIMIT };
};

const EXPORTS: Record<string, ExportDefinition> = {
  orders: {
    permission: 'order.export',
    filename: 'orders',
    entityType: 'Order',
    run: async (searchParams) => {
      const query = exportQuery(searchParams, ORDER_SORT_FIELDS, 'placedAt', orderFilterKeys);
      const result = await listOrders(query);

      const columns: CsvColumn<(typeof result.items)[number]>[] = [
        { header: 'Order number', value: (row) => row.number },
        { header: 'Placed at', value: (row) => row.placedAt },
        { header: 'Customer', value: (row) => row.customerName ?? 'Guest' },
        { header: 'Email', value: (row) => row.email },
        { header: 'Status', value: (row) => row.status },
        { header: 'Payment status', value: (row) => row.paymentStatus },
        { header: 'Fulfilment status', value: (row) => row.fulfillmentStatus },
        { header: 'Items', value: (row) => row.itemCount },
        { header: 'Currency', value: (row) => row.currency },
        { header: 'Total', value: (row) => toMajorString(row.grandTotal, row.currency) },
        { header: 'Refunded', value: (row) => toMajorString(row.refundedTotal, row.currency) },
      ];

      return { rows: result.items, columns: columns as CsvColumn<never>[] };
    },
  },

  products: {
    permission: 'product.export',
    filename: 'products',
    entityType: 'Product',
    run: async (searchParams) => {
      const query = exportQuery(searchParams, PRODUCT_SORT_FIELDS, 'createdAt', [
        'status',
        'categoryId',
        'brandId',
        'isFeatured',
      ]);
      const result = await listProducts(query);

      const columns: CsvColumn<(typeof result.items)[number]>[] = [
        { header: 'Name', value: (row) => row.name },
        { header: 'Slug', value: (row) => row.slug },
        { header: 'Status', value: (row) => row.status },
        { header: 'Category', value: (row) => row.categoryName ?? '' },
        { header: 'Brand', value: (row) => row.brandName ?? '' },
        { header: 'Currency', value: (row) => row.currency },
        { header: 'Price', value: (row) => toMajorString(row.basePrice, row.currency) },
        {
          header: 'Compare at',
          value: (row) =>
            row.compareAtPrice === null ? '' : toMajorString(row.compareAtPrice, row.currency),
        },
        { header: 'Variants', value: (row) => row.variantCount },
        { header: 'Stock on hand', value: (row) => row.totalStock },
        { header: 'Featured', value: (row) => row.isFeatured },
        { header: 'Created at', value: (row) => row.createdAt },
      ];

      return { rows: result.items, columns: columns as CsvColumn<never>[] };
    },
  },

  customers: {
    permission: 'customer.export',
    filename: 'customers',
    entityType: 'Customer',
    run: async (searchParams) => {
      const query = exportQuery(searchParams, CUSTOMER_SORT_FIELDS, 'createdAt', [
        'status',
        'marketingOptIn',
      ]);
      const result = await listCustomers(query);

      const columns: CsvColumn<(typeof result.items)[number]>[] = [
        { header: 'First name', value: (row) => row.firstName },
        { header: 'Last name', value: (row) => row.lastName },
        { header: 'Email', value: (row) => row.email },
        { header: 'Phone', value: (row) => row.phone ?? '' },
        { header: 'Status', value: (row) => row.status },
        { header: 'Has account', value: (row) => row.hasAccount },
        { header: 'Marketing opt-in', value: (row) => row.marketingOptIn },
        { header: 'Orders', value: (row) => row.orderCount },
        { header: 'Registered at', value: (row) => row.createdAt },
      ];

      return { rows: result.items, columns: columns as CsvColumn<never>[] };
    },
  },

  inventory: {
    permission: 'inventory.export',
    filename: 'inventory',
    entityType: 'InventoryItem',
    run: async (searchParams) => {
      const query = exportQuery(searchParams, INVENTORY_SORT_FIELDS, 'quantityOnHand', [
        'lowStock',
        'outOfStock',
      ]);
      const config = await getStoreConfig();
      const result = await listInventory(query, config.lowStockThreshold);

      const columns: CsvColumn<(typeof result.items)[number]>[] = [
        { header: 'SKU', value: (row) => row.sku },
        { header: 'Product', value: (row) => row.productName },
        { header: 'Variant', value: (row) => row.variantName },
        { header: 'On hand', value: (row) => row.quantityOnHand },
        { header: 'Reserved', value: (row) => row.quantityReserved },
        { header: 'Available', value: (row) => row.available },
        { header: 'Reorder point', value: (row) => row.reorderPoint },
        { header: 'Bin', value: (row) => row.binLocation ?? '' },
        { header: 'Low stock', value: (row) => row.isLow },
        { header: 'Updated at', value: (row) => row.updatedAt },
      ];

      return { rows: result.items, columns: columns as CsvColumn<never>[] };
    },
  },

  'audit-logs': {
    permission: 'audit_log.export',
    filename: 'audit-logs',
    entityType: 'AuditLog',
    run: async (searchParams) => {
      const query = exportQuery(searchParams, AUDIT_SORT_FIELDS, 'createdAt', [
        'action',
        'entityType',
        'entityId',
        'actorUserId',
      ]);
      const result = await listAuditLogs(query);

      const columns: CsvColumn<(typeof result.items)[number]>[] = [
        { header: 'When', value: (row) => row.createdAt },
        { header: 'Actor', value: (row) => row.actorName ?? row.actorEmail ?? 'System' },
        { header: 'Actor email', value: (row) => row.actorEmail ?? '' },
        { header: 'Action', value: (row) => row.action },
        { header: 'Entity type', value: (row) => row.entityType },
        { header: 'Entity', value: (row) => row.entityLabel ?? row.entityId ?? '' },
        { header: 'IP address', value: (row) => row.ipAddress ?? '' },
        { header: 'Request id', value: (row) => row.requestId ?? '' },
        { header: 'Before', value: (row) => row.before },
        { header: 'After', value: (row) => row.after },
      ];

      return { rows: result.items, columns: columns as CsvColumn<never>[] };
    },
  },
};

export const GET = withApi<{ resource: string }>(async ({ params, searchParams, client }) => {
  const definition = EXPORTS[params.resource];
  if (!definition) throw new NotFoundError('Export');

  const user = await requirePermission(definition.permission);

  const { rows, columns } = await definition.run(searchParams, user);
  const csv = toCsv(rows as never[], columns);

  // Bulk extraction of customer or audit data is itself worth recording.
  await recordAudit({
    actor: { userId: user.id, email: user.email },
    action: 'EXPORTED',
    entityType: definition.entityType,
    entityLabel: `${rows.length} row(s) exported as CSV`,
    after: { resource: params.resource, rowCount: rows.length, filters: searchParams.toString() },
    ipAddress: client.ipAddress ?? null,
    userAgent: client.userAgent ?? null,
    requestId: client.requestId,
  });

  return csvResponse(timestampedFilename(definition.filename), csv);
});

export { formatMoney };
