import type { MapGeoJSONFeature } from 'maplibre-gl';
import { getTransportPopupTitle } from '@/features/map/lib/maplibre/transportDisplayName';
import {
  highlightFromTransportFeature,
  type TransportStopHighlight,
} from '@/features/map/lib/maplibre/transportStopHighlight';
import { resolveTransportKind } from '@/features/map/lib/maplibre/transportPopupModel';
import {
  resolveTransportStopApiLookupId,
  resolveTransportStopLookupId,
  resolveTransportTerminalApiLookupId,
} from '@/features/transport/transportStopLookup';
import type { TransportStopDetail } from '@/types';

export {
  resolveTransportStopApiLookupId,
  resolveTransportStopLookupId,
  resolveTransportTerminalApiLookupId,
} from '@/features/transport/transportStopLookup';

export type TransportMapSelection = {
  readonly lookupId: string;
  /** When set, the public transport detail API is queried (stop or terminal endpoint). */
  readonly apiLookupId: string | null;
  readonly kind: 'stop' | 'terminal';
  readonly coordinates: readonly [number, number];
  readonly highlight: TransportStopHighlight;
  readonly preview: TransportStopDetail;
};

function readString(properties: Record<string, unknown>, key: string): string | null {
  const value = properties[key];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildPreviewDetail(
  kind: 'stop' | 'terminal',
  properties: Record<string, unknown>,
  lookupId: string,
  coordinates: readonly [number, number],
): TransportStopDetail {
  const publicId = readString(properties, 'public_id') ?? lookupId;
  const nameMm = readString(properties, 'name_mm');
  const nameEn = readString(properties, 'name_en');
  const title = getTransportPopupTitle(properties, kind === 'terminal' ? 'terminal' : 'stop');
  const mode = readString(properties, 'mode') ?? 'bus';
  const stopType =
    readString(properties, 'stop_type') ??
    readString(properties, 'terminal_role') ??
    (kind === 'terminal' ? 'terminal' : 'bus_stop');
  const reviewStatus = readString(properties, 'review_status');
  const confidenceRaw = properties.confidence_score;
  const confidenceScore =
    typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
      ? confidenceRaw
      : typeof confidenceRaw === 'string' && confidenceRaw.trim() !== ''
        ? Number(confidenceRaw)
        : null;

  return {
    id: String(properties.id ?? lookupId),
    publicId,
    name: title,
    nameMm,
    nameEn,
    nameUnd: null,
    myanmarName: nameMm,
    englishName: nameEn,
    displayName: title,
    primaryName: title,
    canonicalName: null,
    stopCode: readString(properties, 'stop_code'),
    mode,
    stopType,
    adminAreaName: null,
    latitude: coordinates[1],
    longitude: coordinates[0],
    isVerified: reviewStatus === 'verified',
    confidenceScore: Number.isFinite(confidenceScore) ? confidenceScore : null,
    routeCount: 0,
  };
}

/** Builds map selection state from a clicked Martin transport point feature. */
export function transportSelectionFromFeature(
  feature: MapGeoJSONFeature,
): TransportMapSelection | null {
  const highlight = highlightFromTransportFeature(feature);
  if (!highlight) return null;

  const kind = resolveTransportKind(feature.sourceLayer, feature.layer?.id);
  if (kind !== 'stop' && kind !== 'terminal') return null;

  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const featureId = feature.id;
  const lookupId = resolveTransportStopLookupId(
    properties,
    typeof featureId === 'string' || typeof featureId === 'number' ? featureId : undefined,
  );
  if (!lookupId) return null;

  const mapKind = kind === 'terminal' ? 'terminal' : 'stop';
  const featureIdValue =
    typeof featureId === 'string' || typeof featureId === 'number' ? featureId : undefined;
  const apiLookupId =
    mapKind === 'terminal'
      ? resolveTransportTerminalApiLookupId(properties, featureIdValue)
      : resolveTransportStopApiLookupId(properties, featureIdValue);
  const preview = buildPreviewDetail(mapKind, properties, lookupId, highlight.coordinates);

  return {
    lookupId,
    apiLookupId,
    kind: mapKind,
    coordinates: highlight.coordinates,
    highlight: {
      ...highlight,
      label: preview.name,
    },
    preview,
  };
}
