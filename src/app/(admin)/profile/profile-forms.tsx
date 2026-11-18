'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { KeyRound, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, PasswordInput, Select, SwitchField } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordInput,
  type UpdateProfileInput,
} from '@/validation/auth';

type ProfileValues = z.input<typeof updateProfileSchema>;
type PasswordValues = z.input<typeof changePasswordSchema>;

const TIMEZONES = [
  'UTC',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Lisbon',
  'Africa/Lagos',
  'Africa/Accra',
  'Africa/Nairobi',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
];

/** Your own details. Email and roles are not editable here by design. */
export const ProfileDetailsForm = ({
  initial,
}: {
  initial: {
    firstName: string;
    lastName: string;
    phone: string | null;
    jobTitle: string | null;
    timezone: string;
    locale: string;
  };
}) => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<ProfileValues, unknown, UpdateProfileInput>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      firstName: initial.firstName,
      lastName: initial.lastName,
      phone: initial.phone ?? '',
      jobTitle: initial.jobTitle ?? '',
      timezone: initial.timezone,
      locale: initial.locale,
    },
  });

  const onSubmit = async (values: UpdateProfileInput): Promise<void> => {
    setFormError(null);
    try {
      await api.patch('/api/v1/profile', values);
      toast.success('Profile updated');
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.byField;
        let handled = false;
        for (const key of ['firstName', 'lastName', 'phone', 'jobTitle'] as const) {
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
        <CardTitle>Your details</CardTitle>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" error={errors.firstName?.message} required>
              {(props) => (
                <Input {...props} {...register('firstName')} autoComplete="given-name" />
              )}
            </Field>

            <Field label="Last name" error={errors.lastName?.message} required>
              {(props) => (
                <Input {...props} {...register('lastName')} autoComplete="family-name" />
              )}
            </Field>

            <Field label="Job title" error={errors.jobTitle?.message}>
              {(props) => <Input {...props} {...register('jobTitle')} />}
            </Field>

            <Field label="Phone" error={errors.phone?.message}>
              {(props) => (
                <Input {...props} {...register('phone')} type="tel" autoComplete="tel" />
              )}
            </Field>

            <Field
              label="Time zone"
              error={errors.timezone?.message}
              hint="Used when showing dates and times to you."
            >
              {(props) => (
                <Select {...props} {...register('timezone')}>
                  {TIMEZONES.map((zone) => (
                    <option key={zone} value={zone}>
                      {zone.replace(/_/g, ' ')}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Language" error={errors.locale?.message}>
              {(props) => (
                <Select {...props} {...register('locale')}>
                  <option value="en">English</option>
                </Select>
              )}
            </Field>
          </div>
        </CardContent>

        <CardFooter>
          <Button type="submit" loading={isSubmitting} disabled={!isDirty}>
            <Save aria-hidden="true" />
            Save changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};

/**
 * Change your own password.
 *
 * Requires the current password, so a hijacked session cannot be used to lock
 * the owner out. Other sessions are revoked by default, because a password
 * change is usually a reaction to a suspected compromise.
 */
export const ChangePasswordForm = ({
  minLength,
  hasPassword,
  autoFocus,
}: {
  minLength: number;
  hasPassword: boolean;
  autoFocus: boolean;
}) => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<PasswordValues, unknown, ChangePasswordInput>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: {
      currentPassword: '',
      password: '',
      confirmPassword: '',
      revokeOtherSessions: true,
    },
  });

  const currentPassword = watch('currentPassword');
  const password = watch('password');
  const confirmPassword = watch('confirmPassword');
  const revokeOthers = watch('revokeOtherSessions') ?? true;

  const onSubmit = async (values: ChangePasswordInput): Promise<void> => {
    setFormError(null);
    setDone(false);

    try {
      const result = await api.post<{ message: string }>('/api/auth/change-password', values);
      toast.success('Password changed', { description: result.message });
      setDone(true);
      reset();
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.byField;
        let handled = false;
        for (const key of ['currentPassword', 'password', 'confirmPassword'] as const) {
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

  if (!hasPassword) {
    return (
      <Card as="section" id="change-password">
        <CardHeader>
          <CardTitle>Password</CardTitle>
        </CardHeader>
        <CardContent>
          <Alert tone="info">
            This account signs in with Microsoft Entra ID, so there is no password to change here.
            Manage your credentials through your Microsoft account.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card as="section" id="change-password">
      <CardHeader>
        <CardTitle>Change password</CardTitle>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <CardContent className="space-y-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          {done ? <Alert tone="success">Your password has been updated.</Alert> : null}

          <Field label="Current password" error={errors.currentPassword?.message} required>
            {(props) => (
              <PasswordInput
                {...props}
                {...register('currentPassword')}
                value={currentPassword}
                autoComplete="current-password"
                autoFocus={autoFocus}
              />
            )}
          </Field>

          <Field label="New password" error={errors.password?.message} required>
            {(props) => (
              <PasswordInput
                {...props}
                {...register('password')}
                value={password}
                autoComplete="new-password"
                showRequirements
                minLength={minLength}
              />
            )}
          </Field>

          <Field label="Confirm new password" error={errors.confirmPassword?.message} required>
            {(props) => (
              <PasswordInput
                {...props}
                {...register('confirmPassword')}
                value={confirmPassword}
                autoComplete="new-password"
              />
            )}
          </Field>

          <SwitchField
            label="Sign out my other devices"
            hint="Recommended. Ends every session except this one."
            checked={revokeOthers}
            onCheckedChange={(checked) =>
              setValue('revokeOtherSessions', checked, { shouldDirty: true })
            }
          />
        </CardContent>

        <CardFooter>
          <Button type="submit" loading={isSubmitting} loadingLabel="Updating password">
            <KeyRound aria-hidden="true" />
            Update password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
};
