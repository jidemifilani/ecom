'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Check } from 'lucide-react';
import { forwardRef } from 'react';

import { cn } from '@/lib/utils';

/**
 * Dropdown menus and tooltips.
 *
 * Both are keyboard-navigable via Radix. Tooltips are used only for
 * supplementary detail -- never for information a user needs to complete a
 * task, since they are unavailable on touch devices. Icon-only buttons always
 * carry an aria-label in addition to any tooltip.
 */

export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;
export const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const menuSurface = [
  'bg-surface border-line shadow-overlay z-50 min-w-48 overflow-hidden rounded-card border p-1',
  'data-[state=open]:animate-in data-[state=closed]:animate-out duration-150',
].join(' ');

export const DropdownMenuContent = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 6, align = 'end', ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      align={align}
      // Keeps the menu inside the viewport on small screens.
      collisionPadding={12}
      className={cn(menuSurface, className)}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
));
DropdownMenuContent.displayName = 'DropdownMenuContent';

const itemBase = [
  'relative flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm',
  'outline-none select-none',
  'focus:bg-surface-sunken focus:text-fg data-[highlighted]:bg-surface-sunken',
  'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  '[&_svg]:size-4 [&_svg]:shrink-0',
].join(' ');

export const DropdownMenuItem = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    destructive?: boolean;
  }
>(({ className, destructive = false, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      itemBase,
      destructive ? 'text-danger focus:bg-danger-soft focus:text-danger' : 'text-fg',
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuCheckboxItem = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(itemBase, 'text-fg pl-8', className)}
    {...props}
  >
    <span className="absolute left-2 grid size-4 place-items-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="size-4" aria-hidden="true" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

export const DropdownMenuLabel = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn('text-fg-subtle px-2.5 py-1.5 text-xs font-semibold tracking-wide uppercase', className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = 'DropdownMenuLabel';

export const DropdownMenuSeparator = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn('bg-line -mx-1 my-1 h-px', className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = 'DropdownMenuSeparator';

// ── Tooltip ──────────────────────────────────────────────────────────────────

export const TooltipProvider = ({ children }: { children: React.ReactNode }) => (
  <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={150}>
    {children}
  </TooltipPrimitive.Provider>
);

/**
 * Tooltip wrapper.
 *
 * The trigger must be focusable for the tip to be reachable by keyboard, so
 * this is only used on buttons and links -- never on plain text.
 */
export const Tooltip = ({
  content,
  children,
  side = 'top',
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) => (
  <TooltipPrimitive.Root>
    <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={6}
        collisionPadding={12}
        className={cn(
          'bg-brand-900 text-brand-50 z-50 max-w-60 rounded-md px-2.5 py-1.5 text-xs leading-relaxed',
          'shadow-overlay dark:bg-brand-200 dark:text-brand-900',
          'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out duration-150',
        )}
      >
        {content}
        <TooltipPrimitive.Arrow className="fill-brand-900 dark:fill-brand-200" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  </TooltipPrimitive.Root>
);
