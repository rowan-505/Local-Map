import { useCallback, useMemo, useState } from 'react';
import { FilterBar } from '@/features/filters/components/FilterBar';
import { useDebouncedValue } from '@/features/filters/useDebouncedValue';
import { useCategoryFilter } from '@/features/filters/useCategoryFilter';
import MapView from '@/features/map/components/MapView';
import {
  usePublicCategories,
  usePublicPlace,
  usePublicPlaces,
} from '@/features/poi/api/usePublicMapData';
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
  const debouncedSearchQuery = useDebouncedValue(filterState.searchQuery, 300);

  const categoriesQuery = usePublicCategories();
  const placesQuery = usePublicPlaces({
    q: debouncedSearchQuery,
    categoryId: filterState.categoryId ?? undefined,
    limit: 500,
  });

  const places = useMemo(() => placesQuery.data ?? [], [placesQuery.data]);
  const selectedIdInResults =
    selectedPoiId !== null && places.some((place) => place.id === selectedPoiId);
  const effectiveSelectedPoiId =
    selectedIdInResults ? selectedPoiId : places.length === 1 ? places[0]?.id ?? null : null;
  const selectedListPoi = useMemo(
    () => places.find((place) => place.id === effectiveSelectedPoiId),
    [effectiveSelectedPoiId, places],
  );
  const selectedPlaceQuery = usePublicPlace(effectiveSelectedPoiId);
  const selectedPoi = selectedPlaceQuery.data ?? selectedListPoi;

  const selectedPoiIdForMap = selectedListPoi?.id ?? null;

  const onSelectPoiId = useCallback((id: string | null) => {
    setSelectedPoiId(id);
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
          categoriesLoading={categoriesQuery.isLoading}
          categoriesError={categoriesQuery.isError}
        />
      }
      map={
        <MapView
          pois={places}
          selectedPoiId={selectedPoiIdForMap}
          selectedPoi={selectedListPoi}
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
        />
      }
    />
  );
}
