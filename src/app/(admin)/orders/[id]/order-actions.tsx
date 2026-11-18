'use client';

import { Ban, CreditCard, RotateCcw, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, SwitchField, Textarea } from '@/components/ui/form';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { formatMoney, toMajorString, toMinorUnits } from '@/lib/money';

/**
 * Order action dialogs.
 *
 * Each of these maps to a dedicated endpoint rather than a generic "update
 * order", because each has side effects beyond a status column: fulfilment
 * moves stock, refunds adjust the paid total, cancellation releases
 * reservations. Routing them through one endpoint would make those effects
 * implicit.
 *
 * A reason is required on cancel and refund, and ends up in both the order
 * timeline and the audit trail.
 */

type DialogState = { open: boolean; saving: boolean; error: string | null };

const useDialog = () => {
  const [state, setState] = useState<DialogState>({
    open: false,
    saving: false,
    error: null,
  });

  return {
    ...state,
    openDialog: () => setState({ open: true, saving: false, error: null }),
    close: () => setState((current) => ({ ...current, open: false })),
    setOpen: (open: boolean) => setState((current) => ({ ...current, open })),
    setSaving: (saving: boolean) => setState((current) => ({ ...current, saving })),
    setError: (error: string | null) => setState((current) => ({ ...current, error })),
  };
};

const messageFrom = (error: unknown): string => {
  if (error instanceof ApiError) {
    return Object.values(error.byField)[0] ?? error.message;
  }
  return toErrorMessage(error);
};

// ── Fulfil ───────────────────────────────────────────────────────────────────

