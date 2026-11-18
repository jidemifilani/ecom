import { itemRoute } from '@/lib/api/crud';
import { archiveCustomer, getCustomer, updateCustomer } from '@/server/customer-service';
import { updateCustomerSchema } from '@/validation/customer';

/**
 * /api/v1/customers/[id]
 *
 * Blocking a customer revokes their storefront sessions immediately rather
 * than waiting for the cookie to lapse.
 */
export const { GET, PATCH, PUT, DELETE } = itemRoute({
  get: { permission: 'customer.read', run: (id) => getCustomer(id) },
  update: {
    permission: 'customer.update',
    schema: updateCustomerSchema,
    run: (id, input, actor) => updateCustomer(id, input, actor),
  },
  remove: { permission: 'customer.delete', run: (id, actor) => archiveCustomer(id, actor) },
});
