'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import {
  Checkbox,
  Field,
  FormErrorSummary,
  Input,
  Label,
  Select,
  SwitchField,
} from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { createUserSchema, type CreateUserInput } from '@/validation/user';

type FormValues = z.input<typeof createUserSchema>;

export type RoleOption = { id: string; name: string; level: number; key: string };

/**
 * Invite-a-user form.
 *
 * Only roles the signed-in administrator is allowed to grant are offered. That
 * mirrors the server rule exactly, so the picker never presents a choice the
 * API would reject -- and the API still re-checks, because a hidden option is
 * not a control.
 */
export const UserForm = ({ roles }: { roles: RoleOption[] }) => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
      phone: '',
      jobTitle: '',
      roleIds: [],
      status: 'INVITED',
      sendInvite: true,
    },
  });

  const roleIds = watch('roleIds') ?? [];
  const sendInvite = watch('sendInvite') ?? true;

  const toggleRole = (id: string, checked: boolean): void => {
    const next = checked ? [...roleIds, id] : roleIds.filter((value) => value !== id);
    setValue('roleIds', next, { shouldValidate: true, shouldDirty: true });
  };

  const onSubmit = async (values: CreateUserInput): Promise<void> => {
    setFormError(null);

    try {
      const created = await api.post<{ id: string; fullName: string }>('/api/v1/users', values);

      toast.success('User invited', {
        description: `${created.fullName} can now sign in once they set a password.`,
      });

      router.push(`/users/${created.id}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.byField;
        let handled = false;

        for (const key of ['email', 'firstName', 'lastName', 'phone', 'roleIds'] as const) {
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

  const fieldErrorList = Object.entries(errors)
    .map(([path, error]) => ({
      path,
      message: typeof error?.message === 'string' ? error.message : '',
    }))
    .filter((entry) => entry.message !== '');

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      <FormErrorSummary errors={fieldErrorList} />

      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={errors.firstName?.message} required>
            {(props) => (
              <Input {...props} {...register('firstName')} autoComplete="given-name" autoFocus />
            )}
          </Field>

          <Field label="Last name" error={errors.lastName?.message} required>
            {(props) => <Input {...props} {...register('lastName')} autoComplete="family-name" />}
          </Field>

          <Field
            label="Email address"
            error={errors.email?.message}
            required
            hint="Used to sign in. The invite is sent here."
            className="sm:col-span-2"
          >
            {(props) => (
              <Input
                {...props}
                {...register('email')}
                type="email"
                inputMode="email"
                autoComplete="email"
              />
            )}
          </Field>

          <Field label="Job title" error={errors.jobTitle?.message}>
            {(props) => <Input {...props} {...register('jobTitle')} />}
          </Field>

          <Field label="Phone" error={errors.phone?.message}>
            {(props) => <Input {...props} {...register('phone')} type="tel" inputMode="tel" />}
          </Field>

          <Field
            label="Initial status"
            error={errors.status?.message}
            hint="Invited accounts become active on first sign-in."
          >
            {(props) => (
              <Select {...props} {...register('status')}>
                <option value="INVITED">Invited</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
              </Select>
            )}
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Roles</CardTitle>
        </CardHeader>

        <CardContent className="space-y-1">
          <p className="text-fg-muted mb-3 text-sm leading-relaxed">
            Roles decide what this user can see and do. Only roles you are able to grant are
            listed.
          </p>

          {roles.length === 0 ? (
            <Alert tone="warning">
              You cannot grant any roles. Ask a Super Admin to assign this account instead.
            </Alert>
          ) : (
            <fieldset>
              <legend className="sr-only">Select roles</legend>
              <ul className="divide-line divide-y">
                {roles.map((role) => {
                  const inputId = `role-${role.id}`;
                  return (
                    <li key={role.id} className="flex items-start gap-3 py-3">
                      <Checkbox
                        id={inputId}
                        checked={roleIds.includes(role.id)}
                        onCheckedChange={(checked) => toggleRole(role.id, checked === true)}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <Label htmlFor={inputId} className="font-medium">
                          {role.name}
                        </Label>
                        <p className="text-fg-subtle mt-0.5 text-xs">
                          Authority level {role.level}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </fieldset>
          )}

          {errors.roleIds?.message ? (
            <p role="alert" className="text-danger pt-2 text-xs font-medium">
              {errors.roleIds.message}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Invitation</CardTitle>
        </CardHeader>
        <CardContent>
          <SwitchField
            label="Email an invitation"
            hint="Sends a temporary password and requires a change on first sign-in. Turn this off to set credentials another way."
            checked={sendInvite}
            onCheckedChange={(checked) =>
              setValue('sendInvite', checked, { shouldDirty: true })
            }
          />
        </CardContent>

        <CardFooter>
          <Button variant="outline" asChild>
            <Link href="/users">
              <ArrowLeft aria-hidden="true" />
              Cancel
            </Link>
          </Button>
          <Button type="submit" loading={isSubmitting} loadingLabel="Creating user">
            <Save aria-hidden="true" />
            Create user
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
};
