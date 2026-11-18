import { actionRoute } from '@/lib/api/crud';
import { fulfillOrder } from '@/server/order-service';
import { fulfillOrderSchema } from '@/validation/order';

/**
 * POST /api/v1/orders/[id]/fulfill
 *
 * Creates a shipment, converts the reserved stock into a dispatch and
 * recomputes the fulfilment roll-up from the lines. Supports partial shipments.
 */
export const POST = actionRoute({
  permission: 'order.fulfill',
  schema: fulfillOrderSchema,
  run: (id, input, actor) => fulfillOrder(id, input, actor),
  status: 201,
});
