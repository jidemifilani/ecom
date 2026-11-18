'use client';

import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as LabelPrimitive from '@radix-ui/react-label';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { Check, ChevronDown, Eye, EyeOff, Minus } from 'lucide-react';
import { forwardRef, useId, useMemo, useState } from 'react';

import { evaluatePassword, passwordStrength } from '@/lib/auth/password-policy';
import { cn } from '@/lib/utils';

/**
 * Form primitives.
 *
 * Accessibility rules baked in here rather than left to each page:
 *  * Every control has a visible <label>. Placeholders are never used as
 *    labels -- they vanish on input and are invisible to many screen readers.
 *  * `Field` wires id, aria-describedby and aria-invalid automatically, so a
 *    validation message is always announced with the control it belongs to.
 *  * Errors render next to their field, not only in a summary at the top.
 *  * Required fields are marked in text as well as with `required`.
 */

const controlBase = [
  'w-full rounded-control border bg-surface text-fg',
  'placeholder:text-fg-subtle',
  'transition-[border-color,box-shadow] duration-150',
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:opacity-60',
  'aria-[invalid=true]:border-danger',
].join(' ');

const controlSize = 'h-11 px-3 text-sm';

// ── Label ────────────────────────────────────────────────────────────────────

export const Label = forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & { required?: boolean }
>(({ className, children, required, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn('text-fg block text-sm font-medium', className)}
    {...props}
  >
    {children}
    {required ? (
      <>
        <span aria-hidden="true" className="text-danger ml-0.5">
          *
        </span>
        <span className="sr-only"> (required)</span>
      </>
    ) : null}
  </LabelPrimitive.Root>
));
Label.displayName = 'Label';

// ── Field wrapper ────────────────────────────────────────────────────────────

export type FieldProps = {
  label: string;
  /** Hint shown under the label, before the control. */
  hint?: string;
  error?: string | undefined;
  required?: boolean;
  /** Hides the label visually but keeps it for screen readers. */
  labelHidden?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
  }) => React.ReactNode;
};

export const Field = ({
  label,
  hint,
  error,
  required,
  labelHidden,
  className,
  children,
}: FieldProps) => {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  const describedBy = [hint ? hintId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} required={required} className={labelHidden ? 'sr-only' : undefined}>
        {label}
      </Label>

      {hint ? (
        <p id={hintId} className="text-fg-subtle text-xs leading-relaxed">
          {hint}
        </p>
      ) : null}

      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
      })}

      {error ? (
        /*
         * role="alert" so the message is announced the moment it appears,
         * which matters when validation runs on blur rather than on submit.
         */
        <p id={errorId} role="alert" className="text-danger text-xs font-medium">
          {error}
        </p>
      ) : null}
    </div>
  );
};

// ── Text inputs ──────────────────────────────────────────────────────────────

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(controlBase, controlSize, className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, rows = 4, ...props }, ref) => (
  <textarea
    ref={ref}
    rows={rows}
    className={cn(controlBase, 'min-h-24 px-3 py-2 text-sm', className)}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

/** Native select, styled. Used wherever a plain list of options is enough. */
export const Select = forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
  <div className="relative">
    <select
      ref={ref}
      className={cn(controlBase, controlSize, 'appearance-none pr-9', className)}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      className="text-fg-subtle pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2"
      aria-hidden="true"
    />
  </div>
));
Select.displayName = 'Select';

/**
 * Password input with a reveal toggle and a live requirement checklist.
 *
 * The checklist uses the same `evaluatePassword` the API enforces with, so the
 * form can never show a tick for something the server will reject.
 */
export const PasswordInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & {
    /** Renders the live requirement checklist. Off for sign-in fields. */
    showRequirements?: boolean;
    value?: string;
    minLength?: number;
    context?: { email?: string | undefined; firstName?: string | undefined; lastName?: string | undefined };
  }
