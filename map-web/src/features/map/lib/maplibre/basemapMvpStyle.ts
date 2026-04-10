/**
 * Basemap overlays after vector style load (style path: `config/basemapStyle.ts` → `BASEMAP_STYLE_PUBLIC_FILENAME`).
 */
import type { MapEngine } from '../mapEngineTypes';
import { ensureKyauktanTownshipOverlay } from './kyauktanTownshipOverlay';

export function applyMvpBasemapStyle(map: MapEngine): void {
  ensureKyauktanTownshipOverlay(map);
}
