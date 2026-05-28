/**
 * Overview PMTiles URL for apps/web — `VITE_OVERVIEW_PMTILES_URL` only (no current.json).
 *
 * Examples:
 * - Local: `http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles`
 * - Production: `https://YOUR_TILE_DOMAIN/basemaps/overview/v1/basemap.pmtiles`
 */

export class OverviewPmtilesConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OverviewPmtilesConfigError';
  }
}

export type ResolveOverviewPmtilesUrlResult =
  | { status: 'configured'; httpUrl: string }
  | { status: 'missing' }
  | { status: 'invalid'; message: string };

const DEV_MISSING_WARNING =
  '[map] VITE_OVERVIEW_PMTILES_URL is not set — overview basemap skipped (regional tiles only). ' +
  'Set it in apps/web/.env.local, e.g. ' +
  'http://localhost:8080/overview/regions/myanmar-overview-v1.pmtiles ' +
  '(run `npm run tiles:serve` from repo root).';

const PROD_MISSING_ERROR =
  'VITE_OVERVIEW_PMTILES_URL is required in production. ' +
  'Set it to the hosted overview .pmtiles URL (e.g. https://YOUR_TILE_DOMAIN/basemaps/overview/v1/basemap.pmtiles).';

/** Raw env value trimmed, or `undefined` when unset/blank. */
export function readOverviewPmtilesUrlFromEnv(): string | undefined {
  const configured = import.meta.env.VITE_OVERVIEW_PMTILES_URL;
  if (typeof configured !== 'string') {
    return undefined;
  }
  const trimmed = configured.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Validates HTTP(S) archive URL shape — does not fetch tiles. */
export function validateOverviewPmtilesHttpUrl(
  url: string,
): { ok: true } | { ok: false; message: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, message: 'VITE_OVERVIEW_PMTILES_URL is not a valid URL.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      message: 'VITE_OVERVIEW_PMTILES_URL must use http:// or https://.',
    };
  }

  if (!parsed.pathname.endsWith('.pmtiles') && !parsed.pathname.includes('.pmtiles')) {
    return {
      ok: false,
      message: 'VITE_OVERVIEW_PMTILES_URL must point to a .pmtiles archive path.',
    };
  }

  return { ok: true };
}

/** Non-throwing resolver for composed styles and tests. */
export function resolveOverviewPmtilesUrlForWebMap(): ResolveOverviewPmtilesUrlResult {
  const raw = readOverviewPmtilesUrlFromEnv();
  if (!raw) {
    return { status: 'missing' };
  }

  const validation = validateOverviewPmtilesHttpUrl(raw);
  if (!validation.ok) {
    return { status: 'invalid', message: validation.message };
  }

  return { status: 'configured', httpUrl: raw };
}

function logDevWarning(message: string): void {
  if (import.meta.env.DEV) {
    console.warn(message);
  }
}

/**
 * Overview URL for the public web map.
 * - **Development:** missing/invalid → `console.warn`, returns `undefined` (regional-only style).
 * - **Production:** missing/invalid → throws {@link OverviewPmtilesConfigError}.
 */
export function getOverviewPmtilesUrlForWebMap(): string | undefined {
  const result = resolveOverviewPmtilesUrlForWebMap();

  if (result.status === 'configured') {
    return result.httpUrl;
  }

  if (result.status === 'missing') {
    if (import.meta.env.PROD) {
      throw new OverviewPmtilesConfigError(PROD_MISSING_ERROR);
    }
    logDevWarning(DEV_MISSING_WARNING);
    return undefined;
  }

  const invalidMessage = `${result.message} Overview basemap skipped in development.`;
  if (import.meta.env.PROD) {
    throw new OverviewPmtilesConfigError(
      `${result.message} Fix VITE_OVERVIEW_PMTILES_URL before deploying.`,
    );
  }
  logDevWarning(`[map] ${invalidMessage}`);
  return undefined;
}

/**
 * Overview-only mode (`VITE_MAP_BASEMAP=overview`) — URL is required when this mode is enabled.
 */
export function requireOverviewPmtilesUrlForOverviewMode(): string {
  const result = resolveOverviewPmtilesUrlForWebMap();

  if (result.status === 'configured') {
    return result.httpUrl;
  }

  if (result.status === 'missing') {
    const message =
      'VITE_MAP_BASEMAP=overview requires VITE_OVERVIEW_PMTILES_URL. ' +
      'Set a direct .pmtiles HTTP(S) URL in apps/web/.env.local.';
    if (import.meta.env.PROD) {
      throw new OverviewPmtilesConfigError(message);
    }
    logDevWarning(`[map] ${message}`);
    throw new OverviewPmtilesConfigError(message);
  }

  const message = `${result.message} Cannot load overview-only basemap.`;
  if (import.meta.env.PROD) {
    throw new OverviewPmtilesConfigError(message);
  }
  logDevWarning(`[map] ${message}`);
  throw new OverviewPmtilesConfigError(message);
}
