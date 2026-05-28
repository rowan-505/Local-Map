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
    <div className="relative shrink-0">
      <button
        type="button"
        aria-disabled="true"
        title={hint}
        className="flex min-h-12 min-w-20 cursor-not-allowed flex-col items-center justify-center gap-1 rounded-xl px-2 py-1.5 text-[10px] font-semibold text-neutral-400 opacity-55"
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
          className="pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-30 max-w-[11rem] -translate-x-1/2 rounded-xl bg-neutral-900 px-2.5 py-1.5 text-center text-[10px] font-medium leading-4 text-white shadow-md"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}
