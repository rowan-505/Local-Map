const PMTILES_SCHEME = 'pmtiles';

let registered = false;
let registrationPromise: Promise<void> | null = null;

type MaplibreProtocolHost = {
  addProtocol(name: string, loadFn: unknown): void;
};

/**
 * Registers the `pmtiles://` tile scheme with MapLibre once per JS realm.
 * Pass the default `maplibregl` export from `maplibre-gl`.
 *
 * Uses a dynamic import so the `pmtiles` package is not loaded during Next.js SSR,
 * and guards `window` so this is a no-op on the server. Idempotent across callers.
 */
export async function ensurePmtilesProtocol(
  maplibre: MaplibreProtocolHost,
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (registered) return;

  if (!registrationPromise) {
    registrationPromise = (async () => {
      const { Protocol } = await import('pmtiles');
      if (registered) return;
      const protocol = new Protocol();
      maplibre.addProtocol(PMTILES_SCHEME, protocol.tile);
      registered = true;
    })();
  }

  await registrationPromise;
}
