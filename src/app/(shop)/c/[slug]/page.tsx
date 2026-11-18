import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ProductListing, type ListingSearchParams } from '@/components/shop/product-listing';
import { db } from '@/lib/db';

/**
 * /c/[slug] -- category listing.
 *
 * Products in child categories are included, so browsing "Audio" shows
 * everything under Headphones and Speakers too rather than an empty shelf.
 */

const loadCategory = async (slug: string) =>
  db.category.findFirst({
    where: { slug, deletedAt: null, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      metaTitle: true,
      metaDescription: true,
      parent: { select: { name: true, slug: true } },
      children: {
        where: { deletedAt: null, isActive: true },
        orderBy: { position: 'asc' },
        select: { name: true, slug: true },
      },
    },
  });

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> => {
  const { slug } = await params;
  const category = await loadCategory(slug);

  if (!category) return { title: 'Category not found' };

  return {
    title: category.metaTitle || category.name,
    description:
      category.metaDescription ||
      category.description ||
      `Browse our ${category.name.toLowerCase()} range.`,
  };
};

const CategoryPage = async ({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<ListingSearchParams>;
}) => {
  const [{ slug }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const category = await loadCategory(slug);

  if (!category) notFound();

  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6">
      {/* Breadcrumb trail, so a shopper landing from search knows where they are. */}
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="text-fg-muted flex flex-wrap items-center gap-1.5 text-xs">
          <li>
            <Link href="/" className="hover:text-fg rounded">
              Home
            </Link>
          </li>
          {category.parent ? (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link href={`/c/${category.parent.slug}`} className="hover:text-fg rounded">
                  {category.parent.name}
                </Link>
              </li>
            </>
          ) : null}
          <li aria-hidden="true">/</li>
          <li>
            <span className="text-fg font-medium" aria-current="page">
              {category.name}
            </span>
          </li>
        </ol>
      </nav>

      {category.description ? (
        <p className="text-fg-muted mb-5 max-w-2xl text-sm leading-relaxed">
          {category.description}
        </p>
      ) : null}

      {category.children.length > 0 ? (
        <nav aria-label="Subcategories" className="mb-6">
          <ul className="flex flex-wrap gap-2">
            {category.children.map((child) => (
              <li key={child.slug}>
                <Link
                  href={`/c/${child.slug}`}
                  className="border-line bg-surface text-fg-muted hover:border-line-strong hover:text-fg rounded-full border px-3 py-1.5 text-sm"
                >
                  {child.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}

      <ProductListing
        searchParams={resolvedSearchParams}
        categorySlug={category.slug}
        basePath={`/c/${category.slug}`}
        heading={category.name}
        emptyTitle="Nothing here yet"
        emptyDescription="This category has no products on sale at the moment."
      />
    </div>
  );
};

export default CategoryPage;
