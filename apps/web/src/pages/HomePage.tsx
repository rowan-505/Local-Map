/**
 * Home route: map + Places sidebar both use `visiblePois` from normalized Kyauktan OSM (`MVP_POI_DATA`).
 * Same `selectedPoiId` / `onSelectPoiId` for map clicks and list clicks.
 */
import { useCallback, useMemo, useState } from 'react';
import { MVP_POI_DATA } from '@/data/poi/mvpPoiSource';
import { filterPois } from '@/features/filters/filterPois';
import { FilterBar } from '@/features/filters/components/FilterBar';
import { useCategoryFilter } from '@/features/filters/useCategoryFilter';
import MapView from '@/features/map/components/MapView';
import { PoiPanel } from '@/features/poi/components/PoiPanel';
import { selectPoiFromVisible } from '@/features/poi/selectPoi';
import { HomePageLayout } from './HomePageLayout';

export default function HomePage() {
  const {
    filterState,
    excludedCategoryIds,
    toggleCategory,
    searchQuery,
    setSearchQuery,
  } = useCategoryFilter();
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);

  /** One derived list: normalized Kyauktan OSM (`MVP_POI_DATA`) → category filter → substring search. */
  const visiblePois = useMemo(() => filterPois(MVP_POI_DATA, filterState), [filterState]);

  /** Single derivation: filtered-out POIs yield `undefined` → map gets no selection id. */
  const selectedPoi = useMemo(
    () => selectPoiFromVisible(visiblePois, selectedPoiId),
    [visiblePois, selectedPoiId],
  );

  const selectedPoiIdForMap = selectedPoi?.id ?? null;

  const onSelectPoiId = useCallback((id: string | null) => {
    setSelectedPoiId(id);
  }, []);

  return (
    <HomePageLayout
      filter={
        <FilterBar
          excludedCategoryIds={excludedCategoryIds}
          onToggleCategory={toggleCategory}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
        />
      }
      map={
        <MapView
          pois={visiblePois}
          selectedPoiId={selectedPoiIdForMap}
          onSelectPoiId={onSelectPoiId}
        />
      }
      sidebar={
        <PoiPanel
          pois={visiblePois}
          selectedPoi={selectedPoi}
          onSelectPoiId={onSelectPoiId}
        />
      }
    />
  );
}
