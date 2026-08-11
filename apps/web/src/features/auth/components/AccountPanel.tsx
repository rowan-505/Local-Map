import { useMapUiText } from '@/features/map/i18n/mapUiText';
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
  onOpenReports,
}: {
  readonly onOpenSaved?: () => void;
  readonly onOpenReports?: () => void;
}) {
  const t = useMapUiText();
  const { isAuthenticated, initializing } = useAuth();

  if (initializing) {
    return (
      <section className="p-4">
        <p className="text-sm text-map-muted">
          {t('သင့်အကောင့်ကို ဖွင့်နေသည်…', 'Loading your account…')}
        </p>
      </section>
    );
  }

  if (!isAuthenticated) {
    return <AuthDrawerPanel initialView="login" />;
  }

  return <ProfileDrawerPanel onOpenSaved={onOpenSaved} onOpenReports={onOpenReports} />;
}
