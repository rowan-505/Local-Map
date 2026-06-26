/**
 * Shared class tokens + class helpers for the public map sidebar surfaces.
 * Kept separate from sidebarUi.tsx so the component file only exports
 * components (react-refresh friendly). Presentation only.
 */

/** Outer card surface: consistent radius, border, and soft shadow. */
export const sidebarCard =
  'overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm shadow-neutral-950/3';

/** Small uppercase muted label used for section titles and row labels. */
export const mutedLabel =
  'text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400';

/** Title class for selectable result/list rows (truncates or wraps for bilingual). */
export function resultTitleClass(multiline: boolean): string {
  return multiline
    ? 'block whitespace-pre-line wrap-break-word text-sm font-medium leading-tight text-neutral-900'
    : 'block truncate text-sm font-medium leading-tight text-neutral-900';
}
