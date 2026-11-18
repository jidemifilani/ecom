import type { Metadata } from 'next';

import { PageHeader } from '@/components/ui/card';
import { Breadcrumbs } from '@/components/ui/navigation';
import { requirePermission } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/guard';
import { listSettingsForAdmin } from '@/server/settings-service';

import { SettingsForm, type SettingView } from './settings-form';

export const metadata: Metadata = { title: 'Settings' };

/**
 * /settings
 *
 * Every setting is declared in `src/lib/settings-registry.ts`, which drives
 * the seed, the server-side validation and this form at once. Adding one is a
 * single-file change.
 */
const SettingsPage = async () => {
  const viewer = await requirePermission('setting.read');
  const settings = await listSettingsForAdmin();

  const views: SettingView[] = settings.map((setting) => ({
    key: setting.key,
    group: setting.group,
    label: setting.label,
    description: setting.description ?? '',
    type: setting.type,
    value: setting.value,
    ...(setting.options ? { options: setting.options } : {}),
    ...(setting.min !== undefined ? { min: setting.min } : {}),
    ...(setting.max !== undefined ? { max: setting.max } : {}),
    updatedAt: setting.updatedAt ? setting.updatedAt.toISOString() : null,
    updatedByName: setting.updatedByName,
  }));

  return (
    <>
      <Breadcrumbs items={[{ label: 'Settings' }]} />

      <PageHeader
        title="Settings"
        description="Store identity, checkout behaviour, inventory rules and security policy. Changes take effect on the next request."
      />

      <div className="max-w-3xl">
        <SettingsForm settings={views} canEdit={can(viewer, 'setting.update')} />
      </div>
    </>
  );
};

export default SettingsPage;
