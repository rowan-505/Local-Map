import type { MapMode } from './mapModes';

export const MAP_MODE_STORAGE_KEY = 'coremap:map-mode';

const VALID_MAP_MODES = new Set<MapMode>(['normal', 'satellite', 'hybrid']);

export function normalizeMapMode(value: unknown): MapMode | null {
  if (typeof value !== 'string') return null;
  return VALID_MAP_MODES.has(value as MapMode) ? (value as MapMode) : null;
}

export function readPersistedMapMode(): MapMode | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return normalizeMapMode(localStorage.getItem(MAP_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function persistMapMode(mode: MapMode): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MAP_MODE_STORAGE_KEY, mode);
  } catch {
    /* quota / private mode */
  }
}
