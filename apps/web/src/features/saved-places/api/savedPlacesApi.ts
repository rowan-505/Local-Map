import { authJson } from '@/features/auth/api/http';

export type SavedEntityType = 'place' | 'map_point';

/** Unified saved item: a core place or an arbitrary saved map point. */
export type SavedPlace = {
  readonly id: string;
  readonly entity_type: SavedEntityType;
  /** core_places.id for places; null for map points. */
  readonly entity_id: string | null;
  readonly display_name: string | null;
  readonly custom_name: string | null;
  readonly category: {
    readonly code: string;
    readonly name: string;
  } | null;
  readonly address_line: string | null;
  readonly plus_code: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly admin_area_id: string | null;
  readonly created_at: string;
};

export type CreateMapPointInput = {
  readonly customName?: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly addressLine?: string;
  readonly plusCode?: string;
  readonly adminAreaId?: number;
};

export async function listSavedPlaces(signal?: AbortSignal): Promise<readonly SavedPlace[]> {
  return authJson<SavedPlace[]>('/me/saved-places', signal ? { signal } : {});
}

export async function createSavedPlace(placeId: number): Promise<SavedPlace> {
  return authJson<SavedPlace>('/me/saved-places', {
    method: 'POST',
    body: { entityType: 'place', entityId: placeId },
  });
}

export async function createSavedMapPoint(input: CreateMapPointInput): Promise<SavedPlace> {
  return authJson<SavedPlace>('/me/saved-places', {
    method: 'POST',
    body: {
      entityType: 'map_point',
      latitude: input.latitude,
      longitude: input.longitude,
      ...(input.customName ? { customName: input.customName } : {}),
      ...(input.addressLine ? { addressLine: input.addressLine } : {}),
      ...(input.plusCode ? { plusCode: input.plusCode } : {}),
      ...(input.adminAreaId !== undefined ? { adminAreaId: input.adminAreaId } : {}),
    },
  });
}

export async function deleteSavedPlace(savedId: string): Promise<void> {
  await authJson<void>(`/me/saved-places/${encodeURIComponent(savedId)}`, {
    method: 'DELETE',
  });
}
