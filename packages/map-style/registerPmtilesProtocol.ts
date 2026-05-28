const PMTILES_SCHEME = 'pmtiles';

/** Survives Vite HMR module re-evaluation so we do not call `addProtocol` twice. */
const GLOBAL_REGISTERED_KEY = '__localMapPmtilesProtocolRegistered__';

let registered = false;
let registrationPromise: Promise<void> | null = null;

type MaplibreProtocolHost = {
  addProtocol(name: string, loadFn: unknown): void;
};

type GlobalWithPmtilesFlag = typeof globalThis & {
  [GLOBAL_REGISTERED_KEY]?: boolean;
};

function isRegisteredOnGlobal(): boolean {
  return (globalThis as GlobalWithPmtilesFlag)[GLOBAL_REGISTERED_KEY] === true;
}

function markRegisteredOnGlobal(): void {
  (globalThis as GlobalWithPmtilesFlag)[GLOBAL_REGISTERED_KEY] = true;
}

// Module reload (HMR): sync local flag from global so early-return stays correct.
if (isRegisteredOnGlobal()) {
  registered = true;
}

/**
 * Registers the `pmtiles://` tile scheme with MapLibre once per browser tab.
 * Pass the default `maplibregl` export from `maplibre-gl`.
 *
 * Uses a dynamic import so the `pmtiles` package is not loaded during Next.js SSR,
 * and guards `window` so this is a no-op on the server. Idempotent across callers and HMR.
 */
export async function ensurePmtilesProtocol(
  maplibre: MaplibreProtocolHost,
): Promise<void> {
  if (typeof window === 'undefined') return;
  if (registered || isRegisteredOnGlobal()) {
    registered = true;
    return;
  }

  if (!registrationPromise) {
    registrationPromise = (async () => {
      if (registered || isRegisteredOnGlobal()) {
        registered = true;
        return;
      }
      const { Protocol } = await import('pmtiles');
      if (registered || isRegisteredOnGlobal()) {
        registered = true;
        return;
      }
      const protocol = new Protocol();
      maplibre.addProtocol(PMTILES_SCHEME, protocol.tile);
      registered = true;
      markRegisteredOnGlobal();
    })();
  }

  await registrationPromise;
}

/** Alias for callers that prefer the `register*` naming. */
export const registerPmtilesProtocol = ensurePmtilesProtocol;
