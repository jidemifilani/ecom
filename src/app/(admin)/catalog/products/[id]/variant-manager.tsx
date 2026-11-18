'use client';

import { Plus, Save, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { Field, Input, SwitchField } from '@/components/ui/form';
import { ConfirmDialog, useConfirm } from '@/components/ui/overlay';
import {
  NumericTD,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  TableContainer,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { formatMoney, toMajorString, toMinorUnits } from '@/lib/money';
import { formatNumber } from '@/lib/utils';

/**
 * Variant manager.
 *
 * Variants are the unit that inventory and order lines actually reference, so
 * every product has at least one. The default variant cannot be removed --
 * archiving the product is the way to retire it -- and the server enforces
 * that rather than relying on this UI hiding the button.
 */

export type VariantRow = {
  id: string;
  sku: string;
  name: string;
  price: number;
  isDefault: boolean;
  isActive: boolean;
  quantityOnHand: number;
  quantityReserved: number;
  reorderPoint: number;
  options: { name: string; value: string }[];
};

type DraftState = {
  sku: string;
  name: string;
  price: string;
  optionName: string;
  optionValue: string;
  quantity: string;
  reorderPoint: string;
  isActive: boolean;
};

const emptyDraft: DraftState = {
  sku: '',
  name: '',
  price: '',
  optionName: '',
  optionValue: '',
  quantity: '0',
  reorderPoint: '5',
  isActive: true,
};

export const VariantManager = ({
  productId,
  variants,
  currency,
  locale,
  canEdit,
}: {
  productId: string;
  variants: VariantRow[];
  currency: string;
  locale: string;
  canEdit: boolean;
}) => {
  const router = useRouter();
  const archiveConfirm = useConfirm();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<DraftState>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftState>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [targetVariant, setTargetVariant] = useState<VariantRow | null>(null);

  const money = (minor: number): string => formatMoney(minor, currency, locale);

  const buildPayload = (
    state: DraftState,
    includeOpening: boolean,
  ): Record<string, unknown> | null => {
    const priceMinor = toMinorUnits(state.price, currency);
    if (priceMinor === null) {
      setFormError('Enter a valid price, for example 19.99.');
      return null;
    }

    return {
      sku: state.sku,
      name: state.name,
      price: priceMinor,
      isActive: state.isActive,
      position: 0,
      attributes:
        state.optionName.trim() !== '' && state.optionValue.trim() !== ''
          ? [{ name: state.optionName.trim(), value: state.optionValue.trim() }]
          : [],
      reorderPoint: Number.parseInt(state.reorderPoint || '0', 10),
      ...(includeOpening
        ? { initialQuantity: Number.parseInt(state.quantity || '0', 10) }
        : {}),
    };
  };

  const create = async (): Promise<void> => {
    setFormError(null);
    const payload = buildPayload(draft, true);
    if (!payload) return;

    setBusy(true);
    try {
      await api.post(`/api/v1/products/${productId}/variants`, payload);
      toast.success('Variant added');
      setDraft(emptyDraft);
      setAdding(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(
          Object.values(error.byField)[0] ?? error.message,
        );
        return;
      }
      setFormError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (variant: VariantRow): void => {
    setEditingId(variant.id);
    setFormError(null);
    setEditDraft({
      sku: variant.sku,
      name: variant.name,
      price: toMajorString(variant.price, currency),
      optionName: variant.options[0]?.name ?? '',
      optionValue: variant.options[0]?.value ?? '',
      quantity: String(variant.quantityOnHand),
      reorderPoint: String(variant.reorderPoint),
      isActive: variant.isActive,
    });
  };

  const saveEdit = async (): Promise<void> => {
    if (!editingId) return;
    setFormError(null);

    const payload = buildPayload(editDraft, false);
    if (!payload) return;

    setBusy(true);
    try {
      await api.patch(`/api/v1/products/variants/${editingId}`, payload);
      toast.success('Variant updated');
      setEditingId(null);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        setFormError(Object.values(error.byField)[0] ?? error.message);
        return;
      }
      setFormError(toErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const archive = async (): Promise<void> => {
    if (!targetVariant) return;

    await archiveConfirm.run(async () => {
      try {
        await api.delete(`/api/v1/products/variants/${targetVariant.id}`);
        toast.success('Variant removed');
        router.refresh();
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    });
  };

  const draftFields = (
    state: DraftState,
    setState: (next: DraftState) => void,
    includeOpening: boolean,
  ) => (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="SKU" required>
        {(props) => (
          <Input
            {...props}
            value={state.sku}
            onChange={(event) => setState({ ...state, sku: event.target.value.toUpperCase() })}
            className="font-mono"
          />
        )}
      </Field>

      <Field label="Variant name" required hint="What shoppers see, e.g. Large or Midnight.">
        {(props) => (
          <Input
            {...props}
            value={state.name}
            onChange={(event) => setState({ ...state, name: event.target.value })}
          />
        )}
      </Field>

      <Field label={`Price (${currency})`} required>
        {(props) => (
          <Input
            {...props}
            value={state.price}
            onChange={(event) => setState({ ...state, price: event.target.value })}
            inputMode="decimal"
          />
        )}
      </Field>

      <Field label="Reorder point">
        {(props) => (
          <Input
            {...props}
            value={state.reorderPoint}
            onChange={(event) => setState({ ...state, reorderPoint: event.target.value })}
            inputMode="numeric"
          />
        )}
      </Field>

      <Field label="Option name" hint="For example Size or Colour. Optional.">
        {(props) => (
          <Input
            {...props}
            value={state.optionName}
            onChange={(event) => setState({ ...state, optionName: event.target.value })}
          />
        )}
      </Field>

      <Field label="Option value" hint="For example Large or Midnight.">
        {(props) => (
          <Input
            {...props}
            value={state.optionValue}
            onChange={(event) => setState({ ...state, optionValue: event.target.value })}
          />
        )}
      </Field>

      {includeOpening ? (
        <Field label="Opening quantity" className="sm:col-span-2">
          {(props) => (
            <Input
              {...props}
              value={state.quantity}
              onChange={(event) => setState({ ...state, quantity: event.target.value })}
              inputMode="numeric"
            />
          )}
        </Field>
      ) : (
        <div className="sm:col-span-2">
          <p className="text-fg-subtle text-xs leading-relaxed">
            Stock levels are changed from the Inventory screen, so every movement is recorded
            with a reason.
          </p>
        </div>
      )}

      <div className="sm:col-span-2">
        <SwitchField
          label="Available for sale"
          checked={state.isActive}
          onCheckedChange={(checked) => setState({ ...state, isActive: checked })}
        />
      </div>
    </div>
  );

  return (
    <Card as="section">
      <CardHeader>
        <CardTitle>Variants</CardTitle>
        <div className="flex items-center gap-2">
          <Badge tone="outline">{variants.length}</Badge>
          {canEdit && !adding ? (
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" />
              Add variant
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {formError ? <Alert tone="danger">{formError}</Alert> : null}

        {adding ? (
          <div className="border-line rounded-control border p-4">
            <h3 className="text-fg mb-3 text-sm font-semibold">New variant</h3>
            {draftFields(draft, setDraft, true)}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void create()} loading={busy}>
                <Save aria-hidden="true" />
                Add variant
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAdding(false);
                  setDraft(emptyDraft);
                  setFormError(null);
                }}
              >
                <X aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {editingId ? (
          <div className="border-accent/40 bg-accent-soft/30 rounded-control border p-4">
            <h3 className="text-fg mb-3 text-sm font-semibold">Edit variant</h3>
            {draftFields(editDraft, setEditDraft, false)}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void saveEdit()} loading={busy}>
                <Save aria-hidden="true" />
                Save variant
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(null);
                  setFormError(null);
                }}
              >
                <X aria-hidden="true" />
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        <TableContainer>
          <Table caption="Product variants with price and stock">
            <THead>
              <TR>
                <TH>SKU</TH>
                <TH>Variant</TH>
                <TH className="text-right">Price</TH>
                <TH className="text-right">On hand</TH>
                <TH className="text-right">Available</TH>
                <TH>State</TH>
                {canEdit ? (
                  <TH className="text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                ) : null}
              </TR>
            </THead>
            <TBody>
              {variants.map((variant) => (
                <TR key={variant.id}>
                  <TD className="font-mono text-xs">{variant.sku}</TD>
                  <TD>
                    <span className="text-fg block">{variant.name}</span>
                    {variant.options.length > 0 ? (
                      <span className="text-fg-subtle block text-xs">
                        {variant.options
                          .map((option) => `${option.name}: ${option.value}`)
                          .join(', ')}
                      </span>
                    ) : null}
                  </TD>
                  <NumericTD>{money(variant.price)}</NumericTD>
                  <NumericTD>{formatNumber(variant.quantityOnHand)}</NumericTD>
                  <NumericTD>
                    <span
                      className={
                        variant.quantityOnHand - variant.quantityReserved <= 0
                          ? 'text-danger font-medium'
                          : undefined
                      }
                    >
                      {formatNumber(
                        Math.max(0, variant.quantityOnHand - variant.quantityReserved),
                      )}
                    </span>
                  </NumericTD>
                  <TD>
                    <span className="flex flex-wrap gap-1">
                      {variant.isDefault ? <Badge tone="neutral">Default</Badge> : null}
                      <Badge tone={variant.isActive ? 'success' : 'outline'}>
                        {variant.isActive ? 'On sale' : 'Hidden'}
                      </Badge>
                    </span>
                  </TD>
                  {canEdit ? (
                    <TD className="text-right whitespace-nowrap">
                      <Button variant="ghost" size="xs" onClick={() => startEdit(variant)}>
                        Edit
                        <span className="sr-only"> {variant.sku}</span>
                      </Button>
                      {!variant.isDefault ? (
                        <Button
                          variant="danger-ghost"
                          size="xs"
                          onClick={() => {
                            setTargetVariant(variant);
                            archiveConfirm.ask();
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                          <span className="sr-only">Remove {variant.sku}</span>
                        </Button>
                      ) : null}
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </TableContainer>
      </CardContent>

      <ConfirmDialog
        open={archiveConfirm.open}
        onOpenChange={archiveConfirm.setOpen}
        title="Remove this variant?"
        description={
          <>
            <strong>{targetVariant?.sku}</strong> will be hidden from the storefront and dropped
            from active baskets. Existing order lines are unaffected.
          </>
        }
        confirmLabel="Remove variant"
        destructive
        loading={archiveConfirm.pending}
        onConfirm={archive}
      />
    </Card>
  );
};
