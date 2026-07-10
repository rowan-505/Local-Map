const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(properties: Record<string, unknown>, key: string): string | null {
  const value = properties[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function readFeatureId(featureId: string | number | undefined): string | null {
  const numeric = readPositiveInt(featureId);
  if (numeric !== null) return String(numeric);
  if (typeof featureId === 'string') {
    const trimmed = featureId.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
}

/**
 * Tile lookup id for UI/highlighting — prefers public_id, then numeric tile id.
 * Reads MapLibre `feature.id` when Martin omits non-geometry columns from MVT properties.
 */
export function resolveTransportStopLookupId(
  properties: Record<string, unknown>,
  featureId?: string | number,
): string | null {
  const publicId = readString(properties, 'public_id') ?? readString(properties, 'publicId');
  if (publicId) return publicId;

  const propertyNumeric = readPositiveInt(properties.id);
  if (propertyNumeric !== null) return String(propertyNumeric);

  return readFeatureId(featureId);
}

/**
 * API lookup for GET /public/transport/stops/:id.
 *
 * Contract (single source of truth, mirrors the API repo classifier):
 * 1. numeric `properties.id` (Martin `id_column` → `transport.stops.id`)
 * 2. numeric `feature.id`
 * 3. uuid `properties.public_id` (→ `transport.stops.public_id`)
 * 4. uuid `feature.id`
 * 5. otherwise `null` — never guess an unrelated (non-numeric, non-uuid) id.
 */
export function resolveTransportStopApiLookupId(
  properties: Record<string, unknown>,
  featureId?: string | number,
): string | null {
  const propertyNumeric = readPositiveInt(properties.id);
  if (propertyNumeric !== null) return String(propertyNumeric);

  const featureNumeric = readPositiveInt(featureId);
  if (featureNumeric !== null) return String(featureNumeric);

  const publicId = readString(properties, 'public_id') ?? readString(properties, 'publicId');
  if (publicId && UUID_RE.test(publicId)) return publicId;

  const featureIdText = readFeatureId(featureId);
  if (featureIdText && UUID_RE.test(featureIdText)) return featureIdText;

  return null;
}

/**
 * API lookup for GET /public/transport/terminals/:id.
 * Same contract as stop lookup: numeric id, then uuid public_id.
 */
export const resolveTransportTerminalApiLookupId = resolveTransportStopApiLookupId;
