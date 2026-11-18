'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { formatMoney, toMajorUnits } from '@/lib/money';
import { formatNumber } from '@/lib/utils';

/**
 * Dashboard and report charts.
 *
 * Conventions applied to all of them:
 *  * A categorical palette that stays distinguishable in both themes and under
 *    the common colour-vision deficiencies, and every series is also labelled,
 *    so colour is never the only carrier of meaning.
 *  * A text summary rendered for screen readers before the SVG, because a
 *    chart on its own is unreadable to assistive technology.
 *  * `ResponsiveContainer` inside a fixed-height wrapper, which reserves the
 *    space before paint and keeps cumulative layout shift at zero.
 *  * Money is formatted from minor units, never divided by 100 inline.
 */

/** Chosen for separation in both themes; order is the assignment order. */
export const CHART_COLORS = [
  '#16a34a',
  '#2563eb',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#65a30d',
  '#dc2626',
] as const;

const axisProps = {
  stroke: 'var(--color-fg-subtle)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const tooltipStyle = {
  backgroundColor: 'var(--color-surface)',
  border: '1px solid var(--color-line)',
  borderRadius: 'var(--radius-control)',
  fontSize: '12px',
  color: 'var(--color-fg)',
  boxShadow: 'var(--shadow-overlay)',
} as const;

const shortDate = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
};

// ── Revenue / orders over time ───────────────────────────────────────────────

export type SalesPoint = { date: string; revenue: number; orders: number };

export const SalesTrendChart = ({
  data,
  currency,
  locale,
  showRevenue,
}: {
  data: SalesPoint[];
  currency: string;
  locale: string;
  /** False for users without permission to see money. */
  showRevenue: boolean;
}) => {
  const totalOrders = data.reduce((sum, point) => sum + point.orders, 0);
  const totalRevenue = data.reduce((sum, point) => sum + point.revenue, 0);

  if (data.length === 0) {
    return (
      <p className="text-fg-muted grid h-64 place-items-center text-sm">
        No orders in this period yet.
      </p>
    );
  }

  return (
    <figure className="m-0">
      {/* The accessible equivalent of the chart, read instead of the SVG. */}
      <figcaption className="sr-only">
        {showRevenue
          ? `Daily revenue and order volume. ${formatMoney(totalRevenue, currency, locale)} from ${totalOrders} orders across ${data.length} days.`
          : `Daily order volume: ${totalOrders} orders across ${data.length} days.`}
      </figcaption>

      <div className="h-64 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
            <defs>
              <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS[0]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_COLORS[0]} stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="ordersFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS[1]} stopOpacity={0.3} />
                <stop offset="100%" stopColor={CHART_COLORS[1]} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              {...axisProps}
              minTickGap={24}
            />
            <YAxis
              {...axisProps}
              width={56}
              tickFormatter={(value: number) =>
                showRevenue
                  ? new Intl.NumberFormat(locale, {
                      notation: 'compact',
                      maximumFractionDigits: 1,
                    }).format(toMajorUnits(value, currency))
                  : formatNumber(value)
              }
            />
            <Tooltip
              contentStyle={tooltipStyle}
              /*
               * Recharts types these callbacks loosely (the value can be a
               * number, string or array). Accepting `unknown` and coercing is
               * what keeps them assignable without an `as any` cast.
               */
              labelFormatter={(label: unknown) => shortDate(String(label))}
              formatter={(value: unknown, name: unknown) =>
                String(name) === 'Revenue'
                  ? [formatMoney(Number(value), currency, locale), String(name)]
                  : [formatNumber(Number(value)), String(name)]
              }
            />
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
              iconType="circle"
              iconSize={8}
            />

            {showRevenue ? (
              <Area
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke={CHART_COLORS[0]}
                strokeWidth={2}
                fill="url(#revenueFill)"
              />
            ) : null}
            <Area
              type="monotone"
              dataKey="orders"
              name="Orders"
              stroke={CHART_COLORS[1]}
              strokeWidth={2}
              fill="url(#ordersFill)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
};

// ── Horizontal bar: top products ─────────────────────────────────────────────

export const TopProductsChart = ({
  data,
  currency,
  locale,
  showRevenue,
}: {
  data: { name: string; unitsSold: number; revenue: number }[];
  currency: string;
  locale: string;
  showRevenue: boolean;
}) => {
  if (data.length === 0) {
    return (
      <p className="text-fg-muted grid h-56 place-items-center text-sm">
        No sales in this period yet.
      </p>
    );
  }

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        Best-selling products.{' '}
        {data
          .map(
            (row) =>
              `${row.name}: ${row.unitsSold} units${showRevenue ? `, ${formatMoney(row.revenue, currency, locale)}` : ''}`,
          )
          .join('. ')}
      </figcaption>

      <div className="h-56 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            layout="vertical"
            margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line)" horizontal={false} />
            <XAxis type="number" {...axisProps} tickFormatter={(value: number) => formatNumber(value)} />
            <YAxis
              type="category"
              dataKey="name"
              {...axisProps}
              width={120}
              tickFormatter={(value: string) =>
                value.length > 18 ? `${value.slice(0, 17)}...` : value
              }
            />
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: unknown) => [formatNumber(Number(value)), 'Units sold']}
            />
            <Bar dataKey="unitsSold" name="Units sold" radius={[0, 4, 4, 0]}>
              {data.map((_, index) => (
                <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
};

// ── Donut: order status mix ──────────────────────────────────────────────────

export const StatusMixChart = ({
  data,
}: {
  data: { status: string; count: number }[];
}) => {
  const total = data.reduce((sum, row) => sum + row.count, 0);

  if (total === 0) {
    return (
      <p className="text-fg-muted grid h-56 place-items-center text-sm">
        No orders in this period yet.
      </p>
    );
  }

  const label = (status: string): string =>
    status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');

  return (
    <figure className="m-0">
      <figcaption className="sr-only">
        Orders by status, {total} in total.{' '}
        {data
          .map(
            (row) =>
              `${label(row.status)}: ${row.count} (${Math.round((row.count / total) * 100)}%)`,
          )
          .join('. ')}
      </figcaption>

      <div className="h-56 w-full" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="count"
              nameKey="status"
              innerRadius="55%"
              outerRadius="82%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((_, index) => (
                <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={tooltipStyle}
              formatter={(value: unknown, name: unknown) => {
                const count = Number(value);
                return [
                  `${formatNumber(count)} (${Math.round((count / total) * 100)}%)`,
                  label(String(name)),
                ];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px' }}
              iconType="circle"
              iconSize={8}
              formatter={(value: string) => label(value)}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
};
