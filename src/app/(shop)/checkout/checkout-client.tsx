'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Lock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { ProductImage } from '@/components/shop/product-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { Field, FormErrorSummary, Input, Select, SwitchField } from '@/components/ui/form';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { formatMoney } from '@/lib/money';
import { checkoutSchema, type CheckoutInput } from '@/validation/cart';

import type { CartSnapshot } from '../cart/cart-client';

type FormValues = z.input<typeof checkoutSchema>;

/**
 * Checkout.
 *
 * The form sends addresses, contact details and a payment method -- never a
 * price. Totals are recomputed server-side at the moment of sale, so a basket
 * tampered with in the browser cannot produce a mispriced order.
 *
 * A 422 with field errors is mapped back onto the matching inputs; a 412
 * (stock or store-state problem) is shown as a banner with a route back to the
 * basket, because the fix is there rather than in this form.
 */

const COUNTRIES = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'GH', name: 'Ghana' },
  { code: 'KE', name: 'Kenya' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'IE', name: 'Ireland' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'PT', name: 'Portugal' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'IN', name: 'India' },
  { code: 'AE', name: 'United Arab Emirates' },
];

export const CheckoutClient = ({
  cart,
  locale,
  allowGuest,
  isSignedIn,
  prefill,
}: {
  cart: CartSnapshot;
  locale: string;
  allowGuest: boolean;
  isSignedIn: boolean;
  prefill: {
    email: string;
    firstName: string;
    lastName: string;
    phone: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    postalCode: string;
    countryCode: string;
  } | null;
}) => {
  const router = useRouter();
  const [blockingError, setBlockingError] = useState<string | null>(null);

  const currency = cart.totals?.currency ?? 'USD';
  const money = (minor: number): string => formatMoney(minor, currency, locale);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues, unknown, CheckoutInput>({
    resolver: zodResolver(checkoutSchema),
    defaultValues: {
      email: prefill?.email ?? '',
      phone: prefill?.phone ?? '',
      billingSameAsShipping: true,
      createAccount: false,
      paymentProvider: 'CASH_ON_DELIVERY',
      customerNote: '',
      shippingAddress: {
        firstName: prefill?.firstName ?? '',
        lastName: prefill?.lastName ?? '',
        line1: prefill?.line1 ?? '',
        line2: prefill?.line2 ?? '',
        city: prefill?.city ?? '',
        state: prefill?.state ?? '',
        postalCode: prefill?.postalCode ?? '',
        countryCode: prefill?.countryCode ?? 'GB',
        isDefaultShipping: true,
        isDefaultBilling: true,
      },
    },
  });

  const billingSame = watch('billingSameAsShipping');
  const createAccount = watch('createAccount');

  const onSubmit = async (values: CheckoutInput): Promise<void> => {
    setBlockingError(null);

    try {
      const result = await api.post<{ orderNumber: string }>('/api/shop/checkout', values);

      window.dispatchEvent(
        new CustomEvent('shop:cart-updated', { detail: { itemCount: 0 } }),
      );

      router.push(`/order/${result.orderNumber}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        const fields = error.byField;
        let mapped = false;

        for (const [path, message] of Object.entries(fields)) {
          // Zod paths are dotted; react-hook-form understands that form.
          if (path === 'items' || path === '(root)') continue;
          setError(path as never, { message });
          mapped = true;
        }

        if (!mapped) setBlockingError(error.message);
        return;
      }

      setBlockingError(toErrorMessage(error));
    }
  };

  const summaryErrors = Object.entries(errors)
    .flatMap(([key, value]) => {
      if (value && typeof value === 'object' && 'message' in value && value.message) {
        return [{ path: key, message: String(value.message) }];
      }
      // Nested address errors arrive as an object of field errors.
      if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, { message?: string }>)
          .filter(([, nested]) => Boolean(nested?.message))
          .map(([nestedKey, nested]) => ({
            path: `${key}.${nestedKey}`,
            message: String(nested.message),
          }));
      }
      return [];
    })
    .filter((entry) => entry.message !== '');

  const addressFields = (prefix: 'shippingAddress' | 'billingAddress') => (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        label="First name"
        error={errors[prefix]?.firstName?.message}
        required
      >
        {(props) => (
          <Input {...props} {...register(`${prefix}.firstName`)} autoComplete="given-name" />
        )}
      </Field>

      <Field label="Last name" error={errors[prefix]?.lastName?.message} required>
        {(props) => (
          <Input {...props} {...register(`${prefix}.lastName`)} autoComplete="family-name" />
        )}
      </Field>

      <Field
        label="Address line 1"
        error={errors[prefix]?.line1?.message}
        required
        className="sm:col-span-2"
      >
        {(props) => (
          <Input {...props} {...register(`${prefix}.line1`)} autoComplete="address-line1" />
        )}
      </Field>

      <Field
        label="Address line 2"
        error={errors[prefix]?.line2?.message}
        className="sm:col-span-2"
      >
        {(props) => (
          <Input {...props} {...register(`${prefix}.line2`)} autoComplete="address-line2" />
        )}
      </Field>

      <Field label="City" error={errors[prefix]?.city?.message} required>
        {(props) => (
          <Input {...props} {...register(`${prefix}.city`)} autoComplete="address-level2" />
        )}
      </Field>

      <Field label="County or state" error={errors[prefix]?.state?.message}>
        {(props) => (
          <Input {...props} {...register(`${prefix}.state`)} autoComplete="address-level1" />
        )}
      </Field>

      <Field label="Postcode" error={errors[prefix]?.postalCode?.message}>
        {(props) => (
          <Input {...props} {...register(`${prefix}.postalCode`)} autoComplete="postal-code" />
        )}
      </Field>

      <Field label="Country" error={errors[prefix]?.countryCode?.message} required>
        {(props) => (
          <Select {...props} {...register(`${prefix}.countryCode`)} autoComplete="country">
            {COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {country.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="min-w-0 space-y-5">
        <FormErrorSummary errors={summaryErrors} />

        {blockingError ? (
          <Alert tone="danger" title="Checkout could not be completed">
            <p>{blockingError}</p>
            <p className="mt-2">
              <Link href="/cart" className="font-medium underline underline-offset-4">
                Back to your basket
              </Link>
            </p>
          </Alert>
        ) : null}

        {!allowGuest && !isSignedIn ? (
          <Alert tone="warning" title="An account is required">
            <p>This store does not allow guest checkout.</p>
            <p className="mt-2 flex gap-3">
              <Link href="/account/login?next=/checkout" className="font-medium underline">
                Sign in
              </Link>
              <Link href="/account/register?next=/checkout" className="font-medium underline">
                Create an account
              </Link>
            </p>
          </Alert>
        ) : null}

        <Card as="section">
          <CardHeader>
            <CardTitle as="h2">Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Email address"
              error={errors.email?.message}
              required
              hint="Your order confirmation goes here."
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

            <Field label="Phone" error={errors.phone?.message} hint="For delivery updates.">
              {(props) => (
                <Input {...props} {...register('phone')} type="tel" autoComplete="tel" />
              )}
            </Field>
          </CardContent>
        </Card>

        <Card as="section">
          <CardHeader>
            <CardTitle as="h2">Delivery address</CardTitle>
          </CardHeader>
          <CardContent>{addressFields('shippingAddress')}</CardContent>
        </Card>

        <Card as="section">
          <CardHeader>
            <CardTitle as="h2">Billing address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <SwitchField
              label="Same as delivery address"
              checked={billingSame === true}
              onCheckedChange={(checked) =>
                setValue('billingSameAsShipping', checked, { shouldValidate: true })
              }
            />

            {billingSame !== true ? addressFields('billingAddress') : null}
          </CardContent>
        </Card>

        <Card as="section">
          <CardHeader>
            <CardTitle as="h2">Payment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert tone="info" title="No card is taken in this demonstration">
              Choose how you intend to pay. The order is created unpaid and a staff member
              records the payment once it arrives.
            </Alert>

            <Field label="Payment method" error={errors.paymentProvider?.message} required>
              {(props) => (
                <Select {...props} {...register('paymentProvider')}>
                  <option value="CASH_ON_DELIVERY">Cash on delivery</option>
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="MANUAL">Arrange with the store</option>
                </Select>
              )}
            </Field>

            <Field
              label="Order notes"
              error={errors.customerNote?.message}
              hint="Delivery instructions, or anything we should know."
            >
              {(props) => <Input {...props} {...register('customerNote')} />}
            </Field>

            {!isSignedIn ? (
              <SwitchField
                label="Create an account from these details"
                hint="Lets you track this order and check out faster next time. You will set a password afterwards."
                checked={createAccount === true}
                onCheckedChange={(checked) => setValue('createAccount', checked)}
              />
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* ── Summary ── */}
      <div className="lg:sticky lg:top-20 lg:self-start">
        <Card as="section">
          <CardHeader>
            <CardTitle as="h2">Your order</CardTitle>
            <Badge tone="outline">{cart.itemCount}</Badge>
          </CardHeader>

          <ul className="divide-line divide-y">
            {cart.lines.map((line) => (
              <li key={line.variantId} className="flex items-start gap-3 px-5 py-3">
                <span className="bg-surface-sunken rounded-control relative size-12 shrink-0 overflow-hidden">
                  <ProductImage url={line.imageUrl} alt={line.imageAlt} sizes="48px" />
                </span>

                <span className="min-w-0 flex-1">
                  <span className="text-fg block truncate text-sm font-medium">
                    {line.productName}
                  </span>
                  <span className="text-fg-subtle block text-xs">
                    {line.variantName ? `${line.variantName} - ` : ''}
                    Qty {line.quantity}
                  </span>
                </span>

                <span className="text-fg shrink-0 text-sm font-medium">
                  {money(line.lineTotal)}
                </span>
              </li>
            ))}
          </ul>

          {cart.totals ? (
            <CardContent className="border-line border-t pt-4">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">Subtotal</dt>
                  <dd className="text-fg">{money(cart.totals.subtotal)}</dd>
                </div>
                {cart.totals.discountTotal > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-fg-muted">
                      Discount{cart.discountCode ? ` (${cart.discountCode})` : ''}
                    </dt>
                    <dd className="text-success">-{money(cart.totals.discountTotal)}</dd>
                  </div>
                ) : null}
                {cart.totals.taxTotal > 0 ? (
                  <div className="flex justify-between gap-4">
                    <dt className="text-fg-muted">Tax</dt>
                    <dd className="text-fg">{money(cart.totals.taxTotal)}</dd>
                  </div>
                ) : null}
                <div className="flex justify-between gap-4">
                  <dt className="text-fg-muted">Delivery</dt>
                  <dd className="text-fg">
                    {cart.totals.shippingTotal === 0 ? 'Free' : money(cart.totals.shippingTotal)}
                  </dd>
                </div>
                <div className="border-line flex justify-between gap-4 border-t pt-2 text-base font-semibold">
                  <dt>Total</dt>
                  <dd>{money(cart.totals.grandTotal)}</dd>
                </div>
              </dl>

              <Button
                type="submit"
                size="lg"
                block
                loading={isSubmitting}
                loadingLabel="Placing your order"
                disabled={!cart.checkoutReady || (!allowGuest && !isSignedIn)}
                className="mt-5"
              >
                <Lock aria-hidden="true" />
                Place order
              </Button>

              <p className="text-fg-subtle mt-3 flex items-start gap-1.5 text-xs leading-relaxed">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Stock and prices are re-checked now. If anything has changed you will be told
                before the order is placed.
              </p>
            </CardContent>
          ) : null}
        </Card>

        <p className="mt-3 text-center">
          <Link
            href="/cart"
            className="text-fg-muted hover:text-fg rounded text-sm underline-offset-4 hover:underline"
          >
            Edit your basket
          </Link>
        </p>
      </div>
    </form>
  );
};
