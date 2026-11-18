import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/utils';

/**
 * Table primitives.
 *
 * Responsive strategy: the table scrolls horizontally inside a bounded
 * container (never the page, so there is no full-page horizontal scroll), and
 * every list screen also renders a card list below the `md` breakpoint. Both
 * views come from the same data, so nothing is hidden from phone users -- see
 * `DataTable` in `src/components/data/data-table.tsx`.
 */

export const TableContainer = ({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) => (
  <div className={cn('table-scroll rounded-card border-line bg-surface border', className)}>
    {children}
  </div>
);

export const Table = ({
  className,
  caption,
  ...props
}: React.TableHTMLAttributes<HTMLTableElement> & { caption?: string }) => (
  <table className={cn('w-full border-collapse text-left text-sm', className)} {...props}>
    {/* A caption gives screen-reader users the table's purpose before its rows. */}
    {caption ? <caption className="sr-only">{caption}</caption> : null}
    {props.children}
  </table>
);

export const THead = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <thead className={cn('bg-surface-sunken', className)} {...props} />
);

export const TBody = ({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) => (
  <tbody className={cn('divide-line divide-y', className)} {...props} />
);

export const TR = ({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
  <tr className={cn('hover:bg-surface-sunken/60 transition-colors', className)} {...props} />
);

export const TH = ({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) => (
  <th
    scope="col"
    className={cn(
      'text-fg-muted px-4 py-3 text-xs font-semibold tracking-wide uppercase whitespace-nowrap',
      className,
    )}
    {...props}
  />
);

export const TD = ({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <td className={cn('text-fg px-4 py-3.5 align-middle', className)} {...props} />
);

/**
 * Sortable column header.
 *
 * Renders as a link so sorting survives a page refresh, works with the back
 * button and is usable without JavaScript. `aria-sort` tells assistive tech the
 * current direction, and the icon is decorative.
 */
export const SortableTH = ({
  label,
  field,
  currentSort,
  currentOrder,
  buildHref,
  className,
  numeric = false,
}: {
  label: string;
  field: string;
  currentSort: string;
  currentOrder: 'asc' | 'desc';
  buildHref: (field: string, order: 'asc' | 'desc') => string;
  className?: string;
  numeric?: boolean;
}) => {
  const isActive = currentSort === field;
  const nextOrder: 'asc' | 'desc' = isActive && currentOrder === 'asc' ? 'desc' : 'asc';
  const Icon = !isActive ? ChevronsUpDown : currentOrder === 'asc' ? ArrowUp : ArrowDown;

  return (
    <TH
      aria-sort={isActive ? (currentOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(numeric && 'text-right', className)}
    >
      <Link
        href={buildHref(field, nextOrder)}
        scroll={false}
        className={cn(
          'hover:text-fg -mx-1 inline-flex items-center gap-1 rounded px-1 py-1',
          isActive && 'text-fg',
          numeric && 'flex-row-reverse',
        )}
      >
        {label}
        <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
        <span className="sr-only">
          {isActive
            ? `, sorted ${currentOrder === 'asc' ? 'ascending' : 'descending'}. Activate to sort ${nextOrder === 'asc' ? 'ascending' : 'descending'}.`
            : `, not sorted. Activate to sort ascending.`}
        </span>
      </Link>
    </TH>
  );
};

/** Right-aligned numeric cell. Tabular numerals come from the base styles. */
export const NumericTD = ({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) => (
  <TD className={cn('text-right whitespace-nowrap', className)} {...props} />
);

/**
 * The mobile alternative to a table row: a card with label/value pairs.
 * Used by `DataTable` below the `md` breakpoint.
 */
export const RecordCard = ({
  title,
  subtitle,
  badge,
  fields,
  actions,
  media,
}: {
  /**
   * Usually already contains its own link. The card deliberately does NOT wrap
   * this in one: doing so nested an `<a>` inside an `<a>`, which is invalid
   * HTML and made React discard and re-render the whole list on hydration.
   */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  fields?: { label: string; value: React.ReactNode }[];
  actions?: React.ReactNode;
  media?: React.ReactNode;
}) => {
  /*
   * A div, not a span: column renderers return arbitrary content, including
   * flex rows with a thumbnail. A <div> inside a <span> is invalid HTML, and
   * the browser silently re-parents it -- which shows up as a hydration
   * mismatch rather than a visual bug.
   */
  const heading = <div className="text-fg truncate text-sm font-semibold">{title}</div>;

  return (
    <div className="border-line bg-surface border-b p-4 last:border-b-0">
      <div className="flex items-start gap-3">
        {media ? <div className="shrink-0">{media}</div> : null}

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              {heading}
              {subtitle ? (
                <div className="text-fg-muted mt-0.5 truncate text-xs">{subtitle}</div>
              ) : null}
            </div>
            {badge ? <div className="shrink-0">{badge}</div> : null}
          </div>

          {fields && fields.length > 0 ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
              {fields.map((field) => (
                <div key={field.label} className="min-w-0">
                  <dt className="text-fg-subtle text-[11px] tracking-wide uppercase">
                    {field.label}
                  </dt>
                  <dd className="text-fg mt-0.5 truncate text-sm">{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </div>
  );
};

/** Label/value list for detail panels. */
export const DetailList = ({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) => (
  <dl className={cn('divide-line divide-y', className)}>
    {items.map((item) => (
      <div
        key={item.label}
        className="grid gap-1 py-3 sm:grid-cols-[minmax(0,10rem)_1fr] sm:gap-4"
      >
        <dt className="text-fg-muted text-sm font-medium">{item.label}</dt>
        <dd className="text-fg min-w-0 text-sm break-words">{item.value}</dd>
      </div>
    ))}
  </dl>
);
