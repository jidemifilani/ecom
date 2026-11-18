import type { Metadata } from 'next';
import Link from 'next/link';
import { MapPin, Package, ShoppingBag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import { Badge, EmptyState, StatusBadge } from '@/components/ui/feedback';
import { DetailList } from '@/components/ui/table';
import { requireCustomer } from '@/lib/auth/current-user';
import { formatMoney } from '@/lib/money';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { getCustomer } from '@/server/customer-service';
import { listCustomerOrders } from '@/server/order-service';
import { getStoreConfig } from '@/server/settings-service';

import { CustomerSignOutButton } from './account-forms';

export const metadata: Metadata = {
  title: 'Your account',
  robots: { index: false, follow: false },
};

/**
 * /account -- shopper overview.
 *
 * `requireCustomer` resolves the shopper session against the database, so this
 * is the real guard; the edge proxy only redirects on a missing cookie.
 */
const AccountPage = async () => {
  const session = await requireCustomer();

  const [customer, orders, config] = await Promise.all([
    getCustomer(session.id),
    listCustomerOrders(session.id, 1, 5),
    getStoreConfig(),
  ]);

  const money = (minor: number, currency: string): string =>
    formatMoney(minor, currency, config.locale);

  return (
    <div className="mx-auto w-full max-w-[72rem] px-4 py-8 sm:px-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            Hello, {customer.firstName}
          </h1>
          <p className="text-fg-muted mt-1 text-sm">{customer.email}</p>
        </div>
        <CustomerSignOutButton />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Orders placed" value={formatNumber(customer.stats.orderCount)} />
        <StatCard
          label="Total spent"
          value={money(customer.stats.lifetimeValue, customer.stats.currency)}
          comparisonLabel="Net of refunds"
        />
        <StatCard
          label="Saved addresses"
          value={formatNumber(customer.addresses.length)}
        />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_20rem]">
        <Card as="section">
          <CardHeader>
            <CardTitle as="h2">Recent orders</CardTitle>
            {orders.total > 5 ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/account/orders">View all {orders.total}</Link>
              </Button>
            ) : null}
          </CardHeader>

          {orders.items.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="No orders yet"
              description="When you place an order it will appear here with its delivery status."
              action={
                <Button asChild>
                  <Link href="/search">Start shopping</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-line divide-y">
              {orders.items.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/order/${order.number}`}
                    className="hover:bg-surface-sunken flex items-center gap-3 px-5 py-3.5"
                  >
                    <span
                      aria-hidden="true"
                      className="bg-surface-sunken text-fg-subtle grid size-10 shrink-0 place-items-center rounded-md"
                    >
                      <Package className="size-4" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="text-fg block font-mono text-sm font-medium">
                        {order.number}
                      </span>
                      <span className="text-fg-subtle block text-xs">
                        {formatDateTime(order.placedAt)} &bull; {order.itemCount} item
                        {order.itemCount === 1 ? '' : 's'}
                      </span>
                    </span>

                    <span className="hidden shrink-0 sm:block">
                      <StatusBadge status={order.status} />
                    </span>

                    <span className="text-fg shrink-0 text-sm font-medium">
                      {money(order.grandTotal, order.currency)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card as="section">
            <CardHeader>
              <CardTitle as="h2">Your details</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DetailList
                items={[
                  { label: 'Name', value: customer.fullName },
                  { label: 'Email', value: <span className="break-all">{customer.email}</span> },
                  { label: 'Phone', value: customer.phone ?? 'Not provided' },
                  {
                    label: 'Marketing',
                    value: customer.marketingOptIn ? (
                      <Badge tone="success">Opted in</Badge>
                    ) : (
                      'Not opted in'
                    ),
                  },
                  { label: 'Member since', value: formatDateTime(customer.createdAt) },
                ]}
              />
              <p className="text-fg-subtle mt-3 text-xs leading-relaxed">
                To change your details, contact us
                {config.supportEmail ? ` at ${config.supportEmail}` : ''}.
              </p>
            </CardContent>
          </Card>

          <Card as="section">
            <CardHeader>
              <CardTitle as="h2">Addresses</CardTitle>
              <Badge tone="outline">{customer.addresses.length}</Badge>
            </CardHeader>

            {customer.addresses.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="No saved addresses"
                description="Your delivery address is saved automatically at checkout."
              />
            ) : (
              <ul className="divide-line divide-y">
                {customer.addresses.map((address) => (
                  <li key={address.id} className="px-5 py-3">
                    <div className="mb-1 flex flex-wrap gap-1.5">
                      {address.isDefaultShipping ? (
                        <Badge tone="accent">Default delivery</Badge>
                      ) : null}
                      {address.isDefaultBilling ? (
                        <Badge tone="outline">Default billing</Badge>
                      ) : null}
                    </div>
                    <address className="text-fg-muted text-sm leading-relaxed not-italic">
                      {address.firstName} {address.lastName}
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
                      {address.postalCode ? ` ${address.postalCode}` : ''}
                      <br />
                      {address.countryCode}
                    </address>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

export default AccountPage;
