/**
 * MapLibre GL construction — swap this module if adopting another map provider.
 */
import maplibregl from 'maplibre-gl';
import { boundsFromFeatureCollection } from '@/data/geo/featureCollectionBounds';
import { KYAUKTAN_TOWNSHIP_GEOJSON } from '@/data/geo/kyauktanTownshipData';
import {
  MAP_INITIAL_CENTER,
  MAP_INITIAL_ZOOM,
  MAP_MAX_BOUNDS,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  MAP_TOWNSHIP_FIT_OPTIONS,
} from '../../mapDefaults';
import type { MapEngine } from '../mapEngineTypes';
import { applyMvpBasemapStyle } from './basemapMvpStyle';
import { syncCountryMinZoom } from './mapCountryMinZoom';

const MAP_STYLE_URL = `${import.meta.env.BASE_URL}basemap-township-mvp.json`;

type BoundsLike = maplibregl.LngLatBoundsLike;

export function createMapboxMap(container: HTMLDivElement): MapEngine {
  const map = new maplibregl.Map({
    container,
    style: MAP_STYLE_URL,
    center: MAP_INITIAL_CENTER,
    zoom: MAP_INITIAL_ZOOM,
    maxBounds: MAP_MAX_BOUNDS as BoundsLike,
    minZoom: MAP_MIN_ZOOM,
    maxZoom: MAP_MAX_ZOOM,

    dragPan: true,
    scrollZoom: true,
    boxZoom: true,
    doubleClickZoom: true,
    keyboard: true,
    dragRotate: false,
    pitchWithRotate: false,
    pitch: 0,
    minPitch: 0,
    maxPitch: 0,
    touchPitch: false,
    touchZoomRotate: true,
  });

  const townshipBounds = boundsFromFeatureCollection(KYAUKTAN_TOWNSHIP_GEOJSON) as BoundsLike;
  const postTownshipFitSyncMs = MAP_TOWNSHIP_FIT_OPTIONS.duration + 100;

  map.once('load', () => {
    applyMvpBasemapStyle(map);
    map.on('resize', () => syncCountryMinZoom(map, { skipResize: true }));

    syncCountryMinZoom(map);
    map.fitBounds(townshipBounds, { ...MAP_TOWNSHIP_FIT_OPTIONS });
    window.setTimeout(() => syncCountryMinZoom(map), postTownshipFitSyncMs);
  });

  return map;
}

export function addNavigationControl(map: MapEngine): void {
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
}
