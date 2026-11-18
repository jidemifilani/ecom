import { parseBody } from '@/lib/api/query';
import { withApi } from '@/lib/api/handler';
import { jsonOk } from '@/lib/api/responses';
import { readJsonBody } from '@/lib/request';
import { requireUser } from '@/lib/auth/current-user';
import { changeStaffPassword } from '@/server/auth-service';
import { changePasswordSchema } from '@/validation/auth';

/**
 * POST /api/auth/change-password
 *
 * Self-service change for the signed-in user. Requires the current password,
 * so a stolen session alone cannot be used to lock the owner out.
 */
export const POST = withApi(async ({ request, client }) => {
  const user = await requireUser();
  const body = await readJsonBody(request);
  const input = parseBody(changePasswordSchema, body);

  const result = await changeStaffPassword(
    user.id,
    {
      currentPassword: input.currentPassword,
      password: input.password,
      revokeOtherSessions: input.revokeOtherSessions,
    },
    {
      ipAddress: client.ipAddress,
      userAgent: client.userAgent,
      sessionId: user.sessionId,
    },
  );

  return jsonOk({
    message:
      result.revokedSessions > 0
        ? `Password updated. ${result.revokedSessions} other session(s) were signed out.`
        : 'Password updated.',
    revokedSessions: result.revokedSessions,
  });
});
