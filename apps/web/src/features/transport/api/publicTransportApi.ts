import { publicGet } from '@/features/auth/api/http';
import type { NextStopPreview, RouteServingStop, TransportStopDetail } from '@/types';

type PublicStopRouteServingDto = {
  readonly route_id: string;
  readonly route_public_id: string;
  readonly route_code: string;
  readonly public_name?: string | null;
  readonly variant_id: string;
  readonly variant_public_id: string;
  readonly variant_code: string;
  readonly direction_name?: string | null;
  readonly origin_name?: string | null;
  readonly destination_name?: string | null;
  readonly stop_sequence: number;
};

type PublicStopNextPreviewStopDto = {
  readonly stop_sequence: number;
  readonly id: string;
  readonly public_id: string;
  readonly display_name?: string;
  readonly name: string;
  readonly name_mm?: string | null;
  readonly name_en?: string | null;
  readonly lat: number;
  readonly lng: number;
};

type PublicStopNextPreviewGroupDto = {
  readonly route_id: string;
  readonly route_public_id: string;
  readonly route_code: string;
  readonly public_name?: string | null;
  readonly variant_id: string;
  readonly variant_public_id: string;
  readonly variant_code: string;
  readonly direction_name?: string | null;
  readonly destination_name?: string | null;
  readonly current_stop_sequence?: number;
  readonly stop_sequence: number;
  readonly next_stops?: readonly PublicStopNextPreviewStopDto[];
  readonly stops?: readonly PublicStopNextPreviewStopDto[];
};

type PublicTransportStopDetailDto = {
  readonly id: string;
  readonly publicId: string;
  readonly public_id?: string;
  readonly name?: string;
  readonly myanmar_name?: string | null;
  readonly english_name?: string | null;
  readonly name_mm?: string | null;
  readonly name_my?: string | null;
  readonly name_en?: string | null;
  readonly name_und?: string | null;
  readonly display_name?: string | null;
  readonly primary_name?: string | null;
  readonly canonical_name?: string | null;
  readonly stop_code?: string | null;
  readonly mode: string;
  readonly stop_type: string;
  readonly admin_area_name?: string | null;
  readonly lat: number;
  readonly lng: number;
  readonly isVerified: boolean;
  readonly verification_status?: string;
  readonly status_label?: string;
  readonly confidenceScore?: number | null;
  readonly route_count: number;
  readonly routes_serving_this_stop?: readonly PublicStopRouteServingDto[];
  readonly next_stops_preview?: readonly PublicStopNextPreviewGroupDto[];
  readonly address_line?: string | null;
  readonly plus_code?: string | null;
};

