/**
 * apps/web entry point for PMTiles protocol registration.
 * Call before any `maplibregl.Map` (see `mapInstance.ts`).
 */
import maplibregl from 'maplibre-gl';
import { ensurePmtilesProtocol } from '@local-map/map-style/registerPmtilesProtocol';

export async function registerPmtilesProtocol(): Promise<void> {
  await ensurePmtilesProtocol(maplibregl);
}
