import { withApi } from '@/lib/api/handler';
import { parseListQuery } from '@/lib/api/query';
import { jsonPaginated } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { listStockMovements } from '@/server/inventory-service';

/**
 * GET /api/v1/inventory/movements
 *
 * The stock ledger. Pass `variantId` to narrow it to one item's history.
 */
export const GET = withApi(async ({ searchParams }) => {
  await requirePermission('inventory.read');

  const query = parseListQuery(searchParams, {
    sortable: ['createdAt'] as const,
    defaultSort: 'createdAt',
    filterKeys: ['type'],
  });

  const variantId = searchParams.get('variantId') ?? undefined;
  const result = await listStockMovements(query, variantId);

  return jsonPaginated(result);
});
