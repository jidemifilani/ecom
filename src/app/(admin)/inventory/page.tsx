import type { Metadata } from 'next';
import Link from 'next/link';
import { Warehouse } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { ExportButton } from '@/components/data/export-button';
import { FilterBar } from '@/components/data/filter-bar';
import { Button } from '@/components/ui/button';
import { PageHeader, StatCard } from '@/components/ui/card';
import { Badge } from '@/components/ui/feedback';
import { Breadcrumbs, LinkTabs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac/guard';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { listInventory, type InventoryListItem } from '@/server/inventory-service';
import { getInventoryValuation } from '@/server/report-service';
import { getStoreConfig } from '@/server/settings-service';
import { INVENTORY_SORT_FIELDS } from '@/validation/inventory';

import { AdjustStockDialog, StockCountDialog } from './stock-actions';

export const metadata: Metadata = { title: 'Inventory' };

const FILTER_KEYS = ['lowStock', 'outOfStock'] as const;

/**
 * /inventory
 *
 * "Available" is on-hand minus reserved: stock already promised to an unpaid
 * order is not sellable, and showing on-hand alone is how a store oversells.
 */
const InventoryPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('inventory.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/inventory', params);

  const query = safeListQuery(params, {
    sortable: INVENTORY_SORT_FIELDS,
    defaultSort: 'quantityOnHand',
    defaultSortOrder: 'asc',
    filterKeys: FILTER_KEYS,
    defaultPageSize: 50,
  });

  const config = await getStoreConfig();

  const [result, valuation] = await Promise.all([
    listInventory(query, config.lowStockThreshold),
    // Valuation is only shown to users allowed to see money.
    can(viewer, 'dashboard.view_financials')
      ? getInventoryValuation({ limit: 2000 })
      : Promise.resolve(null),
  ]);

  const canAdjust = can(viewer, 'inventory.adjust');
  const showLow = params.get('lowStock') === 'true';
  const showOut = params.get('outOfStock') === 'true';

  const columns: Column<InventoryListItem>[] = [
    {
      key: 'sku',
      header: 'SKU',
      sortField: 'sku',
      mobile: 'subtitle',
      render: (row) => <span className="font-mono text-xs">{row.sku}</span>,
    },
    {
      key: 'product',
      header: 'Product',
      sortField: 'name',
      mobile: 'title',
      render: (row) => (
        <span className="min-w-0">
          {can(viewer, 'product.read') ? (
            <Link
              href={`/catalog/products/${row.productId}`}
              className="text-fg hover:text-accent block truncate font-medium"
            >
              {row.productName}
            </Link>
          ) : (
            <span className="text-fg block truncate font-medium">{row.productName}</span>
          )}
          {row.variantName && row.variantName !== 'Default' ? (
            <span className="text-fg-muted block truncate text-xs">{row.variantName}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'onHand',
      header: 'On hand',
      sortField: 'quantityOnHand',
      numeric: true,
      mobile: 'field',
      render: (row) => formatNumber(row.quantityOnHand),
    },
    {
      key: 'reserved',
      header: 'Reserved',
      numeric: true,
      mobile: 'field',
      render: (row) =>
        row.quantityReserved > 0 ? (
          <span className="text-warning">{formatNumber(row.quantityReserved)}</span>
        ) : (
          <span className="text-fg-subtle">0</span>
        ),
    },
    {
      key: 'available',
      header: 'Available',
      numeric: true,
      mobile: 'field',
      render: (row) => (
        <span
          className={
            row.available <= 0
              ? 'text-danger font-semibold'
              : row.isLow
                ? 'text-warning font-semibold'
                : 'text-fg font-medium'
          }
        >
          {formatNumber(Math.max(0, row.available))}
        </span>
      ),
    },
    {
      key: 'state',
      header: 'State',
      mobile: 'badge',
      render: (row) =>
        row.available <= 0 ? (
          <Badge tone="danger">Out of stock</Badge>
        ) : row.isLow ? (
          <Badge tone="warning">Low</Badge>
        ) : (
          <Badge tone="success">In stock</Badge>
        ),
    },
    {
      key: 'bin',
      header: 'Bin',
      mobile: 'hidden',
      render: (row) => row.binLocation ?? <span className="text-fg-subtle">-</span>,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      sortField: 'updatedAt',
      mobile: 'hidden',
      render: (row) => formatDateTime(row.updatedAt),
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Inventory' }]} />

      <PageHeader
        title="Inventory"
        description="Stock by variant. Available is on-hand minus units reserved for unpaid orders."
        actions={can(viewer, 'inventory.export') ? <ExportButton resource="inventory" /> : undefined}
      />

      {valuation ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Units on hand"
            value={formatNumber(valuation.totalUnits)}
            icon={<Warehouse className="size-4" />}
          />
          <StatCard
            label="Stock value at cost"
            value={formatMoney(valuation.totalCostValue, valuation.currency, valuation.locale)}
            comparisonLabel="Cost price times on-hand"
          />
          <StatCard
            label="Stock value at retail"
            value={formatMoney(valuation.totalRetailValue, valuation.currency, valuation.locale)}
            comparisonLabel="Selling price times on-hand"
          />
        </div>
      ) : null}

      <LinkTabs
        items={[
          { label: 'All stock', href: '/inventory', active: !showLow && !showOut },
          { label: 'Low stock', href: '/inventory?lowStock=true', active: showLow },
          { label: 'Out of stock', href: '/inventory?outOfStock=true', active: showOut },
          { label: 'Movement history', href: '/inventory/movements', active: false },
        ]}
      />

      <FilterBar searchPlaceholder="Search SKU, product or variant" />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.variantId}
        caption="Stock levels per variant, showing on-hand, reserved and available quantities"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="variant"
        emptyIcon={Warehouse}
        emptyTitle={showOut ? 'Nothing is out of stock' : showLow ? 'Nothing is running low' : 'No stock records yet'}
        emptyDescription={
          showOut || showLow
            ? 'Stock levels are healthy.'
            : 'Stock records are created automatically when you add a product.'
        }
        emptyAction={
          can(viewer, 'product.create') ? (
            <Button asChild>
              <Link href="/catalog/products/new">Add a product</Link>
            </Button>
          ) : undefined
        }
        filtersActive={hasActiveFilters(params, FILTER_KEYS)}
        clearFiltersHref="/inventory"
        rowActions={
          canAdjust
            ? (row) => (
                <span className="flex items-center justify-end gap-1">
                  <AdjustStockDialog
                    target={{
                      variantId: row.variantId,
                      sku: row.sku,
                      productName: row.productName,
                      variantName: row.variantName,
                      quantityOnHand: row.quantityOnHand,
                    }}
                  />
                  <StockCountDialog
                    target={{
                      variantId: row.variantId,
                      sku: row.sku,
                      productName: row.productName,
                      variantName: row.variantName,
                      quantityOnHand: row.quantityOnHand,
                    }}
                  />
                </span>
              )
            : undefined
        }
      />
    </>
  );
};

export default InventoryPage;
