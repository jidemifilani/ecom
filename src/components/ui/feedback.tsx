import { cva, type VariantProps } from 'class-variance-authority';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  type LucideIcon,
  OctagonAlert,
  RefreshCw,
} from 'lucide-react';

import { cn } from '@/lib/utils';

import { Button } from './button';

/**
 * Status, loading, empty and error presentation.
 *
 * Status is never conveyed by colour alone -- every badge and alert carries a
 * word, and alerts carry an icon too, so meaning survives greyscale printing
 * and colour-vision differences.
 */

// ── Badge ────────────────────────────────────────────────────────────────────

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap',
  {
    variants: {
      tone: {
        neutral: 'border-line bg-surface-sunken text-fg-muted',
        accent: 'border-accent/30 bg-accent-soft text-accent',
        success: 'border-success/30 bg-success-soft text-success',
        warning: 'border-warning/30 bg-warning-soft text-warning',
        danger: 'border-danger/30 bg-danger-soft text-danger',
        info: 'border-info/30 bg-info-soft text-info',
        outline: 'border-line-strong bg-transparent text-fg-muted',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>;

export const Badge = ({ className, tone, ...props }: BadgeProps) => (
  <span className={cn(badgeVariants({ tone }), className)} {...props} />
);

export type BadgeTone = NonNullable<BadgeProps['tone']>;

/**
 * Maps a domain status to a tone and a human label in one place, so an order
 * marked REFUNDED reads identically on every screen.
 */
const STATUS_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  // Users
  ACTIVE: { tone: 'success', label: 'Active' },
  INVITED: { tone: 'info', label: 'Invited' },
  SUSPENDED: { tone: 'danger', label: 'Suspended' },
  BLOCKED: { tone: 'danger', label: 'Blocked' },

  // Products / reviews
  DRAFT: { tone: 'neutral', label: 'Draft' },
  ARCHIVED: { tone: 'neutral', label: 'Archived' },
  PENDING: { tone: 'warning', label: 'Pending' },
  APPROVED: { tone: 'success', label: 'Approved' },
  REJECTED: { tone: 'danger', label: 'Rejected' },

  // Orders
  CONFIRMED: { tone: 'info', label: 'Confirmed' },
  PROCESSING: { tone: 'info', label: 'Processing' },
  SHIPPED: { tone: 'accent', label: 'Shipped' },
  DELIVERED: { tone: 'success', label: 'Delivered' },
  CANCELLED: { tone: 'neutral', label: 'Cancelled' },
  REFUNDED: { tone: 'warning', label: 'Refunded' },

  // Payment
  UNPAID: { tone: 'warning', label: 'Unpaid' },
  AUTHORIZED: { tone: 'info', label: 'Authorised' },
  PAID: { tone: 'success', label: 'Paid' },
  PARTIALLY_REFUNDED: { tone: 'warning', label: 'Part refunded' },
  FAILED: { tone: 'danger', label: 'Failed' },

  // Fulfilment
  UNFULFILLED: { tone: 'warning', label: 'Unfulfilled' },
  PARTIALLY_FULFILLED: { tone: 'info', label: 'Part fulfilled' },
  FULFILLED: { tone: 'success', label: 'Fulfilled' },

  // Shipments
  IN_TRANSIT: { tone: 'info', label: 'In transit' },
  RETURNED: { tone: 'danger', label: 'Returned' },

  // Discounts
  active: { tone: 'success', label: 'Active' },
  scheduled: { tone: 'info', label: 'Scheduled' },
  expired: { tone: 'neutral', label: 'Expired' },
  exhausted: { tone: 'warning', label: 'Limit reached' },
  disabled: { tone: 'neutral', label: 'Disabled' },
};

export const StatusBadge = ({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) => {
  if (!status) return <span className="text-fg-subtle text-xs">-</span>;

  const mapped = STATUS_TONES[status] ?? {
    tone: 'neutral' as BadgeTone,
    // Fall back to a readable rendering of an unmapped enum value.
    label: status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' '),
  };

  return (
    <Badge tone={mapped.tone} className={className}>
      {mapped.label}
    </Badge>
  );
};

// ── Loading ──────────────────────────────────────────────────────────────────

export const Spinner = ({
  className,
  label = 'Loading',
}: {
  className?: string;
  label?: string;
}) => (
  <span role="status" className="inline-flex items-center gap-2">
    <Loader2 className={cn('text-fg-subtle size-4 animate-spin', className)} aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </span>
);

export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    aria-hidden="true"
    className={cn('shimmer rounded-control h-4 w-full', className)}
    {...props}
  />
);

/**
 * Table placeholder that matches the real table's geometry, so the page does
 * not jump when data arrives (keeps cumulative layout shift down).
 */
export const TableSkeleton = ({
  rows = 8,
  columns = 5,
}: {
  rows?: number;
  columns?: number;
}) => (
  <div role="status" aria-label="Loading results" className="divide-line divide-y">
    <span className="sr-only">Loading results</span>
    {Array.from({ length: rows }).map((_, rowIndex) => (
      <div key={rowIndex} className="flex items-center gap-4 px-4 py-3.5">
        {Array.from({ length: columns }).map((__, columnIndex) => (
          <Skeleton
            key={columnIndex}
            className={cn(
              'h-4',
              columnIndex === 0 ? 'w-[28%]' : columnIndex === columns - 1 ? 'w-16' : 'flex-1',
            )}
          />
        ))}
      </div>
    ))}
  </div>
);

export const CardsSkeleton = ({ count = 4 }: { count?: number }) => (
  <div
    role="status"
    aria-label="Loading"
    className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
  >
    <span className="sr-only">Loading</span>
    {Array.from({ length: count }).map((_, index) => (
      <div key={index} className="rounded-card border-line bg-surface border p-5">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-32" />
        <Skeleton className="mt-3 h-3 w-20" />
      </div>
    ))}
  </div>
);

// ── Empty and error states ───────────────────────────────────────────────────

export const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) => (
  <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
    {Icon ? (
      <span className="bg-surface-sunken text-fg-subtle mb-4 grid size-12 place-items-center rounded-full">
        <Icon className="size-6" aria-hidden="true" />
      </span>
    ) : null}
    <h3 className="text-fg text-base font-semibold">{title}</h3>
    {description ? (
      <p className="text-fg-muted mt-1.5 max-w-sm text-sm leading-relaxed">{description}</p>
    ) : null}
    {action ? <div className="mt-5">{action}</div> : null}
  </div>
);

