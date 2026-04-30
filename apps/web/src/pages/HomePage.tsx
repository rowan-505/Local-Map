import { useCallback, useMemo, useState } from 'react';
import { FilterBar } from '@/features/filters/components/FilterBar';
import { useDebouncedValue } from '@/features/filters/useDebouncedValue';
import { useCategoryFilter } from '@/features/filters/useCategoryFilter';
import MapView from '@/features/map/components/MapView';
import {
  usePublicCategories,
  usePublicPlace,
  usePublicPlaces,
  usePublicSearch,
} from '@/features/poi/api/usePublicMapData';
import type {
  PublicSearchResult,
  SearchCameraTarget,
} from '@/features/poi/api/publicMapApi';
import { PoiPanel } from '@/features/poi/components/PoiPanel';
import { HomePageLayout } from './HomePageLayout';

export default function HomePage() {
  const {
    filterState,
    categoryId,
    selectCategory,
    searchQuery,
    setSearchQuery,
  } = useCategoryFilter();
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [selectedSearchResult, setSelectedSearchResult] =
    useState<PublicSearchResult | null>(null);
  const [cameraTarget, setCameraTarget] = useState<SearchCameraTarget | undefined>();
  const debouncedSearchQuery = useDebouncedValue(filterState.searchQuery, 300);

  const categoriesQuery = usePublicCategories();
  const placesQuery = usePublicPlaces({
    categoryId: filterState.categoryId ?? undefined,
    limit: 500,
  });
  const searchResultsQuery = usePublicSearch(debouncedSearchQuery);

  const places = useMemo(() => placesQuery.data ?? [], [placesQuery.data]);
  const selectedSearchPlaceId =
    selectedSearchResult?.type === 'place'
      ? selectedSearchResult.publicId ?? selectedSearchResult.id
      : null;
  const selectedIdInResults =
    selectedPoiId !== null && places.some((place) => place.id === selectedPoiId);
  const effectiveSelectedPoiId =
    selectedSearchPlaceId ??
    (selectedIdInResults ? selectedPoiId : places.length === 1 ? places[0]?.id ?? null : null);
  const selectedListPoi = useMemo(
    () => places.find((place) => place.id === effectiveSelectedPoiId),
    [effectiveSelectedPoiId, places],
  );
  const selectedPlaceQuery = usePublicPlace(effectiveSelectedPoiId);
  const selectedPoi = selectedPlaceQuery.data ?? selectedListPoi;

  const selectedPoiIdForMap = selectedPoi?.id ?? effectiveSelectedPoiId;

  const onSelectPoiId = useCallback((id: string | null) => {
    setSelectedPoiId(id);
    setSelectedSearchResult(null);
    setCameraTarget(undefined);
  }, []);

  const onSelectSearchResult = useCallback((result: PublicSearchResult) => {
    setSelectedSearchResult(result);

    if (result.type === 'place') {
      setSelectedPoiId(result.publicId ?? result.id);
    } else {
      setSelectedPoiId(null);
    }

    setCameraTarget(cameraTargetForSearchResult(result));
  }, []);

  const onClearSearch = useCallback(() => {
    setSearchQuery('');
    setSelectedSearchResult(null);
    setCameraTarget(undefined);
  }, [setSearchQuery]);

  const onZoomToSearchResult = useCallback((result: PublicSearchResult) => {
    setCameraTarget(cameraTargetForSearchResult(result));
  }, []);

  return (
    <HomePageLayout
      filter={
        <FilterBar
          categories={categoriesQuery.data ?? []}
          selectedCategoryId={categoryId}
          onSelectCategory={selectCategory}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchResults={searchResultsQuery.data ?? []}
          selectedSearchResultId={selectedSearchResult?.id ?? null}
          onSelectSearchResult={onSelectSearchResult}
          onClearSearch={onClearSearch}
          searchLoading={searchResultsQuery.isLoading}
          searchError={searchResultsQuery.isError}
          categoriesLoading={categoriesQuery.isLoading}
          categoriesError={categoriesQuery.isError}
        />
      }
      map={
        <MapView
          pois={places}
          selectedPoiId={selectedPoiIdForMap}
          selectedPoi={selectedListPoi}
          cameraTarget={cameraTarget}
          onSelectPoiId={onSelectPoiId}
        />
      }
      sidebar={
        <PoiPanel
          pois={places}
          selectedPoi={selectedPoi}
          onSelectPoiId={onSelectPoiId}
          isLoading={placesQuery.isLoading}
          error={placesQuery.error}
          detailLoading={selectedPlaceQuery.isLoading}
          detailError={selectedPlaceQuery.error}
          selectedSearchResult={selectedSearchResult}
          onZoomToSearchResult={onZoomToSearchResult}
        />
      }
    />
  );
}

function cameraTargetForSearchResult(result: PublicSearchResult): SearchCameraTarget | undefined {
  if (result.cameraTarget?.type === 'point') {
    return {
      type: 'point',
      center: result.cameraTarget.center,
      zoom: result.cameraTarget.zoom ?? 16,
      duration: 900,
    };
  }

  if (result.cameraTarget?.type === 'bounds' && result.cameraTarget.bbox) {
    return {
      type: 'bounds',
      bbox: result.cameraTarget.bbox,
      padding: result.cameraTarget.padding ?? 80,
      duration: 900,
    };
  }

  if (typeof result.lng === 'number' && typeof result.lat === 'number') {
    return {
      type: 'point',
      center: [result.lng, result.lat],
      zoom: result.type === 'street' ? 15 : 16,
      duration: 900,
    };
  }

  if (result.center) {
    return {
      type: 'point',
      center: result.center,
      zoom: result.type === 'street' ? 15 : 16,
      duration: 900,
    };
  }

  if (result.bbox) {
    return {
      type: 'bounds',
      bbox: result.bbox,
      padding: 80,
      duration: 900,
    };
  }

  return undefined;
}
