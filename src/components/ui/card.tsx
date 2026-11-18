import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Card surfaces and the dashboard stat tile. */

const cardVariants = cva('rounded-card border bg-surface', {
  variants: {
    elevation: {
      flat: 'border-line',
      raised: 'border-line shadow-card',
      floating: 'border-line shadow-raised',
    },
    padding: {
      none: '',
      sm: 'p-4',
      md: 'p-5',
      lg: 'p-6',
    },
  },
  defaultVariants: { elevation: 'raised', padding: 'none' },
});

export type CardProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof cardVariants> & { as?: 'div' | 'section' | 'article' };

export const Card = ({ className, elevation, padding, as = 'div', ...props }: CardProps) => {
  const Component = as;
  return (
    <Component className={cn(cardVariants({ elevation, padding }), className)} {...props} />
  );
};

export const CardHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn('flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-3', className)}
    {...props}
  />
);

export const CardTitle = ({
  className,
  as: Component = 'h2',
  ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: 'h1' | 'h2' | 'h3' | 'h4' }) => (
  <Component className={cn('text-fg text-base leading-tight font-semibold', className)} {...props} />
);

export const CardDescription = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-fg-muted mt-1 text-sm leading-relaxed', className)} {...props} />
);

export const CardContent = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 pb-5', className)} {...props} />
);

export const CardFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'border-line flex flex-wrap items-center justify-end gap-2 border-t px-5 py-4',
      className,
    )}
    {...props}
  />
);

/**
 * KPI tile.
 *
 * The trend is conveyed by an arrow glyph, a sign and a word as well as by
 * colour, so it is readable without colour vision. `changePercent` of null
 * means "no comparable previous period", which is shown as a dash rather than
 * a misleading 0%.
 */
export type StatCardProps = {
  label: string;
  value: string;
  changePercent?: number | null;
  /** e.g. "vs previous 30 days" */
  comparisonLabel?: string;
  icon?: React.ReactNode;
  /** For metrics where down is good, such as refunds. */
  invertTrend?: boolean;
  footer?: React.ReactNode;
  className?: string;
};

export const StatCard = ({
  label,
  value,
  changePercent,
  comparisonLabel,
  icon,
  invertTrend = false,
  footer,
  className,
}: StatCardProps) => {
  const hasChange = typeof changePercent === 'number' && Number.isFinite(changePercent);
  const rounded = hasChange ? Math.round(changePercent * 10) / 10 : 0;
  const direction = !hasChange || rounded === 0 ? 'flat' : rounded > 0 ? 'up' : 'down';
  const isGood = invertTrend ? direction === 'down' : direction === 'up';

  const TrendIcon =
    direction === 'up' ? ArrowUpRight : direction === 'down' ? ArrowDownRight : Minus;

  return (
    <Card className={cn('p-5', className)}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-fg-muted text-sm font-medium">{label}</p>
        {icon ? (
          <span className="text-fg-subtle shrink-0" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>

      <p className="text-fg mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{value}</p>

      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {hasChange ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
              direction === 'flat'
                ? 'bg-surface-sunken text-fg-muted'
                : isGood
                  ? 'bg-success-soft text-success'
                  : 'bg-danger-soft text-danger',
            )}
          >
            <TrendIcon className="size-3.5" aria-hidden="true" />
            {direction === 'flat' ? 'No change' : `${Math.abs(rounded)}%`}
            <span className="sr-only">
              {direction === 'flat'
                ? ''
                : direction === 'up'
                  ? ' increase'
                  : ' decrease'}
            </span>
          </span>
        ) : (
          <span className="text-fg-subtle">No comparison available</span>
        )}

        {comparisonLabel ? <span className="text-fg-subtle">{comparisonLabel}</span> : null}
      </div>

      {footer ? <div className="mt-3">{footer}</div> : null}
    </Card>
  );
};

/** Page heading block, used at the top of every admin screen. */
export const PageHeader = ({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
    <div className="min-w-0">
      <h1 className="text-fg text-xl font-semibold tracking-tight sm:text-2xl">{title}</h1>
      {description ? (
        <p className="text-fg-muted mt-1 max-w-2xl text-sm leading-relaxed">{description}</p>
      ) : null}
    </div>
    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);