function trimOpt(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function routeServingFromDto(dto: PublicStopRouteServingDto): RouteServingStop {
  return {
    routeId: dto.route_id,
    routePublicId: dto.route_public_id,
    routeCode: dto.route_code,
    publicName: trimOpt(dto.public_name) ?? null,
    variantId: dto.variant_id,
    variantPublicId: dto.variant_public_id,
    variantCode: dto.variant_code,
    directionName: trimOpt(dto.direction_name) ?? null,
    originName: trimOpt(dto.origin_name) ?? null,
    destinationName: trimOpt(dto.destination_name) ?? null,
    stopSequence: dto.stop_sequence,
  };
}

function nextStopPreviewFromDto(dto: PublicStopNextPreviewGroupDto): NextStopPreview {
  const downstreamStops = dto.next_stops ?? dto.stops ?? [];
  return {
    routeId: dto.route_id,
    routePublicId: dto.route_public_id,
    routeCode: dto.route_code,
    publicName: trimOpt(dto.public_name) ?? null,
    variantId: dto.variant_id,
    variantPublicId: dto.variant_public_id,
    variantCode: dto.variant_code,
    directionName: trimOpt(dto.direction_name) ?? null,
    destinationName: trimOpt(dto.destination_name) ?? null,
    stopSequence: dto.current_stop_sequence ?? dto.stop_sequence,
    stops: downstreamStops.slice(0, 3).map((stop) => ({
      stopSequence: stop.stop_sequence,
      id: stop.id,
      publicId: stop.public_id,
      name:
        trimOpt(stop.display_name) ??
        trimOpt(stop.name) ??
        trimOpt(stop.name_en) ??
        trimOpt(stop.name_mm) ??
        'Stop',
      nameMm: trimOpt(stop.name_mm) ?? null,
      nameEn: trimOpt(stop.name_en) ?? null,
      latitude: stop.lat,
      longitude: stop.lng,
    })),
  };
}

function publicTransportStopToDetail(dto: PublicTransportStopDetailDto): TransportStopDetail {
  const mm = trimOpt(dto.name_my ?? dto.name_mm ?? dto.myanmar_name) ?? null;
  const en = trimOpt(dto.name_en ?? dto.english_name) ?? null;
  const und = trimOpt(dto.name_und) ?? null;
  const display = trimOpt(dto.display_name) ?? null;
  const primary = trimOpt(dto.primary_name) ?? null;
  const canonical = trimOpt(dto.canonical_name) ?? null;
  const resolvedName = display ?? trimOpt(dto.name) ?? primary ?? mm ?? en ?? und ?? canonical;

  return {
    id: dto.id,
    publicId: dto.publicId,
    name: resolvedName ?? `Stop:${dto.lng}:${dto.lat}`,
    nameMm: mm,
    nameEn: en,
    nameUnd: und,
    myanmarName: mm,
    englishName: en,
    displayName: display,
    primaryName: primary,
    canonicalName: canonical,
    stopCode: trimOpt(dto.stop_code) ?? null,
    mode: dto.mode,
    stopType: dto.stop_type,
    adminAreaName: trimOpt(dto.admin_area_name) ?? null,
    latitude: dto.lat,
    longitude: dto.lng,
    isVerified: dto.isVerified,
    ...(trimOpt(dto.verification_status) !== undefined
      ? { verificationStatus: trimOpt(dto.verification_status) }
      : {}),
    ...(trimOpt(dto.status_label) !== undefined ? { statusLabel: trimOpt(dto.status_label) } : {}),
    confidenceScore:
      typeof dto.confidenceScore === 'number' && Number.isFinite(dto.confidenceScore)
        ? dto.confidenceScore
        : null,
    routeCount: dto.route_count,
    ...(dto.routes_serving_this_stop !== undefined
      ? { routesServingThisStop: dto.routes_serving_this_stop.map(routeServingFromDto) }
      : {}),
    ...(dto.next_stops_preview !== undefined
      ? { nextStopsPreview: dto.next_stops_preview.map(nextStopPreviewFromDto) }
      : {}),
    addressLine: trimOpt(dto.address_line),
    plusCode: trimOpt(dto.plus_code) ?? null,
  };
}

/**
 * Fetch public transport stop/station/terminal detail for the web map detail panel.
 * Lookup accepts uuid public_id (preferred) or internal numeric id from tile features.
 *
 * The response embeds `routesServingThisStop` and `nextStopsPreview` straight from
 * `GET /public/transport/stops/:id`; the frontend never fabricates them.
 */
export async function getTransportStopDetail(
  idOrPublicId: string,
  options?: { lang?: 'my' | 'en' | 'und'; signal?: AbortSignal },
): Promise<TransportStopDetail> {
  const trimmedId = idOrPublicId.trim();
  if (trimmedId === '') {
    throw new Error('Missing transport stop id');
  }

  const search = new URLSearchParams();
  if (options?.lang) {
    search.set('lang', options.lang);
  }
  const query = search.toString();
  const path = `/public/transport/stops/${encodeURIComponent(trimmedId)}${query ? `?${query}` : ''}`;

  const dto = await publicGet<PublicTransportStopDetailDto>(path, options?.signal);

  return publicTransportStopToDetail(dto);
}

type PublicTransportTerminalDetailDto = PublicTransportStopDetailDto & {
  readonly entity_type: 'terminal';
  readonly terminal_role: string;
  readonly terminal_code?: string | null;
};

function publicTransportTerminalToDetail(dto: PublicTransportTerminalDetailDto): TransportStopDetail {
  const mm = trimOpt(dto.name_my ?? dto.name_mm ?? dto.myanmar_name) ?? null;
  const en = trimOpt(dto.name_en ?? dto.english_name) ?? null;
  const und = trimOpt(dto.name_und) ?? null;
  const display = trimOpt(dto.display_name) ?? null;
  const primary = trimOpt(dto.primary_name) ?? null;
  const canonical = trimOpt(dto.canonical_name) ?? null;
  const resolvedName = display ?? trimOpt(dto.name) ?? primary ?? mm ?? en ?? und ?? canonical;

  return {
    id: dto.id,
    publicId: dto.publicId,
    name: resolvedName ?? `Terminal:${dto.lng}:${dto.lat}`,
    nameMm: mm,
    nameEn: en,
    nameUnd: und,
    myanmarName: mm,
    englishName: en,
    displayName: display,
    primaryName: primary,
    canonicalName: canonical,
    stopCode: trimOpt(dto.terminal_code) ?? null,
    mode: dto.mode,
    stopType: trimOpt(dto.terminal_role) ?? 'terminal',
    adminAreaName: trimOpt(dto.admin_area_name) ?? null,
    latitude: dto.lat,
    longitude: dto.lng,
    isVerified: dto.isVerified,
    ...(trimOpt(dto.verification_status) !== undefined
      ? { verificationStatus: trimOpt(dto.verification_status) }
      : {}),
    ...(trimOpt(dto.status_label) !== undefined ? { statusLabel: trimOpt(dto.status_label) } : {}),
    confidenceScore:
      typeof dto.confidenceScore === 'number' && Number.isFinite(dto.confidenceScore)
        ? dto.confidenceScore
        : null,
    routeCount: dto.route_count,
    ...(dto.routes_serving_this_stop !== undefined
      ? { routesServingThisStop: dto.routes_serving_this_stop.map(routeServingFromDto) }
      : {}),
    addressLine: trimOpt(dto.address_line),
    plusCode: trimOpt(dto.plus_code) ?? null,
  };
}

/**
 * Fetch public transport terminal detail for the web map detail panel.
 */
export async function getTransportTerminalDetail(
  idOrPublicId: string,
  options?: { lang?: 'my' | 'en' | 'und'; signal?: AbortSignal },
): Promise<TransportStopDetail> {
  const trimmedId = idOrPublicId.trim();
  if (trimmedId === '') {
    throw new Error('Missing transport terminal id');
  }

  const search = new URLSearchParams();
  if (options?.lang) {
    search.set('lang', options.lang);
  }
  const query = search.toString();
  const path = `/public/transport/terminals/${encodeURIComponent(trimmedId)}${query ? `?${query}` : ''}`;

  const dto = await publicGet<PublicTransportTerminalDetailDto>(path, options?.signal);

  return publicTransportTerminalToDetail(dto);
}

export type PublicTransportStopRouteUsage = {
  readonly routeCode: string;
  readonly routeNameMm: string | null;
  readonly routeNameEn: string | null;
  readonly variantCode: string;
  readonly directionName: string | null;
  readonly stopSequence: number;
};

export type PublicTransportStopRoutesResult = {
  readonly items: readonly PublicTransportStopRouteUsage[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
};

type PublicTransportStopRouteUsageDto = {
  readonly route_code: string;
  readonly route_name_my?: string | null;
  readonly route_name_en?: string | null;
  readonly variant_code: string;
  readonly direction_name?: string | null;
  readonly stop_sequence: number;
};

type PublicTransportStopRoutesResponseDto = {
  readonly items: readonly PublicTransportStopRouteUsageDto[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
};

function publicTransportStopRouteFromDto(
  dto: PublicTransportStopRouteUsageDto,
): PublicTransportStopRouteUsage {
  return {
    routeCode: dto.route_code,
    routeNameMm: trimOpt(dto.route_name_my) ?? null,
    routeNameEn: trimOpt(dto.route_name_en) ?? null,
    variantCode: dto.variant_code,
    directionName: trimOpt(dto.direction_name) ?? null,
    stopSequence: dto.stop_sequence,
  };
}

/** Public route variants that serve this stop (uuid public_id only). */
export async function fetchPublicTransportStopRoutes(
  publicId: string,
  signal?: AbortSignal,
  limit = 25,
): Promise<PublicTransportStopRoutesResult> {
  const trimmedId = publicId.trim();
  if (trimmedId === '') {
    throw new Error('Missing transport stop public id');
  }

  const search = new URLSearchParams({
    limit: String(limit),
    offset: '0',
  });

  const dto = await publicGet<PublicTransportStopRoutesResponseDto>(
    `/transport/stops/${encodeURIComponent(trimmedId)}/routes?${search.toString()}`,
    signal,
  );

  return {
    items: dto.items.map(publicTransportStopRouteFromDto),
    total: dto.total,
    limit: dto.limit,
    offset: dto.offset,
  };
}
