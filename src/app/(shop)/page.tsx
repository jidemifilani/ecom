import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, PackageCheck, ShieldCheck, Truck } from 'lucide-react';

import { ProductGrid, ProductImage } from '@/components/shop/product-card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { formatMoney } from '@/lib/money';
import { getCategoryTree } from '@/server/catalog-service';
import { listStorefrontProducts } from '@/server/product-service';
import { getStoreConfig } from '@/server/settings-service';

export const generateMetadata = async (): Promise<Metadata> => {
  const config = await getStoreConfig();

  return {
    title: `${config.name} - ${config.tagline || 'Shop online'}`,
    description:
      config.tagline ||
      `Browse the ${config.name} catalogue. Secure checkout and fast dispatch.`,
    openGraph: {
      title: config.name,
      description: config.tagline || `Shop the ${config.name} catalogue.`,
      type: 'website',
    },
  };
};

/**
 * Storefront home page.
 *
 * Sections are ordered the way a shopper scans: what this is, what to buy,
 * where to browse, then reassurance. The featured row falls back to the newest
 * products when nothing is flagged featured, so the page is never empty on a
 * fresh install.
 */
const HomePage = async () => {
  const config = await getStoreConfig();

  const [featured, newest, categoryTree] = await Promise.all([
    listStorefrontProducts({
      featuredOnly: true,
      page: 1,
      pageSize: 8,
      sort: 'newest',
      includeOutOfStock: config.showOutOfStock,
    }),
    listStorefrontProducts({
      page: 1,
      pageSize: 8,
      sort: 'newest',
      includeOutOfStock: config.showOutOfStock,
    }),
    getCategoryTree(),
  ]);

  // A fresh install has nothing flagged featured; show the newest instead.
  const highlight = featured.items.length > 0 ? featured : newest;
  const highlightTitle = featured.items.length > 0 ? 'Featured' : 'New in';

  // Only offer categories that actually lead somewhere.
  const topCategories = categoryTree
    .filter((node) => node.totalProductCount > 0)
    .slice(0, 6);

  return (
    <>
      {/* ── Hero ── */}
      <section className="border-line border-b">
        <div className="mx-auto w-full max-w-[90rem] px-4 py-12 sm:px-6 sm:py-16 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-accent text-sm font-semibold tracking-wide uppercase">
              {config.name}
            </p>
            <h1 className="text-fg mt-3 text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
              {config.tagline || 'Everything you need, one storefront.'}
            </h1>
            <p className="text-fg-muted mt-4 max-w-xl text-base leading-relaxed">
              Browse the full catalogue, check stock in real time and check out in a few steps.
              {config.freeShippingThresholdMinor > 0
                ? ` Free delivery on orders over ${formatMoney(config.freeShippingThresholdMinor, config.currency, config.locale)}.`
                : ''}
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href="/search">
                  Shop everything
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
              {topCategories[0] ? (
                <Button size="lg" variant="outline" asChild>
                  <Link href={`/c/${topCategories[0].slug}`}>
                    Browse {topCategories[0].name}
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* ── Featured ── */}
      <section
        aria-labelledby="highlight-heading"
        className="mx-auto w-full max-w-[90rem] px-4 py-10 sm:px-6"
      >
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="highlight-heading" className="text-fg text-xl font-semibold tracking-tight">
              {highlightTitle}
            </h2>
            <p className="text-fg-muted mt-1 text-sm">
              {highlightTitle === 'Featured'
                ? 'Picked by our team.'
                : 'The latest additions to the catalogue.'}
            </p>
          </div>

          <Button variant="ghost" size="sm" asChild>
            <Link href="/search">
              View all
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>

        {highlight.items.length === 0 ? (
          <div className="rounded-card border-line bg-surface border">
            <EmptyState
              title="The catalogue is empty"
              description="Products added in the back office appear here straight away."
            />
          </div>
        ) : (
          <ProductGrid products={highlight.items} locale={config.locale} />
        )}
      </section>

      {/* ── Categories ── */}
      {topCategories.length > 0 ? (
        <section
          aria-labelledby="categories-heading"
          className="mx-auto w-full max-w-[90rem] px-4 py-10 sm:px-6"
        >
          <h2
            id="categories-heading"
            className="text-fg mb-5 text-xl font-semibold tracking-tight"
          >
            Browse by category
          </h2>

          <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
            {topCategories.map((category) => (
              <li key={category.slug}>
                <Link
                  href={`/c/${category.slug}`}
                  className="rounded-card border-line bg-surface hover:border-line-strong hover:shadow-raised group block overflow-hidden border transition-[border-color,box-shadow]"
                >
                  <div className="bg-surface-sunken relative aspect-[4/3] w-full overflow-hidden">
                    <ProductImage
                      url={category.imageUrl}
                      alt=""
                      sizes="(max-width: 768px) 50vw, 16vw"
                      className="transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  <div className="p-3">
                    <h3 className="text-fg truncate text-sm font-medium">{category.name}</h3>
                    <p className="text-fg-subtle mt-0.5 text-xs">
                      {category.totalProductCount} item
                      {category.totalProductCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Reassurance ── */}
      <section
        aria-labelledby="promises-heading"
        className="mx-auto w-full max-w-[90rem] px-4 py-10 sm:px-6"
      >
        <h2 id="promises-heading" className="sr-only">
          Why shop with us
        </h2>

        <ul className="grid gap-4 sm:grid-cols-3">
          {[
            {
              icon: PackageCheck,
              title: 'Live stock levels',
              body: 'What you see is what is on the shelf. Nothing is sold twice.',
            },
            {
              icon: Truck,
              title: 'Tracked delivery',
              body:
                config.freeShippingThresholdMinor > 0
                  ? `Free over ${formatMoney(config.freeShippingThresholdMinor, config.currency, config.locale)}, tracked as standard.`
                  : 'Dispatched quickly, with tracking on every order.',
            },
            {
              icon: ShieldCheck,
              title: 'Secure checkout',
              body: 'Your details are validated and stored safely, never shared.',
            },
          ].map((promise) => (
            <li
              key={promise.title}
              className="rounded-card border-line bg-surface flex gap-3 border p-5"
            >
              <span
                aria-hidden="true"
                className="bg-accent-soft text-accent grid size-10 shrink-0 place-items-center rounded-full"
              >
                <promise.icon className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-fg text-sm font-semibold">{promise.title}</h3>
                <p className="text-fg-muted mt-1 text-sm leading-relaxed">{promise.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
};

export default HomePage;
