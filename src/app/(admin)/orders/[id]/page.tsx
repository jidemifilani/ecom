import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui/card';
import { Alert, Badge, EmptyState, StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import {
  DetailList,
  NumericTD,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableContainer,
} from '@/components/ui/table';
import { NotFoundError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/auth/current-user';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac/guard';
import { formatDateTime } from '@/lib/utils';
import { allowedTransitions, getOrder } from '@/server/order-service';
import { getStoreConfig } from '@/server/settings-service';

import {
  CancelOrderDialog,
  ChangeStatusControl,
  FulfillOrderDialog,
  RecordPaymentDialog,
  RefundOrderDialog,
} from './order-actions';

export const metadata: Metadata = { title: 'Order' };

/**
 * /orders/[id]
 *
 * Line items, addresses, payments, shipments, refunds and the event timeline.
 *
 * Totals are read straight from the order, never recomputed: the order
 * captured what the customer agreed to pay, and a later price or tax change
 * must not retroactively alter it.
 */
const OrderDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const [viewer, { id }] = await Promise.all([requirePermission('order.read'), params]);

  const order = await getOrder(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const config = await getStoreConfig();
  const money = (minor: number): string => formatMoney(minor, order.currency, config.locale);

  const showMoney = can(viewer, 'dashboard.view_financials');

  const shipping = order.addresses.find((address) => address.type === 'SHIPPING');
  const billing = order.addresses.find((address) => address.type === 'BILLING');

  const paidTotal = order.payments
    .filter((payment) => payment.status === 'PAID')
    .reduce((total, payment) => total + payment.amount, 0);

  const outstanding = Math.max(0, order.grandTotal - paidTotal);
  const refundable = Math.max(0, order.grandTotal - order.refundedTotal);

  const outstandingLines = order.items
    .filter((item) => item.quantity > item.quantityFulfilled)
    .map((item) => ({
      id: item.id,
      label: `${item.productName}${item.variantName && item.variantName !== 'Default' ? ` (${item.variantName})` : ''}`,
      outstanding: item.quantity - item.quantityFulfilled,
    }));

  const isClosed = order.status === 'CANCELLED' || order.status === 'REFUNDED';

  const formatAddress = (address: typeof shipping): React.ReactNode => {
    if (!address) return <span className="text-fg-subtle">Not provided</span>;

    return (
      <span className="block not-italic">
        {address.firstName} {address.lastName}
        {address.company ? (
          <>
            <br />
            {address.company}
          </>
        ) : null}
        <br />
        {address.line1}
        {address.line2 ? (
          <>
            <br />
            {address.line2}
          </>
        ) : null}
        <br />
        {address.city}
        {address.state ? `, ${address.state}` : ''}
        {address.postalCode ? ` ${address.postalCode}` : ''}
        <br />
        {address.countryCode}
        {address.phone ? (
          <>
            <br />
            {address.phone}
          </>
        ) : null}
      </span>
    );
  };

  return (
    <>
      <Breadcrumbs items={[{ label: 'Orders', href: '/orders' }, { label: order.number }]} />

      <PageHeader
        title={order.number}
        description={`Placed ${formatDateTime(order.placedAt)} via ${order.channel}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} />
            <StatusBadge status={order.paymentStatus} />
            <StatusBadge status={order.fulfillmentStatus} />
          </div>
        }
      />

      {order.deletedAt ? (
        <Alert tone="warning" title="This order is archived">
          It is hidden from the default order list.
        </Alert>
      ) : null}

      {/* ── Action bar ── */}
      {!isClosed ? (
        <div className="rounded-card border-line bg-surface flex flex-wrap items-center gap-2 border p-3">
          {can(viewer, 'order.fulfill') && outstandingLines.length > 0 ? (
            <FulfillOrderDialog orderId={order.id} outstandingLines={outstandingLines} />
          ) : null}

          {can(viewer, 'order.update') && outstanding > 0 ? (
            <RecordPaymentDialog
              orderId={order.id}
              outstanding={outstanding}
              currency={order.currency}
              locale={config.locale}
            />
          ) : null}

          {can(viewer, 'order.refund') && refundable > 0 && paidTotal > 0 ? (
            <RefundOrderDialog
              orderId={order.id}
              refundable={refundable}
              currency={order.currency}
              locale={config.locale}
            />
          ) : null}

          {can(viewer, 'order.update') ? (
            <ChangeStatusControl
              orderId={order.id}
              currentStatus={order.status}
              allowed={allowedTransitions(order.status)}
            />
          ) : null}

          <div className="ml-auto">
            {can(viewer, 'order.cancel') ? (
              <CancelOrderDialog orderId={order.id} orderNumber={order.number} />
            ) : null}
          </div>
        </div>
      ) : (
        <Alert tone={order.status === 'REFUNDED' ? 'warning' : 'info'}>
          This order is {order.status.toLowerCase()} and can no longer be changed.
          {order.internalNote ? ` Reason: ${order.internalNote}` : ''}
        </Alert>
      )}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {/* ── Items ── */}
          <Card as="section">
            <CardHeader>
              <CardTitle>Items</CardTitle>
              <Badge tone="outline">{order.items.length}</Badge>
            </CardHeader>

            <TableContainer className="rounded-none border-0 border-t">
              <Table caption="Order line items with quantities and totals">
                <THead>
                  <TR>
                    <TH>Item</TH>
                    <TH className="text-right">Unit price</TH>
                    <TH className="text-right">Qty</TH>
                    <TH className="text-right">Shipped</TH>
                    <TH className="text-right">Total</TH>
                  </TR>
                </THead>
                <TBody>
                  {order.items.map((item) => (
                    <TR key={item.id}>
                      <TD>
                        <span className="min-w-0">
                          {item.productId && can(viewer, 'product.read') ? (
                            <Link
                              href={`/catalog/products/${item.productId}`}
                              className="text-fg hover:text-accent block font-medium"
                            >
                              {item.productName}
                            </Link>
                          ) : (
                            <span className="text-fg block font-medium">{item.productName}</span>
                          )}
                          <span className="text-fg-subtle block font-mono text-xs">
                            {item.sku}
                            {item.variantName && item.variantName !== 'Default'
                              ? ` - ${item.variantName}`
                              : ''}
                          </span>
                        </span>
                      </TD>
                      <NumericTD>{showMoney ? money(item.unitPrice) : '-'}</NumericTD>
                      <NumericTD>{item.quantity}</NumericTD>
                      <NumericTD>
                        <span
                          className={
                            item.quantityFulfilled >= item.quantity
                              ? 'text-success'
                              : item.quantityFulfilled > 0
                                ? 'text-warning'
                                : 'text-fg-subtle'
                          }
                        >
                          {item.quantityFulfilled}
                        </span>
                      </NumericTD>
                      <NumericTD className="font-medium">
                        {showMoney ? money(item.lineTotal) : '-'}
                      </NumericTD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </TableContainer>

            {showMoney ? (
              <CardContent className="border-line border-t pt-4">
                <dl className="ml-auto max-w-xs space-y-1.5 text-sm">
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
                    <dt className="text-fg-muted">Shipping</dt>
                    <dd className="text-fg">
                      {order.shippingTotal === 0 ? 'Free' : money(order.shippingTotal)}
                    </dd>
                  </div>
                  <div className="border-line flex justify-between gap-4 border-t pt-1.5 text-base font-semibold">
                    <dt>Total</dt>
                    <dd>{money(order.grandTotal)}</dd>
                  </div>
                  {order.refundedTotal > 0 ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-warning">Refunded</dt>
                      <dd className="text-warning">-{money(order.refundedTotal)}</dd>
                    </div>
                  ) : null}
                  {outstanding > 0 ? (
                    <div className="flex justify-between gap-4 font-medium">
                      <dt className="text-danger">Outstanding</dt>
                      <dd className="text-danger">{money(outstanding)}</dd>
                    </div>
                  ) : null}
                </dl>
              </CardContent>
            ) : null}
          </Card>

          {/* ── Payments ── */}
          <Card as="section">
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>

            {order.payments.length === 0 ? (
              <EmptyState title="No payments recorded" description="This order is unpaid." />
            ) : (
              <ul className="divide-line divide-y">
                {order.payments.map((payment) => (
                  <li key={payment.id} className="flex items-start gap-3 px-5 py-3">
                    <StatusBadge status={payment.status} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="text-fg block text-sm font-medium">
                        {showMoney ? money(payment.amount) : 'Payment'} via{' '}
                        {payment.provider.toLowerCase().replace(/_/g, ' ')}
                      </span>
                      <span className="text-fg-subtle block text-xs">
                        {formatDateTime(payment.capturedAt ?? payment.createdAt)}
                        {payment.reference ? ` - ${payment.reference}` : ''}
                      </span>
                      {payment.failureReason ? (
                        <span className="text-danger block text-xs">
                          {payment.failureReason}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ── Shipments ── */}
          <Card as="section">
            <CardHeader>
              <CardTitle>Shipments</CardTitle>
            </CardHeader>

            {order.shipments.length === 0 ? (
              <EmptyState
                title="Nothing shipped yet"
                description="Create a shipment to mark items as dispatched."
              />
            ) : (
              <ul className="divide-line divide-y">
                {order.shipments.map((shipment) => (
                  <li key={shipment.id} className="flex items-start gap-3 px-5 py-3">
                    <StatusBadge status={shipment.status} className="mt-0.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="text-fg block text-sm font-medium">{shipment.carrier}</span>
                      {shipment.trackingNumber ? (
                        <span className="text-fg-muted block font-mono text-xs">
                          {shipment.trackingNumber}
                        </span>
                      ) : null}
                      <span className="text-fg-subtle block text-xs">
                        Shipped {formatDateTime(shipment.shippedAt)}
                        {shipment.deliveredAt
                          ? ` - delivered ${formatDateTime(shipment.deliveredAt)}`
                          : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {order.refunds.length > 0 ? (
            <Card as="section">
              <CardHeader>
                <CardTitle>Refunds</CardTitle>
              </CardHeader>
              <ul className="divide-line divide-y">
                {order.refunds.map((refund) => (
                  <li key={refund.id} className="px-5 py-3">
                    <p className="text-fg text-sm font-medium">
                      {showMoney ? money(refund.amount) : 'Refund'}
                      {refund.restock ? ' (restocked)' : ''}
                    </p>
                    <p className="text-fg-muted mt-0.5 text-sm">{refund.reason}</p>
                    <p className="text-fg-subtle mt-0.5 text-xs">
                      {formatDateTime(refund.createdAt)}
                      {refund.createdBy
                        ? ` by ${refund.createdBy.firstName} ${refund.createdBy.lastName}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card as="section">
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DetailList
                items={[
                  {
                    label: 'Name',
                    value: order.customer ? (
                      can(viewer, 'customer.read') ? (
                        <Link
                          href={`/customers/${order.customer.id}`}
                          className="text-accent rounded underline-offset-4 hover:underline"
                        >
                          {order.customer.firstName} {order.customer.lastName}
                        </Link>
                      ) : (
                        `${order.customer.firstName} ${order.customer.lastName}`
                      )
                    ) : (
                      <Badge tone="outline">Guest checkout</Badge>
                    ),
                  },
                  { label: 'Email', value: <span className="break-all">{order.email}</span> },
                  {
                    label: 'Phone',
                    value: order.phone ?? <span className="text-fg-subtle">Not provided</span>,
                  },
                  {
                    label: 'IP address',
                    value: order.ipAddress ?? <span className="text-fg-subtle">Unknown</span>,
                  },
                ]}
              />
            </CardContent>
          </Card>

          <Card as="section">
            <CardHeader>
              <CardTitle>Addresses</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
              <div>
                <h3 className="text-fg-subtle text-xs font-semibold tracking-wider uppercase">
                  Shipping
                </h3>
                <address className="text-fg mt-1.5 text-sm leading-relaxed">
                  {formatAddress(shipping)}
                </address>
              </div>

              <div className="border-line border-t pt-4">
                <h3 className="text-fg-subtle text-xs font-semibold tracking-wider uppercase">
                  Billing
                </h3>
                <address className="text-fg mt-1.5 text-sm leading-relaxed">
                  {formatAddress(billing)}
                </address>
              </div>
            </CardContent>
          </Card>

          {order.customerNote || order.internalNote ? (
            <Card as="section">
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {order.customerNote ? (
                  <div>
                    <h3 className="text-fg-subtle text-xs font-semibold tracking-wider uppercase">
                      From the customer
                    </h3>
                    <p className="text-fg mt-1 text-sm leading-relaxed">{order.customerNote}</p>
                  </div>
                ) : null}
                {order.internalNote ? (
                  <div>
                    <h3 className="text-fg-subtle text-xs font-semibold tracking-wider uppercase">
                      Internal
                    </h3>
                    <p className="text-fg mt-1 text-sm leading-relaxed">{order.internalNote}</p>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card as="section">
            <CardHeader>
              <CardTitle>Timeline</CardTitle>
            </CardHeader>

            {order.events.length === 0 ? (
              <EmptyState title="No events recorded" />
            ) : (
              <ol className="divide-line divide-y">
                {order.events.map((event) => (
                  <li key={event.id} className="px-5 py-3">
                    <p className="text-fg text-sm leading-relaxed">{event.message}</p>
                    <p className="text-fg-subtle mt-0.5 text-xs">
                      {formatDateTime(event.createdAt)}
                      {event.createdBy
                        ? ` - ${event.createdBy.firstName} ${event.createdBy.lastName}`
                        : ''}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
};

export default OrderDetailPage;
