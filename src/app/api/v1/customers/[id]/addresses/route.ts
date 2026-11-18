import { actionRoute } from '@/lib/api/crud';
import { addAddress } from '@/server/customer-service';
import { addressSchema } from '@/validation/customer';

/** POST /api/v1/customers/[id]/addresses -- adds an address to a customer. */
export const POST = actionRoute({
  permission: 'customer.update',
  schema: addressSchema,
  run: (id, input, actor) => addAddress(id, input, actor),
  status: 201,
});
