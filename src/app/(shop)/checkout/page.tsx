import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/feedback';
import { getCurrentCustomer } from '@/lib/auth/current-user';
import { resolveCartIdentity } from '@/lib/shop';
import { getCartView } from '@/server/cart-service';
import { getCustomer } from '@/server/customer-service';
import { getStoreConfig } from '@/server/settings-service';

import { CheckoutClient } from './checkout-client';
import type { CartSnapshot } from '../cart/cart-client';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false, follow: false },
};

/**
 * /checkout
 *
 * A signed-in shopper's details and default address are pre-filled from their
 * account, which removes most of the typing on a repeat order.
 *
 * An empty basket is shown a dead end rather than a form that cannot be
 * submitted.
 */
const CheckoutPage = async () => {
  const [identity, config, customer] = await Promise.all([
    resolveCartIdentity(),
    getStoreConfig(),
    getCurrentCustomer(),
  ]);

  const cart = await getCartView(identity);

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
        <div className="rounded-card border-line bg-surface border">
          <EmptyState
            title="Your basket is empty"
            description="Add something to your basket before checking out."
            action={
              <Button asChild>
                <Link href="/search">Browse products</Link>
              </Button>
            }
          />
        </div>
      </div>
    );
  }

  // A basket with an unfulfillable line must be fixed on the cart page, which
  // has the quantity controls.
  if (!cart.checkoutReady) {
    redirect('/cart');
  }

  const detail = customer ? await getCustomer(customer.id) : null;
  const defaultAddress =
    detail?.addresses.find((address) => address.isDefaultShipping) ?? detail?.addresses[0] ?? null;

  const snapshot: CartSnapshot = {
    itemCount: cart.itemCount,
    lines: cart.lines.map((line) => ({
      variantId: line.variantId,
      productSlug: line.productSlug,
      productName: line.productName,
      variantName: line.variantName,
      sku: line.sku,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
      imageUrl: line.imageUrl,
      imageAlt: line.imageAlt,
      available: Math.min(line.available, 99),
      exceedsStock: line.exceedsStock,
    })),
    totals: cart.totals
      ? {
          subtotal: cart.totals.subtotal,
          discountTotal: cart.totals.discountTotal,
          taxTotal: cart.totals.taxTotal,
          shippingTotal: cart.totals.shippingTotal,
          grandTotal: cart.totals.grandTotal,
          currency: cart.totals.currency,
        }
      : null,
    discountCode: cart.discountCode,
    discountMessage: cart.discountMessage,
    checkoutReady: cart.checkoutReady && !config.maintenanceMode,
  };

  return (
    <div className="mx-auto w-full max-w-[90rem] px-4 py-8 sm:px-6">
      <h1 className="text-fg mb-6 text-2xl font-semibold tracking-tight">Checkout</h1>

      <CheckoutClient
        cart={snapshot}
        locale={config.locale}
        allowGuest={config.allowGuestCheckout}
        isSignedIn={customer !== null}
        prefill={
          detail
            ? {
                email: detail.email,
                firstName: defaultAddress?.firstName ?? detail.firstName,
                lastName: defaultAddress?.lastName ?? detail.lastName,
                phone: detail.phone ?? '',
                line1: defaultAddress?.line1 ?? '',
                line2: defaultAddress?.line2 ?? '',
                city: defaultAddress?.city ?? '',
                state: defaultAddress?.state ?? '',
                postalCode: defaultAddress?.postalCode ?? '',
                countryCode: defaultAddress?.countryCode ?? 'GB',
              }
            : null
        }
      />
    </div>
  );
};

export default CheckoutPage;
