'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { forwardRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { Button } from './button';

/**
 * Dialogs, drawers and confirmations.
 *
 * Built on Radix primitives, which handle the parts that are easy to get wrong
 * by hand: focus trapping, restoring focus to the trigger on close, Escape to
 * dismiss, `aria-modal`, and marking the rest of the page inert.
 *
 * On phones a Dialog becomes a bottom sheet, which keeps its actions within
 * thumb reach instead of centring them on screen.
 */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const Overlay = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-brand-950/60 backdrop-blur-[2px]',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
      className,
    )}
    {...props}
  />
));
Overlay.displayName = 'DialogOverlay';

export const DialogContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    size?: 'sm' | 'md' | 'lg' | 'xl';
    /** Hides the default close button when the dialog must be resolved by action. */
    hideClose?: boolean;
  }
>(({ className, children, size = 'md', hideClose = false, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <Overlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'bg-surface border-line shadow-overlay fixed z-50 border',
        // Phone: bottom sheet, full width, rounded top corners only.
        'inset-x-0 bottom-0 max-h-[92dvh] overflow-y-auto rounded-t-2xl',
        // Tablet and up: centred modal.
        'sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85dvh]',
        'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card',
        'w-full',
        size === 'sm' && 'sm:max-w-sm',
        size === 'md' && 'sm:max-w-lg',
        size === 'lg' && 'sm:max-w-2xl',
        size === 'xl' && 'sm:max-w-4xl',
        'data-[state=open]:animate-in data-[state=closed]:animate-out duration-200',
        className,
      )}
      {...props}
    >
      {children}
      {hideClose ? null : (
        <DialogPrimitive.Close
          className="text-fg-subtle hover:bg-surface-sunken hover:text-fg absolute top-3.5 right-3.5 grid size-9 place-items-center rounded-md"
          aria-label="Close dialog"
        >
          <X className="size-4" aria-hidden="true" />
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = 'DialogContent';

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('px-5 pt-5 pb-3 pr-14', className)} {...props} />
);

export const DialogTitle = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-fg text-base font-semibold', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-fg-muted mt-1 text-sm leading-relaxed', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

export const DialogBody = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('space-y-4 px-5 py-2', className)} {...props} />
);

export const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'safe-bottom border-line flex flex-col-reverse gap-2 border-t px-5 py-4',
      'sm:flex-row sm:justify-end',
      className,
    )}
    {...props}
  />
);

// ── Confirmation ─────────────────────────────────────────────────────────────

/**
 * Destructive-action confirmation.
 *
 * Uses Radix AlertDialog rather than Dialog: it is modal without a dismiss
 * affordance in the corner, and focus lands on the cancel action, so a stray
 * Enter keypress does not delete anything.
 */
export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  destructive = false,
  loading = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void | Promise<void>;
  destructive?: boolean;
  loading?: boolean;
  children?: React.ReactNode;
}) => (
  <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className="fixed inset-0 z-50 bg-brand-950/60 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
      <AlertDialogPrimitive.Content
        className={cn(
          'bg-surface border-line shadow-overlay fixed z-50 border',
          'inset-x-0 bottom-0 rounded-t-2xl',
          'sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-full sm:max-w-md',
          'sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-card',
          'data-[state=closed]:animate-out data-[state=open]:animate-in duration-200',
        )}
      >
        <div className="px-5 pt-5">
          <AlertDialogPrimitive.Title className="text-fg text-base font-semibold">
            {title}
          </AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description asChild>
            <div className="text-fg-muted mt-1.5 text-sm leading-relaxed">{description}</div>
          </AlertDialogPrimitive.Description>
        </div>

        {children ? <div className="px-5 pt-4">{children}</div> : null}

        <div className="safe-bottom mt-5 flex flex-col-reverse gap-2 px-5 pb-5 sm:flex-row sm:justify-end">
          <AlertDialogPrimitive.Cancel asChild>
            <Button variant="outline" disabled={loading}>
              {cancelLabel}
            </Button>
          </AlertDialogPrimitive.Cancel>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            loading={loading}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </div>
      </AlertDialogPrimitive.Content>
    </AlertDialogPrimitive.Portal>
  </AlertDialogPrimitive.Root>
);

/** Small hook for the common "open a confirm, then run an action" pattern. */
export const useConfirm = () => {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return {
    open,
    pending,
    ask: () => setOpen(true),
    close: () => setOpen(false),
    setOpen,
    run: async (action: () => Promise<void>) => {
      setPending(true);
      try {
        await action();
        setOpen(false);
      } finally {
        setPending(false);
      }
    },
  };
};

// ── Side sheet ───────────────────────────────────────────────────────────────

/** Slide-over panel, used for filters and the mobile navigation. */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export const SheetContent = forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    side?: 'left' | 'right';
    label: string;
  }
>(({ className, children, side = 'right', label, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <Overlay />
    <DialogPrimitive.Content
      ref={ref}
      aria-label={label}
      className={cn(
        'bg-surface border-line shadow-overlay fixed inset-y-0 z-50 flex w-[85vw] max-w-sm flex-col border',
        side === 'left' ? 'left-0 border-r' : 'right-0 border-l',
        'data-[state=open]:animate-in data-[state=closed]:animate-out duration-200',
        className,
      )}
      {...props}
    >
      <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
      {children}
      <DialogPrimitive.Close
        className="text-fg-subtle hover:bg-surface-sunken hover:text-fg absolute top-3.5 right-3.5 grid size-9 place-items-center rounded-md"
        aria-label="Close panel"
      >
        <X className="size-4" aria-hidden="true" />
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
SheetContent.displayName = 'SheetContent';
