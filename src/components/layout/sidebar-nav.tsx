'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';

import type { PermissionKey } from '@/lib/rbac/permissions';
import { cn } from '@/lib/utils';

import { isItemActive, visibleSections } from './nav-config';

/**
 * Sidebar navigation list.
 *
 * Takes the user's permission keys as plain strings rather than a prebuilt
 * section tree: the nav config holds icon *components*, which cannot cross the
 * server/client boundary as props. Filtering therefore happens here, in the
 * browser bundle, from data that is not sensitive (the same list is already
 * available from /api/auth/session).
 *
 * This only decides what is *shown*. Every route and endpoint re-checks the
 * same permissions on the server.
 */

export type NavPrincipal = {
  permissions: readonly string[];
  isSuperAdmin: boolean;
};

export const useVisibleSections = ({ permissions, isSuperAdmin }: NavPrincipal) =>
  useMemo(() => {
    const held = new Set(permissions);
    return visibleSections((required) =>
      isSuperAdmin || required.some((permission: PermissionKey) => held.has(permission)),
    );
  }, [permissions, isSuperAdmin]);

export const SidebarNav = ({
  permissions,
  isSuperAdmin,
  onNavigate,
}: NavPrincipal & {
  /** Called after a link is activated, so the mobile drawer can close itself. */
  onNavigate?: () => void;
}) => {
  const pathname = usePathname();
  const sections = useVisibleSections({ permissions, isSuperAdmin });

  return (
    <nav aria-label="Main navigation" className="flex flex-col gap-5">
      {sections.map((section, sectionIndex) => (
        <div key={section.label ?? `section-${sectionIndex}`}>
          {section.label ? (
            <h2 className="text-fg-subtle px-3 pb-1.5 text-[11px] font-semibold tracking-wider uppercase">
              {section.label}
            </h2>
          ) : null}

          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = isItemActive(item, pathname);
              const Icon = item.icon;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'group rounded-control relative flex items-center gap-3 px-3 py-2.5 text-sm font-medium',
                      'transition-colors duration-150',
                      active
                        ? 'bg-surface-sunken text-fg'
                        : 'text-fg-muted hover:bg-surface-sunken/70 hover:text-fg',
                    )}
                  >
                    {/* Active marker: a shape, not only a colour change. */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute top-1/2 left-0 h-5 w-0.5 -translate-y-1/2 rounded-r-full',
                        active ? 'bg-accent' : 'bg-transparent',
                      )}
                    />
                    <Icon
                      className={cn('size-4 shrink-0', active && 'text-accent')}
                      aria-hidden="true"
                    />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
};
