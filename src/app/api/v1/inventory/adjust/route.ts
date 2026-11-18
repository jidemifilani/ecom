import { actorFrom } from '@/lib/api/actor';
import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { readJsonBody } from '@/lib/request';
import { adjustStock } from '@/server/inventory-service';
import { adjustStockSchema } from '@/validation/inventory';

/**
 * POST /api/v1/inventory/adjust
 *
 * Records a receipt, return, damage write-off or manual correction. Every
 * adjustment appends to the stock ledger with a reason, so any level can be
 * explained from history.
 */
export const POST = withApi(async ({ request, client }) => {
  const user = await requirePermission('inventory.adjust');
  const body = await readJsonBody(request);
  const input = parseBody(adjustStockSchema, body);
  const result = await adjustStock(input, actorFrom(user, client));
  return jsonOk(result);
});
