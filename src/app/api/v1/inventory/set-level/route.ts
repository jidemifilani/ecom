import { actorFrom } from '@/lib/api/actor';
import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { readJsonBody } from '@/lib/request';
import { setStockLevel } from '@/server/inventory-service';
import { setStockLevelSchema } from '@/validation/inventory';

/**
 * POST /api/v1/inventory/set-level
 *
 * Sets the absolute on-hand figure after a physical stock count. The delta is
 * written to the ledger as an adjustment, so the history stays complete rather
 * than showing an unexplained jump.
 */
export const POST = withApi(async ({ request, client }) => {
  const user = await requirePermission('inventory.adjust');
  const body = await readJsonBody(request);
  const input = parseBody(setStockLevelSchema, body);
  const result = await setStockLevel(input, actorFrom(user, client));
  return jsonOk(result);
});
