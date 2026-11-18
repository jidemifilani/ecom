import type { Metadata } from 'next';
import Link from 'next/link';
import { Package, ShoppingBag } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, StatusBadge } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/navigation';
import { requireCustomer } from '@/lib/auth/current-user';
import { formatMoney } from '@/lib/money';
import { formatDateTime } from '@/lib/utils';
import { listCustomerOrders } from '@/server/order-service';
import { getStoreConfig } from '@/server/settings-service';

export const metadata: Metadata = {
  title: 'Your orders',
  robots: { index: false, follow: false },
};

/**
 * /account/orders
 *
 * Scoped to the signed-in shopper by `listCustomerOrders`, which filters on the
 * session's customer id. There is no path here that could list someone else's
 * orders.
 */
const AccountOrdersPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) => {
  const [session, params, config] = await Promise.all([
    requireCustomer(),
    searchParams,
    getStoreConfig(),
  ]);

  const parsed = Number.parseInt(params.page ?? '1', 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;

  const orders = await listCustomerOrders(session.id, page, 10);

  return (
    <div className="mx-auto w-full max-w-[72rem] px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4">
        <ol className="text-fg-muted flex items-center gap-1.5 text-xs">
          <li>
            <Link href="/account" className="hover:text-fg rounded">
              Your account
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <span className="text-fg font-medium" aria-current="page">
              Orders
            </span>
          </li>
        </ol>
      </nav>

      <h1 className="text-fg mb-6 text-2xl font-semibold tracking-tight">Your orders</h1>

      <Card as="section">
        <CardHeader>
          <CardTitle as="h2">
            {orders.total} order{orders.total === 1 ? '' : 's'}
          </CardTitle>
        </CardHeader>

        {orders.items.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="No orders yet"
            description="Once you place an order it will appear here, with delivery tracking."
            action={
              <Button asChild>
                <Link href="/search">Start shopping</Link>
              </Button>
            }
          />
        ) : (
          <>
            <ul className="divide-line divide-y">
              {orders.items.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/order/${order.number}`}
                    className="hover:bg-surface-sunken flex flex-wrap items-center gap-3 px-5 py-4"
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
                        Placed {formatDateTime(order.placedAt)} &bull; {order.itemCount} item
                        {order.itemCount === 1 ? '' : 's'}
                      </span>
                    </span>

                    <span className="flex shrink-0 flex-wrap gap-1.5">
                      <StatusBadge status={order.status} />
                      <StatusBadge status={order.fulfillmentStatus} />
                    </span>

                    <span className="text-fg shrink-0 text-sm font-semibold">
                      {formatMoney(order.grandTotal, order.currency, config.locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            <Pagination
              page={orders.page}
              pageSize={orders.pageSize}
              total={orders.total}
              totalPages={Math.max(1, Math.ceil(orders.total / orders.pageSize))}
              buildHref={(nextPage) =>
                nextPage === 1 ? '/account/orders' : `/account/orders?page=${nextPage}`
              }
              itemLabel="order"
            />
          </>
        )}
      </Card>
    </div>
  );
};

export default AccountOrdersPage;
