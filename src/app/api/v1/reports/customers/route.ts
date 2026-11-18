import { withApi } from '@/lib/api/handler';
import { parseListQuery } from '@/lib/api/query';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { getCustomerReport, resolveRange } from '@/server/report-service';

/** GET /api/v1/reports/customers -- top spenders, acquisition and repeat rate. */
export const GET = withApi(async ({ searchParams }) => {
  await requirePermission('report.read');

  const query = parseListQuery(searchParams, { sortable: ['createdAt'] as const });
  const range = resolveRange(query.dateFrom, query.dateTo);
  const report = await getCustomerReport(range, 50);

  return jsonOk({ range, ...report });
});
