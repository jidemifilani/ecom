import type { Metadata } from 'next';
import Link from 'next/link';
import { Percent, Plus } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac/guard';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatDate, formatNumber } from '@/lib/utils';
import { listDiscounts, type DiscountListItem } from '@/server/discount-service';
import { getStoreConfig } from '@/server/settings-service';
import { DISCOUNT_SORT_FIELDS } from '@/validation/discount';

export const metadata: Metadata = { title: 'Discounts' };

const FILTER_KEYS = ['type', 'isActive'] as const;

const DiscountsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('discount.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/discounts', params);

  const query = safeListQuery(params, {
    sortable: DISCOUNT_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: FILTER_KEYS,
  });

  const [result, config] = await Promise.all([listDiscounts(query), getStoreConfig()]);

  /** Renders the value in whatever unit the type actually means. */
  const describeValue = (row: DiscountListItem): string => {
    if (row.type === 'FREE_SHIPPING') return 'Free shipping';
    if (row.type === 'PERCENTAGE') {
      const percent = row.value / 100;
      return `${percent % 1 === 0 ? percent.toFixed(0) : percent.toFixed(2)}% off`;
    }
    return `${formatMoney(row.value, config.currency, config.locale)} off`;
  };

  const columns: Column<DiscountListItem>[] = [
    {
      key: 'code',
      header: 'Code',
      sortField: 'code',
      mobile: 'title',
      render: (row) => (
        <span className="min-w-0">
          <Link
            href={`/discounts/${row.id}`}
            className="text-fg hover:text-accent block font-mono text-sm font-medium"
          >
            {row.code}
          </Link>
          <span className="text-fg-muted block truncate text-xs">{row.name}</span>
        </span>
      ),
    },
    {
      key: 'value',
      header: 'Discount',
      mobile: 'field',
      render: (row) => <span className="text-fg">{describeValue(row)}</span>,
    },
    {
      key: 'scope',
      header: 'Applies to',
      mobile: 'field',
      render: (row) =>
        row.scope === 'ALL'
          ? 'Whole basket'
          : row.scope === 'CATEGORY'
            ? 'One category'
            : 'One product',
    },
    {
      key: 'minSubtotal',
      header: 'Min spend',
      numeric: true,
      mobile: 'hidden',
      render: (row) =>
        row.minSubtotal > 0 ? (
          formatMoney(row.minSubtotal, config.currency, config.locale)
        ) : (
          <span className="text-fg-subtle">None</span>
        ),
    },
    {
      key: 'usage',
      header: 'Used',
      sortField: 'usageCount',
      numeric: true,
      mobile: 'field',
      render: (row) => (
        <span className="whitespace-nowrap">
          {formatNumber(row.usageCount)}
          {row.usageLimit ? (
            <span className="text-fg-subtle"> / {formatNumber(row.usageLimit)}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'window',
      header: 'Runs',
      sortField: 'endsAt',
      mobile: 'field',
      render: (row) => (
        <span className="text-fg-muted text-xs whitespace-nowrap">
          {row.startsAt ? formatDate(row.startsAt) : 'Now'}
          {' to '}
          {row.endsAt ? formatDate(row.endsAt) : 'no end'}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'badge',
      render: (row) => <StatusBadge status={row.deletedAt ? 'ARCHIVED' : row.status} />,
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Discounts' }]} />

      <PageHeader
        title="Discounts"
        description="Promotion codes. The saving is recomputed at checkout, so an expired code can never be banked."
        actions={
          can(viewer, 'discount.create') ? (
            <Button asChild>
              <Link href="/discounts/new">
                <Plus aria-hidden="true" />
                New discount
              </Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchPlaceholder="Search code or name"
        filters={[
          {
            key: 'type',
            label: 'Type',
            options: [
              { value: 'PERCENTAGE', label: 'Percentage off' },
              { value: 'FIXED_AMOUNT', label: 'Fixed amount' },
              { value: 'FREE_SHIPPING', label: 'Free shipping' },
            ],
          },
          {
            key: 'isActive',
            label: 'State',
            options: [
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Disabled' },
            ],
          },
        ]}
      />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Discount codes with their value, scope, usage and schedule"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="discount"
        emptyIcon={Percent}
        emptyTitle="No discounts yet"
        emptyDescription="Create a code to run a promotion."
        emptyAction={
          can(viewer, 'discount.create') ? (
            <Button asChild>
              <Link href="/discounts/new">
                <Plus aria-hidden="true" />
                Create a discount
              </Link>
            </Button>
          ) : undefined
        }
        filtersActive={hasActiveFilters(params, FILTER_KEYS)}
        clearFiltersHref="/discounts"
      />
    </>
  );
};

export default DiscountsPage;
