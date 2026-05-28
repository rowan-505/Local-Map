/**
 * Public routing API types — aligned with apps/api `routing.types` / `routing.schema`.
 * Frontend must only use normalized shapes (no Valhalla/OTP payloads).
 */

export const ROUTING_ROUTE_PROFILE_CODES = [
  'walk',
  'car',
  'motorcycle',
  'multimodal',
] as const;
export type RoutingRouteProfileCode = (typeof ROUTING_ROUTE_PROFILE_CODES)[number];

export const ROUTING_ROUTE_PREFERENCE_CODES = ['fastest', 'shortest', 'balanced'] as const;
export type RoutingRoutePreferenceCode = (typeof ROUTING_ROUTE_PREFERENCE_CODES)[number];

export const ROUTING_ROUTE_STATUS_CODES = ['ok', 'no_route', 'error'] as const;
export type RoutingRouteStatusCode = (typeof ROUTING_ROUTE_STATUS_CODES)[number];

export const ROUTING_ENGINE_CODES = ['valhalla', 'otp', 'external', 'mock'] as const;
export type RoutingEngineCode = (typeof ROUTING_ENGINE_CODES)[number];

export const ROUTING_LEG_MODE_CODES = [
  'road',
  'walk',
  'transit',
  'transfer',
  'wait',
  'air',
] as const;
export type RoutingLegModeCode = (typeof ROUTING_LEG_MODE_CODES)[number];

export const ROUTING_FEEDBACK_PROBLEM_TYPES = [
  'wrong_route',
  'missing_road',
  'road_closed',
  'bad_oneway',
  'bad_motorbike_route',
  'bad_walk_route',
  'dangerous_route',
  'bad_eta',
  'cannot_route',
  'other',
] as const;
export type RoutingFeedbackProblemType = (typeof ROUTING_FEEDBACK_PROBLEM_TYPES)[number];

export type RouteWaypoint = {
  readonly lat: number;
  readonly lng: number;
  readonly label?: string;
};

export type RouteRequestPayload = {
  readonly origin: RouteWaypoint;
  readonly destination: RouteWaypoint;
  readonly profile: RoutingRouteProfileCode;
  readonly allowedModes?: readonly string[];
  readonly excludedModes?: readonly string[];
  readonly serviceClasses?: readonly string[];
  readonly preference?: RoutingRoutePreferenceCode;
  readonly departureTime?: string | null;
  readonly maxWalkMeters?: number;
  readonly maxTransfers?: number;
};

export type RouteGeoJsonLineString = {
  readonly type: 'LineString';
  readonly coordinates: readonly (readonly [number, number])[];
};

export type RouteSummary = {
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly transferCount: number;
};

export type RouteLegTransitDetails = {
  readonly agencyName?: string;
  readonly routeShortName?: string;
  readonly routeLongName?: string;
  readonly headsign?: string;
  readonly serviceClass?: string;
  readonly physicalMode?: string;
};

export type RouteLeg = {
  readonly mode: RoutingLegModeCode;
  readonly profile?: RoutingRouteProfileCode | string;
  readonly physicalMode?: string;
  readonly serviceClass?: string;
  readonly distanceMeters: number;
  readonly durationSeconds: number;
  readonly from: RouteWaypoint;
  readonly to: RouteWaypoint;
  readonly geometry?: RouteGeoJsonLineString | null;
  readonly transit?: RouteLegTransitDetails | null;
  readonly instructions?: readonly string[];
};

export type RouteResponseDebug = {
  readonly buildCode?: string;
  readonly requestId?: string;
};

export type RouteResponse = {
  readonly status: RoutingRouteStatusCode;
  readonly routingEngine: RoutingEngineCode;
  readonly profile: string;
  readonly summary: RouteSummary;
  readonly geometry: RouteGeoJsonLineString | null;
  readonly legs: readonly RouteLeg[];
  readonly warnings: readonly string[];
  readonly debug?: RouteResponseDebug;
};

export type RoutingPublicProfile = {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly isPublicEnabled: boolean;
  readonly isRoutingEnabled: boolean;
  readonly sortOrder: number;
  readonly primaryPhysicalModeCode: string | null;
  readonly source: 'database' | 'env';
};

export type RoutingProfilesResponse = {
  readonly profiles: readonly RoutingPublicProfile[];
  readonly source: 'database' | 'env';
};

export type RoutingEngineHealthStatus = 'healthy' | 'degraded' | 'down' | 'unknown';

export type RoutingEngineHealth = {
  readonly engine: 'valhalla' | 'otp' | 'external';
  readonly status: RoutingEngineHealthStatus;
  readonly latencyMs?: number;
  readonly message?: string;
  readonly checkedAt: string;
};

export type RoutingHealthResponse = {
  readonly routingEnabled: boolean;
  readonly defaultEngine: string;
  readonly configuredPublicProfiles: readonly string[];
  readonly activeEngine: string;
  readonly engineHealth: RoutingEngineHealth | null;
};

export type RoutingFeedbackPayload = {
  readonly requestId?: string;
  readonly origin: Pick<RouteWaypoint, 'lat' | 'lng'>;
  readonly destination: Pick<RouteWaypoint, 'lat' | 'lng'>;
  readonly profile: RoutingRouteProfileCode;
  readonly problemType: RoutingFeedbackProblemType;
  readonly message?: string;
};

export type RoutingFeedbackResponse = {
  readonly publicId: string;
  readonly status: string;
  readonly stored: boolean;
};
