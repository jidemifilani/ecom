import { actorFrom } from '@/lib/api/actor';
import { withApi } from '@/lib/api/handler';
import { parseBody } from '@/lib/api/query';
import { jsonCreated, jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { readJsonBody } from '@/lib/request';
import { createVariant, getProduct } from '@/server/product-service';
import { createVariantSchema } from '@/validation/catalog';

/**
 * /api/v1/products/[id]/variants
 *
 * GET  - the variants of one product, with their stock figures.
 * POST - adds a variant, upserting its option axes and opening stock.
 */
export const GET = withApi<{ id: string }>(async ({ params }) => {
  await requirePermission('product.read');
  const product = await getProduct(params.id);
  return jsonOk(product.variants);
});

export const POST = withApi<{ id: string }>(async ({ request, params, client }) => {
  const user = await requirePermission('product.update');
  const body = await readJsonBody(request);
  const input = parseBody(createVariantSchema, body);
  const variant = await createVariant(params.id, input, actorFrom(user, client));
  return jsonCreated(variant);
});
