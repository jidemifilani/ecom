import type { Metadata } from 'next';
import Link from 'next/link';
import { ShoppingCart } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { ExportButton } from '@/components/data/export-button';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs, LinkTabs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac/guard';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { listOrders, type OrderListItem } from '@/server/order-service';
import { getStoreConfig } from '@/server/settings-service';
import { ORDER_SORT_FIELDS, orderFilterKeys } from '@/validation/order';

export const metadata: Metadata = { title: 'Orders' };

const OrdersPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('order.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/orders', params);

  const query = safeListQuery(params, {
    sortable: ORDER_SORT_FIELDS,
    defaultSort: 'placedAt',
    filterKeys: orderFilterKeys,
  });

  const [result, config] = await Promise.all([listOrders(query), getStoreConfig()]);

  const showMoney = can(viewer, 'dashboard.view_financials');
  const money = (minor: number, currency: string): string =>
    formatMoney(minor, currency, config.locale);

  const activeStatus = params.get('status') ?? '';
  const activeFulfilment = params.get('fulfillmentStatus') ?? '';

  const columns: Column<OrderListItem>[] = [
    {
      key: 'number',
      header: 'Order',
      sortField: 'number',
      mobile: 'title',
      render: (row) => (
        <Link
          href={`/orders/${row.id}`}
          className="text-fg hover:text-accent block font-mono text-sm font-medium"
        >
          {row.number}
        </Link>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      mobile: 'subtitle',
      render: (row) => (
        <span className="min-w-0">
          <span className="text-fg block truncate">{row.customerName ?? 'Guest'}</span>
          <span className="text-fg-muted block truncate text-xs">{row.email}</span>
        </span>
      ),
    },
    {
      key: 'placedAt',
      header: 'Placed',
      sortField: 'placedAt',
      mobile: 'field',
      render: (row) => formatDateTime(row.placedAt),
    },
    {
      key: 'status',
      header: 'Status',
      sortField: 'status',
      mobile: 'badge',
      render: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: 'payment',
      header: 'Payment',
      sortField: 'paymentStatus',
      mobile: 'field',
      render: (row) => <StatusBadge status={row.paymentStatus} />,
    },
    {
      key: 'fulfilment',
      header: 'Fulfilment',
      mobile: 'field',
      render: (row) => <StatusBadge status={row.fulfillmentStatus} />,
    },
    {
      key: 'items',
      header: 'Items',
      numeric: true,
      mobile: 'hidden',
      render: (row) => formatNumber(row.itemCount),
    },
    {
      key: 'total',
      header: 'Total',
      sortField: 'grandTotal',
      numeric: true,
      mobile: 'field',
      render: (row) =>
        showMoney ? (
          <span className="whitespace-nowrap">
            <span className="text-fg font-medium">{money(row.grandTotal, row.currency)}</span>
            {row.refundedTotal > 0 ? (
              <span className="text-warning block text-xs">
                -{money(row.refundedTotal, row.currency)} refunded
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-fg-subtle">Hidden</span>
        ),
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Orders' }]} />

      <PageHeader
        title="Orders"
        description="Every order, with payment and fulfilment state. Totals are fixed at the point of sale."
        actions={can(viewer, 'order.export') ? <ExportButton resource="orders" /> : undefined}
      />

      <LinkTabs
        items={[
          { label: 'All', href: '/orders', active: activeStatus === '' && activeFulfilment === '' },
          {
            label: 'To fulfil',
            href: '/orders?fulfillmentStatus=UNFULFILLED',
            active: activeFulfilment === 'UNFULFILLED',
          },
          {
            label: 'Pending',
            href: '/orders?status=PENDING',
            active: activeStatus === 'PENDING',
          },
          {
            label: 'Shipped',
            href: '/orders?status=SHIPPED',
            active: activeStatus === 'SHIPPED',
          },
          {
            label: 'Delivered',
            href: '/orders?status=DELIVERED',
            active: activeStatus === 'DELIVERED',
          },
          {
            label: 'Cancelled',
            href: '/orders?status=CANCELLED',
            active: activeStatus === 'CANCELLED',
          },
        ]}
      />

      <FilterBar
        searchPlaceholder="Search order number, email or customer"
        showDateRange
        filters={[
          {
            key: 'status',
            label: 'Status',
            options: [
              { value: 'PENDING', label: 'Pending' },
              { value: 'CONFIRMED', label: 'Confirmed' },
              { value: 'PROCESSING', label: 'Processing' },
              { value: 'SHIPPED', label: 'Shipped' },
              { value: 'DELIVERED', label: 'Delivered' },
              { value: 'CANCELLED', label: 'Cancelled' },
              { value: 'REFUNDED', label: 'Refunded' },
            ],
          },
          {
            key: 'paymentStatus',
            label: 'Payment',
            options: [
              { value: 'UNPAID', label: 'Unpaid' },
              { value: 'AUTHORIZED', label: 'Authorised' },
              { value: 'PAID', label: 'Paid' },
              { value: 'PARTIALLY_REFUNDED', label: 'Part refunded' },
              { value: 'REFUNDED', label: 'Refunded' },
              { value: 'FAILED', label: 'Failed' },
            ],
          },
          {
            key: 'fulfillmentStatus',
            label: 'Fulfilment',
            options: [
              { value: 'UNFULFILLED', label: 'Unfulfilled' },
              { value: 'PARTIALLY_FULFILLED', label: 'Part fulfilled' },
              { value: 'FULFILLED', label: 'Fulfilled' },
            ],
          },
        ]}
      />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Orders with their status, payment state, fulfilment state and total"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="order"
        emptyIcon={ShoppingCart}
        emptyTitle="No orders yet"
        emptyDescription="Orders placed on the storefront appear here straight away."
        filtersActive={hasActiveFilters(params, orderFilterKeys)}
        clearFiltersHref="/orders"
      />
    </>
  );
};

export default OrdersPage;
