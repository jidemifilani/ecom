import type { Metadata } from 'next';
import { Monitor } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, PageHeader } from '@/components/ui/card';
import { Alert, Badge, EmptyState } from '@/components/ui/feedback';
import { Breadcrumbs } from '@/components/ui/navigation';
import { DetailList } from '@/components/ui/table';
import { requireUser } from '@/lib/auth/current-user';
import { publicConfig } from '@/lib/env';
import { formatDateTime, initials } from '@/lib/utils';
import { getUser, listUserSessions } from '@/server/user-service';

import { ChangePasswordForm, ProfileDetailsForm } from './profile-forms';

export const metadata: Metadata = { title: 'Your profile' };

/**
 * /profile
 *
 * Self-service only: details, password and active sessions. Status and roles
 * are deliberately absent -- a user changing their own access is the problem
 * this separation exists to prevent.
 *
 * `?changePassword=1` focuses the password section, which is where the login
 * flow sends a user whose account is flagged `mustChangePassword`.
 */
const ProfilePage = async ({
  searchParams,
}: {
  searchParams: Promise<{ changePassword?: string }>;
}) => {
  const [user, params] = await Promise.all([requireUser(), searchParams]);

  const [detail, sessions] = await Promise.all([
    getUser(user.id),
    listUserSessions(user.id, user.sessionId),
  ]);

  const focusPassword = params.changePassword === '1';

  return (
    <>
      <Breadcrumbs items={[{ label: 'Your profile' }]} />

      <PageHeader
        title="Your profile"
        description="Your details, password and signed-in devices."
      />

      {user.mustChangePassword ? (
        <Alert tone="warning" title="Choose a new password">
          Your account is using a temporary password. Set your own below before continuing.
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <ProfileDetailsForm
            initial={{
              firstName: detail.firstName,
              lastName: detail.lastName,
              phone: detail.phone,
              jobTitle: detail.jobTitle,
              timezone: detail.timezone,
              locale: detail.locale,
            }}
          />

          <ChangePasswordForm
            minLength={publicConfig.passwordMinLength}
            hasPassword={user.hasPassword}
            autoFocus={focusPassword}
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
                  {initials(detail.firstName, detail.lastName)}
                </span>
                <div className="min-w-0">
                  <p className="text-fg truncate text-sm font-medium">{detail.fullName}</p>
                  <p className="text-fg-muted truncate text-xs">{detail.email}</p>
                </div>
              </div>

              <DetailList
                items={[
                  {
                    label: 'Email',
                    value: (
                      <span className="break-all">
                        {detail.email}
                        <span className="text-fg-subtle mt-0.5 block text-xs">
                          Ask an administrator to change this.
                        </span>
                      </span>
                    ),
                  },
                  {
                    label: 'Roles',
                    value:
                      user.roles.length === 0 ? (
                        <Badge tone="warning">None assigned</Badge>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {user.roles.map((role) => (
                            <Badge key={role.key} tone="outline">
                              {role.name}
                            </Badge>
                          ))}
                        </span>
                      ),
                  },
                  {
                    label: 'Permissions',
                    value: `${user.permissions.size}${user.isSuperAdmin ? ' (unrestricted)' : ''}`,
                  },
                  {
                    label: 'Sign-in method',
                    value:
                      detail.authProvider === 'ENTRA_ID'
                        ? 'Microsoft Entra ID'
                        : 'Email and password',
                  },
                  { label: 'Last sign-in', value: formatDateTime(detail.lastLoginAt) },
                  { label: 'Member since', value: formatDateTime(detail.createdAt) },
                ]}
              />
            </CardContent>
          </Card>

          <Card as="section">
            <CardHeader>
              <CardTitle>Signed-in devices</CardTitle>
              <Badge tone="outline">{sessions.length}</Badge>
            </CardHeader>

            {sessions.length === 0 ? (
              <EmptyState icon={Monitor} title="No active sessions" />
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

            <CardContent className="pt-0">
              <p className="text-fg-subtle text-xs leading-relaxed">
                To end other sessions, change your password with
                &quot;Sign out my other devices&quot; switched on.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
};

export default ProfilePage;
