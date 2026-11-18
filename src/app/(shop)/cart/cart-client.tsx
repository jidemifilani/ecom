'use client';

import { Minus, Plus, ShoppingBag, Tag, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ProductImage } from '@/components/shop/product-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Input } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { formatMoney } from '@/lib/money';

/**
 * Basket.
 *
 * Totals come from the server on every change rather than being recomputed in
 * the browser: the figure shown must be the figure the checkout will charge,
 * and only the server knows the live prices, discount validity and tax rules.
 *
 * Each mutation replaces the whole cart view from the response, so the UI can
 * never drift from the server's idea of the basket.
 */

export type CartLine = {
  variantId: string;
  productSlug: string;
  productName: string;
  variantName: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  imageUrl: string | null;
  imageAlt: string;
  available: number;
  exceedsStock: boolean;
};

export type CartTotals = {
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  shippingTotal: number;
  grandTotal: number;
  currency: string;
};

export type CartSnapshot = {
  itemCount: number;
  lines: CartLine[];
  totals: CartTotals | null;
  discountCode: string | null;
  discountMessage: string | null;
  checkoutReady: boolean;
};

export const CartClient = ({
  initial,
  locale,
  freeShippingThreshold,
}: {
  initial: CartSnapshot;
  locale: string;
  freeShippingThreshold: number;
}) => {
  const router = useRouter();
  const [cart, setCart] = useState(initial);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [codeInput, setCodeInput] = useState(initial.discountCode ?? '');
  const [codeBusy, setCodeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = cart.totals?.currency ?? 'USD';
  const money = (minor: number): string => formatMoney(minor, currency, locale);

  /** Applies a server cart response and notifies the header badge. */
  const apply = (next: CartSnapshot): void => {
    setCart(next);
    window.dispatchEvent(
      new CustomEvent('shop:cart-updated', { detail: { itemCount: next.itemCount } }),
    );
    router.refresh();
  };

  const setQuantity = async (variantId: string, quantity: number): Promise<void> => {
    setError(null);
    setBusyLine(variantId);

    try {
      const next = await api.patch<CartSnapshot>('/api/shop/cart/items', {
        variantId,
        quantity,
      });
      apply(next);
      if (quantity === 0) toast.success('Removed from basket');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : toErrorMessage(caught));
    } finally {
      setBusyLine(null);
    }
  };

  const applyCode = async (): Promise<void> => {
    setError(null);
    setCodeBusy(true);

    try {
      const next = await api.post<CartSnapshot>('/api/shop/cart/discount', {
        code: codeInput.trim().toUpperCase(),
      });
      apply(next);

      // An inapplicable code is stored with a reason rather than rejected, so
      // the outcome has to be read from the response, not the status code.
      if (next.totals && next.totals.discountTotal > 0) {
        toast.success('Discount applied');
      } else if (next.discountMessage) {
        setError(next.discountMessage);
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : toErrorMessage(caught));
    } finally {
      setCodeBusy(false);
    }
  };

  const removeCode = async (): Promise<void> => {
    setError(null);
    setCodeBusy(true);
    try {
      const next = await api.delete<CartSnapshot>('/api/shop/cart/discount');
      setCodeInput('');
      apply(next);
    } catch (caught) {
      setError(toErrorMessage(caught));
    } finally {
      setCodeBusy(false);
    }
  };

  const clear = async (): Promise<void> => {
    setError(null);
    try {
      const next = await api.post<CartSnapshot>('/api/shop/cart/clear');
      setCodeInput('');
      apply(next);
      toast.success('Basket emptied');
    } catch (caught) {
      setError(toErrorMessage(caught));
    }
  };

  if (cart.lines.length === 0) {
    return (
      <div className="rounded-card border-line bg-surface border">
        <EmptyState
          icon={ShoppingBag}
          title="Your basket is empty"
          description="Browse the catalogue and add something you like."
          action={
            <Button asChild>
              <Link href="/search">Start shopping</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const remainingForFreeShipping =
    freeShippingThreshold > 0 && cart.totals
      ? freeShippingThreshold - (cart.totals.subtotal - cart.totals.discountTotal)
      : 0;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      {/* ── Lines ── */}
      <div className="min-w-0 space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}

        {cart.lines.some((line) => line.exceedsStock) ? (
          <Alert tone="warning" title="Some quantities are no longer available">
            Reduce the highlighted lines to continue to checkout.
          </Alert>
        ) : null}

        <ul className="rounded-card border-line bg-surface divide-line divide-y overflow-hidden border">
          {cart.lines.map((line) => (
            <li key={line.variantId} className="p-4">
              <div className="flex gap-4">
                <Link
                  href={`/p/${line.productSlug}`}
                  className="bg-surface-sunken rounded-control relative size-20 shrink-0 overflow-hidden sm:size-24"
                >
                  <ProductImage url={line.imageUrl} alt={line.imageAlt} sizes="96px" />
                </Link>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/p/${line.productSlug}`}
                        className="text-fg hover:text-accent block text-sm font-medium"
                      >
                        {line.productName}
                      </Link>
                      {line.variantName ? (
                        <p className="text-fg-muted mt-0.5 text-xs">{line.variantName}</p>
                      ) : null}
                      <p className="text-fg-subtle mt-0.5 font-mono text-xs">{line.sku}</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => void setQuantity(line.variantId, 0)}
                      disabled={busyLine === line.variantId}
                      aria-label={`Remove ${line.productName} from basket`}
                      className="text-fg-subtle hover:bg-danger-soft hover:text-danger grid size-9 shrink-0 place-items-center rounded-md"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>

                  {line.exceedsStock ? (
                    <p className="text-danger mt-2 text-xs font-medium" role="alert">
                      Only {line.available} available. Reduce the quantity to continue.
                    </p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <div
                      className="border-line-strong rounded-control flex items-center border"
                      role="group"
                      aria-label={`Quantity for ${line.productName}`}
                    >
                      <button
                        type="button"
                        onClick={() => void setQuantity(line.variantId, line.quantity - 1)}
                        disabled={busyLine === line.variantId || line.quantity <= 1}
                        aria-label="Decrease quantity"
                        className="text-fg-muted hover:bg-surface-sunken hover:text-fg grid size-10 place-items-center rounded-l-[inherit] disabled:opacity-40"
                      >
                        <Minus className="size-4" aria-hidden="true" />
                      </button>

                      <output className="text-fg w-10 text-center text-sm font-medium tabular-nums">
                        {line.quantity}
                      </output>

                      <button
                        type="button"
                        onClick={() => void setQuantity(line.variantId, line.quantity + 1)}
                        disabled={
                          busyLine === line.variantId || line.quantity >= line.available
                        }
                        aria-label="Increase quantity"
                        className="text-fg-muted hover:bg-surface-sunken hover:text-fg grid size-10 place-items-center rounded-r-[inherit] disabled:opacity-40"
                      >
                        <Plus className="size-4" aria-hidden="true" />
                      </button>
                    </div>

                    <div className="text-right">
                      <p className="text-fg text-sm font-semibold">{money(line.lineTotal)}</p>
                      {line.quantity > 1 ? (
                        <p className="text-fg-subtle text-xs">{money(line.unitPrice)} each</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" size="sm" asChild>
            <Link href="/search">Continue shopping</Link>
          </Button>

          <Button variant="danger-ghost" size="sm" onClick={() => void clear()}>
            <Trash2 aria-hidden="true" />
            Empty basket
          </Button>
        </div>
      </div>

      {/* ── Summary ── */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card as="section">
          <CardHeader>
            <CardTitle as="h2">Order summary</CardTitle>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Discount code */}
            <div>
              <label htmlFor="discount-code" className="text-fg mb-1.5 block text-sm font-medium">
                Discount code
              </label>

              {cart.discountCode && cart.totals && cart.totals.discountTotal > 0 ? (
                <div className="bg-accent-soft border-accent/30 rounded-control flex items-center justify-between gap-2 border p-2.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <Tag className="text-accent size-4 shrink-0" aria-hidden="true" />
                    <span className="text-accent truncate font-mono text-sm font-medium">
                      {cart.discountCode}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeCode()}
                    disabled={codeBusy}
                    aria-label={`Remove discount code ${cart.discountCode}`}
                    className="text-accent hover:bg-accent/10 grid size-8 shrink-0 place-items-center rounded"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    id="discount-code"
                    value={codeInput}
                    onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                    placeholder="WELCOME10"
                    className="font-mono"
                  />
                  <Button
                    variant="outline"
                    onClick={() => void applyCode()}
                    loading={codeBusy}
                    disabled={codeInput.trim() === ''}
                  >
                    Apply
                  </Button>
                </div>
              )}
            </div>

            {cart.totals ? (
              <dl className="border-line space-y-2 border-t pt-4 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">Subtotal</dt>
                  <dd className="text-fg">{money(cart.totals.subtotal)}</dd>
                </div>

                {cart.totals.discountTotal > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-fg-muted">Discount</dt>
                    <dd className="text-success">-{money(cart.totals.discountTotal)}</dd>
                  </div>
                ) : null}

                {cart.totals.taxTotal > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-fg-muted">Tax</dt>
                    <dd className="text-fg">{money(cart.totals.taxTotal)}</dd>
                  </div>
                ) : null}

                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">Delivery</dt>
                  <dd className="text-fg">
                    {cart.totals.shippingTotal === 0 ? (
                      <Badge tone="success">Free</Badge>
                    ) : (
                      money(cart.totals.shippingTotal)
                    )}
                  </dd>
                </div>

                <div className="border-line flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd>{money(cart.totals.grandTotal)}</dd>
                </div>
              </dl>
            ) : null}

            {remainingForFreeShipping > 0 ? (
              <p className="text-fg-muted text-xs leading-relaxed">
                Add {money(remainingForFreeShipping)} more to qualify for free delivery.
              </p>
            ) : null}

            <Button size="lg" block disabled={!cart.checkoutReady} asChild={cart.checkoutReady}>
              {cart.checkoutReady ? (
                <Link href="/checkout">Checkout</Link>
              ) : (
                <span>Fix basket to continue</span>
              )}
            </Button>

            <p className="text-fg-subtle text-center text-xs leading-relaxed">
              Prices and stock are re-checked at checkout, so you never pay a stale price.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
