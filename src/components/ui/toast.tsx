'use client';

import { CheckCircle2, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import { Toaster, toast as sonner } from 'sonner';

/**
 * Toast notifications.
 *
 * Toasts are for confirming an action the user just took. Anything they must
 * act on, or must not miss, belongs in an inline `Alert` or a dialog -- a toast
 * disappears and cannot be recovered.
 *
 * Sonner renders into an `aria-live` region, so messages are announced without
 * stealing focus. The duration for errors is longer, because an error is more
 * likely to need reading twice.
 */

export const ToastProvider = () => (
  <Toaster
    position="bottom-right"
    // Offset clears the mobile bottom navigation.
    offset={16}
    mobileOffset={{ bottom: 88, left: 16, right: 16 }}
    gap={8}
    visibleToasts={4}
    toastOptions={{
      classNames: {
        toast:
          'group rounded-card border border-line bg-surface text-fg shadow-overlay px-4 py-3 text-sm',
        title: 'font-medium',
        description: 'text-fg-muted text-xs leading-relaxed mt-0.5',
        actionButton: 'rounded-md bg-primary px-2 py-1 text-xs font-medium text-on-primary',
        cancelButton:
          'rounded-md border border-line px-2 py-1 text-xs font-medium text-fg-muted',
      },
    }}
    icons={{
      success: <CheckCircle2 className="text-success size-4" aria-hidden="true" />,
      error: <OctagonAlert className="text-danger size-4" aria-hidden="true" />,
      warning: <TriangleAlert className="text-warning size-4" aria-hidden="true" />,
      info: <Info className="text-info size-4" aria-hidden="true" />,
    }}
  />
);

type ToastOptions = {
  description?: string;
  /** Overrides the default dwell time, in milliseconds. */
  duration?: number;
  action?: { label: string; onClick: () => void };
};

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    sonner.success(message, { duration: 4000, ...options }),

  error: (message: string, options?: ToastOptions) =>
    // Errors stay longer: they usually carry something to read or copy.
    sonner.error(message, { duration: 8000, ...options }),

  warning: (message: string, options?: ToastOptions) =>
    sonner.warning(message, { duration: 6000, ...options }),

  info: (message: string, options?: ToastOptions) =>
    sonner.info(message, { duration: 4000, ...options }),

  /** Shows progress, then resolves to success or error on settle. */
  promise: <T,>(
    promise: Promise<T>,
    messages: { loading: string; success: string; error: string },
  ) => sonner.promise(promise, messages),

  dismiss: (id?: string | number) => sonner.dismiss(id),
};
