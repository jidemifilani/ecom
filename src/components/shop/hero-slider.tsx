'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ImageOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import type { ProductCardItem } from '@/components/shop/product-card';

type HeroSliderProps = {
  products: readonly ProductCardItem[];
  locale: string;
  storeName?: string;
};

export const HeroSlider = ({ products, locale, storeName }: HeroSliderProps) => {
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const count = products.length;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const next = useCallback(() => {
    setCurrent((c) => (c + 1) % count);
  }, [count]);

  const prev = useCallback(() => {
    setCurrent((c) => (c - 1 + count) % count);
  }, [count]);

  useEffect(() => {
    if (paused || reducedMotion || count <= 1) return;
    intervalRef.current = setInterval(next, 5000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [paused, reducedMotion, next, count]);

  if (count === 0) return null;

  const product = products[current]!;
  const onSale =
    product.compareAtPrice !== null && product.compareAtPrice > product.basePrice;
  const discountPercent = onSale
    ? Math.round(
        ((product.compareAtPrice! - product.basePrice) / product.compareAtPrice!) * 100,
      )
    : 0;

  return (
    <section
      aria-label="Featured products"
      aria-roledescription="carousel"
      className="relative overflow-hidden border-b"
      style={{ borderColor: 'var(--color-border, oklch(0.3 0.02 260))' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Holographic background layer */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 70% 50%, oklch(0.25 0.06 var(--accent-h, 240) / 0.35) 0%, transparent 70%)',
        }}
      />
      {/* Holo sheen strip */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'linear-gradient(135deg, oklch(0.9 0.08 var(--accent-h, 240) / 0.04) 0%, transparent 50%, oklch(0.75 0.14 var(--accent-h, 240) / 0.06) 100%)',
        }}
      />

      <div className="relative z-10 mx-auto w-full max-w-[90rem] px-4 py-10 sm:px-6 sm:py-14 lg:py-20">
        <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-2 lg:gap-16">

          {/* Text pane */}
          <div
            key={product.id}
            className={reducedMotion ? '' : 'animate-hero-enter'}
          >
            {storeName ? (
              <p
                className="text-sm font-semibold tracking-widest uppercase"
                style={{ color: 'var(--color-accent, oklch(0.72 0.17 240))' }}
              >
                {storeName}
              </p>
            ) : null}

            {onSale ? (
              <span
                className="mt-2 inline-block rounded-full px-3 py-0.5 text-xs font-semibold"
                style={{
                  background: 'oklch(0.65 0.21 25 / 0.15)',
                  color: 'oklch(0.78 0.18 25)',
                  border: '1px solid oklch(0.65 0.21 25 / 0.25)',
                }}
              >
                {discountPercent}% off
              </span>
            ) : null}

            <h1
              className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl"
              style={{ color: 'var(--color-fg, oklch(0.97 0.01 260))' }}
            >
              {product.name}
            </h1>

            {product.shortDescription ? (
              <p
                className="mt-4 max-w-md text-base leading-relaxed"
                style={{ color: 'var(--color-muted, oklch(0.72 0.02 260))' }}
              >
                {product.shortDescription}
              </p>
            ) : null}

            <div className="mt-3 flex items-baseline gap-3">
              <span
                className="text-2xl font-semibold"
                style={{ color: 'var(--color-fg, oklch(0.97 0.01 260))' }}
              >
                {formatMoney(product.basePrice, product.currency, locale)}
              </span>
              {onSale ? (
                <span
                  className="text-base line-through"
                  style={{ color: 'var(--color-muted, oklch(0.72 0.02 260))' }}
                >
                  <span className="sr-only">was </span>
                  {formatMoney(product.compareAtPrice!, product.currency, locale)}
                </span>
              ) : null}
            </div>

            <div className="mt-7 flex flex-wrap gap-3">
              <Button size="lg" asChild>
                <Link href={`/p/${product.slug}`}>Shop now</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="/search">Browse all</Link>
              </Button>
            </div>
          </div>

          {/* Image pane */}
          <div
            key={`img-${product.id}`}
            aria-hidden="true"
            className={`relative ${reducedMotion ? '' : 'animate-hero-image-enter'}`}
          >
            {/* Glass card behind image */}
            <div
              className="relative aspect-square w-full overflow-hidden"
              style={{
                borderRadius: '1.25rem',
                background: 'oklch(0.18 0.02 260 / 0.6)',
                backdropFilter: 'blur(24px)',
                border: '1px solid oklch(1 0 0 / 0.08)',
                boxShadow:
                  '0 32px 64px oklch(0 0 0 / 0.4), inset 0 1px 0 oklch(1 0 0 / 0.1)',
              }}
            >
              {product.imageUrl ? (
                <Image
                  src={product.imageUrl}
                  alt={product.name}
                  fill
                  priority
                  sizes="(max-width: 1024px) 90vw, 45vw"
                  className="object-cover"
                  style={{ borderRadius: '1.25rem' }}
                />
              ) : (
                <div className="grid h-full w-full place-items-center">
                  <ImageOff
                    className="size-12"
                    style={{ color: 'var(--color-muted, oklch(0.72 0.02 260))' }}
                  />
                </div>
              )}

              {/* Gradient overlay at bottom */}
              <div
                className="pointer-events-none absolute right-0 bottom-0 left-0 h-1/3"
                style={{
                  background:
                    'linear-gradient(to top, oklch(0.12 0.02 260 / 0.6), transparent)',
                  borderRadius: '0 0 1.25rem 1.25rem',
                }}
              />
            </div>
          </div>
        </div>

        {/* Controls */}
        {count > 1 ? (
          <div className="mt-8 flex items-center justify-between">
            {/* Dot indicators */}
            <div
              role="tablist"
              aria-label="Slide indicators"
              className="flex items-center gap-2"
            >
              {products.map((p, i) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={i === current}
                  aria-label={`Slide ${i + 1}: ${p.name}`}
                  onClick={() => setCurrent(i)}
                  className="rounded-full transition-all"
                  style={{
                    width: i === current ? '2rem' : '0.5rem',
                    height: '0.5rem',
                    background:
                      i === current
                        ? 'var(--color-accent, oklch(0.72 0.17 240))'
                        : 'oklch(0.72 0.02 260 / 0.4)',
                    transitionDuration: reducedMotion ? '0.01ms' : '300ms',
                  }}
                />
              ))}
            </div>

            {/* Arrow controls */}
            <div className="flex gap-2">
              <button
                aria-label="Previous product"
                onClick={prev}
                className="grid size-10 place-items-center rounded-full border transition-colors"
                style={{
                  background: 'oklch(0.18 0.02 260 / 0.6)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid oklch(1 0 0 / 0.1)',
                  color: 'var(--color-fg, oklch(0.97 0.01 260))',
                }}
              >
                <ArrowLeft className="size-4" strokeWidth={1.75} />
              </button>
              <button
                aria-label="Next product"
                onClick={next}
                className="grid size-10 place-items-center rounded-full border transition-colors"
                style={{
                  background: 'oklch(0.18 0.02 260 / 0.6)',
                  backdropFilter: 'blur(12px)',
                  border: '1px solid oklch(1 0 0 / 0.1)',
                  color: 'var(--color-fg, oklch(0.97 0.01 260))',
                }}
              >
                <ArrowRight className="size-4" strokeWidth={1.75} />
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <style>{`
        @keyframes hero-enter {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes hero-image-enter {
          from { opacity: 0; transform: scale(0.96) translateX(24px); }
          to   { opacity: 1; transform: scale(1) translateX(0); }
        }
        .animate-hero-enter {
          animation: hero-enter 400ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .animate-hero-image-enter {
          animation: hero-image-enter 500ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-hero-enter, .animate-hero-image-enter {
            animation-duration: 0.01ms !important;
          }
        }
      `}</style>
    </section>
  );
};
