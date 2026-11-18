import type { Metadata } from 'next';
import Link from 'next/link';
import { Plus, UserPlus, Users as UsersIcon } from 'lucide-react';

import { DataTable, type Column } from '@/components/data/data-table';
import { FilterBar } from '@/components/data/filter-bar';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { safeListQuery } from '@/lib/list-query';
import { can } from '@/lib/rbac/guard';
import { formatDateTime, initials } from '@/lib/utils';
import { toSearchParams, urlBuilder, hasActiveFilters } from '@/lib/url';
import { listRoleOptions } from '@/server/role-service';
import { listUsers, type UserListItem } from '@/server/user-service';
import { USER_SORT_FIELDS } from '@/validation/user';

export const metadata: Metadata = { title: 'Users' };

const FILTER_KEYS = ['status', 'roleId'] as const;

/**
 * /users
 *
 * The canonical list screen: URL-driven search, filters, sorting and paging,
 * one column definition rendering both a table (md and up) and cards (below
 * md), and row actions gated on the viewer's permissions.
 *
 * Data is fetched directly through the service layer rather than via the REST
 * API. A server component is already inside the trust boundary, so going over
 * HTTP would add a round trip and a second serialisation for no benefit -- and
 * `requirePermission` enforces the same check the API route would.
 */
const UsersPage = async ({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => {
  const [viewer, rawParams] = await Promise.all([
    requirePermission('user.read'),
    searchParams,
  ]);

  const params = toSearchParams(rawParams);
  const buildHref = urlBuilder('/users', params);

  const query = safeListQuery(params, {
    sortable: USER_SORT_FIELDS,
    defaultSort: 'createdAt',
    filterKeys: FILTER_KEYS,
  });

  const [result, roleOptions] = await Promise.all([listUsers(query), listRoleOptions()]);

  const canEdit = can(viewer, 'user.update');
  const canCreate = can(viewer, 'user.create');

  const columns: Column<UserListItem>[] = [
    {
      key: 'name',
      header: 'Name',
      sortField: 'firstName',
      mobile: 'title',
      render: (row) => (
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="bg-surface-sunken text-fg-muted grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold"
          >
            {initials(row.firstName, row.lastName)}
          </span>
          <span className="min-w-0">
            <Link
              href={`/users/${row.id}`}
              className="text-fg hover:text-accent block truncate font-medium"
            >
              {row.fullName}
            </Link>
            <span className="text-fg-muted block truncate text-xs">{row.email}</span>
          </span>
        </div>
      ),
    },
    {
      key: 'roles',
      header: 'Roles',
      mobile: 'field',
      render: (row) =>
        row.roles.length === 0 ? (
          <Badge tone="warning">No roles</Badge>
        ) : (
          <span className="flex flex-wrap gap-1">
            {row.roles.map((role) => (
              <Badge key={role.id} tone="outline">
                {role.name}
              </Badge>
            ))}
          </span>
        ),
    },
    {
      key: 'jobTitle',
      header: 'Job title',
      mobile: 'field',
      render: (row) => row.jobTitle ?? <span className="text-fg-subtle">-</span>,
    },
    {
      key: 'status',
      header: 'Status',
      sortField: 'status',
      mobile: 'badge',
      render: (row) => (
        <span className="flex items-center gap-1.5">
          <StatusBadge status={row.deletedAt ? 'ARCHIVED' : row.status} />
          {row.isLocked ? <Badge tone="danger">Locked</Badge> : null}
        </span>
      ),
    },
    {
      key: 'lastLoginAt',
      header: 'Last sign-in',
      sortField: 'lastLoginAt',
      mobile: 'field',
      render: (row) =>
        row.lastLoginAt ? (
          formatDateTime(row.lastLoginAt)
        ) : (
          <span className="text-fg-subtle">Never</span>
        ),
    },
  ];

  return (
    <>
      <Breadcrumbs items={[{ label: 'Users' }]} />

      <PageHeader
        title="Users"
        description="Staff accounts, their roles and their sign-in activity."
        actions={
          canCreate ? (
            <Button asChild>
              <Link href="/users/new">
                <Plus aria-hidden="true" />
                Invite user
              </Link>
            </Button>
          ) : undefined
        }
      />

      <FilterBar
        searchPlaceholder="Search name, email or job title"
        filters={[
          {
            key: 'status',
            label: 'Status',
            options: [
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INVITED', label: 'Invited' },
              { value: 'SUSPENDED', label: 'Suspended' },
            ],
          },
          {
            key: 'roleId',
            label: 'Role',
            options: roleOptions.map((role) => ({ value: role.id, label: role.name })),
          },
        ]}
      />

      <DataTable
        rows={result.items}
        columns={columns}
        getRowId={(row) => row.id}
        caption="Staff users, with their roles, status and last sign-in"
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        buildSortHref={(field, order) => buildHref({ sortBy: field, sortOrder: order })}
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        buildPageHref={(page) => buildHref({ page })}
        itemLabel="user"
        emptyIcon={UsersIcon}
        emptyTitle="No users yet"
        emptyDescription="Invite a colleague to give them access to the back office."
        emptyAction={
          canCreate ? (
            <Button asChild>
              <Link href="/users/new">
                <UserPlus aria-hidden="true" />
                Invite your first user
              </Link>
            </Button>
          ) : undefined
        }
        filtersActive={hasActiveFilters(params, FILTER_KEYS)}
        clearFiltersHref="/users"
        rowActions={(row) => (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/users/${row.id}`}>
              {canEdit ? 'Manage' : 'View'}
              <span className="sr-only"> {row.fullName}</span>
            </Link>
          </Button>
        )}
      />
    </>
  );
};

export default UsersPage;
