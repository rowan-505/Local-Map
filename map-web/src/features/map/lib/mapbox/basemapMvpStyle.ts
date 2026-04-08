/**
 * Basemap overlays after style load (raster in `public/basemap-township-mvp.json`).
 */
import type { MapEngine } from '../mapEngineTypes';
import { ensureKyauktanTownshipOverlay } from './kyauktanTownshipOverlay';
import { KYAUKTAN_TOWNSHIP_SOURCE_ID } from './mapLayerIds';

export function applyMvpBasemapStyle(map: MapEngine): void {
  if (map.getSource(KYAUKTAN_TOWNSHIP_SOURCE_ID)) return;
  ensureKyauktanTownshipOverlay(map);
}
