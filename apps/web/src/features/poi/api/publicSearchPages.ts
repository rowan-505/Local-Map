import type { PublicSearchResult } from './publicMapApi';
import { PUBLIC_SEARCH_SESSION_RESULT_CAP } from './publicSearchConstants';

/** Flatten infinite-query pages and drop duplicate ids (stable append order). */
export function flattenPublicSearchPages(
  pages: ReadonlyArray<{ readonly items: readonly PublicSearchResult[] }> | undefined,
): PublicSearchResult[] {
  if (!pages || pages.length === 0) return [];

  const seen = new Set<string>();
  const merged: PublicSearchResult[] = [];

  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
      if (merged.length >= PUBLIC_SEARCH_SESSION_RESULT_CAP) {
        return merged;
      }
    }
  }

  return merged;
}

export function publicSearchReachedSessionCap(
  pages: ReadonlyArray<{ readonly items: readonly PublicSearchResult[] }> | undefined,
): boolean {
  return flattenPublicSearchPages(pages).length >= PUBLIC_SEARCH_SESSION_RESULT_CAP;
}
