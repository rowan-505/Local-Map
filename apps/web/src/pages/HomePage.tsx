import { useCallback, useMemo, useState } from 'react';
import { SearchPanel } from '@/features/filters/components/SearchPanel';
import { useDebouncedValue } from '@/features/filters/useDebouncedValue';
import { useCategoryFilter } from '@/features/filters/useCategoryFilter';
import { AddressLocationPanel } from '@/features/map/components/AddressLocationPanel';
import { MapFloatingControls } from '@/features/map/components/MapFloatingControls';
import { MapLeftRail } from '@/features/map/components/MapLeftRail';
import {
  BusPanelPlaceholder,
  type BottomSheetState,
  MapSidebar,
  MorePanelPlaceholder,
  type RouteDestination,
  SavedPanelPlaceholder,
  type SidebarMode,
} from '@/features/map/components/MapSidebar';
import MapView from '@/features/map/components/MapView';
import {
  RoutePlannerPanel,
  type RouteDraft,
  type RoutePoint,
} from '@/features/map/components/RoutePlannerPanel';
import { useMapUiStore } from '@/features/map/state/mapUiStore';
import type { MapClickedLocation } from '@/features/map/types';
import type { MapViewportState } from '@/features/map/types';
import {
  usePublicCategories,
  usePublicMapPlaces,
  usePublicPlace,
  usePublicSearch,
} from '@/features/poi/api/usePublicMapData';
import type {
  PublicMapPlacesResult,
  PublicSearchResult,
  SearchCameraTarget,
} from '@/features/poi/api/publicMapApi';
import { PlaceDetailPanel } from '@/features/poi/components/PlaceDetailPanel';
import type { Poi } from '@/types';
import { MapShell, MapViewport } from './HomePageLayout';

