import { useState } from 'react';
import { ApiError } from '../api/http';
import { useAuth } from '../state/useAuth';

type Phase = 'idle' | 'code';

/** Inline email verification: send OTP, enter the 6-digit code, update badge. */
export function EmailVerifySection() {
  const { sendEmailOtp, verifyEmailOtp } = useAuth();
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSend = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const status = await sendEmailOtp();
      if (status === 'already_verified') {
        setMessage('Your email is already verified.');
        return;
      }
      setPhase('code');
      setMessage('We sent a 6-digit code to your email.');
    } catch (err) {
      setError(toMessage(err, 'Could not send the code. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const onVerify = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const status = await verifyEmailOtp(code.trim());
      if (status === 'verified' || status === 'already_verified') {
        setMessage('Email verified.');
        setPhase('idle');
        setCode('');
      }
    } catch (err) {
      setError(toMessage(err, 'Invalid or expired code.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-neutral-600">Verify your email</p>

      {phase === 'idle' ? (
        <button
          type="button"
          className="w-full rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:opacity-60"
          disabled={busy}
          onClick={() => void onSend()}
        >
          {busy ? 'Sending…' : 'Send verification code'}
        </button>
      ) : (
        <div className="space-y-2">
          <input
            className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-center text-base font-semibold tracking-[0.4em] text-neutral-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sky-700 disabled:opacity-60"
              disabled={busy || code.length !== 6}
              onClick={() => void onVerify()}
            >
              {busy ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-semibold text-neutral-600 transition-colors hover:bg-neutral-50 disabled:opacity-60"
              disabled={busy}
              onClick={() => void onSend()}
            >
              Resend
            </button>
          </div>
        </div>
      )}

      {message ? <p className="text-xs text-emerald-600">{message}</p> : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}

function toMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}
