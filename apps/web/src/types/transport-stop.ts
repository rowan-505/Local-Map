/**
 * Route variant that serves a transport stop — from the public stop detail API.
 */
export type RouteServingStop = {
  readonly routeId: string;
  readonly routePublicId: string;
  readonly routeCode: string;
  readonly publicName: string | null;
  readonly variantId: string;
  readonly variantPublicId: string;
  readonly variantCode: string;
  readonly directionName: string | null;
  readonly originName: string | null;
  readonly destinationName: string | null;
  readonly stopSequence: number;
};

/** A single downstream stop inside a next-stops preview group. */
export type NextStopPreviewStop = {
  readonly stopSequence: number;
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
  readonly nameMm: string | null;
  readonly nameEn: string | null;
  readonly latitude: number;
  readonly longitude: number;
};

/**
 * Next 1–3 stops after the selected stop on one serving route variant.
 */
export type NextStopPreview = {
  readonly routeId: string;
  readonly routePublicId: string;
  readonly routeCode: string;
  readonly publicName: string | null;
  readonly variantId: string;
  readonly variantPublicId: string;
  readonly variantCode: string;
  readonly directionName: string | null;
  readonly destinationName: string | null;
  /** Sequence of the selected stop on this variant. */
  readonly stopSequence: number;
  readonly stops: readonly NextStopPreviewStop[];
};

/**
 * Public transport stop detail — API-backed fields for map detail panels.
 *
 * Fields marked "single stop detail responses" are absent on tile-preview
 * objects built from map features; do not fabricate them in the frontend.
 */
export type TransportStopDetail = {
  readonly id: string;
  readonly publicId: string;
  readonly name: string;
  readonly nameMm: string | null;
  readonly nameEn: string | null;
  readonly nameUnd: string | null;
  readonly myanmarName: string | null;
  readonly englishName: string | null;
  readonly displayName: string | null;
  readonly primaryName: string | null;
  readonly canonicalName: string | null;
  readonly stopCode: string | null;
  readonly mode: string;
  readonly stopType: string;
  readonly adminAreaName: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly isVerified: boolean;
  readonly confidenceScore: number | null;
  readonly routeCount: number;
  /** Raw review status (e.g. reviewed/verified) — present only on single stop detail responses. */
  readonly verificationStatus?: string;
  /** Human-readable status label — present only on single stop detail responses. */
  readonly statusLabel?: string;
  /** Route variants serving this stop — present only on single stop detail responses. */
  readonly routesServingThisStop?: readonly RouteServingStop[];
  /** Downstream stop preview per variant — present only on single stop detail responses. */
  readonly nextStopsPreview?: readonly NextStopPreview[];
  /** Composed reverse-address line — present only on single stop detail responses. */
  readonly addressLine?: string;
  /** Dynamically generated Plus Code — present only on single stop detail responses. */
  readonly plusCode?: string | null;
};
