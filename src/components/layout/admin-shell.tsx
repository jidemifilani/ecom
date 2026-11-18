import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';

import { TooltipProvider } from '@/components/ui/menu';
import type { CurrentUser } from '@/lib/auth/current-user';
import { getNotificationPreview } from '@/server/notification-service';
import { getStoreConfig } from '@/server/settings-service';

import { MobileBottomBar, MobileNavDrawer } from './mobile-nav';
import { NotificationBell, type NotificationPreviewItem } from './notification-bell';
import { SidebarNav } from './sidebar-nav';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';

/**
 * Back-office application shell.
 *
 * Layout at each breakpoint:
 *  * < 1024px: top bar with a drawer trigger, plus a bottom bar of primary
 *    destinations. No sidebar.
 *  * >= 1024px: a fixed 16rem sidebar, no bottom bar.
 *
 * The scroll container is `main`, not the page, so the sidebar and top bar stay
 * put and long tables do not drag the chrome off screen.
 */

export const AdminShell = async ({
  user,
  children,
}: {
  user: CurrentUser;
  children: React.ReactNode;
}) => {
  const [config, notifications] = await Promise.all([
    getStoreConfig(),
    getNotificationPreview(user.id, 6),
  ]);

  const permissions = [...user.permissions];

  const previewItems: NotificationPreviewItem[] = notifications.items.map((item) => ({
    id: item.id,
    title: item.title,
    body: item.body,
    level: item.level,
    actionUrl: item.actionUrl,
    readAt: item.readAt ? item.readAt.toISOString() : null,
    createdAt: item.createdAt.toISOString(),
  }));

  return (
    <TooltipProvider>
      <div className="bg-canvas min-h-dvh">
        {/* ── Sidebar (large screens) ── */}
        <aside
          className="border-line bg-surface fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r lg:flex"
          aria-label="Sidebar"
        >
          <div className="border-line flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <Link
              href="/dashboard"
              className="flex min-w-0 items-center gap-2"
              aria-label={`${config.name} dashboard`}
            >
              <span
                aria-hidden="true"
                className="bg-primary text-on-primary grid size-7 shrink-0 place-items-center rounded-md"
              >
                <ShoppingBag className="size-4" />
              </span>
              <span className="text-fg truncate text-sm font-semibold">{config.name}</span>
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto px-2 py-4">
            <SidebarNav permissions={permissions} isSuperAdmin={user.isSuperAdmin} />
          </div>

          <div className="border-line text-fg-subtle shrink-0 border-t px-4 py-3 text-[11px]">
            <p className="truncate">
              {user.roles.length > 0
                ? user.roles.map((role) => role.name).join(', ')
                : 'No roles assigned'}
            </p>
          </div>
        </aside>

        {/* ── Main column ── */}
        <div className="lg:pl-64">
          <header className="border-line bg-surface/95 sticky top-0 z-10 flex h-14 items-center gap-2 border-b px-3 backdrop-blur-md sm:px-4">
            <MobileNavDrawer
              permissions={permissions}
              isSuperAdmin={user.isSuperAdmin}
              storeName={config.name}
            />

            <Link
              href="/dashboard"
              className="flex min-w-0 items-center gap-2 lg:hidden"
              aria-label={`${config.name} dashboard`}
            >
              <span
                aria-hidden="true"
                className="bg-primary text-on-primary grid size-7 shrink-0 place-items-center rounded-md"
              >
                <ShoppingBag className="size-4" />
              </span>
              <span className="text-fg truncate text-sm font-semibold sm:inline">
                {config.name}
              </span>
            </Link>

            <div className="flex-1" />

            <div className="flex items-center gap-1">
              <ThemeToggle />
              <NotificationBell
                initialItems={previewItems}
                initialUnreadCount={notifications.unreadCount}
              />
              <UserMenu
                firstName={user.firstName}
                lastName={user.lastName}
                email={user.email}
                roleNames={user.roles.map((role) => role.name)}
                avatarUrl={user.avatarUrl}
              />
            </div>
          </header>

          <main id="main" className="px-3 pt-4 pb-24 sm:px-4 lg:px-6 lg:pb-8">
            <div className="mx-auto w-full max-w-[90rem] space-y-5">{children}</div>
          </main>
        </div>

        <MobileBottomBar permissions={permissions} isSuperAdmin={user.isSuperAdmin} />
      </div>
    </TooltipProvider>
  );
};
