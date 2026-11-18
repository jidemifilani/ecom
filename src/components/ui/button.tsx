import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Button.
 *
 * Sizing starts at a 44px tap target on the default and large sizes, which is
 * the WCAG 2.2 target-size minimum. The `sm` size is 36px and is reserved for
 * controls inside table rows, where it sits in a row that is itself the touch
 * target; `xs` is icon-only in dense toolbars.
 *
 * `loading` keeps the button mounted and its width stable, swapping the icon
 * for a spinner, so a form does not reflow on submit. It also sets
 * aria-busy and disables the control, so a double submit is impossible.
 */

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap',
    'rounded-control font-medium',
    'transition-[background-color,border-color,color,box-shadow,opacity] duration-150',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:bg-primary-hover shadow-card',
        accent: 'bg-accent text-on-accent hover:bg-accent-hover shadow-card',
        outline: 'border border-line-strong bg-surface text-fg hover:bg-surface-sunken',
        ghost: 'text-fg-muted hover:bg-surface-sunken hover:text-fg',
        danger: 'bg-danger text-on-danger hover:bg-danger-hover shadow-card',
        'danger-ghost': 'text-danger hover:bg-danger-soft',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-8 px-2 text-xs [&_svg]:size-4',
        sm: 'h-9 px-3 text-sm [&_svg]:size-4',
        md: 'h-11 px-4 text-sm [&_svg]:size-4',
        lg: 'h-12 px-6 text-base [&_svg]:size-5',
        'icon-sm': 'size-9 [&_svg]:size-4',
        icon: 'size-11 [&_svg]:size-5',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md', block: false },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /** Renders the child element instead of a <button>, e.g. a Next <Link>. */
    asChild?: boolean;
    loading?: boolean;
    /** Announced while loading, so the state is not conveyed by the spinner alone. */
    loadingLabel?: string;
  };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant,
      size,
      block,
      asChild = false,
      loading = false,
      loadingLabel = 'Working',
      disabled,
      children,
      type,
      ...props
    },
    ref,
  ) => {
    const Component = asChild ? Slot : 'button';

    return (
      <Component
        ref={ref}
        className={cn(buttonVariants({ variant, size, block }), className)}
        // An unset type inside a form defaults to "submit", which surprises
        // people who meant a plain button.
        {...(asChild ? {} : { type: type ?? 'button' })}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            <span className="sr-only">{loadingLabel}</span>
            <span aria-hidden="true">{children}</span>
          </>
        ) : (
          children
        )}
      </Component>
    );
  },
);

Button.displayName = 'Button';

export { buttonVariants };
