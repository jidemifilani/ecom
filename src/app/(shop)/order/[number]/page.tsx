import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CheckCircle2, Package } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/feedback';
import { NotFoundError } from '@/lib/api/errors';
import { getCurrentCustomer } from '@/lib/auth/current-user';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { getOrderByNumber } from '@/server/order-service';
import { getStoreConfig } from '@/server/settings-service';

export const metadata: Metadata = {
  title: 'Order confirmed',
  robots: { index: false, follow: false },
};

/**
 * /order/[number] -- confirmation and tracking.
 *
 * Access control: a signed-in shopper can only see their own orders (the
 * service scopes by customerId). A guest order is reachable by its number
 * alone, which is a deliberate trade-off -- the alternative is a guest having
 * no way to see what they just bought. Order numbers are sequential, so this
 * page shows no payment detail or personal data beyond what the buyer typed,
 * and nothing here can be acted on.
 */
const OrderConfirmationPage = async ({
  params,
}: {
  params: Promise<{ number: string }>;
}) => {
  const [{ number }, customer, config] = await Promise.all([
    params,
    getCurrentCustomer(),
    getStoreConfig(),
  ]);

  const order = await getOrderByNumber(
    decodeURIComponent(number),
    // Signed-in shoppers are restricted to their own orders.
    customer?.id,
  ).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const money = (minor: number): string => formatMoney(minor, order.currency, config.locale);
  const shipping = order.addresses.find((address) => address.type === 'SHIPPING');
  const shipment = order.shipments[0];

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="text-center">
        <span className="bg-success-soft text-success mx-auto mb-4 grid size-14 place-items-center rounded-full">
          <CheckCircle2 className="size-7" aria-hidden="true" />
        </span>

        <h1 className="text-fg text-2xl font-semibold tracking-tight sm:text-3xl">
          Thank you, your order is confirmed
        </h1>
        <p className="text-fg-muted mt-2 text-sm leading-relaxed">
          Order <span className="text-fg font-mono font-medium">{order.number}</span> was placed
          on {formatDateTime(order.placedAt)}. A confirmation has been sent to{' '}
          <span className="text-fg font-medium">{order.email}</span>.
        </p>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <StatusBadge status={order.status} />
        <StatusBadge status={order.paymentStatus} />
        <StatusBadge status={order.fulfillmentStatus} />
      </div>

      <Card as="section" className="mt-8">
        <CardHeader>
          <CardTitle as="h2">What you ordered</CardTitle>
          <Badge tone="outline">{order.items.length}</Badge>
        </CardHeader>

        <ul className="divide-line divide-y">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 px-5 py-3">
              <span
                aria-hidden="true"
                className="bg-surface-sunken text-fg-subtle grid size-10 shrink-0 place-items-center rounded-md"
              >
                <Package className="size-4" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="text-fg block text-sm font-medium">{item.productName}</span>
                <span className="text-fg-subtle block text-xs">
                  {item.variantName && item.variantName !== 'Default'
                    ? `${item.variantName} - `
                    : ''}
                  {item.sku} - Qty {item.quantity}
                </span>
              </span>

              <span className="text-fg shrink-0 text-sm font-medium">
                {money(item.lineTotal)}
              </span>
            </li>
          ))}
        </ul>

        <CardContent className="border-line border-t pt-4">
          <dl className="ml-auto max-w-xs space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-fg-muted">Subtotal</dt>
              <dd className="text-fg">{money(order.subtotal)}</dd>
            </div>
            {order.discountTotal > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">
                  Discount{order.discountCode ? ` (${order.discountCode})` : ''}
                </dt>
                <dd className="text-success">-{money(order.discountTotal)}</dd>
              </div>
            ) : null}
            {order.taxTotal > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-fg-muted">Tax</dt>
                <dd className="text-fg">{money(order.taxTotal)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between gap-4">
              <dt className="text-fg-muted">Delivery</dt>
              <dd className="text-fg">
                {order.shippingTotal === 0 ? 'Free' : money(order.shippingTotal)}
              </dd>
            </div>
            <div className="border-line flex justify-between gap-4 border-t pt-2 text-base font-semibold">
              <dt>Total</dt>
              <dd>{money(order.grandTotal)}</dd>
            </div>
            {order.refundedTotal > 0 ? (
              <div className="flex justify-between gap-4">
                <dt className="text-warning">Refunded</dt>
                <dd className="text-warning">-{money(order.refundedTotal)}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <Card as="section">
          <CardHeader>
            <CardTitle as="h2">Delivery to</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {shipping ? (
              <address className="text-fg-muted text-sm leading-relaxed not-italic">
                {shipping.firstName} {shipping.lastName}
                <br />
                {shipping.line1}
                {shipping.line2 ? (
                  <>
                    <br />
                    {shipping.line2}
                  </>
                ) : null}
                <br />
                {shipping.city}
                {shipping.state ? `, ${shipping.state}` : ''}
                {shipping.postalCode ? ` ${shipping.postalCode}` : ''}
                <br />
                {shipping.countryCode}
              </address>
            ) : (
              <p className="text-fg-subtle text-sm">No delivery address recorded.</p>
            )}
          </CardContent>
        </Card>

        <Card as="section">
          <CardHeader>
            <CardTitle as="h2">Delivery status</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {shipment ? (
              <div className="text-sm">
                <p className="text-fg font-medium">{shipment.carrier}</p>
                {shipment.trackingNumber ? (
                  <p className="text-fg-muted mt-1 font-mono text-xs">
                    {shipment.trackingNumber}
                  </p>
                ) : null}
                <p className="text-fg-subtle mt-1 text-xs">
                  {shipment.deliveredAt
                    ? `Delivered ${formatDateTime(shipment.deliveredAt)}`
                    : `Dispatched ${formatDateTime(shipment.shippedAt)}`}
                </p>
              </div>
            ) : (
              <p className="text-fg-muted text-sm leading-relaxed">
                Not dispatched yet. You will get an email with tracking details as soon as it
                ships.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button asChild>
          <Link href="/search">Continue shopping</Link>
        </Button>
        {customer ? (
          <Button variant="outline" asChild>
            <Link href="/account/orders">View all your orders</Link>
          </Button>
        ) : (
          <Button variant="outline" asChild>
            <Link href="/account/register">Create an account to track orders</Link>
          </Button>
        )}
      </div>

      {config.supportEmail ? (
        <p className="text-fg-subtle mt-6 text-center text-xs">
          Questions about this order? Email{' '}
          <a
            href={`mailto:${config.supportEmail}?subject=Order ${order.number}`}
            className="text-accent rounded underline-offset-4 hover:underline"
          >
            {config.supportEmail}
          </a>
          .
        </p>
      ) : null}
    </div>
  );
};

export default OrderConfirmationPage;
