import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Monitor } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui/card';
import { Badge, EmptyState, StatusBadge } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { DetailList } from '@/components/ui/table';
import { actorFrom } from '@/lib/api/actor';
import { NotFoundError } from '@/lib/api/errors';
import { requirePermission } from '@/lib/auth/current-user';
import { can, isSuperAdmin } from '@/lib/rbac/guard';
import { getClientInfo } from '@/lib/request';
import { formatDateTime, initials } from '@/lib/utils';
import { getEntityHistory } from '@/server/audit-service';
import { listAssignableRoles } from '@/server/role-service';
import { getUser, listUserSessions } from '@/server/user-service';

import {
  UserDangerZone,
  UserEditForm,
  UserRestoreAction,
  UserRolesForm,
} from './user-detail-forms';

export const metadata: Metadata = { title: 'User' };

/**
 * /users/[id]
 *
 * Shows what the viewer is allowed to see and offers only the actions they are
 * allowed to take. Two rules shape the page:
 *  * A viewer cannot act on a user who outranks them, so the forms are
 *    read-only in that case and the reason is stated rather than the controls
 *    silently doing nothing.
 *  * A viewer editing their own record cannot change their status or roles,
 *    which is the usual way an administrator locks themselves out.
 */
const UserDetailPage = async ({ params }: { params: Promise<{ id: string }> }) => {
  const [viewer, { id }] = await Promise.all([requirePermission('user.read'), params]);

  const user = await getUser(id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const requestHeaders = await headers();
  const client = getClientInfo(new Request('http://internal', { headers: requestHeaders }));
  const actor = actorFrom(viewer, client);

  const [assignableRoles, sessions, history] = await Promise.all([
    can(viewer, 'user.assign_roles') ? listAssignableRoles(actor) : Promise.resolve([]),
    listUserSessions(user.id, viewer.sessionId),
    can(viewer, 'audit_log.read')
      ? getEntityHistory('User', user.id, 15)
      : Promise.resolve([]),
  ]);

  const isSelf = user.id === viewer.id;

  // A viewer may only act on a user whose authority is at or below their own.
  const outranksViewer = !isSuperAdmin(viewer) && user.level < viewer.level;
  const canEdit = can(viewer, 'user.update') && !outranksViewer;
  const canAssign = can(viewer, 'user.assign_roles') && !outranksViewer;

  const assignableIds = new Set(assignableRoles.map((role) => role.id));
  const lockedRoleNames = user.roles
    .filter((role) => !assignableIds.has(role.id))
    .map((role) => role.name);

  return (
    <>
      <Breadcrumbs
        items={[{ label: 'Users', href: '/users' }, { label: user.fullName }]}
      />

      <PageHeader
        title={user.fullName}
        description={user.jobTitle ? `${user.jobTitle} - ${user.email}` : user.email}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={user.deletedAt ? 'ARCHIVED' : user.status} />
            {user.isLocked ? <Badge tone="danger">Locked</Badge> : null}
            {user.deletedAt && can(viewer, 'user.update') ? (
              <UserRestoreAction userId={user.id} />
            ) : null}
          </div>
        }
      />

      {outranksViewer ? (
        <div className="rounded-card border-warning/30 bg-warning-soft text-warning border p-4 text-sm">
          This account holds a role that outranks yours, so it is shown read-only. A Super Admin
          can make changes.
        </div>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <UserEditForm
            userId={user.id}
            initial={{
              firstName: user.firstName,
              lastName: user.lastName,
              phone: user.phone,
              jobTitle: user.jobTitle,
              avatarUrl: user.avatarUrl,
              status: user.status,
            }}
            isSelf={isSelf}
            canEdit={canEdit}
          />

          <UserRolesForm
            userId={user.id}
            assignedRoleIds={user.roles.map((role) => role.id)}
            assignableRoles={assignableRoles}
            lockedRoleNames={lockedRoleNames}
            isSelf={isSelf}
            canAssign={canAssign}
          />

          <UserDangerZone
            userId={user.id}
            userName={user.fullName}
            isArchived={user.deletedAt !== null}
            isSelf={isSelf}
            activeSessionCount={user.activeSessionCount}
            permissions={{
              resetPassword: can(viewer, 'user.reset_password') && !outranksViewer,
              revokeSessions: can(viewer, 'user.revoke_sessions') && !outranksViewer,
              archive: can(viewer, 'user.delete') && !outranksViewer,
            }}
          />
        </div>

        <div className="space-y-5">
          <Card as="section">
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mb-4 flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="bg-primary text-on-primary grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold"
                >
                  {initials(user.firstName, user.lastName)}
                </span>
                <div className="min-w-0">
                  <p className="text-fg truncate text-sm font-medium">{user.fullName}</p>
                  <p className="text-fg-muted truncate text-xs">{user.email}</p>
                </div>
              </div>

              <DetailList
                items={[
                  {
                    label: 'Sign-in method',
                    value:
                      user.authProvider === 'ENTRA_ID' ? 'Microsoft Entra ID' : 'Email and password',
                  },
                  {
                    label: 'Must change password',
                    value: user.mustChangePassword ? 'Yes, at next sign-in' : 'No',
                  },
                  { label: 'Last sign-in', value: formatDateTime(user.lastLoginAt) },
                  {
                    label: 'Last IP address',
                    value: user.lastLoginIp ?? <span className="text-fg-subtle">Unknown</span>,
                  },
                  {
                    label: 'Failed attempts',
                    value: String(user.failedLoginCount),
                  },
                  {
                    label: 'Locked until',
                    value: user.lockedUntil ? (
                      formatDateTime(user.lockedUntil)
                    ) : (
                      <span className="text-fg-subtle">Not locked</span>
                    ),
                  },
                  { label: 'Created', value: formatDateTime(user.createdAt) },
                  { label: 'Updated', value: formatDateTime(user.updatedAt) },
                ]}
              />
            </CardContent>
          </Card>

          <Card as="section">
            <CardHeader>
              <CardTitle>Active sessions</CardTitle>
              <Badge tone="outline">{sessions.length}</Badge>
            </CardHeader>

            {sessions.length === 0 ? (
              <EmptyState
                icon={Monitor}
                title="No active sessions"
                description="This user is not signed in on any device."
              />
            ) : (
              <ul className="divide-line divide-y">
                {sessions.map((session) => (
                  <li key={session.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-fg min-w-0 flex-1 truncate text-sm">
                        {session.ipAddress ?? 'Unknown IP'}
                      </p>
                      {session.isCurrent ? <Badge tone="accent">This device</Badge> : null}
                    </div>
                    <p className="text-fg-subtle mt-0.5 line-clamp-2 text-xs leading-relaxed">
                      {session.userAgent ?? 'Unknown device'}
                    </p>
                    <p className="text-fg-subtle mt-1 text-xs">
                      Last active {formatDateTime(session.lastSeenAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {can(viewer, 'audit_log.read') ? (
            <Card as="section">
              <CardHeader>
                <CardTitle>Recent changes</CardTitle>
              </CardHeader>

              {history.length === 0 ? (
                <EmptyState title="No changes recorded" />
              ) : (
                <ul className="divide-line divide-y">
                  {history.map((entry) => (
                    <li key={entry.id} className="px-5 py-3">
                      <div className="flex items-start gap-2">
                        <Badge tone="outline" className="shrink-0">
                          {entry.action.toLowerCase().replace(/_/g, ' ')}
                        </Badge>
                        <p className="text-fg-subtle min-w-0 flex-1 text-xs">
                          {entry.actorName ?? entry.actorEmail ?? 'System'}
                        </p>
                      </div>
                      <p className="text-fg-subtle mt-1 text-xs">
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
};

export default UserDetailPage;
