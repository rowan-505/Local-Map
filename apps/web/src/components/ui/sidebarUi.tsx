import type { ReactNode } from 'react';
import { mutedLabel } from './sidebarTokens';

/**
 * Shared visual system for the public map sidebar surfaces (search card, place
 * detail card, result rows, chips, sections). Presentation only — no data,
 * search, or map logic lives here. Keep this small and lightweight.
 *
 * Class tokens and class helpers live in ./sidebarTokens so this file only
 * exports components.
 */

/** Card section header with an optional trailing hint (count / loading text). */
export function SidebarSectionTitle({
  children,
  trailing,
  className = '',
}: {
  readonly children: ReactNode;
  readonly trailing?: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className}`}>
      <h2 className={mutedLabel}>{children}</h2>
      {trailing ? (
        <span className="shrink-0 text-xs font-normal normal-case tracking-normal text-neutral-500">
          {trailing}
        </span>
      ) : null}
    </div>
  );
}

/** Compact action button: neutral by default, slightly stronger when primary. */
export function ActionButton({
  children,
  disabled = false,
  primary = false,
  title,
  onClick,
}: {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly primary?: boolean;
  readonly title?: string;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`flex h-9 items-center justify-center rounded-lg border px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
        primary
          ? 'border-sky-600 bg-sky-600 text-white hover:bg-sky-500'
          : 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50'
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Pill chip used for category and result-type filters. */
export function Chip({
  selected,
  onClick,
  children,
}: {
  readonly selected: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-sky-500/30 ${
        selected
          ? 'border-neutral-900 bg-neutral-900 text-white shadow-sm'
          : 'border-neutral-200 bg-white text-neutral-700 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700'
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** Horizontally scrollable row for chips (scrollbar hidden). */
export function ChipRow({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label?: string;
}) {
  return (
    <div
      className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** Vertical list of metadata rows separated by subtle dividers. */
export function MetadataList({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="divide-y divide-neutral-100 border-t border-neutral-100">{children}</dl>
  );
}

/** Label/value metadata row. Supports stacked layout, mono values, and muted text. */
export function MetadataRow({
  label,
  children,
  stacked = false,
  mono = false,
  muted = false,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly stacked?: boolean;
  readonly mono?: boolean;
  readonly muted?: boolean;
}) {
  const rowLabelClass = 'text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400';
  const valueClass = `text-sm leading-6 ${mono ? 'font-mono text-[13px]' : ''} ${
    muted ? 'text-neutral-400' : 'text-neutral-700'
  }`;

  if (stacked) {
    return (
      <div className="px-4 py-2.5">
        <dt className={rowLabelClass}>{label}</dt>
        <dd className={`mt-1 wrap-break-word ${valueClass}`}>{children}</dd>
      </div>
    );
  }

  return (
    <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
      <dt className={`${rowLabelClass} shrink-0`}>{label}</dt>
      <dd className={`min-w-0 text-right ${valueClass}`}>{children}</dd>
    </div>
  );
}

/**
 * Selectable result/list row used by both search results and the visible-places
 * list. The caller provides leading (badge/avatar), title, subtitle, and an
 * optional trailing slot; layout, padding, and selected/hover states are shared.
 */
export function ResultRow({
  selected = false,
  onClick,
  leading,
  title,
  subtitle,
  trailing,
  align = 'start',
}: {
  readonly selected?: boolean;
  readonly onClick: () => void;
  readonly leading?: ReactNode;
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly trailing?: ReactNode;
  readonly align?: 'start' | 'center';
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`flex w-full gap-3 px-3.5 py-2.5 text-left outline-none transition-colors focus-visible:bg-sky-50/60 ${
        align === 'center' ? 'items-center' : 'items-start'
      } ${selected ? 'bg-sky-50 hover:bg-sky-100/70' : 'hover:bg-sky-50/60'}`}
      onClick={onClick}
    >
      {leading}
      <span className="min-w-0 flex-1">
        {title}
        {subtitle}
      </span>
      {trailing}
    </button>
  );
}
