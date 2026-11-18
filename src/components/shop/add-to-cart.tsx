'use client';

import { Check, Minus, Plus, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert, Badge } from '@/components/ui/feedback';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Variant picker and add-to-basket control.
 *
 * Stock is enforced server-side; this only avoids obviously doomed requests by
 * capping the stepper at what is available. If stock runs out between page load
 * and submit, the API rejects it and the message is shown inline rather than
 * failing silently.
 *
 * On success a `shop:cart-updated` event updates the header badge without a
 * navigation, and `router.refresh()` re-reads the server data so availability
 * stays accurate.
 */

export type VariantChoice = {
  id: string;
  sku: string;
  name: string;
  price: number;
  available: number;
  isDefault: boolean;
  options: { name: string; value: string }[];
};

export const AddToCart = ({
  variants,
  currency,
  locale,
  productName,
}: {
  variants: VariantChoice[];
  currency: string;
  locale: string;
  productName: string;
}) => {
  const router = useRouter();

  const firstAvailable = variants.find((variant) => variant.available > 0) ?? variants[0];
  const [selectedId, setSelectedId] = useState(firstAvailable?.id ?? '');
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const selected = variants.find((variant) => variant.id === selectedId) ?? firstAvailable;

  if (!selected) {
    return (
      <Alert tone="warning">This product has no purchasable options at the moment.</Alert>
    );
  }

  // Sentinel used by the service for backorder-enabled items.
  const unlimited = selected.available >= Number.MAX_SAFE_INTEGER;
  const maxQuantity = unlimited ? 99 : Math.min(selected.available, 99);
  const soldOut = !unlimited && selected.available <= 0;

  const choose = (id: string): void => {
    setSelectedId(id);
    setQuantity(1);
    setError(null);
    setAdded(false);
  };

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);

    try {
      const cart = await api.post<{ itemCount: number }>('/api/shop/cart/items', {
        variantId: selected.id,
        quantity,
      });

      window.dispatchEvent(
        new CustomEvent('shop:cart-updated', { detail: { itemCount: cart.itemCount } }),
      );

      setAdded(true);
      toast.success('Added to basket', {
        description: `${quantity} x ${productName}`,
        action: { label: 'View basket', onClick: () => router.push('/cart') },
      });

      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : toErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Variant choice, only when there is a real choice to make. */}
      {variants.length > 1 ? (
        <fieldset>
          <legend className="text-fg mb-2 text-sm font-medium">
            {variants[0]?.options[0]?.name ?? 'Option'}
          </legend>

          <div className="flex flex-wrap gap-2">
            {variants.map((variant) => {
              const label =
                variant.options.map((option) => option.value).join(' / ') || variant.name;
              const out = variant.available <= 0;
              const isSelected = variant.id === selected.id;

              return (
                <button
                  key={variant.id}
                  type="button"
                  onClick={() => choose(variant.id)}
                  aria-pressed={isSelected}
                  className={cn(
                    'rounded-control min-h-11 border px-3 py-2 text-sm font-medium',
                    'transition-[border-color,background-color] duration-150',
                    isSelected
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line-strong bg-surface text-fg hover:border-line-strong',
                    out && 'opacity-60',
                  )}
                >
                  {label}
                  {out ? (
                    <span className="text-fg-subtle ml-1.5 text-xs">(sold out)</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {/* Price and stock for the chosen variant. */}
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-fg text-2xl font-semibold">
          {formatMoney(selected.price, currency, locale)}
        </p>

        {soldOut ? (
          <Badge tone="danger">Out of stock</Badge>
        ) : unlimited ? (
          <Badge tone="success">Available to order</Badge>
        ) : selected.available <= 5 ? (
          <Badge tone="warning">Only {selected.available} left</Badge>
        ) : (
          <Badge tone="success">In stock</Badge>
        )}
      </div>

      <p className="text-fg-subtle font-mono text-xs">SKU {selected.sku}</p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {!soldOut ? (
        <div className="flex flex-wrap items-center gap-3">
          {/* Quantity stepper: 44px targets, and the value is announced. */}
          <div
            className="border-line-strong rounded-control flex items-center border"
            role="group"
            aria-label="Quantity"
          >
            <button
              type="button"
              onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              disabled={quantity <= 1}
              aria-label="Decrease quantity"
              className="text-fg-muted hover:bg-surface-sunken hover:text-fg grid size-11 place-items-center rounded-l-[inherit] disabled:opacity-40"
            >
              <Minus className="size-4" aria-hidden="true" />
            </button>

            <output
              aria-live="polite"
              className="text-fg w-12 text-center text-sm font-medium tabular-nums"
            >
              {quantity}
            </output>

            <button
              type="button"
              onClick={() => setQuantity((value) => Math.min(maxQuantity, value + 1))}
              disabled={quantity >= maxQuantity}
              aria-label="Increase quantity"
              className="text-fg-muted hover:bg-surface-sunken hover:text-fg grid size-11 place-items-center rounded-r-[inherit] disabled:opacity-40"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>

          <Button
            size="lg"
            onClick={() => void submit()}
            loading={busy}
            loadingLabel="Adding to basket"
            className="flex-1 sm:flex-none"
          >
            {added ? (
              <>
                <Check aria-hidden="true" />
                Added
              </>
            ) : (
              <>
                <ShoppingCart aria-hidden="true" />
                Add to basket
              </>
            )}
          </Button>
        </div>
      ) : (
        <Alert tone="info">
          This option is sold out. Choose another option, or check back shortly.
        </Alert>
      )}

      {added ? (
        <Button variant="outline" block asChild>
          <Link href="/cart">Go to basket</Link>
        </Button>
      ) : null}
    </div>
  );
};
