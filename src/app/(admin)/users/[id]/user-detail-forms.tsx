'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, KeyRound, LogOut, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Label, Select } from '@/components/ui/form';
import { ConfirmDialog, useConfirm } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { assignRolesSchema, updateUserSchema, type UpdateUserInput } from '@/validation/user';

type EditValues = z.input<typeof updateUserSchema>;

export type RoleOption = { id: string; name: string; level: number; key: string };

/** Profile editor. Status is locked when the viewer is editing themselves. */
export const UserEditForm = ({
  userId,
  initial,
  isSelf,
  canEdit,
}: {
  userId: string;
  initial: {
    firstName: string;
    lastName: string;
    phone: string | null;
    jobTitle: string | null;
    avatarUrl: string | null;
    status: string;
  };
  isSelf: boolean;
  canEdit: boolean;
}) => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<EditValues, unknown, UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: {
      firstName: initial.firstName,
      lastName: initial.lastName,
      phone: initial.phone ?? '',
      jobTitle: initial.jobTitle ?? '',
      avatarUrl: initial.avatarUrl ?? '',
      status: initial.status as EditValues['status'],
    },
  });

  const onSubmit = async (values: UpdateUserInput): Promise<void> => {
    setFormError(null);

    try {
      await api.patch(`/api/v1/users/${userId}`, values);
      toast.success('User updated');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.byField;
        let handled = false;
        for (const key of ['firstName', 'lastName', 'phone', 'jobTitle', 'status'] as const) {
          const message = fields[key];
          if (message) {
            setError(key, { message });
            handled = true;
          }
        }
        if (!handled) setFormError(error.message);
        return;
      }
      setFormError(toErrorMessage(error));
    }
  };

  return (
    <Card as="section">
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={errors.firstName?.message} required>
              {(props) => <Input {...props} {...register('firstName')} disabled={!canEdit} />}
            </Field>

            <Field label="Last name" error={errors.lastName?.message} required>
              {(props) => <Input {...props} {...register('lastName')} disabled={!canEdit} />}
            </Field>

            <Field label="Job title" error={errors.jobTitle?.message}>
              {(props) => <Input {...props} {...register('jobTitle')} disabled={!canEdit} />}
            </Field>

            <Field label="Phone" error={errors.phone?.message}>
              {(props) => (
                <Input {...props} {...register('phone')} type="tel" disabled={!canEdit} />
              )}
            </Field>

            <Field
              label="Status"
              error={errors.status?.message}
              hint={
                isSelf
                  ? 'You cannot change your own status. Another administrator must do it.'
                  : 'Suspending an account signs it out of every device immediately.'
              }
              className="sm:col-span-2"
            >
              {(props) => (
                <Select {...props} {...register('status')} disabled={!canEdit || isSelf}>
                  <option value="ACTIVE">Active</option>
                  <option value="INVITED">Invited</option>
                  <option value="SUSPENDED">Suspended</option>
                </Select>
              )}
            </Field>
          </div>
        </CardContent>

        {canEdit ? (
          <CardFooter>
            <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
              <Save aria-hidden="true" />
              Save changes
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
};

/** Role assignment. Disabled entirely when editing your own account. */
export const UserRolesForm = ({
  userId,
  assignedRoleIds,
  assignableRoles,
  lockedRoleNames,
  isSelf,
  canAssign,
}: {
  userId: string;
  assignedRoleIds: string[];
  assignableRoles: RoleOption[];
  /** Roles the user holds that this viewer may not alter. */
  lockedRoleNames: string[];
  isSelf: boolean;
  canAssign: boolean;
}) => {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(assignedRoleIds);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const changed =
    selected.length !== assignedRoleIds.length ||
    selected.some((id) => !assignedRoleIds.includes(id));

  const save = async (): Promise<void> => {
    setFormError(null);

    const parsed = assignRolesSchema.safeParse({ roleIds: selected });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Assign at least one role.');
      return;
    }

    setSaving(true);
    try {
      await api.put(`/api/v1/users/${userId}/roles`, parsed.data);
      toast.success('Roles updated', { description: 'Access changes apply immediately.' });
      router.refresh();
    } catch (error) {
      setFormError(toErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const disabled = !canAssign || isSelf;

  return (
    <Card as="section">
      <CardHeader>
        <CardTitle>Roles and access</CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        {isSelf ? (
          <Alert tone="info">
            You cannot change your own roles. This prevents an administrator from accidentally
            removing their own access.
          </Alert>
        ) : null}

        {lockedRoleNames.length > 0 ? (
          <Alert tone="warning" title="Some roles are not editable by you">
            This user holds {lockedRoleNames.join(', ')}, which outranks your own role. A Super
            Admin must make changes here.
          </Alert>
        ) : null}

        {assignableRoles.length === 0 ? (
          <p className="text-fg-muted text-sm">There are no roles you are able to grant.</p>
        ) : (
          <fieldset disabled={disabled}>
            <legend className="sr-only">Assigned roles</legend>
            <ul className="divide-line divide-y">
              {assignableRoles.map((role) => {
                const inputId = `assign-role-${role.id}`;
                return (
                  <li key={role.id} className="flex items-start gap-3 py-3">
                    <Checkbox
                      id={inputId}
                      checked={selected.includes(role.id)}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        setSelected((current) =>
                          checked === true
                            ? [...current, role.id]
                            : current.filter((value) => value !== role.id),
                        )
                      }
                      className="mt-0.5"
                    />
                    <div className="min-w-0 flex-1">
                      <Label htmlFor={inputId} className="font-medium">
                        {role.name}
                      </Label>
                      <p className="text-fg-subtle mt-0.5 text-xs">Authority level {role.level}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
      </CardContent>

      {!disabled && assignableRoles.length > 0 ? (
        <CardFooter>
          <Button onClick={() => void save()} loading={saving} disabled={!changed}>
            <ShieldCheck aria-hidden="true" />
            Update roles
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
};

/** Security actions: force a password reset, sign out everywhere, archive. */
export const UserDangerZone = ({
  userId,
  userName,
  isArchived,
  isSelf,
  permissions,
  activeSessionCount,
}: {
  userId: string;
  userName: string;
  isArchived: boolean;
  isSelf: boolean;
  permissions: {
    resetPassword: boolean;
    revokeSessions: boolean;
    archive: boolean;
  };
  activeSessionCount: number;
}) => {
  const router = useRouter();
  const resetConfirm = useConfirm();
  const revokeConfirm = useConfirm();
  const archiveConfirm = useConfirm();

  const [generated, setGenerated] = useState<string | null>(null);

  const forceReset = async (): Promise<void> => {
    await resetConfirm.run(async () => {
      try {
        const result = await api.post<{ message: string; temporaryPassword?: string }>(
          `/api/v1/users/${userId}/password-reset`,
        );
        setGenerated(result.temporaryPassword ?? null);
        toast.success('Password reset', { description: result.message });
        router.refresh();
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    });
  };

  const revokeSessions = async (): Promise<void> => {
    await revokeConfirm.run(async () => {
      try {
        const result = await api.delete<{ revoked: number }>(
          `/api/v1/users/${userId}/sessions`,
        );
        toast.success(
          result.revoked > 0
            ? `Signed out of ${result.revoked} session(s)`
            : 'There were no active sessions',
        );
        router.refresh();
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    });
  };

  const archive = async (): Promise<void> => {
    await archiveConfirm.run(async () => {
      try {
        await api.delete(`/api/v1/users/${userId}`);
        toast.success('User archived');
        router.push('/users');
        router.refresh();
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    });
  };

  const anyAvailable =
    permissions.resetPassword || permissions.revokeSessions || permissions.archive;

  if (!anyAvailable || isArchived) return null;

  return (
    <Card as="section" className="border-danger/30">
      <CardHeader>
        <CardTitle>Security actions</CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {generated ? (
          <Alert tone="info" title="Temporary password">
            <p className="leading-relaxed">
              Share this over a channel other than email, then ask the user to change it:
            </p>
            <code className="bg-surface-sunken mt-2 inline-block rounded px-2 py-1 font-mono text-xs">
              {generated}
            </code>
          </Alert>
        ) : null}

        {permissions.resetPassword ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-fg text-sm font-medium">Force a password reset</p>
              <p className="text-fg-muted text-xs leading-relaxed">
                Issues a temporary password, emails it, and signs the user out everywhere.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={resetConfirm.ask}>
              <KeyRound aria-hidden="true" />
              Reset password
            </Button>
          </div>
        ) : null}

        {permissions.revokeSessions ? (
          <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="min-w-0">
              <p className="text-fg text-sm font-medium">Sign out everywhere</p>
              <p className="text-fg-muted text-xs leading-relaxed">
                {activeSessionCount === 0
                  ? 'No active sessions.'
                  : `Ends ${activeSessionCount} active session(s) immediately.`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={revokeConfirm.ask}
              disabled={activeSessionCount === 0}
            >
              <LogOut aria-hidden="true" />
              Sign out
            </Button>
          </div>
        ) : null}

        {permissions.archive && !isSelf ? (
          <div className="border-line flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="min-w-0">
              <p className="text-fg text-sm font-medium">Archive this user</p>
              <p className="text-fg-muted text-xs leading-relaxed">
                Revokes access and hides the account. History and audit entries are kept.
              </p>
            </div>
            <Button variant="danger" size="sm" onClick={archiveConfirm.ask}>
              <Archive aria-hidden="true" />
              Archive
            </Button>
          </div>
        ) : null}
      </CardContent>

      <ConfirmDialog
        open={resetConfirm.open}
        onOpenChange={resetConfirm.setOpen}
        title="Force a password reset?"
        description={
          <>
            {userName} will be signed out of every device and must use a new temporary password to
            sign back in. Their current password stops working immediately.
          </>
        }
        confirmLabel="Reset password"
        loading={resetConfirm.pending}
        onConfirm={forceReset}
      />

      <ConfirmDialog
        open={revokeConfirm.open}
        onOpenChange={revokeConfirm.setOpen}
        title="Sign this user out everywhere?"
        description={
          <>
            {userName} will need to sign in again on every device. Their password is unchanged.
          </>
        }
        confirmLabel="Sign out everywhere"
        loading={revokeConfirm.pending}
        onConfirm={revokeSessions}
      />

      <ConfirmDialog
        open={archiveConfirm.open}
        onOpenChange={archiveConfirm.setOpen}
        title="Archive this user?"
        description={
          <>
            {userName} will lose access immediately and be hidden from the user list. Their audit
            history is preserved, and the account can be restored later.
          </>
        }
        confirmLabel="Archive user"
        destructive
        loading={archiveConfirm.pending}
        onConfirm={archive}
      />
    </Card>
  );
};

/** Restores an archived account. */
export const UserRestoreAction = ({ userId }: { userId: string }) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const restore = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post(`/api/v1/users/${userId}/restore`);
      toast.success('User restored');
      router.refresh();
    } catch (error) {
      toast.error(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={() => void restore()} loading={busy}>
      <RotateCcw aria-hidden="true" />
      Restore user
    </Button>
  );
};
