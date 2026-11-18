import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, ShieldCheck } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { can } from '@/lib/rbac/guard';
import { ALL_PERMISSION_KEYS } from '@/lib/rbac/permissions';
import { hasActiveFilters, toSearchParams, urlBuilder } from '@/lib/url';
import { formatNumber, pluralize } from '@/lib/utils';
import { listRoles, type RoleListItem } from '@/server/role-service';
import { ROLE_SORT_FIELDS } from '@/validation/role';

export const metadata: Metadata = { title: 'Roles' };

/**
 * /roles
 *
 * Roles are ordered by authority by default (level ascending), which is the
 * order people reason about them in: Super Admin first, most restricted last.
 */
const RolesPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('role.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/roles', params);

  const query = safeListQuery(params, {
    sortable: ROLE_SORT_FIELDS,
    defaultSort: 'level',
    defaultSortOrder: 'asc',
  });

  const result = await listRoles(query);
  const canCreate = can(viewer, 'role.create');
  const totalPermissions = ALL_PERMISSION_KEYS.length;

  const columns: Column<RoleListItem>[] = [
    {
      key: 'name',
      header: 'Role',
      sortField: 'name',
      mobile: 'title',
      render: (row) => (
        <span className="min-w-0">
          <Link
            href={`/roles/${row.id}`}
            className="text-fg hover:text-accent block truncate font-medium"
          >
            {row.name}
          </Link>
          <code className="text-fg-subtle block truncate font-mono text-xs">{row.key}</code>
        </span>
      ),
    },
    {
      key: 'description',
      header: 'Description',
      mobile: 'hidden',
      className: 'max-w-md',
      render: (row) => (
        <span className="text-fg-muted line-clamp-2 text-sm leading-relaxed">
          {row.description ?? '-'}
        </span>
      ),
    },
    {
      key: 'level',
      header: 'Authority',
      sortField: 'level',
      mobile: 'field',
      mobileLabel: 'Authority',
      render: (row) => (
        <span className="flex items-center gap-2">
          <Badge tone={row.level === 0 ? 'danger' : row.level <= 10 ? 'warning' : 'outline'}>
            Level {row.level}
          </Badge>
          {row.isSystem ? <Badge tone="neutral">Built-in</Badge> : null}
        </span>
      ),
    },
    {
      key: 'permissionCount',
      header: 'Permissions',
      mobile: 'field',
      numeric: true,
      render: (row) => (
        <span className="text-fg-muted text-sm">
          {row.key === 'super_admin'
            ? `All ${totalPermissions}`
            : `${formatNumber(row.permissionCount)} of ${totalPermissions}`}
        </span>
      ),
    },
    {
      key: 'userCount',
      header: 'Users',
      mobile: 'field',
      numeric: true,
      render: (row) => (
        <span className="text-fg text-sm">
          {formatNumber(row.userCount)}
          <span className="sr-only"> {pluralize(row.userCount, 'user')}</span>
        </span>
      ),
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Roles' }]} />

      <PageHeader
        title="Roles and permissions"
        description="A role is a named bundle of permissions. Permissions are defined in code; roles are composed here, so new roles need no deployment."
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/roles/new">
                <Plus aria-hidden="true" />
                New role
              </Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar searchPlaceholder="Search roles" />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Roles with their authority level, permission count and number of users"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="role"
        emptyIcon={ShieldCheck}
        emptyTitle="No roles found"
        emptyDescription="The built-in roles are created by the database seed."
        filtersActive={hasActiveFilters(params, [])}
        clearFiltersHref="/roles"
        rowActions={(row) => (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/roles/${row.id}`}>
              {can(viewer, 'role.update') && row.key !== 'super_admin' ? 'Edit' : 'View'}
              <span className="sr-only"> {row.name}</span>
            </Link>
          </Button>
        )}
      />
    </>
  );
};

export default RolesPage;
