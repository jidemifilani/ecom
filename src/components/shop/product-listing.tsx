import Link from 'next/link';
import { PackageSearch } from 'lucide-react';

import { Pagination } from '@/components/ui/navigation';
import { EmptyState } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { toMinorUnits } from '@/lib/money';
import { listStorefrontProducts, type StorefrontListOptions } from '@/server/product-service';
import { getStoreConfig } from '@/server/settings-service';
import { listBrandOptions } from '@/server/catalog-service';

import { ProductGrid } from './product-card';

/**
 * Shared storefront product listing.
 *
 * Used by the category pages and by search. Sorting and filtering are plain
 * links and a no-JavaScript form, so the listing works before hydration and
 * every state has a shareable URL.
 */

export type ListingSearchParams = Record<string, string | string[] | undefined>;

const SORT_OPTIONS: { value: NonNullable<StorefrontListOptions['sort']>; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'name', label: 'Name A to Z' },
];

const readParam = (params: ListingSearchParams, key: string): string | undefined => {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value;
};

export const ProductListing = async ({
  searchParams,
  categorySlug,
  basePath,
  heading,
  emptyTitle,
  emptyDescription,
}: {
  searchParams: ListingSearchParams;
  categorySlug?: string;
  /** Path the filter and page links point at. */
  basePath: string;
  heading: string;
  emptyTitle: string;
  emptyDescription: string;
}) => {
  const config = await getStoreConfig();
  const brands = await listBrandOptions();

  const search = readParam(searchParams, 'q');
  const brandId = readParam(searchParams, 'brandId');
  const sortRaw = readParam(searchParams, 'sort');
  const minRaw = readParam(searchParams, 'min');
  const maxRaw = readParam(searchParams, 'max');
  const pageRaw = readParam(searchParams, 'page');

  const sort = SORT_OPTIONS.some((option) => option.value === sortRaw)
    ? (sortRaw as NonNullable<StorefrontListOptions['sort']>)
    : 'newest';

  const parsedPage = Number.parseInt(pageRaw ?? '1', 10);
  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;

  // Shoppers type prices in major units; the service works in minor units.
  const minPrice = minRaw ? (toMinorUnits(minRaw, config.currency) ?? undefined) : undefined;
  const maxPrice = maxRaw ? (toMinorUnits(maxRaw, config.currency) ?? undefined) : undefined;

  const result = await listStorefrontProducts({
    categorySlug,
    search,
    brandId,
    minPrice,
    maxPrice,
    sort,
    page,
    pageSize: config.productsPerPage,
    includeOutOfStock: config.showOutOfStock,
  });

  /** Preserves the current filters while changing one key. */
  const buildHref = (changes: Record<string, string | number | null>): string => {
    const next = new URLSearchParams();

    for (const [key, value] of Object.entries(searchParams)) {
      const single = Array.isArray(value) ? value[0] : value;
      if (single !== undefined && single !== '') next.set(key, single);
    }

    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, String(value));
    }

    if (!('page' in changes)) next.delete('page');
    if (next.get('page') === '1') next.delete('page');

    const query = next.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const hasFilters =
    Boolean(brandId) || Boolean(minRaw) || Boolean(maxRaw) || (search ?? '') !== '';

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">{heading}</h1>
          <p className="text-fg-muted mt-1 text-sm" aria-live="polite">
            {result.total} product{result.total === 1 ? '' : 's'}
            {search ? ` matching "${search}"` : ''}
          </p>
        </div>

        {/*
          A GET form: changing sort order is a navigation, so it works without
          JavaScript and leaves a shareable URL behind.
        */}
        <form method="get" action={basePath} className="flex items-end gap-2">
          {Object.entries(searchParams).map(([key, value]) => {
            const single = Array.isArray(value) ? value[0] : value;
            if (key === 'sort' || key === 'page' || single === undefined) return null;
            return <input key={key} type="hidden" name={key} value={single} />;
          })}

          <label className="block">
            <span className="text-fg-muted mb-1 block text-xs font-medium">Sort by</span>
            <Select name="sort" defaultValue={sort} className="h-10 sm:w-48">
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </label>

          <button
            type="submit"
            className="border-line-strong text-fg-muted hover:bg-surface-sunken hover:text-fg rounded-control h-10 shrink-0 border px-3 text-sm font-medium"
          >
            Apply
          </button>
        </form>
      </div>

      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        {/* ── Filters ── */}
        <aside aria-labelledby="filters-heading" className="lg:sticky lg:top-20 lg:self-start">
          <h2 id="filters-heading" className="text-fg mb-3 text-sm font-semibold">
            Filter
          </h2>

          <form method="get" action={basePath} className="space-y-4">
            {search ? <input type="hidden" name="q" value={search} /> : null}
            <input type="hidden" name="sort" value={sort} />

            <div>
              <label
                htmlFor="filter-brand"
                className="text-fg-muted mb-1 block text-xs font-medium"
              >
                Brand
              </label>
              <Select id="filter-brand" name="brandId" defaultValue={brandId ?? ''} className="h-10">
                <option value="">All brands</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </Select>
            </div>

            <fieldset>
              <legend className="text-fg-muted mb-1 block text-xs font-medium">
                Price ({config.currency})
              </legend>
              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="sr-only">Minimum price</span>
                  <input
                    name="min"
                    defaultValue={minRaw ?? ''}
                    inputMode="decimal"
                    placeholder="Min"
                    className="border-line-strong bg-surface text-fg placeholder:text-fg-subtle rounded-control h-10 w-full border px-2.5 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Maximum price</span>
                  <input
                    name="max"
                    defaultValue={maxRaw ?? ''}
                    inputMode="decimal"
                    placeholder="Max"
                    className="border-line-strong bg-surface text-fg placeholder:text-fg-subtle rounded-control h-10 w-full border px-2.5 text-sm"
                  />
                </label>
              </div>
            </fieldset>

            <button
              type="submit"
              className="bg-primary text-on-primary hover:bg-primary-hover rounded-control h-10 w-full text-sm font-medium"
            >
              Apply filters
            </button>

            {hasFilters ? (
              <Link
                href={search ? `${basePath}?q=${encodeURIComponent(search)}` : basePath}
                className="text-fg-muted hover:text-fg block text-center text-sm underline-offset-4 hover:underline"
              >
                Clear filters
              </Link>
            ) : null}
          </form>
        </aside>

        {/* ── Results ── */}
        <div className="min-w-0">
          {result.items.length === 0 ? (
            <div className="rounded-card border-line bg-surface border">
              <EmptyState
                icon={PackageSearch}
                title={hasFilters ? 'No products match those filters' : emptyTitle}
                description={
                  hasFilters
                    ? 'Try widening the price range or clearing the brand filter.'
                    : emptyDescription
                }
                action={
                  hasFilters ? (
                    <Link
                      href={basePath}
                      className="text-accent rounded text-sm font-medium underline-offset-4 hover:underline"
                    >
                      Clear all filters
                    </Link>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <>
              <ProductGrid products={result.items} locale={config.locale} />

              <div className="rounded-card border-line bg-surface mt-6 border">
                <Pagination
                  page={result.page}
                  pageSize={result.pageSize}
                  total={result.total}
                  totalPages={Math.max(1, Math.ceil(result.total / result.pageSize))}
                  buildHref={(nextPage) => buildHref({ page: nextPage })}
                  itemLabel="product"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
};
