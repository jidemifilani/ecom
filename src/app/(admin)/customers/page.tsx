import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, Users } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { ExportButton } from '@/components/data/export-button';
import { FilterBar } from '@/components/data/filter-bar';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { can } from '@/lib/rbac/guard';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatDate, formatNumber, initials } from '@/lib/utils';
import { listCustomers, type CustomerListItem } from '@/server/customer-service';
import { CUSTOMER_SORT_FIELDS } from '@/validation/customer';

export const metadata: Metadata = { title: 'Customers' };

const FILTER_KEYS = ['status', 'marketingOptIn'] as const;

const CustomersPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('customer.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/customers', params);

  const query = safeListQuery(params, {
    sortable: CUSTOMER_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: FILTER_KEYS,
  });

  const result = await listCustomers(query);

  const columns: Column<CustomerListItem>[] = [
    {
      key: 'name',
      header: 'Customer',
      sortField: 'firstName',
      mobile: 'title',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="bg-surface-sunken text-fg-muted grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
          >
            {initials(row.firstName, row.lastName)}
          </span>
          <span className="min-w-0">
            <Link
              href={`/customers/${row.id}`}
              className="text-fg hover:text-accent block truncate font-medium"
            >
              {row.fullName}
            </Link>
            <span className="text-fg-muted block truncate text-xs">{row.email}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'account',
      header: 'Account',
      mobile: 'field',
      render: (row) => (
        <Badge tone={row.hasAccount ? 'accent' : 'outline'}>
          {row.hasAccount ? 'Registered' : 'Guest only'}
        </Badge>
      ),
    },
    {
      key: 'orders',
      header: 'Orders',
      numeric: true,
      mobile: 'field',
      render: (row) =>
        row.orderCount > 0 && can(viewer, 'order.read') ? (
          <Link
            href={`/orders?customerId=${row.id}`}
            className="text-accent rounded underline-offset-4 hover:underline"
          >
            {formatNumber(row.orderCount)}
          </Link>
        ) : (
          formatNumber(row.orderCount)
        ),
    },
    {
      key: 'marketing',
      header: 'Marketing',
      mobile: 'hidden',
      render: (row) =>
        row.marketingOptIn ? (
          <Badge tone="success">Opted in</Badge>
        ) : (
          <span className="text-fg-subtle text-xs">No</span>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      mobile: 'badge',
      render: (row) => <StatusBadge status={row.deletedAt ? 'ARCHIVED' : row.status} />,
    },
    {
      key: 'createdAt',
      header: 'Registered',
      sortField: 'createdAt',
      mobile: 'field',
      render: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Customers' }]} />

      <PageHeader
        title="Customers"
        description="Shoppers who have ordered or registered. Guests become customers at checkout."
        actions={
          <>
            {can(viewer, 'customer.export') ? <ExportButton resource="customers" /> : null}
            {can(viewer, 'customer.create') ? (
              <Button asChild>
                <Link href="/customers/new">
                  <Plus aria-hidden="true" />
                  New customer
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Search name, email or phone"
        showDateRange
        filters={[
          {
            key: 'status',
            label: 'Status',
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'BLOCKED', label: 'Blocked' },
            ],
          },
          {
            key: 'marketingOptIn',
            label: 'Marketing',
            anyLabel: 'All customers',
            options: [
              { value: 'true', label: 'Opted in' },
              { value: 'false', label: 'Not opted in' },
            ],
          },
        ]}
      />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Customers with their account type, order count and status"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="customer"
        emptyIcon={Users}
        emptyTitle="No customers yet"
        emptyDescription="Customers are created automatically when an order is placed."
        filtersActive={hasActiveFilters(params, FILTER_KEYS)}
        clearFiltersHref="/customers"
        rowActions={(row) => (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/customers/${row.id}`}>
              View
              <span className="sr-only"> {row.fullName}</span>
            </Link>
          </Button>
        )}
      />
    </>
  );
};

export default CustomersPage;
