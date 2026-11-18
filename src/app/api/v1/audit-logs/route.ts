import { withApi } from '@/lib/api/handler';
import { parseListQuery } from '@/lib/api/query';
import { jsonPaginated } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { AUDIT_SORT_FIELDS, getAuditFilterOptions, listAuditLogs } from '@/server/audit-service';

/**
 * GET /api/v1/audit-logs
 *
 * Read-only by design: no endpoint anywhere edits or deletes an audit entry.
 * The distinct action and entity values are returned alongside the page so the
 * filter dropdowns do not need a second round trip.
 */
export const GET = withApi(async ({ searchParams }) => {
  await requirePermission('audit_log.read');

  const query = parseListQuery(searchParams, {
    sortable: AUDIT_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: ['action', 'entityType', 'entityId', 'actorUserId'],
    defaultPageSize: 25,
  });

  const [result, filterOptions] = await Promise.all([
    listAuditLogs(query),
    getAuditFilterOptions(),
  ]);

  return jsonPaginated(result, { filterOptions });
});
