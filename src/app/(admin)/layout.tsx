import { redirect } from 'next/navigation';

import { AdminShell } from '@/components/layout/admin-shell';
import { getCurrentUser } from '@/lib/auth/current-user';

/**
 * Back-office layout and authentication boundary.
 *
 * This is the real gate for every route in the (admin) group. Middleware only
 * checks that a session cookie is present -- here the session is resolved
 * against the database, so a stale, revoked or forged cookie lands on /login.
 *
 * A user with no roles is sent to /no-access rather than an empty shell, which
 * is what a first-time single-sign-on arrival would otherwise see.
 */
const AdminLayout = async ({ children }: { children: React.ReactNode }) => {
  const user = await getCurrentUser();

  if (!user) redirect('/login');
  if (user.roles.length === 0) redirect('/no-access');

  return <AdminShell user={user}>{children}</AdminShell>;
};

export default AdminLayout;
