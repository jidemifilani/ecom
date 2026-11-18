'use client';

import { Archive, Save } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Badge } from '@/components/ui/feedback';
import { Checkbox, Field, Input, Label, Textarea } from '@/components/ui/form';
import { ConfirmDialog, useConfirm } from '@/components/ui/overlay';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { slugify } from '@/lib/utils';
import { createRoleSchema, updateRoleSchema } from '@/validation/role';

/**
 * Role editor.
 *
 * The permission matrix is grouped exactly as the catalogue declares, with a
 * tri-state checkbox per group so an administrator can grant a whole area in
 * one click rather than ticking twenty boxes.
 *
 * Deliberately hand-wired rather than driven by react-hook-form: the state is
 * a permission set plus three scalars, and a Set is a far better fit for that
 * than a flat field registry.
 */

export type PermissionCatalogEntry = { key: string; group: string; description: string };

export type RoleFormProps = {
  mode: 'create' | 'edit';
  catalog: Record<string, PermissionCatalogEntry[]>;
  initial?: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    level: number;
    isSystem: boolean;
    permissions: string[];
    userCount: number;
  };
  /** Highest authority the actor may grant (their own level, or 1 for a super admin). */
  minLevel: number;
  canDelete: boolean;
};

export const RoleForm = ({ mode, catalog, initial, minLevel, canDelete }: RoleFormProps) => {
  const router = useRouter();
  const archiveConfirm = useConfirm();

  const [name, setName] = useState(initial?.name ?? '');
  const [key, setKey] = useState(initial?.key ?? '');
  const [keyEdited, setKeyEdited] = useState(mode === 'edit');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [level, setLevel] = useState(String(initial?.level ?? 100));
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial?.permissions ?? []),
  );

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const groups = useMemo(() => Object.entries(catalog), [catalog]);
  const allKeys = useMemo(
    () => groups.flatMap(([, entries]) => entries.map((entry) => entry.key)),
    [groups],
  );

  const toggle = (permissionKey: string, checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(permissionKey);
      else next.delete(permissionKey);
      return next;
    });
  };

  const toggleGroup = (entries: PermissionCatalogEntry[], checked: boolean): void => {
    setSelected((current) => {
      const next = new Set(current);
      for (const entry of entries) {
        if (checked) next.add(entry.key);
        else next.delete(entry.key);
      }
      return next;
    });
  };

  const onNameChange = (value: string): void => {
    setName(value);
    // Derive the machine key from the name until the user edits it directly.
    // Once set and saved, the key is immutable, so this only applies on create.
    if (mode === 'create' && !keyEdited) {
      setKey(slugify(value).replace(/-/g, '_'));
    }
  };

  const save = async (): Promise<void> => {
    setFormError(null);
    setFieldErrors({});

    const payload = {
      name,
      description: description.trim() === '' ? undefined : description,
      level: Number.parseInt(level, 10),
      permissions: [...selected],
      ...(mode === 'create' ? { key } : {}),
    };

    const schema = mode === 'create' ? createRoleSchema : updateRoleSchema;
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      const mapped: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const path = issue.path.map(String).join('.') || '(root)';
        mapped[path] ??= issue.message;
      }
      setFieldErrors(mapped);
      setFormError('Check the highlighted fields.');
      return;
    }

    setSaving(true);
    try {
      if (mode === 'create') {
        const created = await api.post<{ id: string; name: string }>(
          '/api/v1/roles',
          parsed.data,
        );
        toast.success('Role created', { description: `${created.name} is ready to assign.` });
        router.push(`/roles/${created.id}`);
      } else if (initial) {
        await api.patch(`/api/v1/roles/${initial.id}`, parsed.data);
        toast.success('Role updated', {
          description:
            initial.userCount > 0
              ? `Applied to ${initial.userCount} user(s) immediately.`
              : undefined,
        });
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
        await api.delete(`/api/v1/roles/${initial.id}`);
        toast.success('Role deleted');
        router.push('/roles');
        router.refresh();
      } catch (error) {
        toast.error(toErrorMessage(error));
      }
    });
  };

  const readOnly = initial?.key === 'super_admin';

  return (
    <div className="space-y-5">
      {readOnly ? (
        <Alert tone="info" title="Super Admin cannot be edited">
          This role holds every permission by definition, including any added in future releases.
          Editing it could only ever remove access, so it is locked.
        </Alert>
      ) : null}

      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      <Card as="section">
        <CardHeader>
          <CardTitle>Role details</CardTitle>
          {initial?.isSystem ? <Badge tone="neutral">Built-in</Badge> : null}
        </CardHeader>

        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={fieldErrors.name} required>
            {(props) => (
              <Input
                {...props}
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                disabled={readOnly}
                placeholder="Warehouse Supervisor"
              />
            )}
          </Field>

          <Field
            label="Machine key"
            error={fieldErrors.key}
            required
            hint={
              mode === 'edit'
                ? 'The key is fixed once a role exists, because permissions reference it.'
                : 'Lower-case letters, numbers and underscores. Cannot be changed later.'
            }
          >
            {(props) => (
              <Input
                {...props}
                value={key}
                onChange={(event) => {
                  setKeyEdited(true);
                  setKey(event.target.value);
                }}
                disabled={mode === 'edit' || readOnly}
                className="font-mono"
                placeholder="warehouse_supervisor"
              />
            )}
          </Field>

          <Field
            label="Authority level"
            error={fieldErrors.level}
            required
            hint={`Lower outranks higher. You can create roles at level ${minLevel} or above. Level 0 is reserved for Super Admin.`}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                inputMode="numeric"
                min={minLevel}
                max={999}
                value={level}
                onChange={(event) => setLevel(event.target.value)}
                disabled={readOnly || initial?.isSystem}
              />
            )}
          </Field>

          <Field label="Description" error={fieldErrors.description} className="sm:col-span-2">
            {(props) => (
              <Textarea
                {...props}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={readOnly}
                rows={3}
                placeholder="What this role is for, and who should have it."
              />
            )}
          </Field>
        </CardContent>
      </Card>

      <Card as="section">
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
          <Badge tone={selected.size > 0 ? 'accent' : 'outline'}>
            {readOnly ? `All ${allKeys.length}` : `${selected.size} of ${allKeys.length}`}
          </Badge>
        </CardHeader>

        <CardContent className="space-y-6">
          {fieldErrors.permissions ? (
            <Alert tone="danger">{fieldErrors.permissions}</Alert>
          ) : null}

          {groups.map(([group, entries]) => {
            const granted = entries.filter((entry) => selected.has(entry.key)).length;
            const allGranted = readOnly || granted === entries.length;
            const someGranted = !readOnly && granted > 0 && granted < entries.length;
            const groupId = `group-${slugify(group)}`;

            return (
              <fieldset key={group} disabled={readOnly}>
                <div className="border-line mb-2 flex items-center gap-3 border-b pb-2">
                  <Checkbox
                    id={groupId}
                    checked={someGranted ? 'indeterminate' : allGranted}
                    onCheckedChange={(checked) => toggleGroup(entries, checked === true)}
                    disabled={readOnly}
                  />
                  <legend className="contents">
                    <Label htmlFor={groupId} className="text-sm font-semibold">
                      {group}
                    </Label>
                  </legend>
                  <span className="text-fg-subtle ml-auto text-xs">
                    {readOnly ? entries.length : granted} / {entries.length}
                  </span>
                </div>

                <ul className="grid gap-x-6 sm:grid-cols-2">
                  {entries.map((entry) => {
                    const inputId = `perm-${entry.key.replace(/\./g, '-')}`;
                    return (
                      <li key={entry.key} className="flex items-start gap-3 py-2">
                        <Checkbox
                          id={inputId}
                          checked={readOnly || selected.has(entry.key)}
                          onCheckedChange={(checked) => toggle(entry.key, checked === true)}
                          disabled={readOnly}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <Label htmlFor={inputId} className="font-normal">
                            {entry.description}
                          </Label>
                          <code className="text-fg-subtle mt-0.5 block font-mono text-[11px]">
                            {entry.key}
                          </code>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </fieldset>
            );
          })}
        </CardContent>

        {!readOnly ? (
          <CardFooter className="justify-between">
            {mode === 'edit' && canDelete && initial && !initial.isSystem ? (
              <Button variant="danger-ghost" onClick={archiveConfirm.ask}>
                <Archive aria-hidden="true" />
                Delete role
              </Button>
            ) : (
              <span />
            )}

            <Button onClick={() => void save()} loading={saving}>
              <Save aria-hidden="true" />
              {mode === 'create' ? 'Create role' : 'Save changes'}
            </Button>
          </CardFooter>
        ) : null}
      </Card>

      {initial ? (
        <ConfirmDialog
          open={archiveConfirm.open}
          onOpenChange={archiveConfirm.setOpen}
          title="Delete this role?"
          description={
            initial.userCount > 0 ? (
              <>
                {initial.userCount} user(s) still hold <strong>{initial.name}</strong>. Reassign
                them first -- the server will refuse this while anyone holds the role.
              </>
            ) : (
              <>
                <strong>{initial.name}</strong> will be removed. This cannot be undone, but no
                user currently holds it.
              </>
            )
          }
          confirmLabel="Delete role"
          destructive
          loading={archiveConfirm.pending}
          onConfirm={archive}
        />
      ) : null}
    </div>
  );
};
