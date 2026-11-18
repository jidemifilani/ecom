'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, SwitchField } from '@/components/ui/form';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  useConfirm,
} from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { slugify } from '@/lib/utils';

/**
 * Brand create/edit dialog.
 *
 * Brands carry only four fields, all of which the list already shows, so --
 * unlike categories -- the edit form can be populated from the row without a
 * second fetch and without risking blanking a field it never loaded.
 */

export type BrandRecord = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  isActive: boolean;
};

const BrandFormDialog = ({
  brand,
  onClose,
}: {
  brand?: BrandRecord;
  onClose: () => void;
}) => {
  const router = useRouter();
  const isEdit = brand !== undefined;

  const [name, setName] = useState(brand?.name ?? '');
  const [slug, setSlug] = useState(brand?.slug ?? '');
  const [slugEdited, setSlugEdited] = useState(isEdit);
  const [logoUrl, setLogoUrl] = useState(brand?.logoUrl ?? '');
  const [isActive, setIsActive] = useState(brand?.isActive ?? true);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const save = async (): Promise<void> => {
    setFormError(null);
    setFieldErrors({});

    const payload = {
      name,
      slug: slug.trim() === '' ? undefined : slug,
      logoUrl: logoUrl.trim() === '' ? undefined : logoUrl,
      isActive,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/v1/brands/${brand.id}`, payload);
        toast.success('Brand updated');
      } else {
        await api.post('/api/v1/brands', payload);
        toast.success('Brand created');
      }
      onClose();
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
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit brand' : 'New brand'}</DialogTitle>
          <DialogDescription>
            Brands let shoppers filter the catalog by maker.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          <Field label="Name" error={fieldErrors.name} required>
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slugEdited) setSlug(slugify(event.target.value));
                }}
                autoFocus
              />
            )}
          </Field>

          <Field
            label="URL slug"
            error={fieldErrors.slug}
            hint="Leave blank to generate from the name."
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

          <Field label="Logo URL" error={fieldErrors.logoUrl}>
            {(props) => (
              <Input
                {...props}
                value={logoUrl}
                onChange={(event) => setLogoUrl(event.target.value)}
                placeholder="/demo/tools.svg"
              />
            )}
          </Field>

          <SwitchField
            label="Available for selection"
            hint="Inactive brands stay on existing products but cannot be chosen for new ones."
            checked={isActive}
            onCheckedChange={setIsActive}
          />
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {isEdit ? 'Save changes' : 'Create brand'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const NewBrandButton = () => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        New brand
      </Button>
      {open ? <BrandFormDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
};

export const EditBrandButton = ({ brand }: { brand: BrandRecord }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <Pencil aria-hidden="true" />
        Edit
        <span className="sr-only"> {brand.name}</span>
      </Button>
      {open ? <BrandFormDialog brand={brand} onClose={() => setOpen(false)} /> : null}
    </>
  );
};

export const ArchiveBrandButton = ({
  brand,
}: {
  brand: { id: string; name: string; productCount: number };
}) => {
  const router = useRouter();
  const confirm = useConfirm();

  const archive = async (): Promise<void> => {
    await confirm.run(async () => {
      try {
        await api.delete(`/api/v1/brands/${brand.id}`);
        toast.success('Brand archived');
        router.refresh();
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    });
  };

  return (
    <>
      <Button variant="danger-ghost" size="xs" onClick={confirm.ask}>
        <Trash2 aria-hidden="true" />
        <span className="sr-only">Archive {brand.name}</span>
      </Button>

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.setOpen}
        title="Archive this brand?"
        description={
          <>
            <strong>{brand.name}</strong> will no longer be offered when editing a product.
            {brand.productCount > 0
              ? ` Its ${brand.productCount} existing product(s) keep the brand and stay on sale.`
              : ''}
          </>
        }
        confirmLabel="Archive brand"
        destructive
        loading={confirm.pending}
        onConfirm={archive}
      />
    </>
  );
};