export default function HomePage() {
  const {
    filterState,
    categoryCode,
    selectCategory,
    searchQuery,
    setSearchQuery,
  } = useCategoryFilter();
  const languageMode = useMapUiStore((s) => s.languageMode);
  const setLanguageMode = useMapUiStore((s) => s.setLanguageMode);

  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [selectedSearchResult, setSelectedSearchResult] =
    useState<PublicSearchResult | null>(null);
  const [cameraTarget, setCameraTarget] = useState<SearchCameraTarget | undefined>();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeSidebarMode, setActiveSidebarMode] = useState<SidebarMode>('search');
  const [bottomSheetState, setBottomSheetState] = useState<BottomSheetState>('half');
  const [mapViewport, setMapViewport] = useState<MapViewportState | null>(null);
  const [routeDestination, setRouteDestination] = useState<RouteDestination | null>(null);
  const [routeDraft, setRouteDraft] = useState<RouteDraft>({
    from: null,
    to: null,
    profile: 'motorbike',
  });
  const [clickedLocation, setClickedLocation] = useState<MapClickedLocation | null>(null);
  const debouncedSearchQuery = useDebouncedValue(filterState.searchQuery, 300);
  const debouncedMapViewport = useDebouncedValue(mapViewport, 250);

  const categoriesQuery = usePublicCategories();
  const viewportPlaceLimit = mapPlaceLimitForZoom(debouncedMapViewport?.zoom);
  const mapPlacesParams = useMemo(
    () =>
      debouncedMapViewport
        ? {
            bbox: debouncedMapViewport.bbox,
            zoom: debouncedMapViewport.zoom,
            categoryCode: filterState.categoryCode ?? undefined,
            limit: viewportPlaceLimit,
            offset: 0,
          }
        : null,
    [debouncedMapViewport, filterState.categoryCode, viewportPlaceLimit],
  );
  const placesQuery = usePublicMapPlaces(mapPlacesParams);
  const searchResultsQuery = usePublicSearch(debouncedSearchQuery);

  const places = useMemo(
    () =>
      placesQuery.isError && placesQuery.data === undefined
        ? []
        : combineUniqueViewportPlaces(placesQuery.data?.pages),
    [placesQuery.data, placesQuery.isError],
  );
  const visiblePlacesCount = places.length;
  const placesInitialError =
    placesQuery.isError && placesQuery.data === undefined ? placesQuery.error : null;
  const placesLoadMoreError =
    placesQuery.isError && placesQuery.data !== undefined ? placesQuery.error : null;
  const selectedSearchPlaceId =
    selectedSearchResult?.type === 'place'
      ? selectedSearchResult.publicId ?? selectedSearchResult.id
      : null;
  const effectiveSelectedPoiId =
    selectedSearchPlaceId ?? (selectedPoiId !== null ? selectedPoiId : null);
  const selectedListPoi = useMemo(
    () => places.find((place) => place.id === effectiveSelectedPoiId),
    [effectiveSelectedPoiId, places],
  );
  const selectedPlaceQuery = usePublicPlace(effectiveSelectedPoiId);
  const selectedPoi = selectedPlaceQuery.data ?? selectedListPoi;

  const selectedPoiIdForMap = selectedPoi?.id ?? effectiveSelectedPoiId;
  const mapPlaces = useMemo(
    () => combinePlacesForMap(places, selectedPoi),
    [places, selectedPoi],
  );
  const mapCameraLayout = useMemo(
    () => ({ isSidebarOpen, bottomSheetState }),
    [bottomSheetState, isSidebarOpen],
  );

  const onSelectPoiId = useCallback((id: string | null) => {
    setSelectedPoiId(id);
    setSelectedSearchResult(null);

    if (id !== null) {
      setClickedLocation(null);
      const place = places.find((candidate) => candidate.id === id);
      setCameraTarget(
        place
          ? {
              type: 'point',
              center: [place.longitude, place.latitude],
              zoom: 16,
              duration: 700,
            }
          : undefined,
      );
      setActiveSidebarMode('placeDetail');
      setIsSidebarOpen(true);
      return;
    }

    setCameraTarget(undefined);
    setActiveSidebarMode((mode) => (mode === 'placeDetail' ? 'search' : mode));
  }, [places]);

  const onSelectSearchResult = useCallback((result: PublicSearchResult) => {
    setSelectedSearchResult(result);
    setClickedLocation(null);

    if (result.type === 'place') {
      setSelectedPoiId(result.publicId ?? result.id);
    } else {
      setSelectedPoiId(null);
    }

    const searchCameraTarget = cameraTargetForSearchResult(result);
    const selectedPlace =
      result.type === 'place'
        ? places.find((place) => place.id === (result.publicId ?? result.id))
        : undefined;
    setCameraTarget(
      searchCameraTarget ??
        (selectedPlace
          ? {
              type: 'point',
              center: [selectedPlace.longitude, selectedPlace.latitude],
              zoom: 16,
              duration: 700,
            }
          : undefined),
    );
    setActiveSidebarMode('placeDetail');
    setIsSidebarOpen(true);
  }, [places]);

  const onClearSearch = useCallback(() => {
    setSearchQuery('');
    setSelectedSearchResult(null);
    setCameraTarget(undefined);
    setClickedLocation(null);
    setActiveSidebarMode('search');
  }, [setSearchQuery]);

  const onBackToSearch = useCallback(() => {
    setActiveSidebarMode('search');
    setIsSidebarOpen(true);
  }, []);

  const onRouteToPlace = useCallback((destination: RouteDestination) => {
    setRouteDestination(destination);
    setRouteDraft((draft) => ({ ...draft, to: destination }));
    setActiveSidebarMode('route');
    setIsSidebarOpen(true);
    setCameraTarget({
      type: 'point',
      center: destination.coordinates,
      zoom: 16,
      duration: 700,
    });
  }, []);

  const onEmptyMapClick = useCallback((location: MapClickedLocation) => {
    setSelectedPoiId(null);
    setSelectedSearchResult(null);
    setClickedLocation(location);
    setActiveSidebarMode('address');
    setIsSidebarOpen(true);
  }, []);

  const onUseAddressAsRoutePoint = useCallback(
    (field: 'from' | 'to', point: RoutePoint) => {
      setRouteDraft((draft) => ({ ...draft, [field]: point }));
      if (field === 'to' && point.coordinates) {
        setRouteDestination({ label: point.label, coordinates: point.coordinates });
      }
      setActiveSidebarMode('route');
      setIsSidebarOpen(true);
    },
    [],
  );

  return (
    <MapShell
      leftRail={
        <MapLeftRail
          activeMode={activeSidebarMode}
          onModeChange={(mode) => {
            setActiveSidebarMode(mode);
            setIsSidebarOpen(true);
          }}
        />
      }
      map={
        <MapViewport>
          <MapView
            pois={mapPlaces}
            selectedPoiId={selectedPoiIdForMap}
            selectedPoi={selectedPoi}
            cameraTarget={cameraTarget}
            cameraLayout={mapCameraLayout}
            clickedLocation={clickedLocation}
            onSelectPoiId={onSelectPoiId}
            onEmptyMapClick={onEmptyMapClick}
            onViewportChange={setMapViewport}
          />
        </MapViewport>
      }
      sidebar={
        <MapSidebar
          isOpen={isSidebarOpen}
          activeMode={activeSidebarMode}
          onCollapse={() => setIsSidebarOpen(false)}
          bottomSheetState={bottomSheetState}
          onBottomSheetStateChange={setBottomSheetState}
          searchPanel={
            <SearchPanel
              categories={categoriesQuery.data ?? []}
              selectedCategoryCode={categoryCode}
              onSelectCategory={selectCategory}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              searchResults={searchResultsQuery.data ?? []}
              selectedSearchResultId={selectedSearchResult?.id ?? null}
              onSelectSearchResult={onSelectSearchResult}
              onClearSearch={onClearSearch}
              pois={places}
              placesCount={visiblePlacesCount}
              selectedPoiId={selectedPoiIdForMap}
              onSelectPoiId={onSelectPoiId}
              searchLoading={searchResultsQuery.isLoading}
              searchError={searchResultsQuery.isError}
              categoriesLoading={categoriesQuery.isLoading}
              categoriesError={categoriesQuery.isError}
              placesLoading={placesQuery.isLoading}
              placesError={placesInitialError}
              hasMorePlaces={placesQuery.hasNextPage}
              placesLoadingMore={placesQuery.isFetchingNextPage}
              placesLoadMoreError={placesLoadMoreError}
              onLoadMorePlaces={() => {
                void placesQuery.fetchNextPage();
              }}
            />
          }
          placeDetailPanel={
            <PlaceDetailPanel
              selectedPoi={selectedPoi}
              detailLoading={selectedPlaceQuery.isLoading}
              detailError={selectedPlaceQuery.error}
              selectedSearchResult={selectedSearchResult}
              onBack={onBackToSearch}
              onRouteToPlace={onRouteToPlace}
            />
          }
          addressPanel={
            <AddressLocationPanel
              location={clickedLocation}
              onUseAsRouteStart={(point) => onUseAddressAsRoutePoint('from', point)}
              onUseAsRouteDestination={(point) => onUseAddressAsRoutePoint('to', point)}
            />
          }
          routeDestination={routeDestination}
          routePanel={
            <RoutePlannerPanel
              clickedLocation={clickedLocation}
              draft={routeDraft}
              onDraftChange={setRouteDraft}
            />
          }
          busPanel={<BusPanelPlaceholder />}
          savedPanel={<SavedPanelPlaceholder />}
          morePanel={<MorePanelPlaceholder />}
        />
      }
      floatingControls={
        <MapFloatingControls
          selectedLanguageMode={languageMode}
          onSelectLanguageMode={setLanguageMode}
          isSidebarOpen={isSidebarOpen}
          bottomSheetState={bottomSheetState}
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
      zoom: searchResultPointZoom(result.type),
      duration: 900,
    };
  }

  if (result.center) {
    return {
      type: 'point',
      center: result.center,
      zoom: searchResultPointZoom(result.type),
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

function searchResultPointZoom(type: PublicSearchResult['type']): number {
  if (type === 'admin_area') return 14;
  if (type === 'street') return 15;
  return 16;
}

function combineUniqueViewportPlaces(
  pages: readonly PublicMapPlacesResult[] | undefined,
): readonly Poi[] {
  if (!pages) return [];

  const placesById = new Map<string, Poi>();

  for (const page of pages) {
    for (const place of page.places) {
      const key = poiDedupeKey(place);
      if (!placesById.has(key)) {
        placesById.set(key, place);
      }
    }
  }

  return [...placesById.values()];
}

function combinePlacesForMap(places: readonly Poi[], selectedPoi: Poi | undefined): readonly Poi[] {
  if (!selectedPoi) return places;

  const selectedKey = poiDedupeKey(selectedPoi);
  if (places.some((place) => poiDedupeKey(place) === selectedKey)) {
    return places;
  }

  return [...places, selectedPoi];
}

function poiDedupeKey(place: Poi): string {
  return place.publicId ?? place.apiId ?? place.id;
}

function mapPlaceLimitForZoom(zoom: number | undefined): number {
  // Keep request density aligned with API score bands:
  // low zoom fetches landmarks, mid zoom fetches a balanced page, high zoom fetches local detail.
  if (zoom === undefined) return 100;
  if (zoom < 12) return 50;
  if (zoom < 16) return 100;
  return 200;
}
