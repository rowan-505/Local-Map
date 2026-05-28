import type { RouteResponse } from '@/features/routing/types';

const MAX_MESSAGE_LENGTH = 4000;

/** User detail plus compact auto-attached route context (stored in API `message`). */
export function buildRoutingFeedbackMessage(
  detail: string,
  routeResult: RouteResponse | null,
): string {
  const trimmed = detail.trim();
  if (!routeResult) return trimmed.slice(0, MAX_MESSAGE_LENGTH);

  const context: Record<string, unknown> = {
    routeStatus: routeResult.status,
    profile: routeResult.profile,
    routingEngine: routeResult.routingEngine,
    distanceMeters: routeResult.summary.distanceMeters,
    durationSeconds: routeResult.summary.durationSeconds,
    transferCount: routeResult.summary.transferCount,
  };

  if (routeResult.debug?.requestId) {
    context.requestId = routeResult.debug.requestId;
  }

  const geometry = routeResult.geometry;
  if (geometry && geometry.coordinates.length >= 2) {
    const coords = geometry.coordinates;
    context.geometryPointCount = coords.length;
    context.geometryStart = coords[0];
    context.geometryEnd = coords[coords.length - 1];
  }

  const footer = `\n\n---\n[route-context]\n${JSON.stringify(context)}`;
  const maxDetailLength = Math.max(0, MAX_MESSAGE_LENGTH - footer.length);
  return `${trimmed.slice(0, maxDetailLength)}${footer}`;
}
