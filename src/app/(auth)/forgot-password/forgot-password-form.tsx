'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/validation/auth';

/**
 * Password reset request.
 *
 * On success the form is replaced by a confirmation that does not reveal
 * whether the address was recognised. The same screen appears either way,
 * which is the whole point: a different message for a known address would turn
 * this page into an account-enumeration tool.
 *
 * A rate-limit rejection (429) is surfaced, because that is about the request
 * rather than the account.
 */
export const ForgotPasswordForm = () => {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotPasswordInput): Promise<void> => {
    setFormError(null);

    try {
      await api.post('/api/auth/forgot-password', values);
      setSent(true);
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        setFormError(error.message);
        return;
      }
      setFormError(toErrorMessage(error));
    }
  };

  if (sent) {
    return (
      <div className="rounded-card border-line bg-surface shadow-card border p-6 text-center sm:p-8">
        <span className="bg-success-soft text-success mx-auto mb-4 grid size-12 place-items-center rounded-full">
          <MailCheck className="size-6" aria-hidden="true" />
        </span>

        <h1 className="text-fg text-xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="text-fg-muted mt-2 text-sm leading-relaxed">
          If an account exists for{' '}
          <span className="text-fg font-medium">{getValues('email')}</span>, a reset link is on
          its way. The link can be used once and expires in 60 minutes.
        </p>
        <p className="text-fg-subtle mt-3 text-xs leading-relaxed">
          Nothing arrived? Check your spam folder, or ask an administrator to reset your password
          from the Users screen.
        </p>

        <Button variant="outline" block asChild className="mt-6">
          <Link href="/login">
            <ArrowLeft aria-hidden="true" />
            Back to sign in
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-card border-line bg-surface shadow-card border p-6 sm:p-8">
      <h1 className="text-fg text-xl font-semibold tracking-tight">Reset your password</h1>
      <p className="text-fg-muted mt-1 text-sm leading-relaxed">
        Enter the email address on your account and we will send you a link to choose a new
        password.
      </p>

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

        <Button type="submit" block loading={isSubmitting} loadingLabel="Sending link">
          Send reset link
        </Button>

        <Button variant="ghost" block asChild>
          <Link href="/login">
            <ArrowLeft aria-hidden="true" />
            Back to sign in
          </Link>
        </Button>
      </form>
    </div>
  );
};
