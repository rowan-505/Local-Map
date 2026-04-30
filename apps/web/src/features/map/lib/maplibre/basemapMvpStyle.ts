/**
 * Basemap overlays after the shared vector style loads.
 */
import type { MapEngine } from '../mapEngineTypes';
import { ensureKyauktanTownshipOverlay } from './kyauktanTownshipOverlay';

export function applyMvpBasemapStyle(map: MapEngine): void {
  ensureKyauktanTownshipOverlay(map);
}
