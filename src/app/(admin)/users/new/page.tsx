import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { PageHeader } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/ui/navigation';
import { actorFrom } from '@/lib/api/actor';
import { requirePermission } from '@/lib/auth/current-user';
import { getClientInfo } from '@/lib/request';
import { listAssignableRoles } from '@/server/role-service';

import { UserForm } from './user-form';

export const metadata: Metadata = { title: 'Invite user' };

/**
 * /users/new
 *
 * The role picker is built from `listAssignableRoles`, which filters by the
 * actor's own authority level. An Admin therefore cannot even see Super Admin
 * as an option, let alone submit it.
 */
const NewUserPage = async () => {
  const user = await requirePermission('user.create');

  // The service actor is derived the same way an API route derives it, so the
  // authority filter behaves identically on both paths.
  const requestHeaders = await headers();
  const client = getClientInfo(new Request('http://internal', { headers: requestHeaders }));
  const roles = await listAssignableRoles(actorFrom(user, client));

  return (
    <>
      <Breadcrumbs items={[{ label: 'Users', href: '/users' }, { label: 'Invite user' }]} />

      <PageHeader
        title="Invite a user"
        description="Create a staff account and choose what it can do. The user sets their own password on first sign-in."
      />

      <div className="max-w-3xl">
        <UserForm roles={roles} />
      </div>
    </>
  );
};

export default NewUserPage;