>(({ className, showRequirements = false, value = '', minLength = 12, context, ...props }, ref) => {
  const [revealed, setRevealed] = useState(false);
  const listId = useId();

  const requirements = useMemo(
    () => (showRequirements ? evaluatePassword(String(value), minLength, context) : []),
    [showRequirements, value, minLength, context],
  );

  const strength = useMemo(() => passwordStrength(String(value)), [value]);
  const strengthLabel = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'][strength] ?? 'Very weak';

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          ref={ref}
          type={revealed ? 'text' : 'password'}
          value={value}
          className={cn(controlBase, controlSize, 'pr-11', className)}
          aria-describedby={showRequirements ? listId : props['aria-describedby']}
          {...props}
        />
        <button
          type="button"
          onClick={() => setRevealed((previous) => !previous)}
          className="text-fg-subtle hover:text-fg absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md"
          /* The control communicates its own state, so no title is needed. */
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
        >
          {revealed ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {showRequirements && String(value).length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div
              className="bg-surface-sunken h-1.5 flex-1 overflow-hidden rounded-full"
              role="presentation"
            >
              <div
                className={cn(
                  'h-full rounded-full transition-[width,background-color] duration-300',
                  strength <= 1 && 'bg-danger',
                  strength === 2 && 'bg-warning',
                  strength >= 3 && 'bg-accent',
                )}
                style={{ width: `${Math.max(8, (strength / 4) * 100)}%` }}
              />
            </div>
            <span className="text-fg-muted text-xs font-medium">{strengthLabel}</span>
          </div>

          <ul id={listId} className="grid gap-1 sm:grid-cols-2">
            {requirements.map((requirement) => (
              <li
                key={requirement.id}
                className={cn(
                  'flex items-start gap-1.5 text-xs',
                  requirement.met ? 'text-success' : 'text-fg-subtle',
                )}
              >
                {requirement.met ? (
                  <Check className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <Minus className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                )}
                {/* The icon is decorative; the state is in the text. */}
                <span>
                  <span className="sr-only">{requirement.met ? 'Met: ' : 'Not met: '}</span>
                  {requirement.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
});
PasswordInput.displayName = 'PasswordInput';

// ── Checkbox and switch ──────────────────────────────────────────────────────

export const Checkbox = forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'border-line-strong bg-surface peer size-5 shrink-0 rounded border',
      'data-[state=checked]:bg-accent data-[state=checked]:border-accent data-[state=checked]:text-on-accent',
      'data-[state=indeterminate]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:text-on-accent',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="flex items-center justify-center">
      {props.checked === 'indeterminate' ? (
        <Minus className="size-3.5" aria-hidden="true" />
      ) : (
        <Check className="size-3.5" aria-hidden="true" />
      )}
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

/** Checkbox with its label, as one 44px-tall row. */
export const CheckboxField = ({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
  name,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  name?: string;
}) => {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex items-start gap-3 py-1.5">
      <Checkbox
        id={id}
        name={name}
        checked={checked}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        {hint ? (
          <p id={hintId} className="text-fg-subtle mt-0.5 text-xs leading-relaxed">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export const Switch = forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'bg-line-strong peer inline-flex h-6 w-11 shrink-0 items-center rounded-full',
      'transition-colors duration-200',
      'data-[state=checked]:bg-accent',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        'bg-surface pointer-events-none block size-5 rounded-full shadow-sm ring-0',
        'transition-transform duration-200 data-[state=checked]:translate-x-5.5 data-[state=unchecked]:translate-x-0.5',
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

/** Switch with its label, for settings rows. */
export const SwitchField = ({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) => {
  const id = useId();
  const hintId = `${id}-hint`;

  return (
    <div className="flex items-start justify-between gap-4 py-1">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id}>{label}</Label>
        {hint ? (
          <p id={hintId} className="text-fg-subtle mt-0.5 text-xs leading-relaxed">
            {hint}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={hint ? hintId : undefined}
        className="mt-0.5 shrink-0"
      />
    </div>
  );
};

/**
 * Error summary for the top of a long form.
 *
 * Complements the per-field messages rather than replacing them: a 20-field
 * form needs both, because a message below the fold is easy to miss.
 */
export const FormErrorSummary = ({
  errors,
  title = 'Please fix the following before continuing',
}: {
  errors: { path: string; message: string }[];
  title?: string;
}) => {
  if (errors.length === 0) return null;

  return (
    <div
      role="alert"
      tabIndex={-1}
      className="border-danger bg-danger-soft rounded-card border p-4"
    >
      <h2 className="text-danger text-sm font-semibold">{title}</h2>
      <ul className="text-danger mt-2 list-disc space-y-1 pl-5 text-sm">
        {errors.map((error) => (
          <li key={`${error.path}-${error.message}`}>{error.message}</li>
        ))}
      </ul>
    </div>
  );
};
