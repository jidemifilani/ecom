'use client';

import { ClipboardCheck, PackagePlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
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

/**
 * Stock adjustment dialogs.
 *
 * Two distinct operations, deliberately not merged:
 *  * Adjust records a *movement* (receipt, return, damage, correction) with a
 *    reason. This is the normal path and keeps the ledger meaningful.
 *  * Stock count sets the absolute figure after a physical count; the service
 *    writes the difference as an adjustment so history stays continuous.
 *
 * A reason is mandatory on both, because a stock level nobody can explain is
 * the thing that makes inventory data untrustworthy.
 */

export type StockTarget = {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  quantityOnHand: number;
};

const MOVEMENT_TYPES = [
  { value: 'RECEIPT', label: 'Receipt - stock arrived', sign: 'add' },
  { value: 'RETURN', label: 'Return - customer sent it back', sign: 'add' },
  { value: 'DAMAGE', label: 'Damage or loss - write off', sign: 'remove' },
  { value: 'ADJUSTMENT', label: 'Correction - signed adjustment', sign: 'signed' },
] as const;

export const AdjustStockDialog = ({ target }: { target: StockTarget }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>('RECEIPT');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const selected = MOVEMENT_TYPES.find((entry) => entry.value === type);

  const submit = async (): Promise<void> => {
    setFormError(null);
    setFieldErrors({});

    const parsed = Number.parseInt(quantity, 10);
    if (!Number.isFinite(parsed) || parsed === 0) {
      setFieldErrors({ quantity: 'Enter a whole number other than zero.' });
      return;
    }

    setSaving(true);
    try {
      const result = await api.post<{ quantityOnHand: number }>(
        '/api/v1/inventory/adjust',
        {
          variantId: target.variantId,
          type,
          quantity: parsed,
          reason,
          reference: reference.trim() === '' ? undefined : reference,
        },
      );

      toast.success('Stock adjusted', {
        description: `${target.sku} is now ${result.quantityOnHand} unit(s) on hand.`,
      });

      setOpen(false);
      setQuantity('');
      setReason('');
      setReference('');
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

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <PackagePlus aria-hidden="true" />
        Adjust
        <span className="sr-only"> stock for {target.sku}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>
              {target.productName}
              {target.variantName && target.variantName !== 'Default'
                ? ` - ${target.variantName}`
                : ''}{' '}
              ({target.sku}). Currently {target.quantityOnHand} on hand.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {formError ? <Alert tone="danger">{formError}</Alert> : null}

            <Field label="Reason for change" error={fieldErrors.type} required>
              {(props) => (
                <Select {...props} value={type} onChange={(event) => setType(event.target.value)}>
                  {MOVEMENT_TYPES.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Quantity"
              error={fieldErrors.quantity}
              required
              hint={
                selected?.sign === 'signed'
                  ? 'Use a negative number to remove stock, positive to add.'
                  : selected?.sign === 'remove'
                    ? 'Enter how many units to write off. It is subtracted automatically.'
                    : 'Enter how many units arrived. It is added automatically.'
              }
            >
              {(props) => (
                <Input
                  {...props}
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  inputMode={selected?.sign === 'signed' ? 'text' : 'numeric'}
                  placeholder={selected?.sign === 'signed' ? '-3' : '24'}
                />
              )}
            </Field>

            <Field
              label="Note"
              error={fieldErrors.reason}
              required
              hint="Recorded against the movement. Future you will thank present you."
            >
              {(props) => (
                <Textarea
                  {...props}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Delivery from Northwind, PO 4821"
                />
              )}
            </Field>

            <Field
              label="Reference"
              error={fieldErrors.reference}
              hint="Optional. A purchase order, delivery note or RMA number."
            >
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
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={saving}>
              Record adjustment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const StockCountDialog = ({ target }: { target: StockTarget }) => {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState(String(target.quantityOnHand));
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const parsed = Number.parseInt(counted, 10);
  const delta = Number.isFinite(parsed) ? parsed - target.quantityOnHand : 0;

  const submit = async (): Promise<void> => {
    setFormError(null);
    setFieldErrors({});

    if (!Number.isFinite(parsed) || parsed < 0) {
      setFieldErrors({ quantityOnHand: 'Enter the counted quantity, zero or more.' });
      return;
    }

    setSaving(true);
    try {
      const result = await api.post<{ quantityOnHand: number }>(
        '/api/v1/inventory/set-level',
        { variantId: target.variantId, quantityOnHand: parsed, reason },
      );

      toast.success('Stock count recorded', {
        description: `${target.sku} set to ${result.quantityOnHand} unit(s).`,
      });

      setOpen(false);
      setReason('');
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

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <ClipboardCheck aria-hidden="true" />
        Count
        <span className="sr-only"> stock for {target.sku}</span>
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a stock count</DialogTitle>
            <DialogDescription>
              Set the real figure for {target.sku}. The difference is written to the ledger as a
              correction, so the history stays continuous.
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            {formError ? <Alert tone="danger">{formError}</Alert> : null}

            <Field
              label="Counted quantity"
              error={fieldErrors.quantityOnHand}
              required
              hint={`The system currently shows ${target.quantityOnHand}.`}
            >
              {(props) => (
                <Input
                  {...props}
                  value={counted}
                  onChange={(event) => setCounted(event.target.value)}
                  inputMode="numeric"
                  autoFocus
                />
              )}
            </Field>

            {delta !== 0 && Number.isFinite(parsed) ? (
              <Alert tone={delta < 0 ? 'warning' : 'info'}>
                This will record a correction of {delta > 0 ? '+' : ''}
                {delta} unit(s).
              </Alert>
            ) : null}

            <Field label="Reason" error={fieldErrors.reason} required>
              {(props) => (
                <Textarea
                  {...props}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={2}
                  placeholder="Quarterly stock count, aisle B"
                />
              )}
            </Field>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={saving} disabled={delta === 0}>
              {delta === 0 ? 'No change to record' : 'Record count'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
