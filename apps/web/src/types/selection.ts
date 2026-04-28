/**
 * Which POI is active for map + panel sync (highlight, detail, etc.).
 */

export type SelectedPoiState = {
  /** `null` when nothing is selected. */
  readonly selectedPoiId: string | null;
};
