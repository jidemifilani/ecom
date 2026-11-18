import { actionRoute } from '@/lib/api/crud';
import { refundOrder } from '@/server/order-service';
import { refundOrderSchema } from '@/validation/order';

/**
 * POST /api/v1/orders/[id]/refund
 *
 * Supports partial refunds. The service refuses to refund more than the
 * remaining balance, so repeated calls cannot over-refund an order.
 */
export const POST = actionRoute({
  permission: 'order.refund',
  schema: refundOrderSchema,
  run: (id, input, actor) => refundOrder(id, input, actor),
});
