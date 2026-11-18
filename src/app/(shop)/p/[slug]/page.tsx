import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AddToCart } from '@/components/shop/add-to-cart';
import { ProductGrid, ProductImage } from '@/components/shop/product-card';
import { Badge } from '@/components/ui/feedback';
import { formatDate } from '@/lib/utils';
import { getStorefrontProduct, listStorefrontProducts } from '@/server/product-service';
import { listProductReviews } from '@/server/review-service';
import { getStoreConfig } from '@/server/settings-service';

import { ReviewForm } from './review-form';

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> => {
  const { slug } = await params;
  const product = await getStorefrontProduct(slug);

  if (!product) return { title: 'Product not found' };

  return {
    title: product.name,
    description: product.shortDescription ?? `Buy ${product.name}.`,
    openGraph: {
      title: product.name,
      description: product.shortDescription ?? undefined,
      type: 'website',
      ...(product.images[0] ? { images: [{ url: product.images[0].url }] } : {}),
    },
  };
};

/**
 * /p/[slug] -- product detail.
 *
 * Only ACTIVE, non-archived products resolve; a draft or archived product 404s
 * rather than being quietly reachable by URL.
 */
const ProductPage = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params;
  const product = await getStorefrontProduct(slug);

  if (!product) notFound();

  const [config, reviews, related] = await Promise.all([
    getStoreConfig(),
    listProductReviews(product.id, 10),
    product.categorySlug
      ? listStorefrontProducts({
          categorySlug: product.categorySlug,
          page: 1,
          pageSize: 5,
          sort: 'newest',
          includeOutOfStock: false,
        })
      : Promise.resolve(null),
  ]);

  const relatedItems = (related?.items ?? []).filter((item) => item.id !== product.id).slice(0, 4);

  const onSale =
    product.compareAtPrice !== null && product.compareAtPrice > product.basePrice;

  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-5">
        <ol className="text-fg-muted flex flex-wrap items-center gap-1.5 text-xs">
          <li>
            <Link href="/" className="hover:text-fg rounded">
              Home
            </Link>
          </li>
          {product.categorySlug && product.categoryName ? (
            <>
              <li aria-hidden="true">/</li>
              <li>
                <Link href={`/c/${product.categorySlug}`} className="hover:text-fg rounded">
                  {product.categoryName}
                </Link>
              </li>
            </>
          ) : null}
          <li aria-hidden="true">/</li>
          <li>
            <span className="text-fg font-medium" aria-current="page">
              {product.name}
            </span>
          </li>
        </ol>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        {/* ── Gallery ── */}
        <div>
          <div className="bg-surface-sunken rounded-card border-line relative aspect-square w-full overflow-hidden border">
            <ProductImage
              url={product.images[0]?.url ?? null}
              alt={product.images[0]?.alt ?? product.name}
              priority
              sizes="(max-width: 1024px) 100vw, 50vw"
            />
          </div>

          {product.images.length > 1 ? (
            <ul className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-5">
              {product.images.slice(1, 6).map((image, index) => (
                <li key={`${image.url}-${index}`}>
                  <div className="bg-surface-sunken rounded-control border-line relative aspect-square overflow-hidden border">
                    <ProductImage url={image.url} alt={image.alt} sizes="20vw" />
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* ── Buy box ── */}
        <div>
          {product.brandName ? (
            <p className="text-fg-subtle text-xs tracking-wide uppercase">{product.brandName}</p>
          ) : null}

          <h1 className="text-fg mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            {product.name}
          </h1>

          {product.reviewCount > 0 && product.averageRating !== null ? (
            <p className="mt-2 flex items-center gap-2 text-sm">
              <span aria-hidden="true" className="text-warning font-medium">
                {'*'.repeat(Math.round(product.averageRating))}
                <span className="text-fg-subtle">
                  {'*'.repeat(5 - Math.round(product.averageRating))}
                </span>
              </span>
              <span className="text-fg-muted">
                {product.averageRating.toFixed(1)} out of 5 from {product.reviewCount} review
                {product.reviewCount === 1 ? '' : 's'}
              </span>
            </p>
          ) : null}

          {product.shortDescription ? (
            <p className="text-fg-muted mt-4 text-base leading-relaxed">
              {product.shortDescription}
            </p>
          ) : null}

          {onSale ? (
            <p className="mt-4">
              <Badge tone="danger">
                Save{' '}
                {Math.round(
                  ((product.compareAtPrice! - product.basePrice) / product.compareAtPrice!) * 100,
                )}
                %
              </Badge>
            </p>
          ) : null}

          <div className="border-line mt-6 border-t pt-6">
            <AddToCart
              variants={product.variants}
              currency={product.currency}
              locale={config.locale}
              productName={product.name}
            />
          </div>

          {product.description ? (
            <div className="border-line mt-8 border-t pt-6">
              <h2 className="text-fg text-base font-semibold">Description</h2>
              <div className="text-fg-muted mt-2 space-y-3 text-sm leading-relaxed">
                {product.description.split('\n\n').map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Reviews ── */}
      <section aria-labelledby="reviews-heading" className="border-line mt-12 border-t pt-8">
        <h2 id="reviews-heading" className="text-fg text-xl font-semibold tracking-tight">
          Reviews
        </h2>

        <div className="mt-5 grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div>
            {reviews.length === 0 ? (
              <p className="text-fg-muted text-sm">
                No reviews yet. Be the first to share what you think.
              </p>
            ) : (
              <ul className="divide-line divide-y">
                {reviews.map((review) => (
                  <li key={review.id} className="py-4 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span aria-hidden="true" className="text-warning text-sm font-medium">
                        {'*'.repeat(review.rating)}
                        <span className="text-fg-subtle">{'*'.repeat(5 - review.rating)}</span>
                      </span>
                      <span className="sr-only">{review.rating} out of 5</span>
                      <span className="text-fg text-sm font-medium">{review.authorName}</span>
                      {review.customerId ? (
                        <Badge tone="outline">Verified purchase account</Badge>
                      ) : null}
                      <span className="text-fg-subtle text-xs">
                        {formatDate(review.createdAt)}
                      </span>
                    </div>

                    {review.title ? (
                      <h3 className="text-fg mt-1.5 text-sm font-semibold">{review.title}</h3>
                    ) : null}

                    <p className="text-fg-muted mt-1 text-sm leading-relaxed">{review.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <ReviewForm
            productId={product.id}
            productName={product.name}
            moderated={config.requireReviewApproval}
          />
        </div>
      </section>

      {/* ── Related ── */}
      {relatedItems.length > 0 ? (
        <section aria-labelledby="related-heading" className="border-line mt-12 border-t pt-8">
          <h2
            id="related-heading"
            className="text-fg mb-5 text-xl font-semibold tracking-tight"
          >
            More in {product.categoryName}
          </h2>
          <ProductGrid products={relatedItems} locale={config.locale} />
        </section>
      ) : null}
    </div>
  );
};

export default ProductPage;
