import type { NextStopPreview, NextStopPreviewStop } from '@/types';

export const MAX_NEXT_STOPS_PREVIEW = 3;

export function capNextStopPreviewStops(
  stops: readonly NextStopPreviewStop[],
): readonly NextStopPreviewStop[] {
  return stops.slice(0, MAX_NEXT_STOPS_PREVIEW);
}

/** True when at least one variant has downstream stops to show. */
export function hasNextStopsPreviewContent(previews: readonly NextStopPreview[]): boolean {
  return previews.some((group) => group.stops.length > 0);
}

export function formatPreviewRouteTitle(
  routeCode: string,
  publicName: string | null | undefined,
): string {
  const trimmedPublicName = publicName?.trim();
  return trimmedPublicName && trimmedPublicName !== routeCode
    ? `${routeCode} · ${trimmedPublicName}`
    : routeCode;
}

export function formatPreviewDirectionLabel(group: NextStopPreview): string | null {
  const direction = group.directionName?.trim() ?? null;
  const destination = group.destinationName?.trim() ?? null;

  if (direction && destination) {
    return `${direction} · ${destination}`;
  }

  return direction ?? destination;
}
