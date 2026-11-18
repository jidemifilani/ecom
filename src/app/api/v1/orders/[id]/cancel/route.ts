import { actionRoute } from '@/lib/api/crud';
import { cancelOrder } from '@/server/order-service';
import { cancelOrderSchema } from '@/validation/order';

/**
 * POST /api/v1/orders/[id]/cancel
 *
 * Cancels an order and, by default, returns the unshipped units to stock.
 */
export const POST = actionRoute({
  permission: 'order.cancel',
  schema: cancelOrderSchema,
  run: (id, input, actor) => cancelOrder(id, input, actor),
});
