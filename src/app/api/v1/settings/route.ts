import { actorFrom } from '@/lib/api/actor';
import { BadRequestError } from '@/lib/api/errors';
import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { requirePermission } from '@/lib/auth/current-user';
import { readJsonBody } from '@/lib/request';
import { listSettingsForAdmin, updateSettings } from '@/server/settings-service';

/**
 * /api/v1/settings
 *
 * PATCH accepts a partial map of setting key to value. Unknown keys are
 * rejected rather than ignored, so a typo surfaces instead of silently doing
 * nothing, and each value is coerced and range-checked against the registry.
 */
export const GET = withApi(async () => {
  await requirePermission('setting.read');
  const settings = await listSettingsForAdmin();
  return jsonOk(settings);
});

export const PATCH = withApi(async ({ request, client }) => {
  const user = await requirePermission('setting.update');
  const body = await readJsonBody(request);

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestError('Send an object of setting keys and values.');
  }

  const actor = actorFrom(user, client);

  const updated = await updateSettings(body as Record<string, unknown>, {
    userId: actor.id,
    email: actor.email,
    ipAddress: actor.ipAddress,
    userAgent: actor.userAgent,
    requestId: actor.requestId,
  });

  return jsonOk(updated);
});

export const PUT = PATCH;
