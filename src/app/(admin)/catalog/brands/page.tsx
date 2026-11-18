import type { Metadata } from 'next';
import Link from 'next/link';
import { Boxes } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { can } from '@/lib/rbac/guard';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatDate, formatNumber } from '@/lib/utils';
import { listBrands, type BrandListItem } from '@/server/catalog-service';

import { ArchiveBrandButton, EditBrandButton, NewBrandButton } from './brand-actions';

export const metadata: Metadata = { title: 'Brands' };

const BrandsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('brand.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/catalog/brands', params);

  const query = safeListQuery(params, {
    sortable: ['name', 'createdAt'] as const,
    defaultSort: 'name',
    defaultSortOrder: 'asc',
    defaultPageSize: 50,
  });

  const result = await listBrands(query);

  const canUpdate = can(viewer, 'brand.update');
  const canDelete = can(viewer, 'brand.delete');

  const columns: Column<BrandListItem>[] = [
    {
      key: 'name',
      header: 'Brand',
      sortField: 'name',
      mobile: 'title',
      render: (row) => (
        <span className="min-w-0">
          <span className="text-fg block truncate font-medium">{row.name}</span>
          <span className="text-fg-subtle block truncate font-mono text-xs">{row.slug}</span>
        </span>
      ),
    },
    {
      key: 'isActive',
      header: 'State',
      mobile: 'badge',
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'outline'}>
          {row.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'products',
      header: 'Products',
      numeric: true,
      mobile: 'field',
      render: (row) =>
        row.productCount > 0 && can(viewer, 'product.read') ? (
          <Link
            href={`/catalog/products?brandId=${row.id}`}
            className="text-accent rounded underline-offset-4 hover:underline"
          >
            {formatNumber(row.productCount)}
          </Link>
        ) : (
          formatNumber(row.productCount)
        ),
    },
    {
      key: 'createdAt',
      header: 'Added',
      sortField: 'createdAt',
      mobile: 'field',
      render: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Catalog' }, { label: 'Brands' }]} />

      <PageHeader
        title="Brands"
        description="Optional grouping by maker. Shoppers can filter the catalog by brand."
        actions={can(viewer, 'brand.create') ? <NewBrandButton /> : undefined}
      />

      <FilterBar searchPlaceholder="Search brands" />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Brands with their state and product counts"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="brand"
        emptyIcon={Boxes}
        emptyTitle="No brands yet"
        emptyDescription="Brands are optional. Add them if shoppers think in terms of makers."
        emptyAction={can(viewer, 'brand.create') ? <NewBrandButton /> : undefined}
        filtersActive={hasActiveFilters(params, [])}
        clearFiltersHref="/catalog/brands"
        rowActions={
          canUpdate || canDelete
            ? (row) => (
                <span className="flex items-center justify-end gap-1">
                  {canUpdate ? (
                    <EditBrandButton
                      brand={{
                        id: row.id,
                        name: row.name,
                        slug: row.slug,
                        logoUrl: row.logoUrl,
                        isActive: row.isActive,
                      }}
                    />
                  ) : null}
                  {canDelete ? (
                    <ArchiveBrandButton
                      brand={{
                        id: row.id,
                        name: row.name,
                        productCount: row.productCount,
                      }}
                    />
                  ) : null}
                </span>
              )
            : undefined
        }
      />
    </>
  );
};

export default BrandsPage;
