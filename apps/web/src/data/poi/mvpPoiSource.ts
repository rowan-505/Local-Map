/**
 * Active POI source for the UI — Kyauktan normalized OSM only.
 *
 * Flow: `src/data/poi/kyauktan/processed/kyauktan-pois.json` → validate → `cleanupKyauktanPois`
 * (`kyauktanPoisFromOsm.ts`). Manual refresh: `npm run pois:refresh` (writes raw + processed).
 *
 * Pages import `MVP_POI_DATA` from here only — no other live POI feed.
 */
import type { Poi } from '@/types';
import { KYAUKTAN_POIS_FROM_OSM } from './kyauktan/kyauktanPoisFromOsm';

export const MVP_POI_DATA: readonly Poi[] = KYAUKTAN_POIS_FROM_OSM;

export function getMvpPois(): readonly Poi[] {
  return MVP_POI_DATA;
}
