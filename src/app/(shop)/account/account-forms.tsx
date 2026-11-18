'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { LogIn, LogOut, UserPlus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, PasswordInput, SwitchField } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import {
  customerLoginSchema,
  customerRegisterSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type CustomerLoginInput,
  type CustomerRegisterInput,
  type ForgotPasswordInput,
  type ResetPasswordInput,
} from '@/validation/auth';

/**
 * Storefront account forms.
 *
 * Shoppers authenticate through a separate cookie and session scope from staff,
 * so a customer session can never reach the back office even in the same
 * browser. These forms post to /api/auth/shop/*.
 */

type LoginValues = z.input<typeof customerLoginSchema>;
type RegisterValues = z.input<typeof customerRegisterSchema>;
type ForgotValues = z.input<typeof forgotPasswordSchema>;
type ResetValues = z.input<typeof resetPasswordSchema>;

const safeNext = (next: string | undefined): string =>
  next && next.startsWith('/') && !next.startsWith('//') ? next : '/account';

export const CustomerLoginForm = ({ next }: { next?: string | undefined }) => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues, unknown, CustomerLoginInput>({
    resolver: zodResolver(customerLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const password = watch('password');

  const onSubmit = async (values: CustomerLoginInput): Promise<void> => {
    setFormError(null);
    try {
      await api.post('/api/auth/shop/login', values);
      router.replace(safeNext(next));
      router.refresh();
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : toErrorMessage(error));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <Field label="Email address" error={errors.email?.message} required>
        {(props) => (
          <Input
            {...props}
            {...register('email')}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
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

      <div className="text-right">
        <Link
          href="/account/forgot-password"
          className="text-accent rounded text-sm font-medium underline-offset-4 hover:underline"
        >
          Forgot your password?
        </Link>
      </div>

      <Button type="submit" block loading={isSubmitting} loadingLabel="Signing in">
        <LogIn aria-hidden="true" />
        Sign in
      </Button>

      <p className="text-fg-muted text-center text-sm">
        New here?{' '}
        <Link
          href={next ? `/account/register?next=${encodeURIComponent(next)}` : '/account/register'}
          className="text-accent rounded font-medium underline-offset-4 hover:underline"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
};

export const CustomerRegisterForm = ({
  next,
  passwordMinLength,
}: {
  next?: string | undefined;
  passwordMinLength: number;
}) => {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues, unknown, CustomerRegisterInput>({
    resolver: zodResolver(customerRegisterSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
      marketingOptIn: false,
    },
  });

  const password = watch('password');
  const confirmPassword = watch('confirmPassword');
  const marketingOptIn = watch('marketingOptIn');

  const onSubmit = async (values: CustomerRegisterInput): Promise<void> => {
    setFormError(null);
    try {
      await api.post('/api/auth/shop/register', values);
      toast.success('Account created');
      router.replace(safeNext(next));
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.byField;
        let handled = false;
        for (const key of ['email', 'password', 'firstName', 'lastName', 'phone'] as const) {
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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName?.message} required>
          {(props) => (
            <Input {...props} {...register('firstName')} autoComplete="given-name" autoFocus />
          )}
        </Field>

        <Field label="Last name" error={errors.lastName?.message} required>
          {(props) => <Input {...props} {...register('lastName')} autoComplete="family-name" />}
        </Field>
      </div>

      <Field label="Email address" error={errors.email?.message} required>
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

      <Field label="Phone" error={errors.phone?.message} hint="Optional. For delivery updates.">
        {(props) => <Input {...props} {...register('phone')} type="tel" autoComplete="tel" />}
      </Field>

      <Field label="Password" error={errors.password?.message} required>
        {(props) => (
          <PasswordInput
            {...props}
            {...register('password')}
            value={password}
            autoComplete="new-password"
            showRequirements
            minLength={passwordMinLength}
          />
        )}
      </Field>

      <Field label="Confirm password" error={errors.confirmPassword?.message} required>
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
        label="Email me about offers"
        hint="You can change this at any time."
        checked={marketingOptIn === true}
        onCheckedChange={(checked) => setValue('marketingOptIn', checked)}
      />

      <Button type="submit" block loading={isSubmitting} loadingLabel="Creating your account">
        <UserPlus aria-hidden="true" />
        Create account
      </Button>

      <p className="text-fg-muted text-center text-sm">
        Already have an account?{' '}
        <Link
          href={next ? `/account/login?next=${encodeURIComponent(next)}` : '/account/login'}
          className="text-accent rounded font-medium underline-offset-4 hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
};

export const CustomerForgotPasswordForm = () => {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<ForgotValues, unknown, ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (values: ForgotPasswordInput): Promise<void> => {
    setFormError(null);
    try {
      await api.post('/api/auth/shop/forgot-password', values);
      setSent(true);
    } catch (error) {
      setFormError(toErrorMessage(error));
    }
  };

  if (sent) {
    return (
      <Alert tone="success" title="Check your inbox">
        If an account exists for {getValues('email')}, a reset link is on its way. It can be used
        once and expires in 60 minutes.
      </Alert>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <Field label="Email address" error={errors.email?.message} required>
        {(props) => (
          <Input
            {...props}
            {...register('email')}
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
          />
        )}
      </Field>

      <Button type="submit" block loading={isSubmitting} loadingLabel="Sending link">
        Send reset link
      </Button>

      <p className="text-center">
        <Link
          href="/account/login"
          className="text-fg-muted hover:text-fg rounded text-sm underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </form>
  );
};

export const CustomerResetPasswordForm = ({
  token,
  passwordMinLength,
}: {
  token: string;
  passwordMinLength: number;
}) => {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues, unknown, ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { token, password: '', confirmPassword: '' },
  });

  const password = watch('password');
  const confirmPassword = watch('confirmPassword');

  const onSubmit = async (values: ResetPasswordInput): Promise<void> => {
    setFormError(null);
    try {
      await api.post('/api/auth/shop/reset-password', values);
      setDone(true);
    } catch (error) {
      if (error instanceof ApiError) {
        const message = error.byField.password;
        if (message) {
          setError('password', { message });
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
      <div className="space-y-4">
        <Alert tone="success" title="Password updated">
          Your password has been changed and other devices have been signed out.
        </Alert>
        <Button block asChild>
          <Link href="/account/login">Sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

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
            minLength={passwordMinLength}
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
  );
};

export const CustomerSignOutButton = () => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const signOut = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.post('/api/auth/shop/logout');
      router.replace('/');
      router.refresh();
    } catch (error) {
      toast.error(toErrorMessage(error));
      setBusy(false);
    }
  };

  return (
    <Button variant="outline" size="sm" onClick={() => void signOut()} loading={busy}>
      <LogOut aria-hidden="true" />
      Sign out
    </Button>
  );
};
