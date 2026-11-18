import { actorFrom } from '@/lib/api/actor';
import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonNoContent, jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { readJsonBody } from '@/lib/request';
import { deleteAddress, updateAddress } from '@/server/customer-service';
import { addressSchema } from '@/validation/customer';

/** /api/v1/customers/addresses/[addressId] -- edit or remove one address. */
export const PATCH = withApi<{ addressId: string }>(async ({ request, params, client }) => {
  const user = await requirePermission('customer.update');
  const body = await readJsonBody(request);
  const input = parseBody(addressSchema, body);
  const result = await updateAddress(params.addressId, input, actorFrom(user, client));
  return jsonOk(result);
});

export const PUT = PATCH;

export const DELETE = withApi<{ addressId: string }>(async ({ params, client }) => {
  const user = await requirePermission('customer.update');
  await deleteAddress(params.addressId, actorFrom(user, client));
  return jsonNoContent();
});
