import { actionRoute } from '@/lib/api/crud';
import { changeOrderStatus } from '@/server/order-service';
import { updateOrderStatusSchema } from '@/validation/order';

/**
 * PATCH /api/v1/orders/[id]/status
 *
 * Moves an order along its state machine. Cancellation and refunds are
 * rejected here and must use their own endpoints, which capture a reason and
 * handle stock.
 */
export const PATCH = actionRoute({
  permission: 'order.update',
  schema: updateOrderStatusSchema,
  run: (id, input, actor) => changeOrderStatus(id, input, actor),
});

export const POST = PATCH;
