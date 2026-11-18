import { itemRoute } from '@/lib/api/crud';
import { archiveDiscount, getDiscount, updateDiscount } from '@/server/discount-service';
import { updateDiscountSchema } from '@/validation/discount';

/** /api/v1/discounts/[id] -- read, update or archive a discount. */
export const { GET, PATCH, PUT, DELETE } = itemRoute({
  get: { permission: 'discount.read', run: (id) => getDiscount(id) },
  update: {
    permission: 'discount.update',
    schema: updateDiscountSchema,
    run: (id, input, actor) => updateDiscount(id, input, actor),
  },
  remove: { permission: 'discount.delete', run: (id, actor) => archiveDiscount(id, actor) },
});
