'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, SwitchField, Textarea } from '@/components/ui/form';
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
 * Category create/edit dialog.
 *
 * A dialog rather than a page: a category is a handful of fields and the list
 * is the useful context to keep on screen.
 *
 * The dialog is mounted only while open, so the form starts clean every time
 * instead of retaining whatever was typed and abandoned on a previous attempt.
 * `NewCategoryButton` and `EditCategoryButton` are the two entry points; both
 * render the same form.
 */

export type CategoryOption = { id: string; name: string; depth: number };

export type CategoryDraft = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  parentId: string | null;
  position: number;
  isActive: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  productCount: number;
  childCount: number;
};

type FormState = {
  name: string;
  slug: string;
  description: string;
  imageUrl: string;
  parentId: string;
  position: string;
  isActive: boolean;
  metaTitle: string;
  metaDescription: string;
};

const toFormState = (draft?: CategoryDraft): FormState => ({
  name: draft?.name ?? '',
  slug: draft?.slug ?? '',
  description: draft?.description ?? '',
  imageUrl: draft?.imageUrl ?? '',
  parentId: draft?.parentId ?? '',
  position: String(draft?.position ?? 0),
  isActive: draft?.isActive ?? true,
  metaTitle: draft?.metaTitle ?? '',
  metaDescription: draft?.metaDescription ?? '',
});

