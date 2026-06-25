import { useState } from 'react';
import { ApiError } from '@/features/auth/api/http';
import { useAuth } from '@/features/auth/state/useAuth';
import { useSavedPlaces } from '../state/useSavedPlaces';

type SaveButtonProps = {
  /** Numeric core_places id (Poi.apiId). Save is disabled when absent. */
  readonly placeApiId: string | undefined;
};

/**
 * Save / unsave toggle for the place detail panel.
 * - Guests are prompted to sign in.
 * - Signed-in users save via POST /me/saved-places and can unsave.
 */
export function SaveButton({ placeApiId }: SaveButtonProps) {
  const { isAuthenticated, openAuthModal } = useAuth();
  const { isSaved, save, unsaveByPlaceId } = useSavedPlaces();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saved = isAuthenticated && isSaved(placeApiId);
  const disabled = placeApiId === undefined;

  const onClick = async () => {
    if (disabled || busy) return;

    if (!isAuthenticated) {
      openAuthModal('login');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (saved) {
        await unsaveByPlaceId(placeApiId!);
      } else {
        await save(placeApiId!);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        openAuthModal('login');
      } else {
        setError('Could not update saved places. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        className={`flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
          saved
            ? 'border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100'
            : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50'
        }`}
        disabled={disabled || busy}
        aria-pressed={saved}
        onClick={() => void onClick()}
      >
        <BookmarkIcon filled={saved} />
        {busy ? 'Saving…' : saved ? 'Saved' : 'Save place'}
      </button>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function BookmarkIcon({ filled }: { readonly filled: boolean }) {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      aria-hidden="true"
    >
      <path
        d="M7 5.5A2.5 2.5 0 0 1 9.5 3h5A2.5 2.5 0 0 1 17 5.5v15L12 17l-5 3.5v-15Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
