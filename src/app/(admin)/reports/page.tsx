import type { Metadata } from 'next';
import { BarChart3 } from 'lucide-react';

import { SalesTrendChart, StatusMixChart } from '@/components/charts/sales-chart';
import { FilterBar } from '@/components/data/filter-bar';
import { Card, CardContent, CardHeader, CardTitle, PageHeader, StatCard } from '@/components/ui/card';
import { Alert, EmptyState } from '@/components/ui/feedback';
import { Breadcrumbs, LinkTabs } from '@/components/ui/navigation';
import {
  NumericTD,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableContainer,
} from '@/components/ui/table';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { formatMoney } from '@/lib/money';
import { can } from '@/lib/rbac/guard';
import { toSearchParams } from '@/lib/url';
import { formatDate, formatNumber } from '@/lib/utils';
import {
  getCustomerReport,
  getDiscountReport,
  getInventoryValuation,
  getProductPerformance,
  getSalesSummary,
  resolveRange,
} from '@/server/report-service';

export const metadata: Metadata = { title: 'Reports' };

type ReportTab = 'sales' | 'products' | 'inventory' | 'customers' | 'discounts';

const TABS: { value: ReportTab; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'products', label: 'Products' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'customers', label: 'Customers' },
  { value: 'discounts', label: 'Discounts' },
];

/**
 * /reports
 *
 * Every money figure uses one definition -- paid orders, net of refunds,
 * cancelled excluded -- shared with the dashboard. That is what makes two
 * reports reconcile rather than quietly disagree.
 *
 * Users without `dashboard.view_financials` get the operational reports
 * (inventory, product units) and are told plainly that revenue is withheld,
 * rather than being shown zeros that look like a bad month.
 */
const ReportsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('report.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const requested = params.get('tab') ?? 'sales';
  const tab: ReportTab = TABS.some((entry) => entry.value === requested)
    ? (requested as ReportTab)
    : 'sales';

  const query = safeListQuery(params, { sortable: ['createdAt'] as const });
  const range = resolveRange(query.dateFrom, query.dateTo, 30);

  const showMoney = can(viewer, 'dashboard.view_financials');

  const tabHref = (value: ReportTab): string => {
    const next = new URLSearchParams(params.toString());
    next.set('tab', value);
    next.delete('page');
    return `/reports?${next.toString()}`;
  };

  return (
    <>
      <Breadcrumbs items={[{ label: 'Reports' }]} />

      <PageHeader
        title="Reports"
        description={`Figures for ${formatDate(range.from)} to ${formatDate(range.to)}. Revenue counts paid orders only, net of refunds.`}
      />

      <LinkTabs
        items={TABS.map((entry) => ({
          label: entry.label,
          href: tabHref(entry.value),
          active: entry.value === tab,
        }))}
      />

      <FilterBar searchPlaceholder="Search" showDateRange />

      {!showMoney && tab !== 'inventory' ? (
        <Alert tone="info" title="Revenue is hidden for your role">
          You can see volumes and operational figures. Money requires the &quot;See revenue,
          margin and payout figures&quot; permission.
        </Alert>
      ) : null}

      {tab === 'sales' ? <SalesReport range={range} showMoney={showMoney} /> : null}
      {tab === 'products' ? <ProductReport range={range} showMoney={showMoney} /> : null}
      {tab === 'inventory' ? <InventoryReport /> : null}
      {tab === 'customers' ? <CustomerReport range={range} showMoney={showMoney} /> : null}
      {tab === 'discounts' ? <DiscountReport range={range} showMoney={showMoney} /> : null}
    </>
  );
};

// ── Sales ────────────────────────────────────────────────────────────────────

