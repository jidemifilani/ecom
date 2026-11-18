import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { MapPin, ShoppingCart } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, PageHeader, StatCard } from '@/components/ui/card';
import { Badge, EmptyState, StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { DetailList } from '@/components/ui/table';
import { NotFoundError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/auth/current-user';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac/guard';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { getCustomer } from '@/server/customer-service';
import { listCustomerOrders } from '@/server/order-service';
import { getStoreConfig } from '@/server/settings-service';

import { CustomerForm } from '../customer-form';

export const metadata: Metadata = { title: 'Customer' };

const CustomerDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const [viewer, { id }] = await Promise.all([requirePermission('customer.read'), params]);

  const customer = await getCustomer(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const [orders, config] = await Promise.all([
    can(viewer, 'order.read') ? listCustomerOrders(id, 1, 10) : Promise.resolve(null),
    getStoreConfig(),
  ]);

  const showMoney = can(viewer, 'dashboard.view_financials');
  const canEdit = can(viewer, 'customer.update');
  const money = (minor: number): string =>
    formatMoney(minor, customer.stats.currency, config.locale);

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Customers', href: '/customers' }, { label: customer.fullName }]}
      />

      <PageHeader
        title={customer.fullName}
        description={customer.email}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={customer.deletedAt ? 'ARCHIVED' : customer.status} />
            <Badge tone={customer.hasAccount ? 'accent' : 'outline'}>
              {customer.hasAccount ? 'Registered' : 'Guest only'}
            </Badge>
          </div>
        }
      />

      {showMoney ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Lifetime value"
            value={money(customer.stats.lifetimeValue)}
            comparisonLabel="Paid orders, net of refunds"
          />
          <StatCard label="Orders" value={formatNumber(customer.stats.orderCount)} />
          <StatCard
            label="Average order"
            value={money(customer.stats.averageOrderValue)}
          />
          <StatCard
            label="Last order"
            value={
              customer.stats.lastOrderAt
                ? formatDateTime(customer.stats.lastOrderAt).split(',')[0] ?? '-'
                : 'Never'
            }
          />
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {canEdit ? (
            <CustomerForm
              mode="edit"
              initial={{
                id: customer.id,
                email: customer.email,
                firstName: customer.firstName,
                lastName: customer.lastName,
                phone: customer.phone,
                status: customer.status,
                marketingOptIn: customer.marketingOptIn,
                notes: customer.notes,
                isArchived: customer.deletedAt !== null,
              }}
              canDelete={can(viewer, 'customer.delete')}
            />
          ) : (
            <Card as="section">
              <CardHeader>
                <CardTitle>Details</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <DetailList
                  items={[
                    { label: 'Name', value: customer.fullName },
                    { label: 'Email', value: <span className="break-all">{customer.email}</span> },
                    { label: 'Phone', value: customer.phone ?? '-' },
                    { label: 'Marketing', value: customer.marketingOptIn ? 'Opted in' : 'No' },
                    { label: 'Notes', value: customer.notes ?? '-' },
                  ]}
                />
              </CardContent>
            </Card>
          )}

          {orders ? (
            <Card as="section">
              <CardHeader>
                <CardTitle>Order history</CardTitle>
                {orders.total > 0 ? (
                  <Button variant="ghost" size="sm" asChild>
                    <Link href={`/orders?customerId=${customer.id}`}>
                      View all {orders.total}
                    </Link>
                  </Button>
                ) : null}
              </CardHeader>

              {orders.items.length === 0 ? (
                <EmptyState
                  icon={ShoppingCart}
                  title="No orders yet"
                  description="This customer has not placed an order."
                />
              ) : (
                <ul className="divide-line divide-y">
                  {orders.items.map((order) => (
                    <li key={order.id}>
                      <Link
                        href={`/orders/${order.id}`}
                        className="hover:bg-surface-sunken flex items-center gap-3 px-5 py-3"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="text-fg block font-mono text-sm font-medium">
                            {order.number}
                          </span>
                          <span className="text-fg-subtle block text-xs">
                            {formatDateTime(order.placedAt)} &bull; {order.itemCount} item
                            {order.itemCount === 1 ? '' : 's'}
                          </span>
                        </span>

                        <StatusBadge status={order.status} className="hidden sm:inline-flex" />

                        {showMoney ? (
                          <span className="text-fg shrink-0 text-sm font-medium">
                            {formatMoney(order.grandTotal, order.currency, config.locale)}
                          </span>
                        ) : (
                          <StatusBadge status={order.paymentStatus} />
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card as="section">
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <DetailList
                items={[
                  {
                    label: 'Storefront login',
                    value: customer.hasAccount ? 'Password set' : 'No password (guest)',
                  },
                  { label: 'Last sign-in', value: formatDateTime(customer.lastLoginAt) },
                  { label: 'Registered', value: formatDateTime(customer.createdAt) },
                  { label: 'Last updated', value: formatDateTime(customer.updatedAt) },
                ]}
              />
            </CardContent>
          </Card>

          <Card as="section">
            <CardHeader>
              <CardTitle>Addresses</CardTitle>
              <Badge tone="outline">{customer.addresses.length}</Badge>
            </CardHeader>

            {customer.addresses.length === 0 ? (
              <EmptyState
                icon={MapPin}
                title="No saved addresses"
                description="Addresses are saved when the customer checks out."
              />
            ) : (
              <ul className="divide-line divide-y">
                {customer.addresses.map((address) => (
                  <li key={address.id} className="px-5 py-3">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      {address.label ? (
                        <span className="text-fg text-sm font-medium">{address.label}</span>
                      ) : null}
                      {address.isDefaultShipping ? (
                        <Badge tone="accent">Default shipping</Badge>
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
                      {address.state ? `, ${address.state}` : ''}
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
    </>
  );
};

export default CustomerDetailPage;
