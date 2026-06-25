import { useCallback, useMemo } from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useAuth } from '@/features/auth/state/useAuth';
import {
  createSavedMapPoint,
  createSavedPlace,
  deleteSavedPlace,
  listSavedPlaces,
  type CreateMapPointInput,
  type SavedPlace,
} from '../api/savedPlacesApi';

const SAVED_PLACES_QUERY_KEY = ['saved-places'] as const;

export type UseSavedPlacesResult = {
  readonly items: readonly SavedPlace[];
  readonly loading: boolean;
  readonly error: boolean;
  readonly isMutating: boolean;
  /** True if the place (by numeric place id) is currently saved. */
  readonly isSaved: (placeApiId: string | undefined) => boolean;
  /** Save a place by its numeric place id. Returns the created row. */
  readonly save: (placeApiId: string) => Promise<SavedPlace>;
  /** Save an arbitrary map point (clicked location). */
  readonly saveMapPoint: (input: CreateMapPointInput) => Promise<SavedPlace>;
  /** Remove the saved place matching the numeric place id, if present. */
  readonly unsaveByPlaceId: (placeApiId: string) => Promise<void>;
  readonly removeSaved: (savedId: string) => Promise<void>;
};

export function useSavedPlaces(): UseSavedPlacesResult {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: SAVED_PLACES_QUERY_KEY,
    queryFn: ({ signal }) => listSavedPlaces(signal),
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const savedByPlaceId = useMemo(() => {
    const map = new Map<string, SavedPlace>();
    for (const item of query.data ?? []) {
      if (item.entity_type === 'place' && item.entity_id) {
        map.set(item.entity_id, item);
      }
    }
    return map;
  }, [query.data]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: SAVED_PLACES_QUERY_KEY });
  }, [queryClient]);

  const saveMutation = useMutation({
    mutationFn: (placeApiId: string) => createSavedPlace(Number(placeApiId)),
    onSuccess: invalidate,
  });

  const saveMapPointMutation = useMutation({
    mutationFn: (input: CreateMapPointInput) => createSavedMapPoint(input),
    onSuccess: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: (savedId: string) => deleteSavedPlace(savedId),
    onSuccess: invalidate,
  });

  const isSaved = useCallback(
    (placeApiId: string | undefined) =>
      placeApiId !== undefined && savedByPlaceId.has(placeApiId),
    [savedByPlaceId],
  );

  const save = useCallback(
    (placeApiId: string) => saveMutation.mutateAsync(placeApiId),
    [saveMutation],
  );

  const saveMapPoint = useCallback(
    (input: CreateMapPointInput) => saveMapPointMutation.mutateAsync(input),
    [saveMapPointMutation],
  );

  const removeSaved = useCallback(
    (savedId: string) => deleteMutation.mutateAsync(savedId),
    [deleteMutation],
  );

  const unsaveByPlaceId = useCallback(
    async (placeApiId: string) => {
      const existing = savedByPlaceId.get(placeApiId);
      if (existing) {
        await deleteMutation.mutateAsync(existing.id);
      }
    },
    [deleteMutation, savedByPlaceId],
  );

  return {
    items: query.data ?? [],
    loading: query.isLoading,
    error: query.isError,
    isMutating:
      saveMutation.isPending ||
      saveMapPointMutation.isPending ||
      deleteMutation.isPending,
    isSaved,
    save,
    saveMapPoint,
    unsaveByPlaceId,
    removeSaved,
  };
}
