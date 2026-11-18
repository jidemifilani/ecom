import type { Metadata } from 'next';

import { PageHeader } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { isSuperAdmin } from '@/lib/rbac/guard';
import { listPermissionCatalog } from '@/server/role-service';

import { RoleForm } from '../role-form';

export const metadata: Metadata = { title: 'New role' };

/**
 * /roles/new
 *
 * `minLevel` caps how powerful a role the actor may create: a super admin can
 * go down to level 1, anyone else no lower than their own level. The server
 * enforces the same rule, so this only keeps the form honest.
 */
const NewRolePage = async () => {
  const viewer = await requirePermission('role.create');
  const catalog = listPermissionCatalog();

  return (
    <>
      <Breadcrumbs items={[{ label: 'Roles', href: '/roles' }, { label: 'New role' }]} />

      <PageHeader
        title="Create a role"
        description="Choose the permissions this role grants. You can change them later, and changes apply to every holder immediately."
      />

      <div className="max-w-4xl">
        <RoleForm
          mode="create"
          catalog={catalog}
          minLevel={isSuperAdmin(viewer) ? 1 : Math.max(1, viewer.level)}
          canDelete={false}
        />
      </div>
    </>
  );
};

export default NewRolePage;
