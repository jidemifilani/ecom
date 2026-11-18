'use client';

import { Archive, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, SwitchField, Textarea } from '@/components/ui/form';
import { ConfirmDialog, useConfirm } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { toMajorString, toMinorUnits } from '@/lib/money';

/**
 * Discount editor.
 *
 * The `value` field means different things per type, which is a genuine source
 * of mistakes, so the form translates for the user:
 *  * PERCENTAGE is entered as a percentage and stored as basis points.
 *  * FIXED_AMOUNT is entered in major units and stored in minor units.
 *  * FREE_SHIPPING ignores the value entirely, and the input is hidden.
 */

export type DiscountInitial = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  scope: string;
  value: number;
  minSubtotal: number;
  maxDiscountAmount: number | null;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  targetCategoryId: string | null;
  targetProductId: string | null;
  isArchived: boolean;
};

export type SelectOption = { id: string; name: string };

const toDateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

export const DiscountForm = ({
  mode,
  initial,
  currency,
  categories,
  products,
  canDelete,
}: {
  mode: 'create' | 'edit';
  initial?: DiscountInitial;
  currency: string;
  categories: SelectOption[];
  products: SelectOption[];
  canDelete: boolean;
}) => {
  const router = useRouter();
  const archiveConfirm = useConfirm();

  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [type, setType] = useState(initial?.type ?? 'PERCENTAGE');
  const [scope, setScope] = useState(initial?.scope ?? 'ALL');

  // Displayed in the unit the user thinks in, converted on save.
  const [percent, setPercent] = useState(
    initial && initial.type === 'PERCENTAGE' ? String(initial.value / 100) : '10',
  );
  const [fixedAmount, setFixedAmount] = useState(
    initial && initial.type === 'FIXED_AMOUNT' ? toMajorString(initial.value, currency) : '',
  );

  const [minSubtotal, setMinSubtotal] = useState(
    initial ? toMajorString(initial.minSubtotal, currency) : '0',
  );
  const [maxDiscount, setMaxDiscount] = useState(
    initial?.maxDiscountAmount ? toMajorString(initial.maxDiscountAmount, currency) : '',
  );
  const [usageLimit, setUsageLimit] = useState(
    initial?.usageLimit ? String(initial.usageLimit) : '',
  );
  const [perCustomerLimit, setPerCustomerLimit] = useState(
    initial?.perCustomerLimit ? String(initial.perCustomerLimit) : '',
  );
  const [startsAt, setStartsAt] = useState(toDateInput(initial?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toDateInput(initial?.endsAt ?? null));
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [targetCategoryId, setTargetCategoryId] = useState(initial?.targetCategoryId ?? '');
  const [targetProductId, setTargetProductId] = useState(initial?.targetProductId ?? '');

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = async (): Promise<void> => {
    setFormError(null);
    setFieldErrors({});

    let value = 0;
    if (type === 'PERCENTAGE') {
      const parsed = Number.parseFloat(percent === '' ? '0' : percent);
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) {
        setFieldErrors({ value: 'Enter a percentage between 0 and 100.' });
        return;
      }
      value = Math.round(parsed * 100);
    } else if (type === 'FIXED_AMOUNT') {
      const minor = toMinorUnits(fixedAmount, currency);
      if (minor === null || minor <= 0) {
        setFieldErrors({ value: 'Enter an amount above zero.' });
        return;
      }
      value = minor;
    }

    const minSubtotalMinor = toMinorUnits(minSubtotal === '' ? '0' : minSubtotal, currency);
    if (minSubtotalMinor === null) {
      setFieldErrors({ minSubtotal: 'Enter a valid amount, or 0 for no minimum.' });
      return;
    }

    const maxDiscountMinor =
      maxDiscount.trim() === '' ? undefined : toMinorUnits(maxDiscount, currency);
    if (maxDiscount.trim() !== '' && maxDiscountMinor === null) {
      setFieldErrors({ maxDiscountAmount: 'Enter a valid amount, or leave blank.' });
      return;
    }

    const payload = {
      code,
      name,
      description: description.trim() === '' ? undefined : description,
      type,
      scope,
      value,
      minSubtotal: minSubtotalMinor,
      ...(maxDiscountMinor !== undefined ? { maxDiscountAmount: maxDiscountMinor } : {}),
      ...(usageLimit.trim() === '' ? {} : { usageLimit: Number.parseInt(usageLimit, 10) }),
      ...(perCustomerLimit.trim() === ''
        ? {}
        : { perCustomerLimit: Number.parseInt(perCustomerLimit, 10) }),
      startsAt: startsAt === '' ? undefined : startsAt,
      endsAt: endsAt === '' ? undefined : endsAt,
      isActive,
      targetCategoryId: scope === 'CATEGORY' ? targetCategoryId || null : null,
      targetProductId: scope === 'PRODUCT' ? targetProductId || null : null,
    };

    setSaving(true);
    try {
      if (mode === 'create') {
        const created = await api.post<{ id: string; code: string }>(
          '/api/v1/discounts',
          payload,
        );
        toast.success('Discount created', { description: created.code });
        router.push(`/discounts/${created.id}`);
      } else if (initial) {
        await api.patch(`/api/v1/discounts/${initial.id}`, payload);
        toast.success('Discount updated');
      }
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFieldErrors(error.byField);
        setFormError(error.message);
        return;
      }
      setFormError(toErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const archive = async (): Promise<void> => {
    if (!initial) return;
    await archiveConfirm.run(async () => {
      try {
        await api.delete(`/api/v1/discounts/${initial.id}`);
        toast.success('Discount archived');
        router.push('/discounts');
        router.refresh();
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    });
  };

  return (
    <div className="space-y-5">
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      {initial?.isArchived ? (
        <Alert tone="warning" title="This discount is archived">
          It can no longer be applied at checkout.
        </Alert>
      ) : null}

      <Card as="section">
        <CardHeader>
          <CardTitle>Code and value</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Code"
            error={fieldErrors.code}
            required
            hint="What shoppers type at checkout. Case-insensitive."
          >
            {(props) => (
              <Input
                {...props}
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                className="font-mono"
                placeholder="WELCOME10"
              />
            )}
          </Field>

          <Field
            label="Internal name"
            error={fieldErrors.name}
            required
            hint="Shown in reports and on the order."
          >
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Welcome 10% off"
              />
            )}
          </Field>

          <Field label="Type" error={fieldErrors.type} required>
            {(props) => (
              <Select {...props} value={type} onChange={(event) => setType(event.target.value)}>
                <option value="PERCENTAGE">Percentage off</option>
                <option value="FIXED_AMOUNT">Fixed amount off</option>
                <option value="FREE_SHIPPING">Free shipping</option>
              </Select>
            )}
          </Field>

          {type === 'PERCENTAGE' ? (
            <Field label="Percentage off" error={fieldErrors.value} required>
              {(props) => (
                <Input
                  {...props}
                  value={percent}
                  onChange={(event) => setPercent(event.target.value)}
                  inputMode="decimal"
                  placeholder="10"
                />
              )}
            </Field>
          ) : type === 'FIXED_AMOUNT' ? (
            <Field label={`Amount off (${currency})`} error={fieldErrors.value} required>
              {(props) => (
                <Input
                  {...props}
                  value={fixedAmount}
                  onChange={(event) => setFixedAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder="20.00"
                />
              )}
            </Field>
          ) : (
            <div className="flex items-end">
              <p className="text-fg-muted pb-3 text-sm">
                Free shipping needs no value. Shipping is set to zero when the code applies.
              </p>
            </div>
          )}

          <Field
            label={`Minimum spend (${currency})`}
            error={fieldErrors.minSubtotal}
            hint="Measured against the whole basket. 0 for no minimum."
          >
            {(props) => (
              <Input
                {...props}
                value={minSubtotal}
                onChange={(event) => setMinSubtotal(event.target.value)}
                inputMode="decimal"
              />
            )}
          </Field>

          {type === 'PERCENTAGE' ? (
            <Field
              label={`Maximum discount (${currency})`}
              error={fieldErrors.maxDiscountAmount}
              hint="Caps a percentage discount. Leave blank for uncapped."
            >
              {(props) => (
                <Input
                  {...props}
                  value={maxDiscount}
                  onChange={(event) => setMaxDiscount(event.target.value)}
                  inputMode="decimal"
                />
              )}
            </Field>
          ) : null}
        </CardContent>
      </Card>

      <Card as="section">
        <CardHeader>
          <CardTitle>What it applies to</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Scope" error={fieldErrors.scope}>
            {(props) => (
              <Select {...props} value={scope} onChange={(event) => setScope(event.target.value)}>
                <option value="ALL">Everything in the basket</option>
                <option value="CATEGORY">One category</option>
                <option value="PRODUCT">One product</option>
              </Select>
            )}
          </Field>

          {scope === 'CATEGORY' ? (
            <Field label="Category" error={fieldErrors.targetCategoryId} required>
              {(props) => (
                <Select
                  {...props}
                  value={targetCategoryId}
                  onChange={(event) => setTargetCategoryId(event.target.value)}
                >
                  <option value="">Choose a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          {scope === 'PRODUCT' ? (
            <Field label="Product" error={fieldErrors.targetProductId} required>
              {(props) => (
                <Select
                  {...props}
                  value={targetProductId}
                  onChange={(event) => setTargetProductId(event.target.value)}
                >
                  <option value="">Choose a product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}

          <Field label="Description" error={fieldErrors.description} className="sm:col-span-2">
            {(props) => (
              <Textarea
                {...props}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
              />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card as="section">
        <CardHeader>
          <CardTitle>Limits and schedule</CardTitle>
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts on" error={fieldErrors.startsAt} hint="Blank starts immediately.">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={startsAt}
                onChange={(event) => setStartsAt(event.target.value)}
              />
            )}
          </Field>

          <Field label="Ends on" error={fieldErrors.endsAt} hint="Blank never expires.">
            {(props) => (
              <Input
                {...props}
                type="date"
                value={endsAt}
                onChange={(event) => setEndsAt(event.target.value)}
              />
            )}
          </Field>

          <Field
            label="Total uses"
            error={fieldErrors.usageLimit}
            hint={
              initial
                ? `Used ${initial.usageCount} time(s) so far. Blank for unlimited.`
                : 'Blank for unlimited.'
            }
          >
            {(props) => (
              <Input
                {...props}
                value={usageLimit}
                onChange={(event) => setUsageLimit(event.target.value)}
                inputMode="numeric"
              />
            )}
          </Field>

          <Field
            label="Uses per customer"
            error={fieldErrors.perCustomerLimit}
            hint="Only enforced for signed-in shoppers. Blank for unlimited."
          >
            {(props) => (
              <Input
                {...props}
                value={perCustomerLimit}
                onChange={(event) => setPerCustomerLimit(event.target.value)}
                inputMode="numeric"
              />
            )}
          </Field>

          <div className="sm:col-span-2">
            <SwitchField
              label="Active"
              hint="Inactive codes are rejected at checkout with a clear message."
              checked={isActive}
              onCheckedChange={setIsActive}
            />
          </div>
        </CardContent>

        <CardFooter className="justify-between">
          {mode === 'edit' && canDelete && initial && !initial.isArchived ? (
            <Button variant="danger-ghost" onClick={archiveConfirm.ask}>
              <Archive aria-hidden="true" />
              Archive
            </Button>
          ) : (
            <Button variant="outline" asChild>
              <Link href="/discounts">Cancel</Link>
            </Button>
          )}

          <Button onClick={() => void save()} loading={saving}>
            <Save aria-hidden="true" />
            {mode === 'create' ? 'Create discount' : 'Save changes'}
          </Button>
        </CardFooter>
      </Card>

      {initial ? (
        <ConfirmDialog
          open={archiveConfirm.open}
          onOpenChange={archiveConfirm.setOpen}
          title="Archive this discount?"
          description={
            <>
              <strong>{initial.code}</strong> will stop working at checkout immediately. Orders
              that already used it keep their discount.
            </>
          }
          confirmLabel="Archive discount"
          destructive
          loading={archiveConfirm.pending}
          onConfirm={archive}
        />
      ) : null}
    </div>
  );
};
