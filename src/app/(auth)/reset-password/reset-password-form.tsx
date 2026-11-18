'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, PasswordInput } from '@/components/ui/form';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { resetPasswordSchema, type ResetPasswordInput } from '@/validation/auth';

/**
 * Choose-a-new-password form.
 *
 * The live requirement checklist comes from the same policy module the API
 * enforces with, so the ticks cannot disagree with the server's answer.
 *
 * On success the user is sent to sign in rather than being logged in
 * automatically: resetting a password revokes every session, and starting a
 * fresh one here would undo part of that.
 */
export const ResetPasswordForm = ({
  token,
  minLength,
}: {
  token: string;
  minLength: number;
}) => {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });

  const password = watch('password');
  const confirmPassword = watch('confirmPassword');

  const onSubmit = async (values: ResetPasswordInput): Promise<void> => {
    setFormError(null);

    try {
      await api.post('/api/auth/reset-password', values);
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.byField;
        if (fields.password) {
          setError('password', { message: fields.password });
          return;
        }
        setFormError(error.message);
        return;
      }
      setFormError(toErrorMessage(error));
    }
  };

  if (done) {
    return (
      <div className="rounded-card border-line bg-surface shadow-card border p-6 text-center sm:p-8">
        <span className="bg-success-soft text-success mx-auto mb-4 grid size-12 place-items-center rounded-full">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </span>
        <h1 className="text-fg text-xl font-semibold tracking-tight">Password updated</h1>
        <p className="text-fg-muted mt-2 text-sm leading-relaxed">
          Your password has been changed and every other device has been signed out. Sign in with
          your new password to continue.
        </p>
        <Button block asChild className="mt-6">
          <Link href="/login">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-card border-line bg-surface shadow-card border p-6 sm:p-8">
      <h1 className="text-fg text-xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="text-fg-muted mt-1 text-sm leading-relaxed">
        Pick something you have not used here before. Signing in elsewhere will be required again
        afterwards.
      </p>

      {formError ? (
        <Alert tone="danger" className="mt-5">
          {formError}
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <input type="hidden" {...register('token')} />

        <Field label="New password" error={errors.password?.message} required>
          {(props) => (
            <PasswordInput
              {...props}
              {...register('password')}
              value={password}
              autoComplete="new-password"
              autoFocus
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

        <Button type="submit" block loading={isSubmitting} loadingLabel="Updating password">
          Update password
        </Button>
      </form>
    </div>
  );
};
