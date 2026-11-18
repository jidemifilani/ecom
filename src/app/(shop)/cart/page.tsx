import type { Metadata } from 'next';

import { resolveCartIdentity } from '@/lib/shop';
import { getCartView } from '@/server/cart-service';
import { getStoreConfig } from '@/server/settings-service';

import { CartClient, type CartSnapshot } from './cart-client';

export const metadata: Metadata = {
  title: 'Your basket',
  robots: { index: false, follow: false },
};

/**
 * /cart
 *
 * Rendered server-side so the basket is correct in the first HTML, then handed
 * to a client component that keeps it in step as quantities change.
 */
const CartPage = async () => {
  const [identity, config] = await Promise.all([resolveCartIdentity(), getStoreConfig()]);
  const cart = await getCartView(identity);

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
      // The backorder sentinel is not useful to the UI; cap it at something sane.
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
      <h1 className="text-fg mb-6 text-2xl font-semibold tracking-tight">Your basket</h1>

      <CartClient
        initial={snapshot}
        locale={config.locale}
        freeShippingThreshold={config.freeShippingThresholdMinor}
      />
    </div>
  );
};

export default CartPage;
