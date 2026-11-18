import { withApi } from '@/lib/api/handler';
import { parseListQuery } from '@/lib/api/query';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { getSalesSummary, resolveRange } from '@/server/report-service';

/**
 * GET /api/v1/reports/sales
 *
 * Revenue, refunds, discounts, tax and shipping over a date range, plus the
 * daily series and status/provider breakdowns. `dateFrom` and `dateTo` are
 * parsed and range-checked by the shared query parser.
 */
export const GET = withApi(async ({ searchParams }) => {
  await requirePermission('report.read');

  const query = parseListQuery(searchParams, { sortable: ['createdAt'] as const });
  const range = resolveRange(query.dateFrom, query.dateTo);
  const summary = await getSalesSummary(range);

  return jsonOk(summary);
});
