import { withApi } from '@/lib/api/handler';
import { parseListQuery } from '@/lib/api/query';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { getDiscountReport, resolveRange } from '@/server/report-service';

/** GET /api/v1/reports/discounts -- redemptions and discount cost per code. */
export const GET = withApi(async ({ searchParams }) => {
  await requirePermission('report.read');

  const query = parseListQuery(searchParams, { sortable: ['createdAt'] as const });
  const range = resolveRange(query.dateFrom, query.dateTo);
  const rows = await getDiscountReport(range);

  return jsonOk({ range, rows });
});
