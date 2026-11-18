'use client';

import { Archive, ImagePlus, Save, Trash2 } from 'lucide-react';
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
import { minorUnitExponent, toMajorString, toMinorUnits } from '@/lib/money';
import { slugify } from '@/lib/utils';

/**
 * Product editor.
 *
 * Prices are typed by humans in major units ("19.99") and stored in minor
 * units (1999). The conversion happens once, here, through `toMinorUnits`;
 * nothing downstream ever sees a decimal, which is what keeps rounding errors
 * out of order totals.
 *
 * Image alt text is required, not optional. A product image without a
 * description is a WCAG 1.1.1 failure, and making it optional guarantees it
 * will be skipped.
 */

export type CategoryOption = { id: string; name: string; depth: number };
export type BrandOption = { id: string; name: string };

export type ImageDraft = { url: string; alt: string; isPrimary: boolean };

export type ProductFormInitial = {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  status: string;
  categoryId: string | null;
  brandId: string | null;
  basePrice: number;
  compareAtPrice: number | null;
  costPrice: number | null;
  currency: string;
  taxRateBps: number;
  isFeatured: boolean;
  trackInventory: boolean;
  weightGrams: number | null;
  metaTitle: string | null;
  metaDescription: string | null;
  images: ImageDraft[];
  isArchived: boolean;
};

