'use client';

import { RotateCcw, Save } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field, Input, Select, SwitchField } from '@/components/ui/form';
import { toast } from '@/components/ui/toast';
import { ApiError, api, toErrorMessage } from '@/lib/client/api';
import { coerceSettingValue, SETTINGS_BY_KEY } from '@/lib/settings-registry';

/**
 * Settings form.
 *
 * Rendered entirely from the settings registry, so adding a setting in
 * `src/lib/settings-registry.ts` makes it appear here with the right control,
 * validation and help text -- no change to this file.
 *
 * Only changed values are sent, which keeps the audit entry to the fields that
 * actually moved rather than recording every setting on every save.
 */

export type SettingView = {
  key: string;
  group: string;
  label: string;
  description: string;
  type: string;
  value: string | number | boolean;
  options?: readonly { readonly value: string; readonly label: string }[];
  min?: number;
  max?: number;
  updatedAt: string | null;
  updatedByName: string | null;
};

type Draft = Record<string, string | number | boolean>;

export const SettingsForm = ({
  settings,
  canEdit,
}: {
  settings: SettingView[];
  canEdit: boolean;
}) => {
  const router = useRouter();

  const initial = useMemo<Draft>(
    () => Object.fromEntries(settings.map((setting) => [setting.key, setting.value])),
    [settings],
  );

  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const groups = useMemo(() => {
    const map = new Map<string, SettingView[]>();
    for (const setting of settings) {
      const existing = map.get(setting.group);
      if (existing) existing.push(setting);
      else map.set(setting.group, [setting]);
    }
    return [...map.entries()];
  }, [settings]);

  const changed = useMemo(
    () => Object.keys(draft).filter((key) => draft[key] !== initial[key]),
    [draft, initial],
  );

  const set = (key: string, value: string | number | boolean): void => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  const save = async (): Promise<void> => {
    setFormError(null);
    setFieldErrors({});

    if (changed.length === 0) return;

    // Validate locally with the same coercion the server applies, so obvious
    // mistakes are caught before a round trip.
    const payload: Record<string, string | number | boolean> = {};
    const localErrors: Record<string, string> = {};

    for (const key of changed) {
      const definition = SETTINGS_BY_KEY.get(key);
      if (!definition) continue;

      const coerced = coerceSettingValue(definition, draft[key]);
      if (coerced.ok) payload[key] = coerced.value;
      else localErrors[key] = coerced.error;
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setFormError('Check the highlighted settings.');
      return;
    }

    setSaving(true);
    try {
      await api.patch('/api/v1/settings', payload);
      toast.success(`Saved ${changed.length} setting(s)`);
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
    <div className="space-y-5">
      {formError ? <Alert tone="danger">{formError}</Alert> : null}

      {!canEdit ? (
        <Alert tone="info">
          You can view settings but not change them. This needs the &quot;Change application
          settings&quot; permission.
        </Alert>
      ) : null}

      {groups.map(([group, items]) => (
        <Card as="section" key={group}>
          <CardHeader>
            <CardTitle>{group}</CardTitle>
          </CardHeader>

          <CardContent className="divide-line divide-y">
            {items.map((setting) => {
              const value = draft[setting.key];
              const error = fieldErrors[setting.key];

              if (setting.type === 'BOOLEAN') {
                return (
                  <div key={setting.key} className="py-3 first:pt-0 last:pb-0">
                    <SwitchField
                      label={setting.label}
                      hint={setting.description}
                      checked={value === true}
                      onCheckedChange={(checked) => set(setting.key, checked)}
                      disabled={!canEdit}
                    />
                    {error ? (
                      <p role="alert" className="text-danger mt-1 text-xs font-medium">
                        {error}
                      </p>
                    ) : null}
                  </div>
                );
              }

              return (
                <div key={setting.key} className="py-3 first:pt-0 last:pb-0">
                  <Field label={setting.label} hint={setting.description} error={error}>
                    {(props) =>
                      setting.options ? (
                        <Select
                          {...props}
                          value={String(value ?? '')}
                          onChange={(event) => set(setting.key, event.target.value)}
                          disabled={!canEdit}
                          className="sm:max-w-sm"
                        >
                          {setting.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          {...props}
                          type={setting.type === 'NUMBER' ? 'number' : 'text'}
                          inputMode={setting.type === 'NUMBER' ? 'numeric' : undefined}
                          min={setting.min}
                          max={setting.max}
                          value={String(value ?? '')}
                          onChange={(event) =>
                            set(
                              setting.key,
                              setting.type === 'NUMBER'
                                ? event.target.value === ''
                                  ? ''
                                  : Number(event.target.value)
                                : event.target.value,
                            )
                          }
                          disabled={!canEdit}
                          className="sm:max-w-sm"
                        />
                      )
                    }
                  </Field>

                  {setting.updatedAt && setting.updatedByName ? (
                    <p className="text-fg-subtle mt-1 text-xs">
                      Last changed by {setting.updatedByName}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      ))}

      {canEdit ? (
        <Card>
          <CardFooter className="justify-between">
            <Button
              variant="ghost"
              onClick={() => {
                setDraft(initial);
                setFieldErrors({});
                setFormError(null);
              }}
              disabled={changed.length === 0 || saving}
            >
              <RotateCcw aria-hidden="true" />
              Discard changes
            </Button>

            <Button onClick={() => void save()} loading={saving} disabled={changed.length === 0}>
              <Save aria-hidden="true" />
              {changed.length === 0
                ? 'No changes'
                : `Save ${changed.length} change${changed.length === 1 ? '' : 's'}`}
            </Button>
          </CardFooter>
        </Card>
      ) : null}
    </div>
  );
};
