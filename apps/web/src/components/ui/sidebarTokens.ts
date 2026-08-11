/**
 * Shared class tokens + class helpers for the public map sidebar surfaces.
 * Kept separate from sidebarUi.tsx so the component file only exports
 * components (react-refresh friendly). Presentation only.
 */

/** Outer card surface: consistent radius, border, and soft shadow. */
export const sidebarCard =
  'overflow-hidden rounded-map-card border border-map-border bg-map-surface shadow-map-card';

/** Small uppercase muted label used for section titles and row labels. */
export const mutedLabel =
  'map-kicker text-map-muted';

/** Title class for selectable result/list rows (truncates or wraps for bilingual). */
export function resultTitleClass(multiline: boolean): string {
  return multiline
    ? 'block whitespace-pre-line wrap-break-word text-sm font-medium leading-tight text-map-ink'
    : 'block truncate text-sm font-medium leading-tight text-map-ink';
}
