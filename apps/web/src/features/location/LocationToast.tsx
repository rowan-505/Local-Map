/**
 * Subtle, transient on-map toast for own-user location outcomes.
 *
 * Presentational only — the message/tone and lifecycle come from `useLocationToast`.
 * Sits top-center above the map, gently fades in, and is removed by the hook's
 * auto-dismiss timer.
 */
import { useEffect, useState } from 'react';
import type { LocationToast as LocationToastModel } from './useLocationToast';

export function LocationToast({ toast }: { readonly toast: LocationToastModel | null }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!toast) {
      setShown(false);
      return;
    }
    // Defer one frame so the opacity/translate transition can play.
    const frame = requestAnimationFrame(() => setShown(true));
    return () => {
      cancelAnimationFrame(frame);
      setShown(false);
    };
  }, [toast?.id]);

  if (!toast) return null;

  const warn = toast.tone === 'warn';

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 justify-center px-3">
      <div
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-lg shadow-neutral-900/10 backdrop-blur-xl transition-all duration-300 ${
          shown ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
        } ${
          warn
            ? 'border-amber-200 bg-amber-50/95 text-amber-900'
            : 'border-white/80 bg-white/95 text-neutral-700'
        }`}
        role="status"
        aria-live="polite"
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${warn ? 'bg-amber-500' : 'bg-sky-500'}`}
          aria-hidden="true"
        />
        <span className="truncate">{toast.message}</span>
      </div>
    </div>
  );
}
