import type { Metadata } from 'next';
import Link from 'next/link';
import { Tags } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { can } from '@/lib/rbac/guard';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatNumber } from '@/lib/utils';
import {
  listCategories,
  listCategoryOptions,
  type CategoryListItem,
} from '@/server/catalog-service';
import { CATEGORY_SORT_FIELDS } from '@/validation/catalog';

import {
  ArchiveCategoryButton,
  EditCategoryButton,
  NewCategoryButton,
} from './category-dialog';

export const metadata: Metadata = { title: 'Categories' };

const FILTER_KEYS = ['isActive', 'parentId'] as const;

const CategoriesPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('category.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/catalog/categories', params);

  const query = safeListQuery(params, {
    sortable: CATEGORY_SORT_FIELDS,
    defaultSort: 'position',
    defaultSortOrder: 'asc',
    filterKeys: FILTER_KEYS,
    defaultPageSize: 50,
  });

  const [result, options] = await Promise.all([listCategories(query), listCategoryOptions()]);

  const canUpdate = can(viewer, 'category.update');
  const canDelete = can(viewer, 'category.delete');

  const depthByName = new Map(options.map((option) => [option.id, option.depth]));

  const columns: Column<CategoryListItem>[] = [
    {
      key: 'name',
      header: 'Category',
      sortField: 'name',
      mobile: 'title',
      render: (row) => {
        const depth = depthByName.get(row.id) ?? 0;
        return (
          <span className="flex min-w-0 items-center">
            {/* Indentation conveys nesting; the parent name below states it in text. */}
            {depth > 0 ? (
              <span
                aria-hidden="true"
                className="text-fg-subtle mr-1 shrink-0 font-mono text-xs"
                style={{ paddingLeft: `${(depth - 1) * 12}px` }}
              >
                |-
              </span>
            ) : null}
            <span className="min-w-0">
              <span className="text-fg block truncate font-medium">{row.name}</span>
              <span className="text-fg-subtle block truncate font-mono text-xs">
                /c/{row.slug}
                {row.parentName ? ` - in ${row.parentName}` : ''}
              </span>
            </span>
          </span>
        );
      },
    },
    {
      key: 'isActive',
      header: 'Visibility',
      mobile: 'badge',
      render: (row) => (
        <Badge tone={row.isActive ? 'success' : 'outline'}>
          {row.isActive ? 'Visible' : 'Hidden'}
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
            href={`/catalog/products?categoryId=${row.id}`}
            className="text-accent rounded underline-offset-4 hover:underline"
          >
            {formatNumber(row.productCount)}
          </Link>
        ) : (
          formatNumber(row.productCount)
        ),
    },
    {
      key: 'children',
      header: 'Subcategories',
      numeric: true,
      mobile: 'field',
      render: (row) => formatNumber(row.childCount),
    },
    {
      key: 'position',
      header: 'Position',
      sortField: 'position',
      numeric: true,
      mobile: 'hidden',
      render: (row) => row.position,
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Catalog' }, { label: 'Categories' }]} />

      <PageHeader
        title="Categories"
        description="The structure shoppers browse. Nesting is shown by indentation; drag-free ordering uses the position field."
        actions={can(viewer, 'category.create') ? <NewCategoryButton parents={options} /> : undefined}
      />

      <FilterBar
        searchPlaceholder="Search categories"
        filters={[
          {
            key: 'isActive',
            label: 'Visibility',
            options: [
              { value: 'true', label: 'Visible' },
              { value: 'false', label: 'Hidden' },
            ],
          },
          {
            key: 'parentId',
            label: 'Level',
            anyLabel: 'All levels',
            options: [{ value: 'root', label: 'Top level only' }],
          },
        ]}
      />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Categories with visibility, product counts and sort position"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="category"
        emptyIcon={Tags}
        emptyTitle="No categories yet"
        emptyDescription="Create a category so shoppers can browse rather than only search."
        emptyAction={
          can(viewer, 'category.create') ? <NewCategoryButton parents={options} /> : undefined
        }
        filtersActive={hasActiveFilters(params, FILTER_KEYS)}
        clearFiltersHref="/catalog/categories"
        rowActions={
          canUpdate || canDelete
            ? (row) => (
                <span className="flex items-center justify-end gap-1">
                  {canUpdate ? (
                    <EditCategoryButton
                      parents={options}
                      category={{
                        id: row.id,
                        name: row.name,
                        slug: row.slug,
                        description: null,
                        imageUrl: row.imageUrl,
                        parentId: row.parentId,
                        position: row.position,
                        isActive: row.isActive,
                        metaTitle: null,
                        metaDescription: null,
                        productCount: row.productCount,
                        childCount: row.childCount,
                      }}
                    />
                  ) : null}
                  {canDelete ? (
                    <ArchiveCategoryButton
                      category={{
                        id: row.id,
                        name: row.name,
                        childCount: row.childCount,
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

export default CategoriesPage;
