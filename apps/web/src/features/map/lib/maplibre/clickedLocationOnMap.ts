import type { GeoJSONSource } from 'maplibre-gl';
import type { MapClickedLocation } from '../../types';
import type { MapEngine } from '../mapEngineTypes';

export const CLICKED_LOCATION_SOURCE_ID = 'clicked-location' as const;
export const CLICKED_LOCATION_SHADOW_LAYER_ID = 'clicked-location-shadow' as const;
export const CLICKED_LOCATION_LAYER_ID = 'clicked-location-pin' as const;

export const CLICKED_LOCATION_LAYER_IDS = [
  CLICKED_LOCATION_SHADOW_LAYER_ID,
  CLICKED_LOCATION_LAYER_ID,
] as const;
const CLICKED_LOCATION_PIN_IMAGE_ID = 'clicked-location-pin-image' as const;

const EMPTY_FC: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

export function ensureClickedLocationLayer(map: MapEngine, location: MapClickedLocation | null): void {
  ensureClickedLocationPinImage(map);

  if (!map.getSource(CLICKED_LOCATION_SOURCE_ID)) {
    map.addSource(CLICKED_LOCATION_SOURCE_ID, {
      type: 'geojson',
      data: clickedLocationToGeoJSON(location),
    });

    map.addLayer({
      id: CLICKED_LOCATION_SHADOW_LAYER_ID,
      type: 'circle',
      source: CLICKED_LOCATION_SOURCE_ID,
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 6, 14, 9, 18, 12],
        'circle-color': '#0f172a',
        'circle-opacity': 0.18,
        'circle-blur': 0.7,
        'circle-translate': [0, 4],
      },
    });

    map.addLayer({
      id: CLICKED_LOCATION_LAYER_ID,
      type: 'symbol',
      source: CLICKED_LOCATION_SOURCE_ID,
      layout: {
        'icon-image': CLICKED_LOCATION_PIN_IMAGE_ID,
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.72, 14, 0.9, 18, 1.05],
      },
    });
    return;
  }

  setClickedLocation(map, location);
}

export function setClickedLocation(map: MapEngine, location: MapClickedLocation | null): void {
  const src = map.getSource(CLICKED_LOCATION_SOURCE_ID) as GeoJSONSource | undefined;
  if (!src) return;
  src.setData(clickedLocationToGeoJSON(location));
}

export function moveClickedLocationLayersToTop(map: MapEngine): void {
  for (const layerId of CLICKED_LOCATION_LAYER_IDS) {
    if (map.getLayer(layerId)) map.moveLayer(layerId);
  }
}

function ensureClickedLocationPinImage(map: MapEngine): void {
  if (map.hasImage(CLICKED_LOCATION_PIN_IMAGE_ID)) return;

  const image = createClickedLocationPinImage();
  if (!image) return;

  map.addImage(CLICKED_LOCATION_PIN_IMAGE_ID, image, { pixelRatio: 2 });
}

function createClickedLocationPinImage(): ImageData | null {
  if (typeof document === 'undefined') return null;

  const canvas = document.createElement('canvas');
  canvas.width = 80;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(2, 2);

  ctx.shadowColor = 'rgba(15, 23, 42, 0.22)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;

  drawPinPath(ctx);
  ctx.fillStyle = '#2563eb';
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  drawPinPath(ctx);
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  drawPinPath(ctx);
  ctx.fillStyle = '#2563eb';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(20, 18, 5.8, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  // TODO: Use GET /public/address/reverse?lat=...&lng=... to label clicked locations later.
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function drawPinPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(20, 44);
  ctx.bezierCurveTo(18, 39, 7, 29, 7, 18);
  ctx.bezierCurveTo(7, 10, 12.6, 5, 20, 5);
  ctx.bezierCurveTo(27.4, 5, 33, 10, 33, 18);
  ctx.bezierCurveTo(33, 29, 22, 39, 20, 44);
  ctx.closePath();
}

function clickedLocationToGeoJSON(
  location: MapClickedLocation | null,
): GeoJSON.FeatureCollection {
  if (!location) return EMPTY_FC;

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          label: location.label,
        },
        geometry: {
          type: 'Point',
          coordinates: [location.coordinates[0], location.coordinates[1]],
        },
      },
    ],
  };
}
