import { actionRoute } from '@/lib/api/crud';
import { recordPayment } from '@/server/order-service';
import { recordPaymentSchema } from '@/validation/order';

/**
 * POST /api/v1/orders/[id]/payments
 *
 * Records a payment taken outside the app (bank transfer, cash on delivery, a
 * card terminal). A payment that settles the balance confirms a pending order.
 */
export const POST = actionRoute({
  permission: 'order.update',
  schema: recordPaymentSchema,
  run: (id, input, actor) => recordPayment(id, input, actor),
  status: 201,
});
