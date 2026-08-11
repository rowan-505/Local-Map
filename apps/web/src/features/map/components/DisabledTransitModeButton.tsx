import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type DisabledTransitModeButtonProps = {
  readonly label: string;
  readonly icon: ReactNode;
  readonly hint: string;
};

export function DisabledTransitModeButton({ label, icon, hint }: DisabledTransitModeButtonProps) {
  const [showHint, setShowHint] = useState(false);

  const revealHint = useCallback(() => {
    setShowHint(true);
  }, []);

  const hideHint = useCallback(() => {
    setShowHint(false);
  }, []);

  useEffect(() => {
    if (!showHint) return;
    const timer = window.setTimeout(() => setShowHint(false), 2200);
    return () => window.clearTimeout(timer);
  }, [showHint]);

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        aria-disabled="true"
        title={hint}
        className="flex min-h-10 w-full min-w-0 cursor-not-allowed items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1 text-sm font-semibold text-slate-400 transition-colors hover:bg-slate-50"
        onClick={revealHint}
        onMouseEnter={revealHint}
        onMouseLeave={hideHint}
        onFocus={revealHint}
        onBlur={hideHint}
      >
        <span className="grid h-4 w-4 place-items-center">{icon}</span>
        {label}
      </button>
      {showHint ? (
        <p
          role="tooltip"
          className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-30 max-w-[12rem] -translate-x-1/2 rounded-map-control bg-slate-900 px-3 py-2 text-center text-xs font-medium leading-5 text-white shadow-map-control"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
