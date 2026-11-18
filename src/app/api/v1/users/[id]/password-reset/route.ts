import { actionRoute } from '@/lib/api/crud';
import { forcePasswordReset } from '@/server/user-service';
import { isProduction } from '@/lib/env';

/**
 * POST /api/v1/users/[id]/password-reset
 *
 * Issues a temporary password, forces a change at next sign-in and revokes
 * every existing session. The generated password is emailed to the user; it is
 * only returned in the response outside production, where no mail server is
 * configured and an administrator would otherwise have no way to read it.
 */
export const POST = actionRoute({
  permission: 'user.reset_password',
  run: async (id, _input, actor) => {
    const result = await forcePasswordReset(id, actor);
    return {
      message: 'A temporary password has been emailed and all sessions were signed out.',
      ...(isProduction ? {} : { temporaryPassword: result.temporaryPassword }),
    };
  },
});