const SalesReport = async ({
  range,
  showMoney,
}: {
  range: { from: Date; to: Date };
  showMoney: boolean;
}) => {
  const summary = await getSalesSummary(range);
  const money = (minor: number): string =>
    formatMoney(minor, summary.currency, summary.locale);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {showMoney ? (
          <>
            <StatCard label="Net revenue" value={money(summary.netRevenue)} />
            <StatCard
              label="Refunds"
              value={money(summary.refunds)}
              invertTrend
              comparisonLabel="Lower is better"
            />
          </>
        ) : null}
        <StatCard label="Orders" value={formatNumber(summary.orderCount)} />
        <StatCard label="Units sold" value={formatNumber(summary.unitsSold)} />
        {showMoney ? (
          <StatCard label="Average order" value={money(summary.averageOrderValue)} />
        ) : null}
      </div>

      {showMoney ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard label="Discounts given" value={money(summary.discounts)} />
          <StatCard label="Tax collected" value={money(summary.tax)} />
          <StatCard label="Shipping charged" value={money(summary.shipping)} />
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>{showMoney ? 'Revenue and orders' : 'Order volume'}</CardTitle>
          </CardHeader>
          <CardContent>
            <SalesTrendChart
              data={summary.series}
              currency={summary.currency}
              locale={summary.locale}
              showRevenue={showMoney}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Orders by status</CardTitle>
          </CardHeader>
          <CardContent>
            <StatusMixChart
              data={summary.byStatus.map((row) => ({ status: row.status, count: row.count }))}
            />
          </CardContent>
        </Card>
      </div>

      {showMoney && summary.byPaymentProvider.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Payments by method</CardTitle>
          </CardHeader>
          <TableContainer className="rounded-none border-0 border-t">
            <Table caption="Captured payments grouped by method">
              <THead>
                <TR>
                  <TH>Method</TH>
                  <TH className="text-right">Payments</TH>
                  <TH className="text-right">Value</TH>
                </TR>
              </THead>
              <TBody>
                {summary.byPaymentProvider.map((row) => (
                  <TR key={row.provider}>
                    <TD>{row.provider.toLowerCase().replace(/_/g, ' ')}</TD>
                    <NumericTD>{formatNumber(row.count)}</NumericTD>
                    <NumericTD className="font-medium">{money(row.value)}</NumericTD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        </Card>
      ) : null}
    </>
  );
};

// ── Products ─────────────────────────────────────────────────────────────────

const ProductReport = async ({
  range,
  showMoney,
}: {
  range: { from: Date; to: Date };
  showMoney: boolean;
}) => {
  const [rows, summary] = await Promise.all([
    getProductPerformance(range, 100),
    getSalesSummary(range),
  ]);

  const money = (minor: number): string =>
    formatMoney(minor, summary.currency, summary.locale);

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={BarChart3}
          title="No sales in this period"
          description="Widen the date range, or wait for the first order."
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Product performance</CardTitle>
      </CardHeader>

      <TableContainer className="rounded-none border-0 border-t">
        <Table caption="Products ranked by revenue, with units sold and discount given">
          <THead>
            <TR>
              <TH>Product</TH>
              <TH>SKU</TH>
              <TH className="text-right">Units</TH>
              <TH className="text-right">Orders</TH>
              {showMoney ? (
                <>
                  <TH className="text-right">Discount</TH>
                  <TH className="text-right">Revenue</TH>
                </>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={`${row.productId ?? 'deleted'}-${row.sku}`}>
                <TD className="font-medium">{row.name}</TD>
                <TD className="font-mono text-xs">{row.sku}</TD>
                <NumericTD>{formatNumber(row.unitsSold)}</NumericTD>
                <NumericTD>{formatNumber(row.orderCount)}</NumericTD>
                {showMoney ? (
                  <>
                    <NumericTD>
                      {row.discountGiven > 0 ? (
                        <span className="text-warning">{money(row.discountGiven)}</span>
                      ) : (
                        <span className="text-fg-subtle">-</span>
                      )}
                    </NumericTD>
                    <NumericTD className="font-medium">{money(row.revenue)}</NumericTD>
                  </>
                ) : null}
              </TR>
            ))}
          </TBody>
        </Table>
      </TableContainer>
    </Card>
  );
};

// ── Inventory ────────────────────────────────────────────────────────────────

