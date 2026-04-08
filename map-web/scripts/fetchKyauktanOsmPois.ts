/**
 * Manual Kyauktan POI refresh (no auto-sync): Overpass fetch → raw JSON → normalize → processed JSON.
 *
 * Run: `npm run pois:refresh` or `npm run data:kyauktan`
 * Dev server: restart or trigger a rebuild so Vite picks up the updated processed JSON import.
 *
 * If you see HTTP 504 + "server is probably too busy" / "timeout": that response is from the
 * **public Overpass host**, not this repo — shared instances often throttle under load. Retries
 * below help; you can also set `OVERPASS_URL` to another public interpreter (see OSM Overpass API wiki).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OPERATIONAL_BOUNDS } from '../src/config/regionScope';
import { normalizeKyauktanOsmDocument } from '../src/data/poi/kyauktan/normalizeKyauktanOsm';
import type { OverpassDocument } from '../src/data/poi/kyauktan/overpassTypes';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const RAW_PATH = join(ROOT, 'src/data/osm/kyauktan/raw/kyauktan-overpass.json');
const PROCESSED_PATH = join(ROOT, 'src/data/poi/kyauktan/processed/kyauktan-pois.json');

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Override with env if the default host is slow or returns 504, e.g. another public interpreter URL. */
const OVERPASS_URL =
  process.env.OVERPASS_URL?.trim() || 'https://overpass-api.de/api/interpreter';

function overpassQueryForBbox(
  south: number,
  west: number,
  north: number,
  east: number,
): string {
  return `
[out:json][timeout:180];
(
  node["amenity"](${south},${west},${north},${east});
  node["shop"](${south},${west},${north},${east});
  node["tourism"](${south},${west},${north},${east});
  node["leisure"](${south},${west},${north},${east});
  node["historic"](${south},${west},${north},${east});
);
out body;
`;
}

async function fetchOverpassWithRetries(query: string): Promise<OverpassDocument> {
  const body = `data=${encodeURIComponent(query)}`;
  const maxAttempts = 4;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body,
    });

    if (res.ok) {
      return (await res.json()) as OverpassDocument;
    }

    const text = await res.text();
    const retryable = res.status === 502 || res.status === 503 || res.status === 504;
    if (retryable && attempt < maxAttempts) {
      console.warn(
        `Overpass HTTP ${res.status} from ${OVERPASS_URL} (attempt ${attempt}/${maxAttempts}). Retrying in 12s…`,
      );
      await sleep(12_000);
      continue;
    }

    throw new Error(`Overpass HTTP ${res.status}: ${text}`);
  }

  throw new Error('Overpass: unexpected retry exhaustion');
}

async function main(): Promise<void> {
  const [[west, south], [east, north]] = OPERATIONAL_BOUNDS;
  const query = overpassQueryForBbox(south, west, north, east);

  console.log(`Overpass: ${OVERPASS_URL}`);
  const rawJson = await fetchOverpassWithRetries(query);
  mkdirSync(dirname(RAW_PATH), { recursive: true });
  writeFileSync(RAW_PATH, `${JSON.stringify(rawJson, null, 2)}\n`, 'utf8');

  const pois = normalizeKyauktanOsmDocument(rawJson, OPERATIONAL_BOUNDS);

  mkdirSync(dirname(PROCESSED_PATH), { recursive: true });
  writeFileSync(PROCESSED_PATH, `${JSON.stringify(pois, null, 2)}\n`, 'utf8');

  console.log(`Wrote raw:     ${RAW_PATH}`);
  console.log(`Wrote processed: ${PROCESSED_PATH} (${pois.length} POIs)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
