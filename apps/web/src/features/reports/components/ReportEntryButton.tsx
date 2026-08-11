import { useState } from 'react';
import type { ReportTarget } from '../api/reportsApi';
import { ReportModal } from './ReportModal';

type ReportEntryButtonProps = {
  readonly target: ReportTarget;
  readonly label: string;
  readonly className?: string;
};

const DEFAULT_CLASS =
  'inline-flex min-h-9 items-center gap-1.5 rounded-full border border-map-border bg-map-surface px-3.5 py-2 text-xs font-semibold text-map-ink transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary';

/** Button + self-contained report modal. Drop into any place/map-point surface. */
export function ReportEntryButton({ target, label, className }: ReportEntryButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={className ?? DEFAULT_CLASS}
        onClick={() => setOpen(true)}
      >
        <span className="grid h-4 w-4 place-items-center text-map-muted">
          <FlagIcon />
        </span>
        {label}
      </button>

      <ReportModal open={open} target={target} onClose={() => setOpen(false)} />
    </>
  );
}

function FlagIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4 14V2.5M4 3h7l-1.3 2.2L11 7.5H4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
