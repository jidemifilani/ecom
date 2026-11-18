import type { LucideIcon } from 'lucide-react';

import { EmptyState } from '@/components/ui/feedback';
import { Pagination } from '@/components/ui/navigation';
import {
  NumericTD,
  RecordCard,
  SortableTH,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableContainer,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * DataTable.
 *
 * One column definition drives two presentations:
 *  * A real <table> from `md` up, with sortable headers and a bounded
 *    horizontal scroll container (so the page itself never scrolls sideways).
 *  * A list of cards below `md`, built from the same columns via their
 *    `mobile` role. Nothing is hidden from phone users -- the card shows the
 *    same values, labelled, instead of a cramped table.
 *
 * This is a server component: columns carry `render` functions, which stay on
 * the server, and sorting and paging are plain links that work without
 * JavaScript.
 */

export type ColumnMobileRole = 'title' | 'subtitle' | 'badge' | 'field' | 'hidden';

export type Column<TRow> = {
  /** Stable key, used for React keys only. */
  key: string;
  header: string;
  render: (row: TRow) => React.ReactNode;
  /** Set to make the column sortable; must match a service sort field. */
  sortField?: string;
  numeric?: boolean;
  /** Where this column appears in the mobile card. Defaults to 'field'. */
  mobile?: ColumnMobileRole;
  /** Shorter label for the mobile card, when the table header is verbose. */
  mobileLabel?: string;
  className?: string;
  headerClassName?: string;
};

export type DataTableProps<TRow> = {
  rows: readonly TRow[];
  columns: readonly Column<TRow>[];
  getRowId: (row: TRow) => string;
  /** Accessible description of the table's contents. */
  caption: string;

  // Sorting
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  buildSortHref: (field: string, order: 'asc' | 'desc') => string;

  // Paging
  page: number;
  pageSize: number;
  total: number;
  buildPageHref: (page: number) => string;
  itemLabel?: string;

  /**
   * Media shown beside the title on the mobile card (a thumbnail, say).
   * There is deliberately no `mobileHref`: the title column already renders
   * its own link, and wrapping the card in a second one nests `<a>` inside
   * `<a>`, which breaks hydration.
   */
  mobileMedia?: (row: TRow) => React.ReactNode;

  /** Trailing actions column, rendered per row. */
  rowActions?: (row: TRow) => React.ReactNode;

  // Empty state
  emptyIcon?: LucideIcon;
  emptyTitle: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  /** Shown instead of emptyTitle when filters are responsible for the gap. */
  filtersActive?: boolean;
  clearFiltersHref?: string;
};

export const DataTable = <TRow,>({
  rows,
  columns,
  getRowId,
  caption,
  sortBy,
  sortOrder,
  buildSortHref,
  page,
  pageSize,
  total,
  buildPageHref,
  itemLabel = 'result',
  mobileMedia,
  rowActions,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  emptyAction,
  filtersActive = false,
  clearFiltersHref,
}: DataTableProps<TRow>) => {
  if (rows.length === 0) {
    return (
      <div className="rounded-card border-line bg-surface border">
        {filtersActive ? (
          <EmptyState
            icon={emptyIcon}
            title="No matches"
            description="No records match the current search and filters. Try widening them."
            action={
              clearFiltersHref ? (
                <a
                  href={clearFiltersHref}
                  className="text-accent rounded text-sm font-medium underline-offset-4 hover:underline"
                >
                  Clear all filters
                </a>
              ) : undefined
            }
          />
        ) : (
          <EmptyState
            icon={emptyIcon}
            title={emptyTitle}
            description={emptyDescription}
            action={emptyAction}
          />
        )}
      </div>
    );
  }

  const titleColumn = columns.find((column) => column.mobile === 'title') ?? columns[0];
  const subtitleColumn = columns.find((column) => column.mobile === 'subtitle');
  const badgeColumn = columns.find((column) => column.mobile === 'badge');
  const fieldColumns = columns.filter(
    (column) =>
      column !== titleColumn &&
      column !== subtitleColumn &&
      column !== badgeColumn &&
      column.mobile !== 'hidden',
  );

  return (
    <div className="rounded-card border-line bg-surface overflow-hidden border">
      {/* ── Phone: card list ── */}
      <div className="md:hidden">
        {rows.map((row) => (
          <RecordCard
            key={getRowId(row)}
            title={titleColumn ? titleColumn.render(row) : null}
            subtitle={subtitleColumn?.render(row)}
            badge={badgeColumn?.render(row)}
            {...(mobileMedia ? { media: mobileMedia(row) } : {})}
            fields={fieldColumns.map((column) => ({
              label: column.mobileLabel ?? column.header,
              value: column.render(row),
            }))}
            {...(rowActions ? { actions: rowActions(row) } : {})}
          />
        ))}
      </div>

      {/* ── Tablet and up: table ── */}
      <div className="hidden md:block">
        <TableContainer className="rounded-none border-0">
          <Table caption={caption}>
            <THead>
              <TR className="hover:bg-surface-sunken">
                {columns.map((column) =>
                  column.sortField ? (
                    <SortableTH
                      key={column.key}
                      label={column.header}
                      field={column.sortField}
                      currentSort={sortBy}
                      currentOrder={sortOrder}
                      buildHref={buildSortHref}
                      numeric={column.numeric}
                      className={column.headerClassName}
                    />
                  ) : (
                    <TH
                      key={column.key}
                      className={cn(column.numeric && 'text-right', column.headerClassName)}
                    >
                      {column.header}
                    </TH>
                  ),
                )}
                {rowActions ? (
                  <TH className="w-px text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </TR>
            </THead>

            <TBody>
              {rows.map((row) => (
                <TR key={getRowId(row)}>
                  {columns.map((column) =>
                    column.numeric ? (
                      <NumericTD key={column.key} className={column.className}>
                        {column.render(row)}
                      </NumericTD>
                    ) : (
                      <TD key={column.key} className={column.className}>
                        {column.render(row)}
                      </TD>
                    ),
                  )}
                  {rowActions ? (
                    <TD className="text-right whitespace-nowrap">{rowActions(row)}</TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        buildHref={buildPageHref}
        itemLabel={itemLabel}
      />
    </div>
  );
};
