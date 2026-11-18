'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, PasswordInput } from '@/components/ui/form';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { loginSchema, type LoginInput } from '@/validation/auth';

/**
 * Schemas with `.default()` have different input and output types, so
 * `useForm` is given both: the raw field values it manages, and the parsed
 * values the submit handler receives.
 */
type LoginFormValues = z.input<typeof loginSchema>;

/**
 * Staff sign-in form.
 *
 * Validation runs through the same Zod schema the API uses, so the rules
 * cannot drift. Server-side field errors are mapped back onto the matching
 * input; anything else becomes a single banner above the form.
 *
 * The error message for bad credentials is deliberately identical for an
 * unknown email and a wrong password -- the API will not say which, and the
 * form must not invent a distinction.
 */

const SSO_ERRORS: Record<string, string> = {
  sso_unavailable: 'Microsoft sign-in is not configured for this installation.',
  sso_denied: 'Microsoft sign-in was cancelled.',
  sso_invalid: 'That Microsoft sign-in response was incomplete. Please try again.',
  sso_expired: 'That sign-in attempt timed out. Please try again.',
  sso_state_mismatch: 'That sign-in attempt could not be verified. Please try again.',
  sso_failed: 'Microsoft sign-in could not be completed. Please try again.',
};

export const LoginForm = ({
  entraEnabled,
  nextPath,
  ssoError,
}: {
  entraEnabled: boolean;
  nextPath: string;
  ssoError?: string | undefined;
}) => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(
    ssoError ? (SSO_ERRORS[ssoError] ?? 'Sign-in could not be completed.') : null,
  );

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues, unknown, LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const onSubmit = async (values: LoginInput): Promise<void> => {
    setFormError(null);

    try {
      const result = await api.post<{ redirectTo: string; mustChangePassword: boolean }>(
        '/api/auth/login',
        values,
      );

      // A forced password change always wins over the requested destination.
      const target = result.mustChangePassword ? result.redirectTo : nextPath;

      router.replace(target);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.byField;
        let handled = false;

        for (const key of ['email', 'password'] as const) {
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

  const password = watch('password');

  return (
    <div className="rounded-card border-line bg-surface shadow-card border p-6 sm:p-8">
      <h1 className="text-fg text-xl font-semibold tracking-tight">Sign in</h1>
      <p className="text-fg-muted mt-1 text-sm">Access the Ecom back office.</p>

      {formError ? (
        <Alert tone="danger" className="mt-5">
          {formError}
        </Alert>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4" noValidate>
        <Field label="Email address" error={errors.email?.message} required>
          {(props) => (
            <Input
              {...props}
              {...register('email')}
              type="email"
              autoComplete="username"
              autoFocus
              inputMode="email"
              placeholder="you@company.com"
            />
          )}
        </Field>

        <Field label="Password" error={errors.password?.message} required>
          {(props) => (
            <PasswordInput
              {...props}
              {...register('password')}
              value={password}
              autoComplete="current-password"
            />
          )}
        </Field>

        <div className="flex items-center justify-between gap-3">
          <label className="text-fg-muted flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              {...register('rememberMe')}
              className="border-line-strong text-accent size-4 rounded"
            />
            Keep me signed in
          </label>

          <Link
            href="/forgot-password"
            className="text-accent rounded text-sm font-medium underline-offset-4 hover:underline"
          >
            Forgot password?
          </Link>
        </div>

        <Button type="submit" block loading={isSubmitting} loadingLabel="Signing in">
          <LogIn aria-hidden="true" />
          Sign in
        </Button>
      </form>

      {entraEnabled ? (
        <>
          <div className="my-6 flex items-center gap-3">
            <span className="bg-line h-px flex-1" aria-hidden="true" />
            <span className="text-fg-subtle text-xs">or</span>
            <span className="bg-line h-px flex-1" aria-hidden="true" />
          </div>

          <Button variant="outline" block asChild>
            {/*
              A full navigation, not a fetch: the OIDC flow needs a top-level
              redirect so the identity provider can show its own UI.
            */}
            <a href={`/api/auth/entra/start?next=${encodeURIComponent(nextPath)}`}>
              Continue with Microsoft
            </a>
          </Button>
        </>
      ) : null}
    </div>
  );
};
