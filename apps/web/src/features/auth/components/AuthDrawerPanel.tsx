import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/http';
import { useAuth } from '../state/useAuth';
import type { AuthModalView } from '../state/useAuth';
import type { PreferredLanguage } from '../types';

/**
 * Sign-in / sign-up form rendered inside the left drawer (not a centered modal).
 * On success the AuthContext user updates and the account panel swaps to the
 * profile view automatically — the rest of the map stays visible and usable.
 */
export function AuthDrawerPanel({
  initialView = 'login',
}: {
  readonly initialView?: AuthModalView;
}) {
  const { login, register } = useAuth();
  const [view, setView] = useState<AuthModalView>(initialView);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<PreferredLanguage>('my');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSignup = view === 'signup';

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      if (isSignup) {
        await register({
          email: email.trim(),
          displayName: displayName.trim(),
          password,
          preferredLanguage,
        });
      } else {
        await login({ email: email.trim(), password });
      }
      // No manual close: the account panel reacts to the new auth state.
    } catch (err) {
      setError(toErrorMessage(err, isSignup));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="p-3.5">
      <div className="rounded-2xl border border-neutral-100 bg-white p-4 shadow-sm shadow-neutral-950/3">
        <div className="grid grid-cols-2 gap-1 rounded-full bg-neutral-100 p-1 text-sm font-semibold">
          <button
            type="button"
            className={tabClass(!isSignup)}
            aria-pressed={!isSignup}
            onClick={() => {
              setView('login');
              setError(null);
            }}
          >
            Sign in
          </button>
          <button
            type="button"
            className={tabClass(isSignup)}
            aria-pressed={isSignup}
            onClick={() => {
              setView('signup');
              setError(null);
            }}
          >
            Sign up
          </button>
        </div>

        <form className="mt-4 space-y-3" onSubmit={onSubmit}>
          {isSignup ? (
            <Field
              label="Display name"
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={setDisplayName}
              placeholder="Your name"
              required
              minLength={2}
            />
          ) : null}
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            required
          />
          <Field
            label="Password"
            type="password"
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            value={password}
            onChange={setPassword}
            placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
            required
            minLength={isSignup ? 8 : 6}
          />
          {isSignup ? (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-neutral-600">
                Preferred language
              </span>
              <select
                className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                value={preferredLanguage}
                onChange={(event) =>
                  setPreferredLanguage(event.target.value === 'en' ? 'en' : 'my')
                }
              >
                <option value="my">မြန်မာ (Myanmar)</option>
                <option value="en">English</option>
              </select>
              {/* TODO: add optional primary region/township and phone fields once the
                  API + region picker support them; do not block signup on them. */}
            </label>
          ) : null}

          {error ? (
            <p
              className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-700"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="w-full rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
          >
            {submitting ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
          </button>
        </form>
      </div>

      <p className="mt-3 px-1 text-center text-xs text-neutral-500">
        Browsing the map and search is free. An account is only needed to save places.
      </p>
    </section>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  required = false,
  minLength,
}: {
  readonly label: string;
  readonly type: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly autoComplete?: string;
  readonly required?: boolean;
  readonly minLength?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-neutral-600">{label}</span>
      <input
        className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-900 outline-none transition-colors focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
      />
    </label>
  );
}

function tabClass(active: boolean): string {
  return `rounded-full px-3 py-1.5 transition-colors ${
    active ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-600 hover:text-neutral-900'
  }`;
}

function toErrorMessage(error: unknown, isSignup: boolean): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'An account with this email already exists.';
    if (error.status === 401) return 'Incorrect email or password.';
    if (error.message) return error.message;
  }
  return isSignup ? 'Could not create account. Try again.' : 'Could not sign in. Try again.';
}
