import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/guard';
import { getDashboardData, type DashboardRange } from '@/server/dashboard-service';

const ALLOWED_RANGES: DashboardRange[] = [7, 30, 90, 365];

/**
 * GET /api/v1/dashboard
 *
 * The payload is shaped by the caller's permissions: without
 * `dashboard.view_financials` the money figures come back zeroed, so the page
 * stays useful to fulfilment staff without exposing revenue.
 */
export const GET = withApi(async ({ searchParams }) => {
  const user = await requirePermission('dashboard.view');

  const requested = Number.parseInt(searchParams.get('range') ?? '30', 10);
  const rangeDays = (
    ALLOWED_RANGES.includes(requested as DashboardRange) ? requested : 30
  ) as DashboardRange;

  const data = await getDashboardData(rangeDays, {
    includeFinancials: can(user, 'dashboard.view_financials'),
  });

  return jsonOk(data);
});
