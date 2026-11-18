'use client';

import { KeyRound, LogOut, Store, User as UserIcon } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/menu';
import { toast } from '@/components/ui/toast';
import { api, toErrorMessage } from '@/lib/client/api';
import { initials } from '@/lib/utils';

/**
 * Account menu.
 *
 * Sign-out is a POST, not a link: a GET that logs you out can be triggered by
 * any page that embeds an image pointing at it.
 */
export const UserMenu = ({
  firstName,
  lastName,
  email,
  roleNames,
  avatarUrl,
}: {
  firstName: string;
  lastName: string;
  email: string;
  roleNames: string[];
  avatarUrl: string | null;
}) => {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async (): Promise<void> => {
    setSigningOut(true);
    try {
      await api.post('/api/auth/logout');
      // Replace, so the back button cannot return to an authenticated page.
      router.replace('/login');
      router.refresh();
    } catch (error) {
      toast.error(toErrorMessage(error));
      setSigningOut(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-9 gap-2 px-1.5"
          aria-label={`Account menu for ${firstName} ${lastName}`}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary remote URLs; next/image adds no benefit at 28px
            <img
              src={avatarUrl}
              alt=""
              width={28}
              height={28}
              className="size-7 rounded-full object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="bg-primary text-on-primary grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold"
            >
              {initials(firstName, lastName)}
            </span>
          )}
          <span className="text-fg hidden max-w-32 truncate text-sm font-medium sm:inline">
            {firstName}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="min-w-60">
        <DropdownMenuLabel>Signed in as</DropdownMenuLabel>
        <div className="px-2.5 pb-2">
          <p className="text-fg truncate text-sm font-medium">
            {firstName} {lastName}
          </p>
          <p className="text-fg-muted truncate text-xs">{email}</p>
          {roleNames.length > 0 ? (
            <p className="text-fg-subtle mt-1 truncate text-xs">{roleNames.join(', ')}</p>
          ) : (
            <p className="text-warning mt-1 text-xs">No roles assigned</p>
          )}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserIcon aria-hidden="true" />
            Your profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/profile?changePassword=1">
            <KeyRound aria-hidden="true" />
            Change password
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/" target="_blank" rel="noopener">
            <Store aria-hidden="true" />
            View storefront
            <span className="sr-only"> (opens in a new tab)</span>
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          destructive
          disabled={signingOut}
          onSelect={(event) => {
            // Keep the menu open while the request is in flight so the
            // disabled state is visible rather than the menu vanishing.
            event.preventDefault();
            void signOut();
          }}
        >
          <LogOut aria-hidden="true" />
          {signingOut ? 'Signing out...' : 'Sign out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
