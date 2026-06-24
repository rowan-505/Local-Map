/**
 * Martin dynamic vector-tile origin for apps/web — `VITE_MARTIN_TILE_URL` only.
 * Kept separate from `VITE_API_BASE_URL` (Fastify API) and PMTiles basemap URLs.
 *
 * Examples:
 * - Local: `http://localhost:3002`
 * - Production: `https://YOUR_MARTIN_DOMAIN`
 *
 * This module is config only. It does not register sources or add map layers.
 */

export class MartinTileUrlConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MartinTileUrlConfigError';
  }
}

export type ResolveMartinTileUrlResult =
  | { status: 'configured'; baseUrl: string }
  | { status: 'missing' }
  | { status: 'invalid'; message: string };

const DEV_MISSING_WARNING =
  '[map] VITE_MARTIN_TILE_URL is not set — Martin transport overlay disabled. ' +
  'Set it in apps/web/.env.local, e.g. http://localhost:3002 ' +
  '(run the local Martin server, infrastructure/tiles/martin).';

const PROD_MISSING_ERROR =
  'VITE_MARTIN_TILE_URL is required in production when the transport overlay is enabled. ' +
  'Set it to the hosted Martin origin (e.g. https://YOUR_MARTIN_DOMAIN).';

/** Raw env value with trailing slashes trimmed, or `undefined` when unset/blank. */
export function readMartinTileUrlFromEnv(): string | undefined {
  const configured = import.meta.env.VITE_MARTIN_TILE_URL;
  if (typeof configured !== 'string') {
    return undefined;
  }
  const trimmed = configured.trim().replace(/\/+$/, '');
  return trimmed === '' ? undefined : trimmed;
}

/** Validates HTTP(S) origin shape — does not fetch the Martin catalog. */
export function validateMartinTileHttpUrl(
  url: string,
): { ok: true } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: 'VITE_MARTIN_TILE_URL is not a valid URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      message: 'VITE_MARTIN_TILE_URL must use http:// or https://.',
    };
  }

  return { ok: true };
}

/** Non-throwing resolver for callers and tests. */
export function resolveMartinTileUrl(): ResolveMartinTileUrlResult {
  const raw = readMartinTileUrlFromEnv();
  if (!raw) {
    return { status: 'missing' };
  }

  const validation = validateMartinTileHttpUrl(raw);
  if (!validation.ok) {
    return { status: 'invalid', message: validation.message };
  }

  return { status: 'configured', baseUrl: raw };
}

function logDevWarning(message: string): void {
  if (import.meta.env.DEV) {
    console.warn(message);
  }
}

/**
 * Martin base origin for the public web map.
 * - **Development:** missing/invalid → `console.warn`, returns `undefined` (overlay disabled).
 * - **Production:** missing/invalid → throws {@link MartinTileUrlConfigError}.
 */
export function getMartinTileUrl(): string | undefined {
  const result = resolveMartinTileUrl();

  if (result.status === 'configured') {
    return result.baseUrl;
  }

  if (result.status === 'missing') {
    if (import.meta.env.PROD) {
      throw new MartinTileUrlConfigError(PROD_MISSING_ERROR);
    }
    logDevWarning(DEV_MISSING_WARNING);
    return undefined;
  }

  if (import.meta.env.PROD) {
    throw new MartinTileUrlConfigError(
      `${result.message} Fix VITE_MARTIN_TILE_URL before deploying.`,
    );
  }
  logDevWarning(`[map] ${result.message} Martin transport overlay disabled in development.`);
  return undefined;
}

/**
 * Builds the `{z}/{x}/{y}` tile template for a Martin source id, e.g.
 * `martinTileTemplate('transport_stops_v')` → `${base}/transport_stops_v/{z}/{x}/{y}`.
 * Returns `undefined` when the Martin URL is not configured (dev) — config only, adds no layers.
 */
export function martinTileTemplate(sourceId: string): string | undefined {
  const base = getMartinTileUrl();
  if (!base) return undefined;
  return `${base}/${sourceId}/{z}/{x}/{y}`;
}
