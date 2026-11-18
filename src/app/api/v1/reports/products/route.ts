import { withApi } from '@/lib/api/handler';
import { parseListQuery } from '@/lib/api/query';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { getProductPerformance, resolveRange } from '@/server/report-service';

/** GET /api/v1/reports/products -- units, revenue and discount per product. */
export const GET = withApi(async ({ searchParams }) => {
  await requirePermission('report.read');

  const query = parseListQuery(searchParams, { sortable: ['createdAt'] as const });
  const range = resolveRange(query.dateFrom, query.dateTo);
  const rows = await getProductPerformance(range, 100);

  return jsonOk({ range, rows });
});