export const ProductForm = ({
  mode,
  initial,
  categories,
  brands,
  defaultCurrency,
  canDelete,
}: {
  mode: 'create' | 'edit';
  initial?: ProductFormInitial;
  categories: CategoryOption[];
  brands: BrandOption[];
  defaultCurrency: string;
  canDelete: boolean;
}) => {
  const router = useRouter();
  const archiveConfirm = useConfirm();

  const currency = initial?.currency ?? defaultCurrency;
  const exponent = minorUnitExponent(currency);

  const [name, setName] = useState(initial?.name ?? '');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(mode === 'edit');
  const [shortDescription, setShortDescription] = useState(initial?.shortDescription ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'DRAFT');
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [brandId, setBrandId] = useState(initial?.brandId ?? '');

  const [price, setPrice] = useState(
    initial ? toMajorString(initial.basePrice, currency) : '',
  );
  const [compareAt, setCompareAt] = useState(
    initial?.compareAtPrice ? toMajorString(initial.compareAtPrice, currency) : '',
  );
  const [cost, setCost] = useState(
    initial?.costPrice ? toMajorString(initial.costPrice, currency) : '',
  );
  const [taxPercent, setTaxPercent] = useState(
    initial ? String(initial.taxRateBps / 100) : '0',
  );
  const [weight, setWeight] = useState(initial?.weightGrams ? String(initial.weightGrams) : '');

  const [isFeatured, setIsFeatured] = useState(initial?.isFeatured ?? false);
  const [trackInventory, setTrackInventory] = useState(initial?.trackInventory ?? true);

  const [metaTitle, setMetaTitle] = useState(initial?.metaTitle ?? '');
  const [metaDescription, setMetaDescription] = useState(initial?.metaDescription ?? '');

  const [images, setImages] = useState<ImageDraft[]>(initial?.images ?? []);

  // Only used when creating: the default variant's SKU and opening stock.
  const [sku, setSku] = useState('');
  const [openingStock, setOpeningStock] = useState('0');
  const [reorderPoint, setReorderPoint] = useState('5');

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const onNameChange = (value: string): void => {
    setName(value);
    if (!slugEdited) setSlug(slugify(value));
  };

  const addImage = (): void => {
    setImages((current) => [
      ...current,
      { url: '', alt: '', isPrimary: current.length === 0 },
    ]);
  };

  const updateImage = (index: number, patch: Partial<ImageDraft>): void => {
    setImages((current) =>
      current.map((image, position) => (position === index ? { ...image, ...patch } : image)),
    );
  };

  const removeImage = (index: number): void => {
    setImages((current) => {
      const next = current.filter((_, position) => position !== index);
      // Keep exactly one primary image.
      if (next.length > 0 && !next.some((image) => image.isPrimary)) {
        const first = next[0];
        if (first) first.isPrimary = true;
      }
      return [...next];
    });
  };

  const setPrimary = (index: number): void => {
    setImages((current) =>
      current.map((image, position) => ({ ...image, isPrimary: position === index })),
    );
  };

  const save = async (): Promise<void> => {
    setFormError(null);
    setFieldErrors({});

    const basePrice = toMinorUnits(price, currency);
    if (basePrice === null) {
      setFieldErrors({ basePrice: 'Enter a price, for example 19.99.' });
      return;
    }

    const compareAtMinor = compareAt.trim() === '' ? undefined : toMinorUnits(compareAt, currency);
    if (compareAt.trim() !== '' && compareAtMinor === null) {
      setFieldErrors({ compareAtPrice: 'Enter a valid amount, or leave it blank.' });
      return;
    }

    const costMinor = cost.trim() === '' ? undefined : toMinorUnits(cost, currency);
    if (cost.trim() !== '' && costMinor === null) {
      setFieldErrors({ costPrice: 'Enter a valid amount, or leave it blank.' });
      return;
    }

    const taxValue = Number.parseFloat(taxPercent === '' ? '0' : taxPercent);
    if (!Number.isFinite(taxValue) || taxValue < 0 || taxValue > 100) {
      setFieldErrors({ taxRateBps: 'Enter a tax rate between 0 and 100 percent.' });
      return;
    }

    const payload = {
      name,
      slug: slug.trim() === '' ? undefined : slug,
      shortDescription: shortDescription.trim() === '' ? undefined : shortDescription,
      description: description.trim() === '' ? undefined : description,
      status,
      categoryId: categoryId === '' ? null : categoryId,
      brandId: brandId === '' ? null : brandId,
      basePrice,
      ...(compareAtMinor !== undefined ? { compareAtPrice: compareAtMinor } : {}),
      ...(costMinor !== undefined ? { costPrice: costMinor } : {}),
      currency,
      taxRateBps: Math.round(taxValue * 100),
      isFeatured,
      trackInventory,
      ...(weight.trim() === '' ? {} : { weightGrams: Number.parseInt(weight, 10) }),
      metaTitle: metaTitle.trim() === '' ? undefined : metaTitle,
      metaDescription: metaDescription.trim() === '' ? undefined : metaDescription,
      images: images
        .filter((image) => image.url.trim() !== '')
        .map((image, index) => ({
          url: image.url.trim(),
          alt: image.alt.trim(),
          position: index,
          isPrimary: image.isPrimary,
        })),
      ...(mode === 'create'
        ? {
            sku,
            initialQuantity: Number.parseInt(openingStock || '0', 10),
            reorderPoint: Number.parseInt(reorderPoint || '0', 10),
          }
        : {}),
    };

    setSaving(true);
    try {
      if (mode === 'create') {
        const created = await api.post<{ id: string; name: string }>(
          '/api/v1/products',
          payload,
        );
        toast.success('Product created', { description: created.name });
        router.push(`/catalog/products/${created.id}`);
      } else if (initial) {
        await api.patch(`/api/v1/products/${initial.id}`, payload);
        toast.success('Product updated');
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
        await api.delete(`/api/v1/products/${initial.id}`);
        toast.success('Product archived');
        router.push('/catalog/products');
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
        <Alert tone="warning" title="This product is archived">
          It is hidden from the storefront and removed from active baskets.
        </Alert>
      ) : null}

      <div className="grid gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card as="section">
            <CardHeader>
              <CardTitle>Basics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Product name" error={fieldErrors.name} required>
                {(props) => (
                  <Input
                    {...props}
                    value={name}
                    onChange={(event) => onNameChange(event.target.value)}
                    placeholder="Aurora Over-Ear Headphones"
                  />
                )}
              </Field>

              <Field
                label="URL slug"
                error={fieldErrors.slug}
                hint="Used in the storefront address. Leave blank to generate from the name."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={slug}
                    onChange={(event) => {
                      setSlugEdited(true);
                      setSlug(event.target.value);
                    }}
                    className="font-mono"
                  />
                )}
              </Field>

              <Field
                label="Short description"
                error={fieldErrors.shortDescription}
                hint="One or two lines, shown on listing cards."
              >
                {(props) => (
                  <Textarea
                    {...props}
                    value={shortDescription}
                    onChange={(event) => setShortDescription(event.target.value)}
                    rows={2}
                  />
                )}
              </Field>

              <Field label="Full description" error={fieldErrors.description}>
                {(props) => (
                  <Textarea
                    {...props}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    rows={6}
                  />
                )}
              </Field>
            </CardContent>
          </Card>

          <Card as="section">
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
              <span className="text-fg-subtle text-xs">All amounts in {currency}</span>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label={`Selling price (${currency})`} error={fieldErrors.basePrice} required>
                {(props) => (
                  <Input
                    {...props}
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                    inputMode="decimal"
                    placeholder={exponent === 0 ? '2500' : '19.99'}
                  />
                )}
              </Field>

              <Field
                label={`Compare-at price (${currency})`}
                error={fieldErrors.compareAtPrice}
                hint="Shown struck through. Must be higher than the selling price."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={compareAt}
                    onChange={(event) => setCompareAt(event.target.value)}
                    inputMode="decimal"
                  />
                )}
              </Field>

              <Field
                label={`Cost price (${currency})`}
                error={fieldErrors.costPrice}
                hint="Used for margin and stock valuation. Never shown to shoppers."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={cost}
                    onChange={(event) => setCost(event.target.value)}
                    inputMode="decimal"
                  />
                )}
              </Field>

              <Field
                label="Tax rate (%)"
                error={fieldErrors.taxRateBps}
                hint="Leave at 0 to use the store default."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={taxPercent}
                    onChange={(event) => setTaxPercent(event.target.value)}
                    inputMode="decimal"
                  />
                )}
              </Field>
            </CardContent>
          </Card>

          <Card as="section">
            <CardHeader>
              <CardTitle>Images</CardTitle>
              <Button variant="outline" size="sm" onClick={addImage}>
                <ImagePlus aria-hidden="true" />
                Add image
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {images.length === 0 ? (
                <p className="text-fg-muted text-sm">
                  No images yet. Products without an image still sell, but convert far worse.
                </p>
              ) : (
                <ul className="space-y-4">
                  {images.map((image, index) => (
                    <li key={index} className="border-line rounded-control border p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={`Image ${index + 1} URL`} required>
                          {(props) => (
                            <Input
                              {...props}
                              value={image.url}
                              onChange={(event) =>
                                updateImage(index, { url: event.target.value })
                              }
                              placeholder="/demo/audio.svg"
                            />
                          )}
                        </Field>

                        <Field
                          label="Alt text"
                          required
                          hint="Describe the image for people who cannot see it."
                        >
                          {(props) => (
                            <Input
                              {...props}
                              value={image.alt}
                              onChange={(event) =>
                                updateImage(index, { alt: event.target.value })
                              }
                              placeholder="Black over-ear headphones, side view"
                            />
                          )}
                        </Field>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2">
                        <Button
                          variant={image.isPrimary ? 'accent' : 'ghost'}
                          size="xs"
                          onClick={() => setPrimary(index)}
                          aria-pressed={image.isPrimary}
                        >
                          {image.isPrimary ? 'Primary image' : 'Make primary'}
                        </Button>

                        <Button
                          variant="danger-ghost"
                          size="xs"
                          onClick={() => removeImage(index)}
                        >
                          <Trash2 aria-hidden="true" />
                          Remove
                          <span className="sr-only"> image {index + 1}</span>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}

              {fieldErrors.images ? (
                <p role="alert" className="text-danger text-xs font-medium">
                  {fieldErrors.images}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card as="section">
            <CardHeader>
              <CardTitle>Search appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field
                label="Meta title"
                error={fieldErrors.metaTitle}
                hint="Falls back to the product name when blank."
              >
                {(props) => (
                  <Input
                    {...props}
                    value={metaTitle}
                    onChange={(event) => setMetaTitle(event.target.value)}
                  />
                )}
              </Field>

              <Field label="Meta description" error={fieldErrors.metaDescription}>
                {(props) => (
                  <Textarea
                    {...props}
                    value={metaDescription}
                    onChange={(event) => setMetaDescription(event.target.value)}
                    rows={2}
                  />
                )}
              </Field>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-5">
          <Card as="section">
            <CardHeader>
              <CardTitle>Organisation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Status" error={fieldErrors.status}>
                {(props) => (
                  <Select
                    {...props}
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="DRAFT">Draft (hidden from shoppers)</option>
                    <option value="ACTIVE">Active (on sale)</option>
                    <option value="ARCHIVED">Archived</option>
                  </Select>
                )}
              </Field>

              <Field label="Category" error={fieldErrors.categoryId}>
                {(props) => (
                  <Select
                    {...props}
                    value={categoryId}
                    onChange={(event) => setCategoryId(event.target.value)}
                  >
                    <option value="">Uncategorised</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {'- '.repeat(category.depth)}
                        {category.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Brand" error={fieldErrors.brandId}>
                {(props) => (
                  <Select
                    {...props}
                    value={brandId}
                    onChange={(event) => setBrandId(event.target.value)}
                  >
                    <option value="">No brand</option>
                    {brands.map((brand) => (
                      <option key={brand.id} value={brand.id}>
                        {brand.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Weight (grams)" error={fieldErrors.weightGrams}>
                {(props) => (
                  <Input
                    {...props}
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                    inputMode="numeric"
                  />
                )}
              </Field>

              <div className="border-line space-y-1 border-t pt-3">
                <SwitchField
                  label="Featured"
                  hint="Highlighted on the storefront home page."
                  checked={isFeatured}
                  onCheckedChange={setIsFeatured}
                />
                <SwitchField
                  label="Track inventory"
                  hint="Turn off for services or made-to-order items."
                  checked={trackInventory}
                  onCheckedChange={setTrackInventory}
                />
              </div>
            </CardContent>
          </Card>

          {mode === 'create' ? (
            <Card as="section">
              <CardHeader>
                <CardTitle>Opening stock</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-fg-muted text-sm leading-relaxed">
                  A default variant is created with this SKU. Add more variants, such as sizes or
                  colours, once the product exists.
                </p>

                <Field label="SKU" error={fieldErrors.sku} required>
                  {(props) => (
                    <Input
                      {...props}
                      value={sku}
                      onChange={(event) => setSku(event.target.value.toUpperCase())}
                      className="font-mono"
                      placeholder="AUR-HEADPHONES-1"
                    />
                  )}
                </Field>

                <Field label="Opening quantity" error={fieldErrors.initialQuantity}>
                  {(props) => (
                    <Input
                      {...props}
                      value={openingStock}
                      onChange={(event) => setOpeningStock(event.target.value)}
                      inputMode="numeric"
                    />
                  )}
                </Field>

                <Field
                  label="Reorder point"
                  error={fieldErrors.reorderPoint}
                  hint="Raises a low-stock alert at or below this level."
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={reorderPoint}
                      onChange={(event) => setReorderPoint(event.target.value)}
                      inputMode="numeric"
                    />
                  )}
                </Field>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardFooter className="flex-col gap-2 sm:flex-col">
              <Button onClick={() => void save()} loading={saving} block>
                <Save aria-hidden="true" />
                {mode === 'create' ? 'Create product' : 'Save changes'}
              </Button>

              <Button variant="outline" block asChild>
                <Link href="/catalog/products">Back to products</Link>
              </Button>

              {mode === 'edit' && canDelete && initial && !initial.isArchived ? (
                <Button variant="danger-ghost" block onClick={archiveConfirm.ask}>
                  <Archive aria-hidden="true" />
                  Archive product
                </Button>
              ) : null}
            </CardFooter>
          </Card>
        </div>
      </div>

      {initial ? (
        <ConfirmDialog
          open={archiveConfirm.open}
          onOpenChange={archiveConfirm.setOpen}
          title="Archive this product?"
          description={
            <>
              <strong>{initial.name}</strong> will be hidden from the storefront and removed from
              any active basket. Past orders keep their line items, and you can restore it later.
            </>
          }
          confirmLabel="Archive product"
          destructive
          loading={archiveConfirm.pending}
          onConfirm={archive}
        />
      ) : null}
    </div>
  );
};