/**
 * Error state with a retry affordance.
 *
 * Shows the request id when there is one: it is the only thing that lets a
 * user and an engineer talk about the same failure.
 */
export const ErrorState = ({
  title = 'Something went wrong',
  message,
  requestId,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  requestId?: string | null;
  onRetry?: () => void;
  className?: string;
}) => (
  <div
    role="alert"
    className={cn('flex flex-col items-center px-6 py-14 text-center', className)}
  >
    <span className="bg-danger-soft text-danger mb-4 grid size-12 place-items-center rounded-full">
      <OctagonAlert className="size-6" aria-hidden="true" />
    </span>
    <h3 className="text-fg text-base font-semibold">{title}</h3>
    <p className="text-fg-muted mt-1.5 max-w-sm text-sm leading-relaxed">
      {message ?? 'The request could not be completed. Please try again.'}
    </p>
    {requestId ? (
      <p className="text-fg-subtle mt-2 font-mono text-xs">Reference: {requestId}</p>
    ) : null}
    {onRetry ? (
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-5">
        <RefreshCw aria-hidden="true" />
        Try again
      </Button>
    ) : null}
  </div>
);

// ── Inline alert ─────────────────────────────────────────────────────────────

const ALERT_ICONS: Record<string, LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: OctagonAlert,
};

export const Alert = ({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: 'info' | 'success' | 'warning' | 'danger';
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) => {
  const Icon = ALERT_ICONS[tone] ?? Info;

  return (
    <div
      /* Warnings and errors are announced; informational notes are not. */
      role={tone === 'danger' || tone === 'warning' ? 'alert' : undefined}
      className={cn(
        'rounded-card flex gap-3 border p-4 text-sm',
        tone === 'info' && 'border-info/30 bg-info-soft text-info',
        tone === 'success' && 'border-success/30 bg-success-soft text-success',
        tone === 'warning' && 'border-warning/30 bg-warning-soft text-warning',
        tone === 'danger' && 'border-danger/30 bg-danger-soft text-danger',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-1', 'leading-relaxed')}>{children}</div> : null}
      </div>
    </div>
  );
};
