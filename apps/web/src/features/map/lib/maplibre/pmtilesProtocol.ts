/**
 * Registers the `pmtiles://` fetch scheme with MapLibre once per page lifetime.
 * Call `ensurePmtilesProtocol()` before `new maplibregl.Map` so styles may use vector sources like:
 *
 * ```json
 * "sources": {
 *   "basemap": {
 *     "type": "vector",
 *     "url": "pmtiles://https://your.host/path/basemap.pmtiles"
 *   }
 * }
 * ```
 *
 * Local files during dev: serve `.pmtiles` from `public/` and use
 * `pmtiles://${location.origin}${import.meta.env.BASE_URL}tiles/basemap.pmtiles` or an absolute https URL.
 */
import maplibregl from 'maplibre-gl';
import { Protocol } from 'pmtiles';

const PMTILES_SCHEME = 'pmtiles';

let done = false;

export function ensurePmtilesProtocol(): void {
  if (done) return;
  const protocol = new Protocol();
  maplibregl.addProtocol(PMTILES_SCHEME, protocol.tile);
  done = true;
}