export const FulfillOrderDialog = ({
  orderId,
  outstandingLines,
}: {
  orderId: string;
  outstandingLines: { id: string; label: string; outstanding: number }[];
}) => {
  const router = useRouter();
  const dialog = useDialog();

  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [notify, setNotify] = useState(true);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(outstandingLines.map((line) => [line.id, String(line.outstanding)])),
  );

  const submit = async (): Promise<void> => {
    dialog.setError(null);
    dialog.setSaving(true);

    const lines = outstandingLines
      .map((line) => ({
        orderItemId: line.id,
        quantity: Number.parseInt(quantities[line.id] ?? '0', 10),
      }))
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);

    if (lines.length === 0) {
      dialog.setError('Enter a quantity for at least one line.');
      dialog.setSaving(false);
      return;
    }

    try {
      await api.post(`/api/v1/orders/${orderId}/fulfill`, {
        carrier,
        trackingNumber: tracking.trim() === '' ? undefined : tracking,
        lines,
        notifyCustomer: notify,
      });

      toast.success('Shipment created', {
        description: notify ? 'The customer has been emailed.' : undefined,
      });
      dialog.close();
      router.refresh();
    } catch (error) {
      dialog.setError(messageFrom(error));
    } finally {
      dialog.setSaving(false);
    }
  };

  return (
    <>
      <Button size="sm" onClick={dialog.openDialog}>
        <Truck aria-hidden="true" />
        Fulfil order
      </Button>

      <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Create a shipment</DialogTitle>
            <DialogDescription>
              Reduce the quantities to ship part of the order. Reserved stock is converted into a
              dispatch.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {dialog.error ? <Alert tone="danger">{dialog.error}</Alert> : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Carrier" required>
                {(props) => (
                  <Input
                    {...props}
                    value={carrier}
                    onChange={(event) => setCarrier(event.target.value)}
                    placeholder="Royal Mail"
                    autoFocus
                  />
                )}
              </Field>

              <Field label="Tracking number">
                {(props) => (
                  <Input
                    {...props}
                    value={tracking}
                    onChange={(event) => setTracking(event.target.value)}
                  />
                )}
              </Field>
            </div>

            <fieldset>
              <legend className="text-fg mb-2 text-sm font-medium">Quantities to ship</legend>
              <ul className="divide-line divide-y">
                {outstandingLines.map((line) => (
                  <li key={line.id} className="flex items-center gap-3 py-2">
                    <span className="text-fg min-w-0 flex-1 truncate text-sm">{line.label}</span>
                    <span className="text-fg-subtle shrink-0 text-xs">
                      of {line.outstanding}
                    </span>
                    <Input
                      value={quantities[line.id] ?? ''}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [line.id]: event.target.value,
                        }))
                      }
                      inputMode="numeric"
                      aria-label={`Quantity to ship for ${line.label}`}
                      className="w-20 shrink-0 text-center"
                    />
                  </li>
                ))}
              </ul>
            </fieldset>

            <SwitchField
              label="Email the customer"
              hint="Sends a shipping confirmation with the tracking number."
              checked={notify}
              onCheckedChange={setNotify}
            />
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={dialog.close} disabled={dialog.saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={dialog.saving}>
              Create shipment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── Record payment ───────────────────────────────────────────────────────────

export const RecordPaymentDialog = ({
  orderId,
  outstanding,
  currency,
  locale,
}: {
  orderId: string;
  outstanding: number;
  currency: string;
  locale: string;
}) => {
  const router = useRouter();
  const dialog = useDialog();

  const [amount, setAmount] = useState(toMajorString(Math.max(0, outstanding), currency));
  const [provider, setProvider] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [status, setStatus] = useState('PAID');

  const submit = async (): Promise<void> => {
    dialog.setError(null);

    const minor = toMinorUnits(amount, currency);
    if (minor === null || minor <= 0) {
      dialog.setError('Enter an amount above zero.');
      return;
    }

    dialog.setSaving(true);
    try {
      await api.post(`/api/v1/orders/${orderId}/payments`, {
        provider,
        amount: minor,
        reference: reference.trim() === '' ? undefined : reference,
        status,
      });

      toast.success('Payment recorded');
      dialog.close();
      router.refresh();
    } catch (error) {
      dialog.setError(messageFrom(error));
    } finally {
      dialog.setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={dialog.openDialog}>
        <CreditCard aria-hidden="true" />
        Record payment
      </Button>

      <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              For payments taken outside the store: bank transfer, cash on delivery or a card
              terminal. Outstanding balance{' '}
              {formatMoney(Math.max(0, outstanding), currency, locale)}.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {dialog.error ? <Alert tone="danger">{dialog.error}</Alert> : null}

            <Field label={`Amount (${currency})`} required>
              {(props) => (
                <Input
                  {...props}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                />
              )}
            </Field>

            <Field label="Method" required>
              {(props) => (
                <Select
                  {...props}
                  value={provider}
                  onChange={(event) => setProvider(event.target.value)}
                >
                  <option value="BANK_TRANSFER">Bank transfer</option>
                  <option value="CASH_ON_DELIVERY">Cash on delivery</option>
                  <option value="CARD">Card</option>
                  <option value="MANUAL">Other</option>
                </Select>
              )}
            </Field>

            <Field label="Outcome" required>
              {(props) => (
                <Select
                  {...props}
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                >
                  <option value="PAID">Received</option>
                  <option value="AUTHORIZED">Authorised, not captured</option>
                  <option value="FAILED">Failed</option>
                </Select>
              )}
            </Field>

            <Field label="Reference" hint="Transaction id, receipt number or payer reference.">
              {(props) => (
                <Input
                  {...props}
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                />
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={dialog.close} disabled={dialog.saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={dialog.saving}>
              Record payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── Refund ───────────────────────────────────────────────────────────────────

export const RefundOrderDialog = ({
  orderId,
  refundable,
  currency,
  locale,
}: {
  orderId: string;
  refundable: number;
  currency: string;
  locale: string;
}) => {
  const router = useRouter();
  const dialog = useDialog();

  const [amount, setAmount] = useState(toMajorString(Math.max(0, refundable), currency));
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(false);

  const submit = async (): Promise<void> => {
    dialog.setError(null);

    const minor = toMinorUnits(amount, currency);
    if (minor === null || minor <= 0) {
      dialog.setError('Enter a refund amount above zero.');
      return;
    }

    dialog.setSaving(true);
    try {
      await api.post(`/api/v1/orders/${orderId}/refund`, {
        amount: minor,
        reason,
        restock,
      });

      toast.success('Refund recorded');
      dialog.close();
      router.refresh();
    } catch (error) {
      dialog.setError(messageFrom(error));
    } finally {
      dialog.setSaving(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={dialog.openDialog}>
        <RotateCcw aria-hidden="true" />
        Refund
      </Button>

      <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue a refund</DialogTitle>
            <DialogDescription>
              Up to {formatMoney(Math.max(0, refundable), currency, locale)} can still be
              refunded. This records the refund against the order; move the money in your payment
              provider separately.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {dialog.error ? <Alert tone="danger">{dialog.error}</Alert> : null}

            <Field label={`Refund amount (${currency})`} required>
              {(props) => (
                <Input
                  {...props}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  autoFocus
                />
              )}
            </Field>

            <Field label="Reason" required>
              {(props) => (
                <Textarea
                  {...props}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Item arrived damaged"
                />
              )}
            </Field>

            <SwitchField
              label="Return the items to stock"
              hint="Only applies to a full refund. Leave off for goods you are not getting back."
              checked={restock}
              onCheckedChange={setRestock}
            />
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={dialog.close} disabled={dialog.saving}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void submit()} loading={dialog.saving}>
              Issue refund
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── Cancel ───────────────────────────────────────────────────────────────────

export const CancelOrderDialog = ({
  orderId,
  orderNumber,
}: {
  orderId: string;
  orderNumber: string;
}) => {
  const router = useRouter();
  const dialog = useDialog();

  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);

  const submit = async (): Promise<void> => {
    dialog.setError(null);
    dialog.setSaving(true);

    try {
      await api.post(`/api/v1/orders/${orderId}/cancel`, { reason, restock });
      toast.success(`Order ${orderNumber} cancelled`);
      dialog.close();
      router.refresh();
    } catch (error) {
      dialog.setError(messageFrom(error));
    } finally {
      dialog.setSaving(false);
    }
  };

  return (
    <>
      <Button variant="danger-ghost" size="sm" onClick={dialog.openDialog}>
        <Ban aria-hidden="true" />
        Cancel order
      </Button>

      <Dialog open={dialog.open} onOpenChange={dialog.setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this order?</DialogTitle>
            <DialogDescription>
              {orderNumber} will be cancelled. A cancelled order cannot be reopened, so issue a
              refund separately if money has already changed hands.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {dialog.error ? <Alert tone="danger">{dialog.error}</Alert> : null}

            <Field label="Reason" required>
              {(props) => (
                <Textarea
                  {...props}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Customer requested cancellation"
                  autoFocus
                />
              )}
            </Field>

            <SwitchField
              label="Release stock back to available"
              hint="Recommended. Returns every unit that has not already shipped."
              checked={restock}
              onCheckedChange={setRestock}
            />
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={dialog.close} disabled={dialog.saving}>
              Keep order
            </Button>
            <Button variant="danger" onClick={() => void submit()} loading={dialog.saving}>
              Cancel order
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

// ── Status change ────────────────────────────────────────────────────────────

export const ChangeStatusControl = ({
  orderId,
  currentStatus,
  allowed,
}: {
  orderId: string;
  currentStatus: string;
  /** Transitions the state machine permits from here. */
  allowed: string[];
}) => {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  if (allowed.length === 0) return null;

  const change = async (next: string): Promise<void> => {
    if (next === '' || next === currentStatus) return;

    setBusy(true);
    try {
      await api.patch(`/api/v1/orders/${orderId}/status`, { status: next });
      toast.success(`Order marked ${next.toLowerCase()}`);
      router.refresh();
    } catch (error) {
      toast.error(messageFrom(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <label className="block">
      <span className="sr-only">Change order status</span>
      <Select
        value=""
        onChange={(event) => void change(event.target.value)}
        disabled={busy}
        aria-label="Change order status"
        className="h-9 text-sm"
      >
        <option value="">Move to...</option>
        {allowed.map((status) => (
          <option key={status} value={status}>
            {status.charAt(0) + status.slice(1).toLowerCase()}
          </option>
        ))}
      </Select>
    </label>
  );
};
