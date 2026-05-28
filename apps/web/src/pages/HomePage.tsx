import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { RoutePlannerPanel } from '@/features/map/components/RoutePlannerPanel';
import type { DirectionsMapOverlay } from '@/features/map/lib/maplibre/directionsRouteGeoJson';
import { bboxFromRouteGeometry } from '@/features/routing/lib/routePoint';
import {
  endpointFromRoutePoint,
  placeEndpoint,
} from '@/features/routing/routeState';
import { useRouteState } from '@/features/routing/useRouteState';
import type { RoutePoint } from '@/features/routing/lib/routePoint';
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
  const route = useRouteState('motorcycle');
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

  const searchReferenceCoordinates = useMemo((): readonly [number, number] | null => {
    if (!mapViewport) return null;
    const [minLng, minLat, maxLng, maxLat] = mapViewport.bbox;
    return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
  }, [mapViewport]);

  const directionsOverlay = useMemo((): DirectionsMapOverlay | null => {
    const from = route.fromCoordinates;
    const to = route.toCoordinates;
    const geometry = route.routeResult?.geometry ?? null;
    if (!from && !to && !geometry) return null;
    return { from, to, geometry };
  }, [route.fromCoordinates, route.toCoordinates, route.routeResult?.geometry]);

  useEffect(() => {
    if (route.routeResult?.status !== 'ok' || !route.routeResult.geometry) return;
    const bbox = bboxFromRouteGeometry(route.routeResult.geometry);
    if (!bbox) return;
    setCameraTarget({
      type: 'bounds',
      bbox,
      padding: 72,
      duration: 900,
    });
  }, [route.routeResult]);

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

  const onRoutePlace = useCallback(
    (
      field: 'from' | 'to',
      place: {
        readonly label: string;
        readonly coordinates: readonly [number, number];
        readonly placeId?: string;
      },
    ) => {
      const [lng, lat] = place.coordinates;
      const endpoint = placeEndpoint(place.label, lng, lat, {
        placeId: place.placeId,
        source: 'place_detail',
      });

      if (field === 'from') {
        route.setFrom(endpoint);
      } else {
        route.setTo(endpoint);
        setRouteDestination({ label: place.label, coordinates: place.coordinates });
      }

      route.cancelMapPick();
      setActiveSidebarMode('route');
      setIsSidebarOpen(true);
      setBottomSheetState('half');
      setCameraTarget({
        type: 'point',
        center: place.coordinates,
        zoom: 16,
        duration: 700,
      });
    },
    [route],
  );

  const onEmptyMapClick = useCallback(
    (location: MapClickedLocation) => {
      if (route.pickMode) {
        const [lng, lat] = location.coordinates;
        route.applyMapPickedPoint(lat, lng);
        setActiveSidebarMode('route');
        setIsSidebarOpen(true);
        setBottomSheetState('half');
        return;
      }

      setSelectedPoiId(null);
      setSelectedSearchResult(null);
      setClickedLocation(location);
      setActiveSidebarMode('address');
      setIsSidebarOpen(true);
    },
    [route],
  );

  const onUseAddressAsRoutePoint = useCallback(
    (field: 'from' | 'to', point: RoutePoint) => {
      const endpoint = endpointFromRoutePoint(point, 'map_click');
      if (field === 'from') {
        route.setFrom(endpoint);
      } else {
        route.setTo(endpoint);
        if (point.coordinates) {
          setRouteDestination({ label: point.label, coordinates: point.coordinates });
        }
      }
      setActiveSidebarMode('route');
      setIsSidebarOpen(true);
      setBottomSheetState('half');
    },
    [route],
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
            directionsOverlay={directionsOverlay}
            routePickMode={route.pickMode}
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
              onRoutePlace={onRoutePlace}
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
              route={route}
              searchReferenceCoordinates={searchReferenceCoordinates}
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
