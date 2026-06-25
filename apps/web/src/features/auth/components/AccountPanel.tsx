import { useAuth } from '../state/useAuth';
import { AuthDrawerPanel } from './AuthDrawerPanel';
import { ProfileDrawerPanel } from './ProfileDrawerPanel';

/**
 * Account content for the left drawer. Renders the sign-in/sign-up form for
 * guests and the profile view for signed-in users. Replaces the old centered
 * AuthModal so authentication never blurs or blocks the map.
 */
export function AccountPanel({
  onOpenSaved,
}: {
  readonly onOpenSaved?: () => void;
}) {
  const { isAuthenticated, initializing } = useAuth();

  if (initializing) {
    return (
      <section className="p-4">
        <p className="text-sm text-neutral-500">Loading your account…</p>
      </section>
    );
  }

  if (!isAuthenticated) {
    return <AuthDrawerPanel initialView="login" />;
  }

  return <ProfileDrawerPanel onOpenSaved={onOpenSaved} />;
}
