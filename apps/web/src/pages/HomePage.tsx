import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
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
  type RouteDestination,
  type SidebarMode,
} from '@/features/map/components/MapSidebar';
import { AccountMenu } from '@/features/auth/components/AccountMenu';
import { AccountPanel } from '@/features/auth/components/AccountPanel';
import { useAuth } from '@/features/auth/state/useAuth';
import {
  SavedPlacesPanel,
  type SavedLocationSelection,
} from '@/features/saved-places/components/SavedPlacesPanel';
import { MyReportsPanel } from '@/features/reports/components/MyReportsPanel';
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
import { mapDocumentLanguage } from '@/features/map/i18n/mapUiText';
import type {
  LocationCameraCommand,
  MapClickedLocation,
  MapViewportState,
} from '@/features/map/types';
import { useUserLocation } from '@/features/location/useUserLocation';
import { useLocationToast } from '@/features/location/useLocationToast';
import { LocationControl } from '@/features/location/LocationControl';
import { LocationToast } from '@/features/location/LocationToast';
import { LocationDebugOverlay } from '@/features/location/LocationDebugOverlay';
import { useLocationDiagnostics } from '@/features/location/LocationDiagnostics';
import { detectLocationBrowserEnvironment } from '@/features/location/locationBrowserEnvironment';
import { isCenterWorthyAccuracy } from '@/features/location/locationAccuracy';
import {
  isLocationDebugOverlayEnabled,
  logLocationDebugBanner,
  logLocationEvent,
  roundOrNull,
} from '@/features/location/locationDebug';
import {
  usePublicCategories,
  usePublicMapPlaces,
  usePublicPlace,
  useInfinitePublicSearch,
  useSearchResultOverlayGeometry,
  type SearchCenter,
} from '@/features/poi/api/usePublicMapData';
import {
  flattenPublicSearchPages,
  publicSearchReachedSessionCap,
} from '@/features/poi/api/publicSearchPages';
import { searchResultOverlayZoomBucket } from '@/features/poi/api/publicMapApi';
import { isPointLikeHighlight } from '@/features/map/lib/maplibre/searchHighlightOnMap';
import type {
  PublicSearchCategory,
  PublicSearchTransportMode,
  PublicSearchTransportType,
} from '@/features/poi/api/publicSearchConstants';
import { PUBLIC_SEARCH_ADDRESSES_FILTER_ENABLED } from '@/features/poi/api/publicSearchConstants';
import { publicSearchApiLang } from '@/features/poi/api/publicSearchLang';
import { publicSearchErrorStatus } from '@/features/poi/api/publicSearchRetry';
import {
  computePublicSearchClickedRank,
  recordPublicSearchResultClick,
  resolvePublicSearchAnalyticsEventId,
} from '@/features/poi/api/searchClickAnalytics';
import { usePublicTransportDetail } from '@/features/transport/api/usePublicTransportDetail';
import type {
  PublicMapPlacesResult,
  PublicSearchResult,
  SearchCameraTarget,
} from '@/features/poi/api/publicMapApi';
import { PlaceDetailPanel } from '@/features/poi/components/PlaceDetailPanel';
import { TransportStopDetailPanel } from '@/features/transport/components/TransportStopDetailPanel';
import { transportStopPanelHeaderTitle } from '@/features/transport/transportStopLabels';
import type { TransportMapSelection } from '@/features/transport/transportMapSelection';
import { readShareNavState } from '@/features/share/shareNavigation';
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
  const { authModalView, closeAuthModal } = useAuth();

  useEffect(() => {
    document.documentElement.lang = mapDocumentLanguage(languageMode);
  }, [languageMode]);

  // A resolved share link (from /s/:code) hands its target here via router state.
  // It seeds the initial map/panel state so the shared location opens immediately.
  const initialShare = readShareNavState(useLocation().state);

  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(
    initialShare?.kind === 'place' ? initialShare.placePublicId : null,
  );
  const [selectedTransportSelection, setSelectedTransportSelection] =
    useState<TransportMapSelection | null>(null);
  const [searchCategory, setSearchCategory] = useState<PublicSearchCategory>('all');
  const [searchTransportType, setSearchTransportType] =
    useState<PublicSearchTransportType>('all');
  const [searchTransportMode, setSearchTransportMode] =
    useState<PublicSearchTransportMode>('all');
  const [searchGeoBias, setSearchGeoBias] = useState<SearchCenter | null>(null);
  const [selectedSearchResult, setSelectedSearchResult] =
    useState<PublicSearchResult | null>(null);
  const [cameraTarget, setCameraTarget] = useState<SearchCameraTarget | undefined>(
    initialShare
      ? {
          type: 'point',
          center: [initialShare.lng, initialShare.lat],
          zoom: initialShare.kind === 'point' ? (initialShare.zoom ?? 17) : 17,
          duration: 800,
        }
      : undefined,
  );
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeSidebarMode, setActiveSidebarMode] = useState<SidebarMode>(
    initialShare ? (initialShare.kind === 'place' ? 'placeDetail' : 'address') : 'search',
  );
  const [bottomSheetState, setBottomSheetState] = useState<BottomSheetState>('half');
  const [mapViewport, setMapViewport] = useState<MapViewportState | null>(null);
  const [routeDestination, setRouteDestination] = useState<RouteDestination | null>(null);
  const route = useRouteState('motorcycle');
  const [clickedLocation, setClickedLocation] = useState<MapClickedLocation | null>(
    initialShare?.kind === 'point'
      ? {
          label: initialShare.addressLine ?? 'Shared location',
          coordinates: [initialShare.lng, initialShare.lat],
          addressLine: initialShare.addressLine,
          plusCode: initialShare.plusCode,
        }
      : null,
  );
  const debouncedSearchQuery = useDebouncedValue(filterState.searchQuery, 200);
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
  /**
   * Live map center for search (nearby ranking + short Plus Code expansion).
   * Held in a ref — NOT in search state or the query key — so map movement and the
   * `flyTo` from selecting a result never re-key or refetch the search. The center
   * is captured only when a search request actually starts (`getSearchCenter`).
   */
  const mapCenterRef = useRef<SearchCenter | undefined>(undefined);
  useEffect(() => {
    if (!mapViewport) {
      mapCenterRef.current = undefined;
      return;
    }
    const [minLng, minLat, maxLng, maxLat] = mapViewport.bbox;
    const round = (v: number) => Math.round(v * 1000) / 1000;
    mapCenterRef.current = {
      lat: round((minLat + maxLat) / 2),
      lng: round((minLng + maxLng) / 2),
    };
  }, [mapViewport]);
  const getSearchCenter = useCallback(() => mapCenterRef.current, []);

  useEffect(() => {
    setSearchGeoBias(getSearchCenter() ?? null);
  }, [
    debouncedSearchQuery,
    searchCategory,
    searchTransportType,
    searchTransportMode,
    getSearchCenter,
  ]);

  useEffect(() => {
    if (!PUBLIC_SEARCH_ADDRESSES_FILTER_ENABLED && searchCategory === 'addresses') {
      setSearchCategory('all');
    }
  }, [searchCategory]);

  const searchOverlayZoom = searchResultOverlayZoomBucket(mapViewport?.zoom ?? 14);
  const searchOverlayGeometryQuery = useSearchResultOverlayGeometry(
    selectedSearchResult,
    searchOverlayZoom,
  );
  const searchHighlightLoading =
    selectedSearchResult !== null &&
    !isPointLikeHighlight(selectedSearchResult) &&
    searchOverlayGeometryQuery.isFetching;

  const searchApiLang = publicSearchApiLang(languageMode);

  const searchResultsQuery = useInfinitePublicSearch({
    q: debouncedSearchQuery,
    lang: searchApiLang,
    category: searchCategory,
    transportType: searchTransportType,
    transportMode: searchTransportMode,
    geoBias: searchGeoBias,
  });

  const loadedSearchResults = useMemo(
    () => flattenPublicSearchPages(searchResultsQuery.data?.pages),
    [searchResultsQuery.data?.pages],
  );
  const searchInputPending = searchQuery.trim() !== debouncedSearchQuery.trim();
  // Never flash results for the previous input while the next debounced request
  // is being prepared. The user sees an immediate lightweight loading state.
  const searchResults = useMemo(
    () => (searchInputPending ? [] : loadedSearchResults),
    [loadedSearchResults, searchInputPending],
  );
  const searchAnalyticsEventId = useMemo(
    () => resolvePublicSearchAnalyticsEventId(searchResultsQuery.data?.pages),
    [searchResultsQuery.data?.pages],
  );
  const searchAnalyticsStartedAtRef = useRef<number | null>(null);
  const searchAnalyticsSessionKeyRef = useRef('');
  const searchAnalyticsSessionKey = `${debouncedSearchQuery}::${searchAnalyticsEventId ?? ''}`;

  if (searchAnalyticsEventId && searchAnalyticsSessionKey !== searchAnalyticsSessionKeyRef.current) {
    searchAnalyticsSessionKeyRef.current = searchAnalyticsSessionKey;
    searchAnalyticsStartedAtRef.current = Date.now();
  } else if (!searchAnalyticsEventId) {
    searchAnalyticsSessionKeyRef.current = '';
    searchAnalyticsStartedAtRef.current = null;
  }
  const searchReachedCap = publicSearchReachedSessionCap(searchResultsQuery.data?.pages);
  const searchHasMore =
    !searchReachedCap &&
    (searchResultsQuery.hasNextPage ?? false) &&
    !searchResultsQuery.isFetchingNextPage;
  const searchInitialError =
    searchResultsQuery.isError && searchResultsQuery.data === undefined;
  const searchUnavailable =
    searchInitialError && publicSearchErrorStatus(searchResultsQuery.error) === 503;
  const searchFetchMoreError =
    searchResultsQuery.isError && searchResultsQuery.data !== undefined;

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
  const selectedTransportStopQuery = usePublicTransportDetail(
    selectedTransportSelection,
    languageMode,
  );
  const transportStopDetailTitle = useMemo(() => {
    if (!selectedTransportSelection) return undefined;
    const stop = selectedTransportStopQuery.data ?? selectedTransportSelection.preview;
    return transportStopPanelHeaderTitle(
      selectedTransportSelection,
      stop.stopType,
      stop.mode,
    );
  }, [selectedTransportSelection, selectedTransportStopQuery.data]);

  /** Refresh selected transport pin caption when API detail replaces tile preview. */
  useEffect(() => {
    const detail = selectedTransportStopQuery.data;
    const apiLookupId = selectedTransportSelection?.apiLookupId;
    if (!detail || !apiLookupId) return;

    setSelectedTransportSelection((previous) => {
      if (!previous || previous.apiLookupId !== apiLookupId) return previous;

      const nameMm = detail.nameMm ?? detail.myanmarName ?? previous.highlight.nameMm;
      const nameEn = detail.nameEn ?? detail.englishName ?? previous.highlight.nameEn;
      const label = detail.displayName ?? detail.name ?? previous.highlight.label;

      if (
        previous.highlight.nameMm === nameMm &&
        previous.highlight.nameEn === nameEn &&
        previous.highlight.label === label
      ) {
        return previous;
      }

      return {
        ...previous,
        preview: detail,
        highlight: {
          ...previous.highlight,
          nameMm: nameMm ?? undefined,
          nameEn: nameEn ?? undefined,
          label: label ?? undefined,
        },
      };
    });
  }, [selectedTransportStopQuery.data, selectedTransportSelection?.apiLookupId]);

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

  const mapCameraTarget = useMemo((): SearchCameraTarget | undefined => {
    if (cameraTarget) return cameraTarget;
    if (selectedSearchResult) return undefined;
    if (route.routeResult?.status !== 'ok' || !route.routeResult.geometry) return undefined;
    const bbox = bboxFromRouteGeometry(route.routeResult.geometry);
    if (!bbox) return undefined;
    return {
      type: 'bounds',
      bbox,
      padding: 72,
      duration: 900,
    };
  }, [cameraTarget, selectedSearchResult, route.routeResult]);

  const onSelectPoiId = useCallback((id: string | null) => {
    setSelectedPoiId(id);
    setSelectedSearchResult(null);
    setSelectedTransportSelection(null);

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
    recordPublicSearchResultClick({
      eventId: searchAnalyticsEventId,
      result,
      clickedRank: computePublicSearchClickedRank(searchResults, result),
      searchStartedAtMs: searchAnalyticsStartedAtRef.current,
    });

    // Selecting a result ONLY updates the selection + map overlay. It must not
    // touch searchQuery/searchResults, switch the active panel, or refetch the
    // list — so the results stay visible and stable while clicking through.
    setSelectedSearchResult(result);
    setClickedLocation(null);
    setSelectedTransportSelection(null);
    setSelectedPoiId(result.type === 'place' ? (result.publicId ?? result.id) : null);

    // Camera + map highlight are owned by the search-highlight overlay (MapView
    // reads `searchHighlight`), so clear any prior cameraTarget to avoid double moves.
    setCameraTarget(undefined);
    setIsSidebarOpen(true);
  }, [searchAnalyticsEventId, searchResults]);

  /** Dismiss the selected-result card (and its map highlight) without losing the list. */
  const onClearSelectedSearchResult = useCallback(() => {
    setSelectedSearchResult(null);
    setSelectedPoiId(null);
    setSelectedTransportSelection(null);
  }, []);

  /** Open the full place detail panel on demand (from the mini card). */
  const onViewSelectedResultDetails = useCallback(() => {
    setActiveSidebarMode('placeDetail');
    setIsSidebarOpen(true);
  }, []);

  /** Editing the query starts a new search and clears any prior result highlight. */
  const onSearchQueryChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      setSelectedSearchResult(null);
    },
    [setSearchQuery],
  );

  const onSearchCategoryChange = useCallback((category: PublicSearchCategory) => {
    setSearchCategory(category);
    setSelectedSearchResult(null);
    if (category !== 'transport') {
      setSearchTransportType('all');
      setSearchTransportMode('all');
    }
  }, []);

  const onSearchTransportTypeChange = useCallback((transportType: PublicSearchTransportType) => {
    setSearchTransportType(transportType);
    setSelectedSearchResult(null);
  }, []);

  const onSearchTransportModeChange = useCallback((mode: PublicSearchTransportMode) => {
    setSearchTransportMode(mode);
    setSelectedSearchResult(null);
  }, []);

  const onClearSearch = useCallback(() => {
    setSearchQuery('');
    setSelectedSearchResult(null);
    setCameraTarget(undefined);
    setClickedLocation(null);
    setActiveSidebarMode('search');
  }, [setSearchQuery]);

  const onBackToSearch = useCallback(() => {
    setSelectedSearchResult(null);
    setSelectedTransportSelection(null);
    setActiveSidebarMode('search');
    setIsSidebarOpen(true);
  }, []);

  const onSelectTransportStop = useCallback((selection: TransportMapSelection) => {
    setSelectedTransportSelection(selection);
    setSelectedPoiId(null);
    setSelectedSearchResult(null);
    setClickedLocation(null);
    setActiveSidebarMode('transportStopDetail');
    setIsSidebarOpen(true);
    setCameraTarget({
      type: 'point',
      center: selection.coordinates,
      zoom: 16,
      duration: 700,
    });
  }, []);

  const openAccountDrawer = useCallback(() => {
    setActiveSidebarMode('account');
    setIsSidebarOpen(true);
  }, []);

  const openSavedDrawer = useCallback(() => {
    setActiveSidebarMode('saved');
    setIsSidebarOpen(true);
  }, []);

  const openReportsDrawer = useCallback(() => {
    setActiveSidebarMode('reports');
    setIsSidebarOpen(true);
  }, []);

  const onSelectSavedLocation = useCallback((selection: SavedLocationSelection) => {
    setSelectedPoiId(null);
    setSelectedSearchResult(null);
    setSelectedTransportSelection(null);
    setClickedLocation(null);
    setCameraTarget({
      type: 'point',
      center: [selection.longitude, selection.latitude],
      zoom: 16,
      duration: 800,
    });
  }, []);

  // Any surface can request sign-in via openAuthModal (e.g. the Save button).
  // Instead of a centered modal, surface the auth form inside the left drawer.
  useEffect(() => {
    if (authModalView === null) return;
    setTimeout(() => {
      openAccountDrawer();
    }, 100);
    closeAuthModal();
  }, [authModalView, closeAuthModal, openAccountDrawer]);

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
      setSelectedTransportSelection(null);
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

  // Own-user location (client-side only): no API, no persistence, no sharing.
  const userLocation = useUserLocation();
  // UA-derived browser/environment (stable per session) for permission diagnostics.
  const locationBrowserEnv = useMemo(() => detectLocationBrowserEnvironment(), []);
  const isLikelyAndroidChrome =
    locationBrowserEnv.isAndroid &&
    locationBrowserEnv.isLikelyChrome &&
    !locationBrowserEnv.isLikelyInAppBrowser;
  const locationToast = useLocationToast(userLocation, {
    isLikelyInAppBrowser: locationBrowserEnv.isLikelyInAppBrowser,
    isLikelyAndroidChrome,
  });
  // Announce debug logging once at load when enabled (dev or ?debugLocation=1). Console-only.
  useEffect(() => {
    logLocationDebugBanner();
  }, []);
  // Console summary to diagnose GPS quality vs app logic. Renders nothing.
  useLocationDiagnostics({
    status: userLocation.status,
    fix: userLocation.fix,
    quality: userLocation.quality,
    isInsideCoverage: userLocation.isInsideCoverage,
    isOutOfCoverage: userLocation.isOutOfCoverage,
    isWarmingUp: userLocation.isWarmingUp,
  });
  const [locationCamera, setLocationCamera] = useState<LocationCameraCommand | null>(null);
  const locationCommandIdRef = useRef(0);
  /** Outside-coverage Yangon fallback issued once per session. */
  const outsideHandledRef = useRef(false);
  /** Whether we have centered on a center-worthy (<=50m) fix yet this session. */
  const hasGoodCenterRef = useRef(false);
  /** Whether the "holding during warm-up" log was already emitted this session. */
  const delayedLoggedRef = useRef(false);
  /** Whether the "skipped low-accuracy auto-center" log was already emitted. */
  const skipLoggedRef = useRef(false);

  // Low-level camera command issuers. Callers log the reasoned camera_* event so
  // logs read at the decision point (good fix / low accuracy / fallback).
  const flyToUserLocation = useCallback(() => {
    locationCommandIdRef.current += 1;
    setLocationCamera({ id: locationCommandIdRef.current, type: 'user' });
  }, []);
  const flyToYangonFocus = useCallback(() => {
    locationCommandIdRef.current += 1;
    setLocationCamera({ id: locationCommandIdRef.current, type: 'yangon' });
  }, []);

  const {
    status: locationStatus,
    fix: locationFix,
    isInsideCoverage: locationInsideCoverage,
    isWarmingUp: locationWarmingUp,
    bestAccuracyM: locationBestAccuracyM,
    startTracking: startLocationTracking,
    enableFollowing: enableLocationFollowing,
    disableFollowing: disableLocationFollowing,
  } = userLocation;

  /** Inside Myanmar, tracking, has a fix, but accuracy is too low (>50m) to trust. */
  const isLowAccuracyInsideCoverage =
    locationStatus === 'tracking' &&
    locationFix != null &&
    locationInsideCoverage === true &&
    !isCenterWorthyAccuracy(locationFix.accuracyM);

  /** Manual opt-in: conservatively center on the approximate (low-accuracy) fix. */
  const onUseApproximateLocation = useCallback(() => {
    if (locationStatus !== 'tracking' || !locationFix || locationInsideCoverage !== true) return;
    logLocationEvent('camera_center_user_manual_low_accuracy', {
      accuracyM: roundOrNull(locationFix.accuracyM),
      cameraAction: 'flyTo_user_conservative',
    });
    // Intentionally do NOT enable follow — this is an approximate, opt-in center,
    // never treated as a precise lock.
    flyToUserLocation();
  }, [locationStatus, locationFix, locationInsideCoverage, flyToUserLocation]);

  const onLocateClick = useCallback(() => {
    logLocationEvent('button_click', { status: locationStatus });

    // Already tracking with a fix → recenter (in coverage) or fall back to Yangon.
    if (locationStatus === 'tracking' && locationFix) {
      if (locationInsideCoverage) {
        const accuracyM = roundOrNull(locationFix.accuracyM);
        // Only recenter/follow when the fix is precise enough (<=50m). For a weak
        // fix we do NOT snap the camera; the "Use anyway" action is the explicit opt-in.
        if (isCenterWorthyAccuracy(locationFix.accuracyM)) {
          logLocationEvent('follow_enabled', { reason: 'recenter_click' });
          logLocationEvent('camera_center_user', {
            reason: 'inside_good_accuracy',
            accuracyM,
            cameraAction: 'flyTo_user',
          });
          enableLocationFollowing();
          flyToUserLocation();
        } else {
          logLocationEvent('camera_skipped_low_accuracy', {
            accuracyM,
            bestAccuracyM: roundOrNull(locationBestAccuracyM),
            reason: 'accuracy_above_precision_threshold',
          });
        }
      } else {
        logLocationEvent('camera_fallback_yangon', {
          reason: 'outside_coverage',
          cameraAction: 'flyTo_yangon',
        });
        disableLocationFollowing();
        flyToYangonFocus();
      }
      return;
    }

    // Any other (non-tracking) state — idle, stopped, requesting, or an error
    // (permission_denied / unavailable / timeout / unsupported) — (re)starts
    // tracking, which re-requests permission from a clean watch.
    outsideHandledRef.current = false;
    hasGoodCenterRef.current = false;
    delayedLoggedRef.current = false;
    skipLoggedRef.current = false;
    startLocationTracking();
  }, [
    locationStatus,
    locationFix,
    locationInsideCoverage,
    locationBestAccuracyM,
    startLocationTracking,
    enableLocationFollowing,
    disableLocationFollowing,
    flyToUserLocation,
    flyToYangonFocus,
  ]);

  /**
   * Warm-up-aware camera while tracking:
   * - Outside coverage → fall back to Yangon once (never fly off-map).
   * - Inside + good fix (<=50m) → center + follow at accuracy-based zoom (once).
   * - Inside + weak fix (>50m) → NEVER auto-center/follow (it would look wrong).
   *   Keep showing the dot + accuracy circle. During warm-up we wait for a better
   *   fix; after warm-up we just skip — the user can opt in via "Use anyway".
   * - A later improvement to a good fix re-centers + enables follow.
   */
  useEffect(() => {
    if (locationStatus !== 'tracking' || !locationFix) return;

    const accuracyM = roundOrNull(locationFix.accuracyM);

    if (locationInsideCoverage === false) {
      if (!outsideHandledRef.current) {
        outsideHandledRef.current = true;
        logLocationEvent('camera_fallback_yangon', {
          reason: 'outside_coverage',
          accuracyM,
          cameraAction: 'flyTo_yangon',
        });
        disableLocationFollowing();
        flyToYangonFocus();
      }
      return;
    }

    const goodFix = isCenterWorthyAccuracy(locationFix.accuracyM);
    if (goodFix) {
      if (!hasGoodCenterRef.current) {
        hasGoodCenterRef.current = true;
        logLocationEvent('follow_enabled', { reason: 'inside_good_accuracy' });
        logLocationEvent('camera_center_user', {
          reason: 'inside_good_accuracy',
          accuracyM,
          cameraAction: 'flyTo_user',
        });
        enableLocationFollowing();
        flyToUserLocation();
      }
      return;
    }

    // Weak fix inside coverage: do not auto-center, ever. Just show the dot/circle.
    if (locationWarmingUp) {
      if (!delayedLoggedRef.current) {
        delayedLoggedRef.current = true;
        logLocationEvent('camera_delayed_low_accuracy', {
          accuracyM,
          isWarmingUp: true,
          reason: 'warmup_waiting_for_better_fix',
        });
      }
    } else if (!skipLoggedRef.current) {
      // Warm-up over and GPS is still weak → skip auto-center (no camera_center_user).
      skipLoggedRef.current = true;
      logLocationEvent('camera_skipped_low_accuracy', {
        accuracyM,
        bestAccuracyM: roundOrNull(locationBestAccuracyM),
        reason: 'accuracy_above_precision_threshold',
      });
    }
  }, [
    locationStatus,
    locationFix,
    locationInsideCoverage,
    locationWarmingUp,
    locationBestAccuracyM,
    enableLocationFollowing,
    disableLocationFollowing,
    flyToUserLocation,
    flyToYangonFocus,
  ]);

  /** Error fallback: keep the map on the Yangon default focus, never lost off-map. */
  useEffect(() => {
    if (
      locationStatus === 'permission_denied' ||
      locationStatus === 'unavailable' ||
      locationStatus === 'timeout' ||
      locationStatus === 'unsupported'
    ) {
      logLocationEvent('camera_fallback_yangon', {
        reason: locationStatus,
        status: locationStatus,
        cameraAction: 'flyTo_yangon',
      });
      flyToYangonFocus();
    }
  }, [locationStatus, flyToYangonFocus]);

  return (
    <MapShell
      leftRail={
        <MapLeftRail
          activeMode={activeSidebarMode}
          onModeChange={(mode) => {
            setActiveSidebarMode(mode);
            setIsSidebarOpen(true);
          }}
          accountSlot={
            <AccountMenu
              onOpen={openAccountDrawer}
              active={activeSidebarMode === 'account'}
            />
          }
        />
      }
      map={
        <MapViewport>
          <MapView
            pois={mapPlaces}
            selectedPoiId={selectedPoiIdForMap}
            selectedPoi={selectedPoi}
            cameraTarget={mapCameraTarget}
            searchHighlight={selectedSearchResult}
            searchHighlightGeometry={searchOverlayGeometryQuery.data ?? null}
            cameraLayout={mapCameraLayout}
            clickedLocation={clickedLocation}
            directionsOverlay={directionsOverlay}
            routePickMode={route.pickMode}
            userLocationFix={userLocation.fix}
            userLocationFollowing={userLocation.isFollowing}
            userLocationInsideCoverage={userLocation.isInsideCoverage}
            locationCameraCommand={locationCamera}
            onUserLocationFollowDisengage={userLocation.disableFollowing}
            onSelectPoiId={onSelectPoiId}
            selectedTransportSelection={selectedTransportSelection}
            onSelectTransportStop={onSelectTransportStop}
            onEmptyMapClick={onEmptyMapClick}
            onViewportChange={setMapViewport}
          />
        </MapViewport>
      }
      sidebar={
        <MapSidebar
          isOpen={isSidebarOpen}
          activeMode={activeSidebarMode}
          transportStopDetailTitle={transportStopDetailTitle}
          onCollapse={() => setIsSidebarOpen(false)}
          bottomSheetState={bottomSheetState}
          onBottomSheetStateChange={setBottomSheetState}
          searchPanel={
            <SearchPanel
              categories={categoriesQuery.data ?? []}
              selectedCategoryCode={categoryCode}
              onSelectCategory={selectCategory}
              searchQuery={searchQuery}
              onSearchQueryChange={onSearchQueryChange}
              searchCategory={searchCategory}
              onSearchCategoryChange={onSearchCategoryChange}
              searchTransportType={searchTransportType}
              onSearchTransportTypeChange={onSearchTransportTypeChange}
              searchTransportMode={searchTransportMode}
              onSearchTransportModeChange={onSearchTransportModeChange}
              searchResults={searchResults}
              selectedSearchResultId={selectedSearchResult?.id ?? null}
              selectedSearchResult={selectedSearchResult}
              selectedResultLoading={searchHighlightLoading}
              onSelectSearchResult={onSelectSearchResult}
              onClearSelectedSearchResult={onClearSelectedSearchResult}
              onViewSelectedResultDetails={onViewSelectedResultDetails}
              onClearSearch={onClearSearch}
              referenceCoordinates={searchReferenceCoordinates}
              mapZoom={mapViewport?.zoom ?? null}
              pois={places}
              placesCount={visiblePlacesCount}
              selectedPoiId={selectedPoiIdForMap}
              onSelectPoiId={onSelectPoiId}
              searchLoading={searchInputPending || searchResultsQuery.isLoading}
              searchLoadingMore={searchResultsQuery.isFetchingNextPage}
              searchError={searchInitialError}
              searchUnavailable={searchUnavailable}
              searchFetchMoreError={searchFetchMoreError}
              hasMoreSearch={searchHasMore}
              searchReachedCap={searchReachedCap}
              onLoadMoreSearch={() => {
                void searchResultsQuery.fetchNextPage();
              }}
              onRetrySearch={() => {
                void searchResultsQuery.refetch();
              }}
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
          transportStopDetailPanel={
            <TransportStopDetailPanel
              selection={selectedTransportSelection}
              selectedStop={selectedTransportStopQuery.data}
              detailLoading={
                selectedTransportStopQuery.isFetching &&
                !selectedTransportStopQuery.isError &&
                selectedTransportStopQuery.data === undefined
              }
              detailFetched={
                selectedTransportStopQuery.isFetched || selectedTransportStopQuery.isError
              }
              detailError={selectedTransportStopQuery.error}
              onBack={onBackToSearch}
              onRoutePlace={onRoutePlace}
              onRetry={() => {
                void selectedTransportStopQuery.refetch();
              }}
            />
          }
          addressPanel={
            <AddressLocationPanel
              location={clickedLocation}
              zoom={mapViewport?.zoom}
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
          savedPanel={<SavedPlacesPanel onSelectLocation={onSelectSavedLocation} />}
          reportsPanel={<MyReportsPanel />}
          accountPanel={
            <AccountPanel onOpenSaved={openSavedDrawer} onOpenReports={openReportsDrawer} />
          }
        />
      }
      floatingControls={
        <>
          <MapFloatingControls
            selectedLanguageMode={languageMode}
            onSelectLanguageMode={setLanguageMode}
            isSidebarOpen={isSidebarOpen}
            bottomSheetState={bottomSheetState}
            locationSlot={
              <LocationControl
                status={userLocation.status}
                fix={userLocation.fix}
                isFollowing={userLocation.isFollowing}
                isOutOfCoverage={userLocation.isOutOfCoverage}
                isWarmingUp={userLocation.isWarmingUp}
                isAwaitingFreshFix={userLocation.isAwaitingFreshFix}
                isLikelyInAppBrowser={locationBrowserEnv.isLikelyInAppBrowser}
                isAndroid={locationBrowserEnv.isAndroid}
                message={userLocation.errorMessage}
                canUseApproximate={isLowAccuracyInsideCoverage}
                onUseApproximate={onUseApproximateLocation}
                onLocateClick={onLocateClick}
                onStopClick={userLocation.stopTracking}
              />
            }
          />
          <LocationToast toast={locationToast} />
          {isLocationDebugOverlayEnabled() ? (
            <LocationDebugOverlay
              status={userLocation.status}
              accuracyM={userLocation.fix ? Math.round(userLocation.fix.accuracyM) : null}
              isInsideCoverage={userLocation.isInsideCoverage}
            />
          ) : null}
        </>
      }
    />
  );
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
