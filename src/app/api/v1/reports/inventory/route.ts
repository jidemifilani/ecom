import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { getInventoryValuation } from '@/server/report-service';

/**
 * GET /api/v1/reports/inventory
 *
 * Stock valuation at cost and at retail. Pass `lowOnly=true` for the reorder
 * worklist.
 */
export const GET = withApi(async ({ searchParams }) => {
  await requirePermission('report.read');

  const valuation = await getInventoryValuation({
    lowOnly: searchParams.get('lowOnly') === 'true',
    limit: 1000,
  });

  return jsonOk(valuation);
});
