import type { Metadata } from 'next';
import { History } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/ui/card';
import { Badge, type BadgeTone } from '@/components/ui/feedback';
import { Breadcrumbs, LinkTabs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { listStockMovements, type StockMovementListItem } from '@/server/inventory-service';

export const metadata: Metadata = { title: 'Stock movements' };

const FILTER_KEYS = ['type'] as const;

const TYPE_TONES: Record<string, BadgeTone> = {
  RECEIPT: 'success',
  RETURN: 'info',
  SALE: 'neutral',
  ADJUSTMENT: 'warning',
  DAMAGE: 'danger',
  RESERVATION: 'outline',
  RELEASE: 'outline',
};

/**
 * /inventory/movements
 *
 * The append-only stock ledger. Every level on the inventory screen is the sum
 * of these rows, which is what makes a disputed figure answerable.
 */
const MovementsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [, rawParams] = await Promise.all([
    requirePermission('inventory.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/inventory/movements', params);

  const query = safeListQuery(params, {
    sortable: ['createdAt'] as const,
    defaultSort: 'createdAt',
    filterKeys: FILTER_KEYS,
    defaultPageSize: 50,
  });

  const variantId = params.get('variantId') ?? undefined;
  const result = await listStockMovements(query, variantId);

  const columns: Column<StockMovementListItem>[] = [
    {
      key: 'createdAt',
      header: 'When',
      sortField: 'createdAt',
      mobile: 'subtitle',
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'product',
      header: 'Item',
      mobile: 'title',
      render: (row) => (
        <span className="min-w-0">
          <span className="text-fg block truncate font-medium">{row.productName}</span>
          <span className="text-fg-subtle block truncate font-mono text-xs">{row.sku}</span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      mobile: 'badge',
      render: (row) => (
        <Badge tone={TYPE_TONES[row.type] ?? 'neutral'}>
          {row.type.charAt(0) + row.type.slice(1).toLowerCase()}
        </Badge>
      ),
    },
    {
      key: 'quantity',
      header: 'Change',
      numeric: true,
      mobile: 'field',
      render: (row) => (
        <span
          className={
            row.quantity > 0 ? 'text-success font-medium' : 'text-danger font-medium'
          }
        >
          {row.quantity > 0 ? '+' : ''}
          {formatNumber(row.quantity)}
        </span>
      ),
    },
    {
      key: 'balanceAfter',
      header: 'Balance',
      numeric: true,
      mobile: 'field',
      render: (row) => formatNumber(row.balanceAfter),
    },
    {
      key: 'reason',
      header: 'Reason',
      mobile: 'field',
      className: 'max-w-sm',
      render: (row) => (
        <span className="text-fg-muted line-clamp-2 text-sm">
          {row.reason ?? <span className="text-fg-subtle">-</span>}
        </span>
      ),
    },
    {
      key: 'reference',
      header: 'Reference',
      mobile: 'hidden',
      render: (row) =>
        row.reference ? (
          <span className="font-mono text-xs">{row.reference}</span>
        ) : (
          <span className="text-fg-subtle">-</span>
        ),
    },
    {
      key: 'createdBy',
      header: 'By',
      mobile: 'field',
      render: (row) => row.createdByName ?? <span className="text-fg-subtle">System</span>,
    },
  ];

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Inventory', href: '/inventory' }, { label: 'Movements' }]}
      />

      <PageHeader
        title="Stock movements"
        description="Append-only ledger of every stock change, with the reason and the running balance."
      />

      <LinkTabs
        items={[
          { label: 'All stock', href: '/inventory', active: false },
          { label: 'Low stock', href: '/inventory?lowStock=true', active: false },
          { label: 'Out of stock', href: '/inventory?outOfStock=true', active: false },
          { label: 'Movement history', href: '/inventory/movements', active: true },
        ]}
      />

      <FilterBar
        searchPlaceholder="Search reference or SKU"
        showDateRange
        filters={[
          {
            key: 'type',
            label: 'Movement type',
            options: [
              { value: 'RECEIPT', label: 'Receipt' },
              { value: 'SALE', label: 'Sale' },
              { value: 'RETURN', label: 'Return' },
              { value: 'ADJUSTMENT', label: 'Adjustment' },
              { value: 'DAMAGE', label: 'Damage' },
              { value: 'RELEASE', label: 'Release' },
            ],
          },
        ]}
      />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Stock movements with type, signed change, running balance and reason"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="movement"
        emptyIcon={History}
        emptyTitle="No movements recorded"
        emptyDescription="Stock changes appear here as soon as you receive, sell or adjust anything."
        filtersActive={hasActiveFilters(params, FILTER_KEYS)}
        clearFiltersHref="/inventory/movements"
      />
    </>
  );
};

export default MovementsPage;
