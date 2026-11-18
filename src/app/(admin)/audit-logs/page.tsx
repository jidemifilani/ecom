import type { Metadata } from 'next';
import { ScrollText } from 'lucide-react';

import { ExportButton } from '@/components/data/export-button';
import { FilterBar } from '@/components/data/filter-bar';
import { PageHeader } from '@/components/ui/card';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Breadcrumbs, Pagination } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { can } from '@/lib/rbac/guard';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatDateTime } from '@/lib/utils';
import {
  AUDIT_SORT_FIELDS,
  getAuditFilterOptions,
  listAuditLogs,
} from '@/server/audit-service';

import { AuditEntryRow } from './audit-entry-row';

export const metadata: Metadata = { title: 'Audit log' };

const FILTER_KEYS = ['action', 'entityType', 'entityId', 'actorUserId'] as const;

const humanise = (value: string): string =>
  value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ');

/**
 * /audit-logs
 *
 * Append-only history of every sensitive action: who, what, when, from where,
 * and the field-level before/after. There is no edit or delete path anywhere in
 * the application, which is what makes the trail worth keeping.
 *
 * Rendered as an expandable list rather than a table because the diff payload
 * does not fit a fixed column, and a row is useless without it.
 */
const AuditLogsPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('audit_log.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/audit-logs', params);

  const query = safeListQuery(params, {
    sortable: AUDIT_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: FILTER_KEYS,
    defaultPageSize: 25,
  });

  const [result, options] = await Promise.all([listAuditLogs(query), getAuditFilterOptions()]);

  const filtersActive = hasActiveFilters(params, FILTER_KEYS);

  return (
    <>
      <Breadcrumbs items={[{ label: 'Audit log' }]} />

      <PageHeader
        title="Audit log"
        description="Every sensitive action, with the acting user, the affected record and what changed."
        actions={can(viewer, 'audit_log.export') ? <ExportButton resource="audit-logs" /> : undefined}
      />

      <FilterBar
        searchPlaceholder="Search by user, record, IP or request id"
        showDateRange
        filters={[
          {
            key: 'action',
            label: 'Action',
            options: options.actions.map((action) => ({
              value: action,
              label: humanise(action),
            })),
          },
          {
            key: 'entityType',
            label: 'Record type',
            options: options.entityTypes.map((type) => ({ value: type, label: type })),
          },
        ]}
      />

      {params.get('entityId') ? (
        <Alert tone="info">
          Showing changes to a single record. Clear the filters to see everything.
        </Alert>
      ) : null}

      <div className="rounded-card border-line bg-surface overflow-hidden border">
        {result.items.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={filtersActive ? 'No matching entries' : 'No activity recorded yet'}
            description={
              filtersActive
                ? 'No audit entries match the current search and filters. Try widening the date range.'
                : 'Entries appear here as soon as someone signs in or changes a record.'
            }
          />
        ) : (
          <>
            <ul className="divide-line divide-y">
              {result.items.map((entry) => (
                <li key={entry.id}>
                  <AuditEntryRow
                    action={humanise(entry.action)}
                    actionKey={entry.action}
                    actor={entry.actorName ?? entry.actorEmail ?? 'System'}
                    actorEmail={entry.actorEmail}
                    entityType={entry.entityType}
                    entityLabel={entry.entityLabel}
                    entityId={entry.entityId}
                    timestamp={formatDateTime(entry.createdAt)}
                    ipAddress={entry.ipAddress}
                    userAgent={entry.userAgent}
                    requestId={entry.requestId}
                    before={entry.before}
                    after={entry.after}
                  />
                </li>
              ))}
            </ul>

            <Pagination
              page={result.page}
              pageSize={result.pageSize}
              total={result.total}
              totalPages={Math.max(1, Math.ceil(result.total / result.pageSize))}
              buildHref={(page) => buildHref({ page })}
              itemLabel="entry"
            />
          </>
        )}
      </div>

      <p className="text-fg-subtle text-xs">
        <Badge tone="outline">Append-only</Badge> Entries are never edited or deleted by the
        application.
      </p>
    </>
  );
};

export default AuditLogsPage;
