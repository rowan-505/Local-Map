import { useState, type ReactNode } from 'react';
import { useSavedPlaces } from '@/features/saved-places/state/useSavedPlaces';
import { ApiError } from '../api/http';
import { useAuth } from '../state/useAuth';
import type { PreferredLanguage } from '../types';
import { EmailVerifySection } from './EmailVerifySection';

/** Email returned by the API's dev AUTH_BYPASS profile (never a real verified user). */
const DEV_BYPASS_EMAIL = 'dev@local';

const LANGUAGE_LABELS: Record<string, string> = {
  my: 'မြန်မာ (Myanmar)',
  en: 'English',
};

/**
 * Signed-in account view rendered inside the left drawer. Shows profile details,
 * email verification state, points, and a saved-places shortcut.
 *
 * NOTE: When AUTH_BYPASS=true the API returns the dev admin (dev@local) as a
 * verified account. Real email-verification flows can only be exercised with
 * AUTH_BYPASS=false. The dev account is labelled below so it is never mistaken
 * for a verified public user.
 */
export function ProfileDrawerPanel({
  onOpenSaved,
}: {
  readonly onOpenSaved?: () => void;
}) {
  const { user, logout } = useAuth();
  const { items, loading: savedLoading } = useSavedPlaces();
  const [editing, setEditing] = useState(false);

  if (!user) return null;

  const initial = (user.display_name.trim().charAt(0) || '?').toUpperCase();
  const isDevBypass = user.email === DEV_BYPASS_EMAIL;
  // Strict: never treat missing/undefined as verified.
  const verified = user.email_verified === true;
  const languageLabel = LANGUAGE_LABELS[user.preferred_language] ?? user.preferred_language;
  const savedCount = items.length;

  if (editing) {
    return <ProfileEditForm onClose={() => setEditing(false)} />;
  }

  return (
    <section className="space-y-3 p-3.5" aria-label="Account profile">
      <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm shadow-neutral-950/3">
        <div className="flex items-start gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sky-600 text-base font-bold text-white">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-neutral-950">{user.display_name}</p>
            <p className="truncate text-xs text-neutral-500">{user.email}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {isDevBypass ? (
                <Badge tone="purple">Development bypass account</Badge>
              ) : verified ? (
                <Badge tone="emerald">Email verified</Badge>
              ) : (
                <Badge tone="amber">Email not verified</Badge>
              )}
              {user.roles.map((role) => (
                <Badge key={role} tone="slate">
                  {role}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {isDevBypass ? (
          <p className="mt-3 rounded-xl bg-purple-50 px-3 py-2 text-[11px] leading-4 text-purple-700">
            Development bypass is on. Real account verification cannot be tested while
            AUTH_BYPASS=true — set it to false to register and verify a real account.
          </p>
        ) : null}
      </div>

      {!verified && !isDevBypass ? (
        <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm shadow-neutral-950/3">
          <EmailVerifySection />
        </div>
      ) : null}

      <div className="rounded-2xl border border-neutral-100 bg-white p-1.5 shadow-sm shadow-neutral-950/3">
        <InfoRow label="Phone" value={user.phone ?? 'Not set'} />
        <InfoRow label="Preferred language" value={languageLabel} />
        {/* TODO: resolve primary region name from the API; show the id for now. */}
        <InfoRow
          label="Primary region"
          value={user.primary_region_id ? `#${user.primary_region_id}` : 'Not set'}
        />
        <InfoRow label="Total points" value={String(user.total_points)} />
        <InfoRow
          label="Saved places"
          value={savedLoading ? '…' : String(savedCount)}
        />
      </div>

      <button
        type="button"
        className="w-full rounded-2xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700"
        onClick={() => setEditing(true)}
      >
        Edit profile
      </button>

      <button
        type="button"
        className="flex w-full items-center justify-between rounded-2xl border border-neutral-100 bg-white px-4 py-3 text-sm font-semibold text-neutral-800 shadow-sm shadow-neutral-950/3 transition-colors hover:bg-neutral-50"
        onClick={onOpenSaved}
      >
        <span>View saved places</span>
        <span className="text-neutral-400">›</span>
      </button>

      <button
        type="button"
        className="w-full rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
        onClick={() => void logout()}
      >
        Log out
      </button>
    </section>
  );
}

/**
 * Editable profile form rendered inside the same left drawer (not a modal).
 * Editable: displayName, phone, preferredLanguage, primaryRegionId.
 * Read-only here: email, verification, roles, points.
 */
function ProfileEditForm({ onClose }: { readonly onClose: () => void }) {
  const { user, updateProfile } = useAuth();
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [preferredLanguage, setPreferredLanguage] = useState<PreferredLanguage>(
    user?.preferred_language === 'en' ? 'en' : 'my',
  );
  const [primaryRegionId, setPrimaryRegionId] = useState(user?.primary_region_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!user) return null;

  const onSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSuccess(false);

    const trimmedRegion = primaryRegionId.trim();
    const regionValue =
      trimmedRegion === '' ? null : Number.parseInt(trimmedRegion, 10);
    if (regionValue !== null && (!Number.isFinite(regionValue) || regionValue <= 0)) {
      setError('Primary region must be a positive number or empty.');
      setBusy(false);
      return;
    }

    try {
      await updateProfile({
        displayName: displayName.trim(),
        phone: phone.trim() === '' ? null : phone.trim(),
        preferredLanguage,
        primaryRegionId: regionValue,
      });
      setSuccess(true);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 p-3.5" aria-label="Edit profile">
      <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm shadow-neutral-950/3">
        <form className="space-y-3" onSubmit={onSubmit}>
          <TextField
            label="Display name"
            value={displayName}
            onChange={setDisplayName}
            required
            minLength={2}
          />
          <TextField
            label="Phone (optional)"
            value={phone}
            onChange={setPhone}
            type="tel"
            placeholder="e.g. 09xxxxxxxxx"
          />
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-neutral-600">
              Preferred language
            </span>
            <select
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value === 'en' ? 'en' : 'my')}
            >
              <option value="my">မြန်မာ (Myanmar)</option>
              <option value="en">English</option>
            </select>
          </label>
          {/* TODO: replace this numeric input with a proper region/township selector. */}
          <TextField
            label="Primary region id (optional)"
            value={primaryRegionId}
            onChange={setPrimaryRegionId}
            inputMode="numeric"
            placeholder="e.g. 12"
          />

          <div className="rounded-xl bg-neutral-50 px-3 py-2 text-[11px] leading-4 text-neutral-500">
            Email, verification status, roles, and points are managed elsewhere and
            can't be edited here.
          </div>

          {error ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
              Profile updated.
            </p>
          ) : null}

          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:opacity-60"
              disabled={busy}
            >
              {busy ? 'Saving…' : 'Save changes'}
            </button>
            <button
              type="button"
              className="rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-50"
              onClick={onClose}
            >
              {success ? 'Back' : 'Cancel'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
  required = false,
  minLength,
  inputMode,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly minLength?: number;
  readonly inputMode?: 'numeric' | 'text' | 'tel';
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-neutral-600">{label}</span>
      <input
        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        inputMode={inputMode}
      />
    </label>
  );
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError && error.message) return error.message;
  return 'Could not update profile. Try again.';
}

function InfoRow({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2.5 py-2">
      <span className="text-xs font-medium text-neutral-500">{label}</span>
      <span className="truncate text-sm font-semibold text-neutral-900">{value}</span>
    </div>
  );
}

const BADGE_TONES = {
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  amber: 'bg-amber-50 text-amber-700 ring-amber-100',
  purple: 'bg-purple-50 text-purple-700 ring-purple-100',
  slate: 'bg-slate-100 text-slate-600 ring-slate-200',
} as const;

function Badge({
  tone,
  children,
}: {
  readonly tone: keyof typeof BADGE_TONES;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}
