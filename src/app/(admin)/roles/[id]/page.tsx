import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { NotFoundError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/auth/current-user';
import { can, isSuperAdmin } from '@/lib/rbac/guard';
import { pluralize } from '@/lib/utils';
import { getRole, listPermissionCatalog } from '@/server/role-service';

import { RoleForm } from '../role-form';

export const metadata: Metadata = { title: 'Role' };

/**
 * /roles/[id]
 *
 * Read-only for a viewer without `role.update`, or when the role outranks
 * them. The form itself reports why rather than presenting controls that would
 * be rejected on save.
 */
const RoleDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const [viewer, { id }] = await Promise.all([requirePermission('role.read'), params]);

  const role = await getRole(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const catalog = listPermissionCatalog();

  // A viewer may only edit a role at or below their own authority.
  const outranksViewer = !isSuperAdmin(viewer) && role.level < viewer.level;
  const canUpdate = can(viewer, 'role.update') && !outranksViewer;

  return (
    <>
      <Breadcrumbs items={[{ label: 'Roles', href: '/roles' }, { label: role.name }]} />

      <PageHeader
        title={role.name}
        description={role.description ?? 'No description set.'}
        actions={
          <div className="flex items-center gap-2">
            <Badge tone={role.level === 0 ? 'danger' : role.level <= 10 ? 'warning' : 'outline'}>
              Level {role.level}
            </Badge>
            {role.isSystem ? <Badge tone="neutral">Built-in</Badge> : null}
            {can(viewer, 'user.read') ? (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/users?roleId=${role.id}`}>
                  {role.userCount} {pluralize(role.userCount, 'user')}
                </Link>
              </Button>
            ) : null}
          </div>
        }
      />

      {outranksViewer ? (
        <div className="rounded-card border-warning/30 bg-warning-soft text-warning border p-4 text-sm">
          This role outranks your own, so it is shown read-only.
        </div>
      ) : null}

      <div className="max-w-4xl">
        {canUpdate ? (
          <RoleForm
            mode="edit"
            catalog={catalog}
            initial={{
              id: role.id,
              key: role.key,
              name: role.name,
              description: role.description,
              level: role.level,
              isSystem: role.isSystem,
              permissions: role.permissions,
              userCount: role.userCount,
            }}
            minLevel={isSuperAdmin(viewer) ? 1 : Math.max(1, viewer.level)}
            canDelete={can(viewer, 'role.delete')}
          />
        ) : (
          <RolePermissionSummary
            catalog={catalog}
            granted={role.permissions}
            isSuperAdminRole={role.key === 'super_admin'}
          />
        )}
      </div>
    </>
  );
};

/** Read-only permission view, for a viewer who cannot edit this role. */
const RolePermissionSummary = ({
  catalog,
  granted,
  isSuperAdminRole,
}: {
  catalog: Record<string, { key: string; description: string }[]>;
  granted: string[];
  isSuperAdminRole: boolean;
}) => {
  const held = new Set(granted);

  return (
    <div className="rounded-card border-line bg-surface border">
      <div className="border-line border-b px-5 py-4">
        <h2 className="text-fg text-base font-semibold">Permissions</h2>
        <p className="text-fg-muted mt-1 text-sm">
          {isSuperAdminRole
            ? 'This role holds every permission, including any added in future releases.'
            : `${granted.length} permission(s) granted.`}
        </p>
      </div>

      <div className="space-y-5 px-5 py-4">
        {Object.entries(catalog).map(([group, entries]) => {
          const active = entries.filter((entry) => isSuperAdminRole || held.has(entry.key));
          if (active.length === 0) return null;

          return (
            <div key={group}>
              <h3 className="text-fg-subtle text-xs font-semibold tracking-wider uppercase">
                {group}
              </h3>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {active.map((entry) => (
                  <li key={entry.key} className="text-fg-muted text-sm">
                    {entry.description}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RoleDetailPage;
