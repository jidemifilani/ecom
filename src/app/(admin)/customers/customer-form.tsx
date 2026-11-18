'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Archive, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, SwitchField, Textarea } from '@/components/ui/form';
import { ConfirmDialog, useConfirm } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import {
  createCustomerSchema,
  updateCustomerSchema,
  type CreateCustomerInput,
  type UpdateCustomerInput,
} from '@/validation/customer';

type CreateValues = z.input<typeof createCustomerSchema>;
type UpdateValues = z.input<typeof updateCustomerSchema>;

/**
 * Customer create/edit form.
 *
 * Blocking a customer revokes their storefront sessions server-side, so the
 * change takes effect at once rather than when a cookie happens to expire.
 */
export const CustomerForm = ({
  mode,
  initial,
  canDelete,
}: {
  mode: 'create' | 'edit';
  initial?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    status: string;
    marketingOptIn: boolean;
    notes: string | null;
    isArchived: boolean;
  };
  canDelete: boolean;
}) => {
  const router = useRouter();
  const archiveConfirm = useConfirm();
  const [formError, setFormError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<CreateValues | UpdateValues, unknown, CreateCustomerInput | UpdateCustomerInput>({
    resolver: zodResolver(mode === 'create' ? createCustomerSchema : updateCustomerSchema),
    defaultValues: {
      email: initial?.email ?? '',
      firstName: initial?.firstName ?? '',
      lastName: initial?.lastName ?? '',
      phone: initial?.phone ?? '',
      status: (initial?.status ?? 'ACTIVE') as CreateValues['status'],
      marketingOptIn: initial?.marketingOptIn ?? false,
      notes: initial?.notes ?? '',
    },
  });

  /*
   * `checkboxSchema` accepts the strings a plain HTML form submits as well as
   * a real boolean, so the watched value is a union. Narrow it once here
   * rather than at each use.
   */
  const rawOptIn = watch('marketingOptIn');
  const marketingOptIn = rawOptIn === true || rawOptIn === 'true' || rawOptIn === 'on';

  const onSubmit = async (
    values: CreateCustomerInput | UpdateCustomerInput,
  ): Promise<void> => {
    setFormError(null);

    try {
      if (mode === 'create') {
        const created = await api.post<{ id: string; fullName: string }>(
          '/api/v1/customers',
          values,
        );
        toast.success('Customer created', { description: created.fullName });
        router.push(`/customers/${created.id}`);
      } else if (initial) {
        await api.patch(`/api/v1/customers/${initial.id}`, values);
        toast.success('Customer updated');
      }
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.byField;
        let handled = false;
        for (const key of ['email', 'firstName', 'lastName', 'phone'] as const) {
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

  const archive = async (): Promise<void> => {
    if (!initial) return;
    await archiveConfirm.run(async () => {
      try {
        await api.delete(`/api/v1/customers/${initial.id}`);
        toast.success('Customer archived');
        router.push('/customers');
        router.refresh();
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    });
  };

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        <Card as="section">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>

          <CardContent className="grid gap-4 sm:grid-cols-2">
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

            <Field
              label="Email address"
              error={errors.email?.message}
              required
              hint="Used for order confirmations and storefront sign-in."
            >
              {(props) => (
                <Input {...props} {...register('email')} type="email" inputMode="email" />
              )}
            </Field>

            <Field label="Phone" error={errors.phone?.message}>
              {(props) => <Input {...props} {...register('phone')} type="tel" inputMode="tel" />}
            </Field>

            <Field
              label="Status"
              error={errors.status?.message}
              hint="Blocking signs the customer out of the storefront immediately."
            >
              {(props) => (
                <Select {...props} {...register('status')}>
                  <option value="ACTIVE">Active</option>
                  <option value="BLOCKED">Blocked</option>
                </Select>
              )}
            </Field>

            <div className="sm:col-span-2">
              <SwitchField
                label="Opted in to marketing"
                hint="Only set this where you hold a lawful basis to contact them."
                checked={marketingOptIn}
                onCheckedChange={(checked) =>
                  setValue('marketingOptIn', checked, { shouldDirty: true })
                }
              />
            </div>

            <Field
              label="Internal notes"
              error={errors.notes?.message}
              hint="Visible to staff only, never to the customer."
              className="sm:col-span-2"
            >
              {(props) => <Textarea {...props} {...register('notes')} rows={3} />}
            </Field>
          </CardContent>

          <CardFooter className="justify-between">
            {mode === 'edit' && canDelete && initial && !initial.isArchived ? (
              <Button variant="danger-ghost" type="button" onClick={archiveConfirm.ask}>
                <Archive aria-hidden="true" />
                Archive customer
              </Button>
            ) : (
              <Button variant="outline" type="button" asChild>
                <Link href="/customers">Cancel</Link>
              </Button>
            )}

            <Button
              type="submit"
              loading={isSubmitting}
              disabled={mode === 'edit' && !isDirty}
            >
              <Save aria-hidden="true" />
              {mode === 'create' ? 'Create customer' : 'Save changes'}
            </Button>
          </CardFooter>
        </Card>
      </form>

      {initial ? (
        <ConfirmDialog
          open={archiveConfirm.open}
          onOpenChange={archiveConfirm.setOpen}
          title="Archive this customer?"
          description={
            <>
              <strong>
                {initial.firstName} {initial.lastName}
              </strong>{' '}
              will lose storefront access and be hidden from the customer list. Their order
              history is preserved.
            </>
          }
          confirmLabel="Archive customer"
          destructive
          loading={archiveConfirm.pending}
          onConfirm={archive}
        />
      ) : null}
    </>
  );
};
