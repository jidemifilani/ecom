import { collectionRoute } from '@/lib/api/crud';
import { createOrderForCustomer, listOrders } from '@/server/order-service';
import { createOrderSchema, ORDER_SORT_FIELDS, orderFilterKeys } from '@/validation/order';

/**
 * /api/v1/orders
 *
 * POST creates an order on a customer's behalf (phone or counter sale). Totals
 * are computed server-side from the catalogue; the request body carries only
 * variant ids and quantities, never prices.
 */
export const { GET, POST } = collectionRoute({
  list: {
    permission: 'order.read',
    sortable: ORDER_SORT_FIELDS,
    defaultSort: 'placedAt',
    filterKeys: orderFilterKeys,
    run: (query) => listOrders(query),
  },
  create: {
    permission: 'order.create',
    schema: createOrderSchema,
    run: (input, actor) => createOrderForCustomer(input, actor),
  },
});
