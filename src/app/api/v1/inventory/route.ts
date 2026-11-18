import { withApi } from '@/lib/api/handler';
import { parseListQuery } from '@/lib/api/query';
import { jsonPaginated } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { listInventory } from '@/server/inventory-service';
import { getStoreConfig } from '@/server/settings-service';
import { INVENTORY_SORT_FIELDS } from '@/validation/inventory';

/**
 * GET /api/v1/inventory
 *
 * Stock levels with availability (on hand minus reserved). The low-stock
 * threshold comes from settings rather than the query string, so the figure
 * matches the dashboard and the reports.
 */
export const GET = withApi(async ({ searchParams }) => {
  await requirePermission('inventory.read');

  const query = parseListQuery(searchParams, {
    sortable: INVENTORY_SORT_FIELDS,
    defaultSort: 'quantityOnHand',
    defaultSortOrder: 'asc',
    filterKeys: ['lowStock', 'outOfStock'],
  });

  const config = await getStoreConfig();
  const result = await listInventory(query, config.lowStockThreshold);

  return jsonPaginated(result, { lowStockThreshold: config.lowStockThreshold });
});
