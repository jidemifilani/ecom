import { actorFrom } from '@/lib/api/actor';
import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonNoContent, jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { readJsonBody } from '@/lib/request';
import { archiveVariant, updateVariant } from '@/server/product-service';
import { updateVariantSchema } from '@/validation/catalog';

/**
 * /api/v1/products/variants/[variantId]
 *
 * Variants live under their own path because the client edits them
 * individually, without needing to know the parent product id.
 */
export const PATCH = withApi<{ variantId: string }>(async ({ request, params, client }) => {
  const user = await requirePermission('product.update');
  const body = await readJsonBody(request);
  const input = parseBody(updateVariantSchema, body);
  const variant = await updateVariant(params.variantId, input, actorFrom(user, client));
  return jsonOk(variant);
});

export const PUT = PATCH;

export const DELETE = withApi<{ variantId: string }>(async ({ params, client }) => {
  const user = await requirePermission('product.update');
  await archiveVariant(params.variantId, actorFrom(user, client));
  return jsonNoContent();
});
