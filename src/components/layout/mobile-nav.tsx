'use client';

import { Menu, MoreHorizontal } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import { useSyncedState } from '@/hooks/use-synced-state';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/overlay';
import type { PermissionKey } from '@/lib/rbac/permissions';
import { cn } from '@/lib/utils';

import { bottomBarItems, isItemActive } from './nav-config';
import { SidebarNav, type NavPrincipal } from './sidebar-nav';

/**
 * Phone and tablet navigation.
 *
 * Two complementary pieces:
 *  * A bottom bar with at most four primary destinations plus "More". Four is
 *    the limit that keeps each target comfortably over 44px at 320px wide.
 *  * A slide-over drawer holding the full navigation, so nothing is
 *    unreachable on a small screen.
 *
 * The drawer closes on navigation, which is what users expect from a mobile
 * menu and avoids leaving a modal open over the new page.
 */

export const MobileNavDrawer = ({
  permissions,
  isSuperAdmin,
  storeName,
}: NavPrincipal & { storeName: string }) => {
  const pathname = usePathname();
  // Close on route change, including browser back and forward.
  const [open, setOpen] = useSyncedState(pathname, () => false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-fg-muted lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="size-5" aria-hidden="true" />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" label="Navigation" className="p-0">
        <div className="border-line flex h-14 shrink-0 items-center border-b px-4">
          <span className="text-fg truncate text-sm font-semibold">{storeName}</span>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-4">
          <SidebarNav
            permissions={permissions}
            isSuperAdmin={isSuperAdmin}
            onNavigate={() => setOpen(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export const MobileBottomBar = ({ permissions, isSuperAdmin }: NavPrincipal) => {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useSyncedState(pathname, () => false);

  const items = useMemo(() => {
    const held = new Set(permissions);
    return bottomBarItems((required) =>
      isSuperAdmin || required.some((permission: PermissionKey) => held.has(permission)),
    );
  }, [permissions, isSuperAdmin]);

  if (items.length === 0) return null;

  return (
    <>
      {/*
       * `pb-[env(safe-area-inset-bottom)]` keeps the bar clear of the iOS home
       * indicator. The matching spacer is rendered by AdminShell so content can
       * always scroll past the bar.
       */}
      <nav
        aria-label="Primary navigation"
        className="border-line bg-surface/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur-md lg:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <ul className="grid grid-cols-5">
          {items.map((item) => {
            const active = isItemActive(item, pathname);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-2',
                    'text-[11px] font-medium transition-colors',
                    active ? 'text-accent' : 'text-fg-muted',
                  )}
                >
                  <Icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}

          <li>
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="text-fg-muted flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium"
                  aria-label="More sections"
                >
                  <MoreHorizontal className="size-5 shrink-0" aria-hidden="true" />
                  <span>More</span>
                </button>
              </SheetTrigger>

              <SheetContent side="right" label="All sections" className="p-0">
                <div className="border-line flex h-14 shrink-0 items-center border-b px-4">
                  <span className="text-fg text-sm font-semibold">All sections</span>
                </div>
                <div className="flex-1 overflow-y-auto px-2 py-4">
                  <SidebarNav
                    permissions={permissions}
                    isSuperAdmin={isSuperAdmin}
                    onNavigate={() => setMoreOpen(false)}
                  />
                </div>
              </SheetContent>
            </Sheet>
          </li>
        </ul>
      </nav>
    </>
  );
};
