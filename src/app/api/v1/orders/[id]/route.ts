import { itemRoute } from '@/lib/api/crud';
import { archiveOrder, getOrder, updateOrder } from '@/server/order-service';
import { updateOrderSchema } from '@/validation/order';

/**
 * /api/v1/orders/[id]
 *
 * PATCH edits contact details, notes and addresses only. Money and line items
 * are immutable once placed; corrections go through refunds and cancellations
 * so the trail stays honest.
 */
export const { GET, PATCH, PUT, DELETE } = itemRoute({
  get: { permission: 'order.read', run: (id) => getOrder(id) },
  update: {
    permission: 'order.update',
    schema: updateOrderSchema,
    run: (id, input, actor) => updateOrder(id, input, actor),
  },
  remove: { permission: 'order.delete', run: (id, actor) => archiveOrder(id, actor) },
});