const CategoryFormDialog = ({
  category,
  parents,
  onClose,
}: {
  /** Absent for a create. */
  category?: CategoryDraft;
  parents: CategoryOption[];
  onClose: () => void;
}) => {
  const router = useRouter();
  const isEdit = category !== undefined;

  const [state, setState] = useState<FormState>(() => toFormState(category));
  // Starts true for an edit, so the effect below never has to set it
  // synchronously (which would cause an extra render before paint).
  const [loading, setLoading] = useState(isEdit);
  const [slugEdited, setSlugEdited] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const patch = (changes: Partial<FormState>): void =>
    setState((current) => ({ ...current, ...changes }));

  /*
   * The list only carries the columns it displays, so an edit loads the full
   * record before showing the form. Without this, saving would submit empty
   * description and meta fields and silently wipe them.
   */
  useEffect(() => {
    if (!isEdit) return;

    let cancelled = false;

    api
      .get<CategoryDraft & { description: string | null }>(
        `/api/v1/categories/${category.id}`,
      )
      .then((full) => {
        if (!cancelled) setState(toFormState({ ...category, ...full }));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFormError(toErrorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isEdit, category]);

  const save = async (): Promise<void> => {
    setFormError(null);
    setFieldErrors({});

    const payload = {
      name: state.name,
      slug: state.slug.trim() === '' ? undefined : state.slug,
      description: state.description.trim() === '' ? undefined : state.description,
      imageUrl: state.imageUrl.trim() === '' ? undefined : state.imageUrl,
      parentId: state.parentId === '' ? null : state.parentId,
      position: Number.parseInt(state.position || '0', 10),
      isActive: state.isActive,
      metaTitle: state.metaTitle.trim() === '' ? undefined : state.metaTitle,
      metaDescription: state.metaDescription.trim() === '' ? undefined : state.metaDescription,
    };

    setSaving(true);
    try {
      if (isEdit) {
        await api.patch(`/api/v1/categories/${category.id}`, payload);
        toast.success('Category updated');
      } else {
        await api.post('/api/v1/categories', payload);
        toast.success('Category created');
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

  // A category cannot be its own parent. Deeper cycles are rejected server-side.
  const parentChoices = parents.filter((option) => option.id !== category?.id);

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit category' : 'New category'}</DialogTitle>
          <DialogDescription>
            Categories organise the catalog and drive the storefront navigation.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {formError ? <Alert tone="danger">{formError}</Alert> : null}

          {loading ? (
            <p className="text-fg-muted py-6 text-center text-sm">Loading category...</p>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" error={fieldErrors.name} required className="sm:col-span-2">
              {(props) => (
                <Input
                  {...props}
                  value={state.name}
                  onChange={(event) => {
                    const name = event.target.value;
                    patch({ name, ...(slugEdited ? {} : { slug: slugify(name) }) });
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
                  value={state.slug}
                  onChange={(event) => {
                    setSlugEdited(true);
                    patch({ slug: event.target.value });
                  }}
                  className="font-mono"
                />
              )}
            </Field>

            <Field label="Parent category" error={fieldErrors.parentId}>
              {(props) => (
                <Select
                  {...props}
                  value={state.parentId}
                  onChange={(event) => patch({ parentId: event.target.value })}
                >
                  <option value="">Top level</option>
                  {parentChoices.map((option) => (
                    <option key={option.id} value={option.id}>
                      {'- '.repeat(option.depth)}
                      {option.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              label="Sort position"
              error={fieldErrors.position}
              hint="Lower numbers appear first."
            >
              {(props) => (
                <Input
                  {...props}
                  value={state.position}
                  onChange={(event) => patch({ position: event.target.value })}
                  inputMode="numeric"
                />
              )}
            </Field>

            <Field label="Image URL" error={fieldErrors.imageUrl}>
              {(props) => (
                <Input
                  {...props}
                  value={state.imageUrl}
                  onChange={(event) => patch({ imageUrl: event.target.value })}
                  placeholder="/demo/audio.svg"
                />
              )}
            </Field>

            <Field label="Description" error={fieldErrors.description} className="sm:col-span-2">
              {(props) => (
                <Textarea
                  {...props}
                  value={state.description}
                  onChange={(event) => patch({ description: event.target.value })}
                  rows={3}
                />
              )}
            </Field>

            <Field label="Meta title" error={fieldErrors.metaTitle}>
              {(props) => (
                <Input
                  {...props}
                  value={state.metaTitle}
                  onChange={(event) => patch({ metaTitle: event.target.value })}
                />
              )}
            </Field>

            <Field label="Meta description" error={fieldErrors.metaDescription}>
              {(props) => (
                <Input
                  {...props}
                  value={state.metaDescription}
                  onChange={(event) => patch({ metaDescription: event.target.value })}
                />
              )}
            </Field>

            <div className="sm:col-span-2">
              <SwitchField
                label="Visible in the storefront"
                hint="Hidden categories keep their products but disappear from navigation."
                checked={state.isActive}
                onCheckedChange={(checked) => patch({ isActive: checked })}
              />
            </div>
          </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {/* Disabled until the record has loaded, so a save cannot submit blanks. */}
          <Button onClick={() => void save()} loading={saving} disabled={loading}>
            {isEdit ? 'Save changes' : 'Create category'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export const NewCategoryButton = ({ parents }: { parents: CategoryOption[] }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        New category
      </Button>

      {open ? <CategoryFormDialog parents={parents} onClose={() => setOpen(false)} /> : null}
    </>
  );
};

export const EditCategoryButton = ({
  category,
  parents,
}: {
  category: CategoryDraft;
  parents: CategoryOption[];
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(true)}>
        <Pencil aria-hidden="true" />
        Edit
        <span className="sr-only"> {category.name}</span>
      </Button>

      {open ? (
        <CategoryFormDialog
          category={category}
          parents={parents}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
};

export const ArchiveCategoryButton = ({
  category,
}: {
  category: { id: string; name: string; childCount: number; productCount: number };
}) => {
  const router = useRouter();
  const confirm = useConfirm();

  const archive = async (): Promise<void> => {
    await confirm.run(async () => {
      try {
        await api.delete(`/api/v1/categories/${category.id}`);
        toast.success('Category archived');
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
        <span className="sr-only">Archive {category.name}</span>
      </Button>

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={confirm.setOpen}
        title="Archive this category?"
        description={
          category.childCount > 0 ? (
            <>
              <strong>{category.name}</strong> has {category.childCount} subcategory(ies). Move or
              archive those first -- the server will refuse this otherwise.
            </>
          ) : (
            <>
              <strong>{category.name}</strong> will disappear from the storefront.{' '}
              {category.productCount > 0
                ? `Its ${category.productCount} product(s) keep their assignment and stay on sale.`
                : 'It has no products.'}
            </>
          )
        }
        confirmLabel="Archive category"
        destructive
        loading={confirm.pending}
        onConfirm={archive}
      />
    </>
  );
};
