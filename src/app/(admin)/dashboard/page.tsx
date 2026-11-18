import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  CircleDollarSign,
  Package,
  PackageX,
  Plus,
  ShoppingCart,
  Star,
  TrendingUp,
  Truck,
  UserPlus,
  Users,
} from 'lucide-react';

import { SalesTrendChart, StatusMixChart, TopProductsChart } from '@/components/charts/sales-chart';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, PageHeader, StatCard } from '@/components/ui/card';
import { Badge, EmptyState, StatusBadge } from '@/components/ui/feedback';
import { LinkTabs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/guard';
import { formatMoney } from '@/lib/money';
import { formatDateTime, formatNumber } from '@/lib/utils';
import { getDashboardData, type DashboardRange } from '@/server/dashboard-service';

export const metadata: Metadata = { title: 'Dashboard' };

const RANGES: { value: DashboardRange; label: string }[] = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '12 months' },
];

/**
 * /dashboard
 *
 * What a user sees here depends on their permissions:
 *  * `dashboard.view_financials` reveals revenue, average order value and
 *    product revenue. Without it the service returns those figures zeroed and
 *    the page omits the cards entirely, rather than showing a misleading 0.
 *  * Quick actions and alert cards are filtered to the things the user can
 *    actually act on, so fulfilment staff get a worklist rather than links
 *    that would 403.
 */
const DashboardPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) => {
  const [user, params] = await Promise.all([requirePermission('dashboard.view'), searchParams]);

  const requested = Number.parseInt(params.range ?? '30', 10);
  const rangeDays = (RANGES.some((range) => range.value === requested)
    ? requested
    : 30) as DashboardRange;

  const showMoney = can(user, 'dashboard.view_financials');
  const data = await getDashboardData(rangeDays, { includeFinancials: showMoney });

  const money = (minor: number): string => formatMoney(minor, data.currency, data.locale);
  const comparison = `vs previous ${rangeDays} days`;

  const quickActions = [
    can(user, 'product.create')
      ? { href: '/catalog/products/new', label: 'Add product', icon: Package }
      : null,
    can(user, 'order.create') ? { href: '/orders/new', label: 'Create order', icon: ShoppingCart } : null,
    can(user, 'customer.create') ? { href: '/customers/new', label: 'Add customer', icon: UserPlus } : null,
    can(user, 'inventory.adjust') ? { href: '/inventory', label: 'Adjust stock', icon: TrendingUp } : null,
  ].filter((action): action is NonNullable<typeof action> => action !== null);

  const alerts = [
    data.counts.unfulfilledOrders > 0 && can(user, 'order.read')
      ? {
          href: '/orders?fulfillmentStatus=UNFULFILLED',
          icon: Truck,
          tone: 'warning' as const,
          label: 'Orders awaiting fulfilment',
          value: data.counts.unfulfilledOrders,
        }
      : null,
    data.counts.outOfStockVariants > 0 && can(user, 'inventory.read')
      ? {
          href: '/inventory?outOfStock=true',
          icon: PackageX,
          tone: 'danger' as const,
          label: 'Variants out of stock',
          value: data.counts.outOfStockVariants,
        }
      : null,
    data.counts.lowStockVariants > 0 && can(user, 'inventory.read')
      ? {
          href: '/inventory?lowStock=true',
          icon: AlertTriangle,
          tone: 'warning' as const,
          label: 'Variants running low',
          value: data.counts.lowStockVariants,
        }
      : null,
    data.counts.pendingReviews > 0 && can(user, 'review.read')
      ? {
          href: '/catalog/reviews?status=PENDING',
          icon: Star,
          tone: 'info' as const,
          label: 'Reviews awaiting approval',
          value: data.counts.pendingReviews,
        }
      : null,
  ].filter((alert): alert is NonNullable<typeof alert> => alert !== null);

  return (
    <>
      <PageHeader
        title={`Welcome back, ${user.firstName}`}
        description="Trading performance and anything that needs attention today."
        actions={
          quickActions.length > 0 ? (
            <>
              {quickActions.slice(0, 1).map((action) => (
                <Button key={action.href} asChild>
                  <Link href={action.href}>
                    <Plus aria-hidden="true" />
                    {action.label}
                  </Link>
                </Button>
              ))}
            </>
          ) : undefined
        }
      />

      <LinkTabs
        items={RANGES.map((range) => ({
          label: range.label,
          href: `/dashboard?range=${range.value}`,
          active: range.value === rangeDays,
        }))}
      />

      {/* ── KPIs ── */}
      <section aria-labelledby="kpi-heading" className="space-y-3">
        <h2 id="kpi-heading" className="sr-only">
          Key figures for the last {rangeDays} days
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {showMoney ? (
            <StatCard
              label="Net revenue"
              value={money(data.revenue.value)}
              changePercent={data.revenue.changePercent}
              comparisonLabel={comparison}
              icon={<CircleDollarSign className="size-4" />}
            />
          ) : null}

          <StatCard
            label="Orders"
            value={formatNumber(data.orders.value)}
            changePercent={data.orders.changePercent}
            comparisonLabel={comparison}
            icon={<ShoppingCart className="size-4" />}
          />

          {showMoney ? (
            <StatCard
              label="Average order value"
              value={money(data.averageOrderValue.value)}
              changePercent={data.averageOrderValue.changePercent}
              comparisonLabel={comparison}
              icon={<TrendingUp className="size-4" />}
            />
          ) : null}

          <StatCard
            label="New customers"
            value={formatNumber(data.newCustomers.value)}
            changePercent={data.newCustomers.changePercent}
            comparisonLabel={comparison}
            icon={<Users className="size-4" />}
          />

          {!showMoney ? (
            <StatCard
              label="Active products"
              value={formatNumber(data.counts.activeProducts)}
              comparisonLabel={`${data.counts.draftProducts} in draft`}
              icon={<Package className="size-4" />}
            />
          ) : null}
        </div>
      </section>

      {/* ── Needs attention ── */}
      {alerts.length > 0 ? (
        <section aria-labelledby="alerts-heading">
          <h2 id="alerts-heading" className="text-fg mb-3 text-sm font-semibold">
            Needs attention
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {alerts.map((alert) => (
              <li key={alert.href}>
                <Link
                  href={alert.href}
                  className="rounded-card border-line bg-surface hover:border-line-strong shadow-card flex items-center gap-3 border p-4 transition-colors"
                >
                  <span
                    aria-hidden="true"
                    className={
                      alert.tone === 'danger'
                        ? 'bg-danger-soft text-danger grid size-9 shrink-0 place-items-center rounded-full'
                        : alert.tone === 'warning'
                          ? 'bg-warning-soft text-warning grid size-9 shrink-0 place-items-center rounded-full'
                          : 'bg-info-soft text-info grid size-9 shrink-0 place-items-center rounded-full'
                    }
                  >
                    <alert.icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-fg block text-lg font-semibold">
                      {formatNumber(alert.value)}
                    </span>
                    <span className="text-fg-muted block text-xs leading-snug">
                      {alert.label}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── Charts ── */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{showMoney ? 'Revenue and orders' : 'Order volume'}</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesTrendChart
              data={data.salesSeries}
              currency={data.currency}
              locale={data.locale}
              showRevenue={showMoney}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusMixChart data={data.statusBreakdown} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Recent orders */}
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
            {can(user, 'order.read') ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/orders">View all</Link>
              </Button>
            ) : null}
          </CardHeader>

          {data.recentOrders.length === 0 ? (
            <EmptyState
              icon={ShoppingCart}
              title="No orders yet"
              description="Orders placed on the storefront will appear here."
            />
          ) : (
            <ul className="divide-line divide-y">
              {data.recentOrders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={can(user, 'order.read') ? `/orders/${order.id}` : '#'}
                    className="hover:bg-surface-sunken flex items-center gap-3 px-5 py-3"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="text-fg block truncate text-sm font-medium">
                        {order.number}
                      </span>
                      <span className="text-fg-muted block truncate text-xs">
                        {order.customerName} &bull; {formatDateTime(order.placedAt)}
                      </span>
                    </span>

                    <span className="hidden shrink-0 sm:block">
                      <StatusBadge status={order.status} />
                    </span>

                    {showMoney ? (
                      <span className="text-fg shrink-0 text-sm font-medium">
                        {money(order.grandTotal)}
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

        {/* Top products */}
        <Card>
          <CardHeader>
            <CardTitle>Best sellers</CardTitle>
          </CardHeader>
          <CardContent>
            <TopProductsChart
              data={data.topProducts.map((product) => ({
                name: product.name,
                unitsSold: product.unitsSold,
                revenue: product.revenue,
              }))}
              currency={data.currency}
              locale={data.locale}
              showRevenue={showMoney}
            />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Quick actions */}
        {quickActions.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Quick actions</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {quickActions.map((action) => (
                <Button key={action.href} variant="outline" size="sm" asChild className="justify-start">
                  <Link href={action.href}>
                    <action.icon aria-hidden="true" />
                    <span className="truncate">{action.label}</span>
                  </Link>
                </Button>
              ))}
            </CardContent>
          </Card>
        ) : null}

        {/* Recent activity */}
        <Card className={quickActions.length > 0 ? 'xl:col-span-2' : 'xl:col-span-3'}>
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            {can(user, 'audit_log.read') ? (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/audit-logs">Full audit log</Link>
              </Button>
            ) : null}
          </CardHeader>

          {data.recentActivity.length === 0 ? (
            <EmptyState title="No activity recorded yet" />
          ) : (
            <ul className="divide-line divide-y">
              {data.recentActivity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 px-5 py-3">
                  <Badge tone="outline" className="mt-0.5 shrink-0">
                    {entry.action.toLowerCase().replace(/_/g, ' ')}
                  </Badge>
                  <span className="min-w-0 flex-1">
                    <span className="text-fg block truncate text-sm">
                      {entry.entityLabel ?? entry.entityType}
                    </span>
                    <span className="text-fg-subtle block truncate text-xs">
                      {entry.actorName ?? entry.actorEmail ?? 'System'} &bull;{' '}
                      {formatDateTime(entry.createdAt)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
};

export default DashboardPage;