const InventoryReport = async () => {
  const valuation = await getInventoryValuation({ limit: 500 });
  const money = (minor: number): string =>
    formatMoney(minor, valuation.currency, valuation.locale);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Units on hand" value={formatNumber(valuation.totalUnits)} />
        <StatCard label="Value at cost" value={money(valuation.totalCostValue)} />
        <StatCard label="Value at retail" value={money(valuation.totalRetailValue)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Stock valuation</CardTitle>
          <span className="text-fg-subtle text-xs">Lowest stock first</span>
        </CardHeader>

        {valuation.rows.length === 0 ? (
          <EmptyState title="No stock records" />
        ) : (
          <TableContainer className="rounded-none border-0 border-t">
            <Table caption="Stock by variant with cost and retail valuation">
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH>SKU</TH>
                  <TH className="text-right">On hand</TH>
                  <TH className="text-right">Reserved</TH>
                  <TH className="text-right">Cost value</TH>
                  <TH className="text-right">Retail value</TH>
                </TR>
              </THead>
              <TBody>
                {valuation.rows.map((row) => (
                  <TR key={row.variantId}>
                    <TD className="font-medium">{row.productName}</TD>
                    <TD className="font-mono text-xs">{row.sku}</TD>
                    <NumericTD>
                      <span className={row.isLow ? 'text-warning font-medium' : undefined}>
                        {formatNumber(row.quantityOnHand)}
                      </span>
                    </NumericTD>
                    <NumericTD>{formatNumber(row.quantityReserved)}</NumericTD>
                    <NumericTD>
                      {row.costPrice === null ? (
                        <span className="text-fg-subtle">No cost set</span>
                      ) : (
                        money(row.costValue)
                      )}
                    </NumericTD>
                    <NumericTD className="font-medium">{money(row.retailValue)}</NumericTD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </>
  );
};

// ── Customers ────────────────────────────────────────────────────────────────

const CustomerReport = async ({
  range,
  showMoney,
}: {
  range: { from: Date; to: Date };
  showMoney: boolean;
}) => {
  const report = await getCustomerReport(range, 50);
  const money = (minor: number): string => formatMoney(minor, report.currency, report.locale);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="New customers" value={formatNumber(report.newCustomers)} />
        <StatCard label="Repeat buyers" value={formatNumber(report.returningCustomers)} />
        <StatCard
          label="Repeat rate"
          value={`${report.repeatRate.toFixed(1)}%`}
          comparisonLabel="Buyers with more than one order"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top customers</CardTitle>
        </CardHeader>

        {report.topCustomers.length === 0 ? (
          <EmptyState
            title="No customer orders in this period"
            description="Widen the date range to see more."
          />
        ) : (
          <TableContainer className="rounded-none border-0 border-t">
            <Table caption="Customers ranked by net spend in the period">
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH>Email</TH>
                  <TH className="text-right">Orders</TH>
                  {showMoney ? <TH className="text-right">Net spend</TH> : null}
                  <TH>Last order</TH>
                </TR>
              </THead>
              <TBody>
                {report.topCustomers.map((row) => (
                  <TR key={row.customerId}>
                    <TD className="font-medium">{row.name}</TD>
                    <TD className="text-fg-muted text-xs break-all">{row.email}</TD>
                    <NumericTD>{formatNumber(row.orderCount)}</NumericTD>
                    {showMoney ? (
                      <NumericTD className="font-medium">{money(row.netSpend)}</NumericTD>
                    ) : null}
                    <TD>{row.lastOrderAt ? formatDate(row.lastOrderAt) : '-'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </>
  );
};

// ── Discounts ────────────────────────────────────────────────────────────────

const DiscountReport = async ({
  range,
  showMoney,
}: {
  range: { from: Date; to: Date };
  showMoney: boolean;
}) => {
  const [rows, summary] = await Promise.all([
    getDiscountReport(range),
    getSalesSummary(range),
  ]);

  const money = (minor: number): string =>
    formatMoney(minor, summary.currency, summary.locale);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Discount usage</CardTitle>
      </CardHeader>

      {rows.length === 0 ? (
        <EmptyState
          title="No discounts redeemed"
          description="No promotion code was used in this period."
        />
      ) : (
        <TableContainer className="rounded-none border-0 border-t">
          <Table caption="Discount codes with redemptions and the revenue they influenced">
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Name</TH>
                <TH className="text-right">Redemptions</TH>
                {showMoney ? (
                  <>
                    <TH className="text-right">Discount given</TH>
                    <TH className="text-right">Revenue influenced</TH>
                  </>
                ) : null}
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.code}>
                  <TD className="font-mono text-sm font-medium">{row.code}</TD>
                  <TD>{row.name}</TD>
                  <NumericTD>{formatNumber(row.redemptions)}</NumericTD>
                  {showMoney ? (
                    <>
                      <NumericTD className="text-warning">
                        {money(row.discountGiven)}
                      </NumericTD>
                      <NumericTD className="font-medium">
                        {money(row.revenueInfluenced)}
                      </NumericTD>
                    </>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      )}
    </Card>
  );
};

export default ReportsPage;
