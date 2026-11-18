import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { Package, Plus } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { ExportButton } from '@/components/data/export-button';
import { FilterBar } from '@/components/data/filter-bar';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac/guard';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatNumber } from '@/lib/utils';
import { listBrandOptions, listCategoryOptions } from '@/server/catalog-service';
import { listProducts, type ProductListItem } from '@/server/product-service';
import { getStoreConfig } from '@/server/settings-service';
import { PRODUCT_SORT_FIELDS } from '@/validation/catalog';

export const metadata: Metadata = { title: 'Products' };

const FILTER_KEYS = ['status', 'categoryId', 'brandId', 'isFeatured'] as const;

const ProductsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('product.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/catalog/products', params);

  const query = safeListQuery(params, {
    sortable: PRODUCT_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: FILTER_KEYS,
  });

  const [result, categories, brands, config] = await Promise.all([
    listProducts(query),
    listCategoryOptions(),
    listBrandOptions(),
    getStoreConfig(),
  ]);

  const money = (minor: number, currency: string): string =>
    formatMoney(minor, currency, config.locale);

  const columns: Column<ProductListItem>[] = [
    {
      key: 'name',
      header: 'Product',
      sortField: 'name',
      mobile: 'title',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <ProductThumb url={row.primaryImageUrl} alt={row.primaryImageAlt ?? row.name} />
          <span className="min-w-0">
            <Link
              href={`/catalog/products/${row.id}`}
              className="text-fg hover:text-accent block truncate font-medium"
            >
              {row.name}
            </Link>
            <span className="text-fg-muted block truncate text-xs">
              {[row.brandName, row.categoryName].filter(Boolean).join(' / ') || 'Uncategorised'}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortField: 'status',
      mobile: 'badge',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1">
          <StatusBadge status={row.deletedAt ? 'ARCHIVED' : row.status} />
          {row.isFeatured ? <Badge tone="accent">Featured</Badge> : null}
        </span>
      ),
    },
    {
      key: 'price',
      header: 'Price',
      sortField: 'basePrice',
      numeric: true,
      mobile: 'field',
      render: (row) => (
        <span className="whitespace-nowrap">
          <span className="text-fg font-medium">{money(row.basePrice, row.currency)}</span>
          {row.compareAtPrice ? (
            <span className="text-fg-subtle ml-1.5 text-xs line-through">
              {money(row.compareAtPrice, row.currency)}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'variants',
      header: 'Variants',
      numeric: true,
      mobile: 'field',
      render: (row) => formatNumber(row.variantCount),
    },
    {
      key: 'stock',
      header: 'Stock',
      numeric: true,
      mobile: 'field',
      render: (row) => (
        <span
          className={
            row.totalStock === 0
              ? 'text-danger font-medium'
              : row.totalStock <= config.lowStockThreshold
                ? 'text-warning font-medium'
                : 'text-fg'
          }
        >
          {formatNumber(row.totalStock)}
          {row.totalStock === 0 ? <span className="sr-only"> (out of stock)</span> : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Catalog' }, { label: 'Products' }]} />

      <PageHeader
        title="Products"
        description="Everything you sell, with pricing, variants and stock at a glance."
        actions={
          <>
            {can(viewer, 'product.export') ? <ExportButton resource="products" /> : null}
            {can(viewer, 'product.create') ? (
              <Button asChild>
                <Link href="/catalog/products/new">
                  <Plus aria-hidden="true" />
                  New product
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      <FilterBar
        searchPlaceholder="Search name, slug or SKU"
        filters={[
          {
            key: 'status',
            label: 'Status',
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'DRAFT', label: 'Draft' },
              { value: 'ARCHIVED', label: 'Archived' },
            ],
          },
          {
            key: 'categoryId',
            label: 'Category',
            options: categories.map((category) => ({
              value: category.id,
              // Indentation shows the tree depth inside a flat select.
              label: `${'- '.repeat(category.depth)}${category.name}`,
            })),
          },
          {
            key: 'brandId',
            label: 'Brand',
            options: brands.map((brand) => ({ value: brand.id, label: brand.name })),
          },
          {
            key: 'isFeatured',
            label: 'Featured',
            anyLabel: 'All products',
            options: [
              { value: 'true', label: 'Featured only' },
              { value: 'false', label: 'Not featured' },
            ],
          },
        ]}
      />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Products with status, price, variant count and stock on hand"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="product"
        emptyIcon={Package}
        emptyTitle="No products yet"
        emptyDescription="Add your first product to start selling."
        emptyAction={
          can(viewer, 'product.create') ? (
            <Button asChild>
              <Link href="/catalog/products/new">
                <Plus aria-hidden="true" />
                Add a product
              </Link>
            </Button>
          ) : undefined
        }
        filtersActive={hasActiveFilters(params, FILTER_KEYS)}
        clearFiltersHref="/catalog/products"
        rowActions={(row) => (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/catalog/products/${row.id}`}>
              {can(viewer, 'product.update') ? 'Edit' : 'View'}
              <span className="sr-only"> {row.name}</span>
            </Link>
          </Button>
        )}
      />
    </>
  );
};

/**
 * Product thumbnail.
 *
 * Remote images go through next/image for format negotiation and lazy
 * loading; the seeded SVG placeholders are rendered directly, because
 * next/image cannot optimise SVG and would only add a redirect.
 */
const ProductThumb = ({ url, alt }: { url: string | null; alt: string }) => {
  if (!url) {
    return (
      <span
        aria-hidden="true"
        className="bg-surface-sunken text-fg-subtle grid size-10 shrink-0 place-items-center rounded-md"
      >
        <Package className="size-4" />
      </span>
    );
  }

  if (url.endsWith('.svg')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SVG is not optimisable by next/image
      <img
        src={url}
        alt={alt}
        width={40}
        height={40}
        loading="lazy"
        className="bg-surface-sunken size-10 shrink-0 rounded-md object-cover"
      />
    );
  }

  return (
    <Image
      src={url}
      alt={alt}
      width={40}
      height={40}
      className="bg-surface-sunken size-10 shrink-0 rounded-md object-cover"
    />
  );
};

export default ProductsPage;
