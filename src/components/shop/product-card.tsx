import Image from 'next/image';
import Link from 'next/link';
import { ImageOff } from 'lucide-react';

import { Badge } from '@/components/ui/feedback';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Storefront product card.
 *
 * The whole card is one link rather than several, so a tap anywhere opens the
 * product and assistive technology announces a single destination instead of
 * three competing ones.
 *
 * Image space is reserved with a fixed aspect ratio, so the grid does not
 * reflow as images load.
 */

export type ProductCardItem = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  currency: string;
  imageUrl: string | null;
  imageAlt: string;
  inStock: boolean;
  brandName: string | null;
};

export const ProductImage = ({
  url,
  alt,
  priority = false,
  sizes = '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw',
  className,
}: {
  url: string | null;
  alt: string;
  priority?: boolean;
  sizes?: string;
  className?: string;
}) => {
  if (!url) {
    return (
      <div
        className={cn(
          'bg-surface-sunken text-fg-subtle grid h-full w-full place-items-center',
          className,
        )}
      >
        <ImageOff className="size-8" aria-hidden="true" />
        <span className="sr-only">No image available</span>
      </div>
    );
  }

  // next/image cannot optimise SVG, so the seeded placeholders are served as-is.
  if (url.endsWith('.svg')) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- SVG bypasses the optimiser
      <img
        src={url}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        className={cn('h-full w-full object-cover', className)}
      />
    );
  }

  return (
    <Image
      src={url}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      className={cn('object-cover', className)}
    />
  );
};

export const ProductCard = ({
  product,
  locale,
  priority = false,
}: {
  product: ProductCardItem;
  locale: string;
  priority?: boolean;
}) => {
  const onSale =
    product.compareAtPrice !== null && product.compareAtPrice > product.basePrice;

  const discountPercent = onSale
    ? Math.round(
        ((product.compareAtPrice! - product.basePrice) / product.compareAtPrice!) * 100,
      )
    : 0;

  return (
    <article className="group">
      <Link
        href={`/p/${product.slug}`}
        className="rounded-card border-line bg-surface hover:border-line-strong hover:shadow-raised flex h-full flex-col overflow-hidden border transition-[border-color,box-shadow] duration-200"
      >
        <div className="bg-surface-sunken relative aspect-square w-full overflow-hidden">
          <ProductImage
            url={product.imageUrl}
            alt={product.imageAlt}
            priority={priority}
            className="transition-transform duration-300 group-hover:scale-[1.03]"
          />

          <div className="absolute top-2 left-2 flex flex-col gap-1">
            {onSale ? <Badge tone="danger">-{discountPercent}%</Badge> : null}
            {!product.inStock ? <Badge tone="neutral">Sold out</Badge> : null}
          </div>
        </div>

        <div className="flex flex-1 flex-col p-3 sm:p-4">
          {product.brandName ? (
            <p className="text-fg-subtle text-xs tracking-wide uppercase">{product.brandName}</p>
          ) : null}

          <h3 className="text-fg mt-0.5 line-clamp-2 text-sm font-medium">{product.name}</h3>

          {product.shortDescription ? (
            <p className="text-fg-muted mt-1 line-clamp-2 text-xs leading-relaxed">
              {product.shortDescription}
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-3">
            <span className="text-fg text-base font-semibold">
              {formatMoney(product.basePrice, product.currency, locale)}
            </span>
            {onSale ? (
              <span className="text-fg-subtle text-xs line-through">
                {formatMoney(product.compareAtPrice!, product.currency, locale)}
                <span className="sr-only"> was</span>
              </span>
            ) : null}
          </div>
        </div>
      </Link>
    </article>
  );
};

/** Responsive product grid. Two columns at 320px, up to five on large screens. */
export const ProductGrid = ({
  products,
  locale,
}: {
  products: readonly ProductCardItem[];
  locale: string;
}) => (
  <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
    {products.map((product, index) => (
      <li key={product.id}>
        {/* The first row is above the fold, so those images load eagerly. */}
        <ProductCard product={product} locale={locale} priority={index < 4} />
      </li>
    ))}
  </ul>
);
