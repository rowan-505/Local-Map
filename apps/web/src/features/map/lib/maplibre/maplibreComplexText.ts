/**
 * Loads wipfli/maplibre-gl-complex-text via MapLibre’s RTL plugin hook (HarfBuzz shaping
 * for Myanmar and other scripts) and rewires multiscript-encoded glyph-range fetches.
 *
 * npm does not publish this package — dependency is `"github:wipfli/maplibre-gl-complex-text"`.
 * @see https://github.com/wipfli/maplibre-gl-complex-text
 */
import maplibregl, {
  type RequestParameters,
  type RequestTransformFunction,
} from 'maplibre-gl';
import complexTextPluginUrl from 'maplibre-gl-complex-text/dist/maplibre-gl-complex-text.js?url';

/**
 * Range starts that must use PGF-encoded glyph PBFs (same list as upstream README).
 * Self-hosted style stays `/fonts/{fontstack}/{range}.pbf`; only these requests are
 * redirected to the multiscript font base URL.
 */
const ENCODED_GLYPH_RANGE_STARTS = new Set([
  63488, 63232, 62976, 62720, 62464, 62208, 61952, 61696, 61440, 61184, 60928, 60672, 60416,
  60160, 59904, 59648, 59392, 59136, 58880, 58624, 58368, 58112, 57856, 57600, 3072, 2816,
  2560, 2304, 10240, 10752,
]);

const DEFAULT_MULTISCRIPT_GLYPH_BASE =
  'https://wipfli.github.io/pgf-glyph-ranges/font/NotoSansMultiscript-Regular-v1';

let pluginLoadPromise: Promise<void> | null = null;

function multiscriptGlyphUrl(start: number, end: number): string {
  const fromEnv = import.meta.env.VITE_MULTISCRIPT_GLYPH_BASE_URL;
  const base =
    typeof fromEnv === 'string' && fromEnv.trim() !== ''
      ? fromEnv.trim().replace(/\/$/, '')
      : DEFAULT_MULTISCRIPT_GLYPH_BASE;
  return `${base}/${start}-${end}.pbf`;
}

function transformGlyphUrlForComplexText(url: string): RequestParameters | undefined {
  const match = url.match(/(\d+)-(\d+)\.pbf(?:\?.*)?$/);
  if (!match) return undefined;
  const start = parseInt(match[1], 10);
  const end = parseInt(match[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
  if (!ENCODED_GLYPH_RANGE_STARTS.has(start)) return undefined;
  return { url: multiscriptGlyphUrl(start, end) };
}

/**
 * Map `transformRequest` — style `glyphs` stays `/fonts/{fontstack}/{range}.pbf`;
 * HarfBuzz-shaped labels may request PGF codepoint ranges that need multiscript PBFs.
 */
export const maplibreComplexTextTransformRequest: RequestTransformFunction = (
  url: string,
  resourceType?: Parameters<RequestTransformFunction>[1],
) => {
  if (resourceType === 'Glyphs') {
    const glyphOverride = transformGlyphUrlForComplexText(url);
    if (glyphOverride) return glyphOverride;
  }
  return undefined;
};

/**
 * Must run before `new maplibregl.Map`. Safe to call multiple times (shared promise).
 * On failure, logs and resolves so the map still loads without complex shaping.
 */
export function ensureMaplibreComplexTextPlugin(): Promise<void> {
  pluginLoadPromise ??= maplibregl
    .setRTLTextPlugin(complexTextPluginUrl, false)
    .catch((err: unknown) => {
      console.warn(
        '[map] maplibre-gl-complex-text failed to load; Myanmar shaping may be wrong.',
        err,
      );
    });
  return pluginLoadPromise;
}
