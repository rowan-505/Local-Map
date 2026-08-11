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
        <span className="shrink-0 text-xs font-normal normal-case tracking-normal text-map-muted">
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
      className={`flex min-h-10 items-center justify-center rounded-map-control border px-3 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 disabled:opacity-55 ${
        primary
          ? 'border-map-primary bg-map-primary text-white shadow-map-control hover:bg-map-primary-hover'
          : 'border-map-border bg-map-surface text-map-ink hover:border-map-primary/50 hover:bg-map-primary-soft'
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
      className={`shrink-0 min-h-10 rounded-full border px-3 py-1.5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,opacity,filter] duration-150 ${
        selected
          ? 'border-map-primary bg-map-primary text-white shadow-map-control'
          : 'border-map-border bg-map-surface text-map-muted hover:border-map-primary/30 hover:bg-map-primary-soft hover:text-map-primary'
      }`}
      aria-pressed={selected}
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
      className="map-chip-row -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pr-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label={label}
    >
      {children}
    </div>
  );
}

/** Vertical list of metadata rows separated by subtle dividers. */
export function MetadataList({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="divide-y divide-map-border/70 border-t border-map-border/70">{children}</dl>
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
  const rowLabelClass = 'map-kicker text-map-muted';
  const valueClass = `text-sm leading-6 ${mono ? 'font-mono text-sm' : ''} ${
    muted ? 'text-map-muted/70' : 'text-map-ink/85'
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
      className={`map-focus-inset flex w-full gap-3 px-3.5 py-2.5 text-left transition-colors duration-150 focus-visible:bg-map-primary-soft ${
        align === 'center' ? 'items-center' : 'items-start'
      } ${
        selected
          ? 'bg-map-primary-soft shadow-[inset_3px_0_0_#0f68e8] hover:bg-blue-100/70'
          : 'hover:bg-map-primary-soft/70'
      }`}
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
