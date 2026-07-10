/**
 * Transport overlay pointer handling: hover highlight and dev-only line-feature popups.
 * Map clicks are resolved centrally in {@link publicMapClickInteractions.ts}.
 */
import maplibregl, { type MapGeoJSONFeature, type MapMouseEvent } from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';
import {
  filterPresentMapLayers,
  isAnyMapLayerVisible,
  PUBLIC_MAP_TRANSPORT_HOVER_LAYER_IDS,
  queryTopRenderedMapFeature,
} from './publicMapClickableLayerRegistry';
import { applySelectedTransportMarker } from './selectedTransportMarker';
import {
  highlightFromTransportFeature,
  setTransportStopHover,
} from './transportStopHighlight';
import {
  buildTransportPopupModel,
  resolveTransportKind,
} from './transportPopupModel';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

type TransportFeatureDebugInfo = {
  readonly layerId: string | undefined;
  readonly sourceLayer: string | undefined;
  readonly sourceId: string | undefined;
  readonly properties: Record<string, unknown>;
};

function debugValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'string' ? value : String(value);
}

function buildDebugFieldsHtml(info: TransportFeatureDebugInfo): string {
  const p = info.properties;
  const fields: ReadonlyArray<readonly [string, string]> = [
    ['raw name', debugValue(p.name)],
    ['id', debugValue(p.id)],
    ['mode', debugValue(p.mode)],
    ['terminal_role', debugValue(p.terminal_role)],
    ['review_status', debugValue(p.review_status)],
    ['confidence_score', debugValue(p.confidence_score)],
    ['layer id', debugValue(info.layerId)],
    ['source layer', debugValue(info.sourceLayer)],
  ];
  return fields
    .map(
      ([label, value]) =>
        `<div style="display:flex;gap:8px;justify-content:space-between;">` +
        `<span style="color:#6b7280;">${escapeHtml(label)}</span>` +
        `<span style="color:#374151;text-align:right;word-break:break-word;">${escapeHtml(value)}</span>` +
        `</div>`,
    )
    .join('');
}

function buildDebugBlockHtml(info: TransportFeatureDebugInfo): string {
  const json = escapeHtml(JSON.stringify(info, null, 2));
  return (
    `<details style="margin-top:6px;border-top:1px solid #e5e7eb;padding-top:4px;">` +
    `<summary style="cursor:pointer;color:#6b7280;font-size:10px;">Debug (dev only)</summary>` +
    `<div style="margin-top:4px;font-size:10px;line-height:1.5;">${buildDebugFieldsHtml(info)}</div>` +
    `<pre style="margin:4px 0 0;max-height:180px;overflow:auto;font-size:10px;line-height:1.4;` +
    `color:#374151;white-space:pre-wrap;word-break:break-word;">${json}</pre>` +
    `</details>`
  );
}

function buildPopupHtml(
  model: ReturnType<typeof buildTransportPopupModel>,
  debugHtml?: string,
): string {
  const rowsHtml = model.rows
    .map(
      (row) =>
        `<div style="display:flex;gap:8px;justify-content:space-between;">` +
        `<span style="color:#6b7280;">${escapeHtml(row.label)}</span>` +
        `<span style="color:#111827;font-weight:500;text-align:right;">${escapeHtml(row.value)}</span>` +
        `</div>`,
    )
    .join('');

  return (
    `<div style="font-size:12px;line-height:1.5;min-width:180px;">` +
    `<div style="font-weight:600;color:#111827;">${escapeHtml(model.title)}</div>` +
    `<div style="color:#9ca3af;font-size:10px;margin-bottom:4px;">${escapeHtml(model.subtitle)}</div>` +
    rowsHtml +
    (debugHtml ?? '') +
    `</div>`
  );
}

let activeTransportLinePopup: maplibregl.Popup | null = null;

/** Dev-only inspection popup for route/infrastructure line clicks. */
export function showTransportLineFeaturePopup(
  map: MapEngine,
  event: MapMouseEvent,
  feature: MapGeoJSONFeature,
): void {
  if (!import.meta.env.DEV) return;

  const kind = resolveTransportKind(feature.sourceLayer, feature.layer?.id);
  if (!kind || kind === 'stop' || kind === 'terminal') return;

  const properties = (feature.properties ?? {}) as Record<string, unknown>;
  const model = buildTransportPopupModel(kind, properties);
  const debugInfo: TransportFeatureDebugInfo = {
    layerId: feature.layer?.id,
    sourceLayer: feature.sourceLayer,
    sourceId: feature.source,
    properties,
  };

  console.groupCollapsed(`[map][transport] clicked ${kind}`);
  console.log('layerId:', debugInfo.layerId);
  console.log('sourceLayer:', debugInfo.sourceLayer);
  console.log('sourceId:', debugInfo.sourceId);
  console.table(properties);
  console.groupEnd();

  activeTransportLinePopup?.remove();
  activeTransportLinePopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: '260px',
  });
  activeTransportLinePopup
    .setLngLat(event.lngLat)
    .setHTML(buildPopupHtml(model, buildDebugBlockHtml(debugInfo)))
    .addTo(map);
}

/** Binds transport hover highlight on hitbox layers. */
export function bindTransportMapInteractions(map: MapEngine): () => void {
  const onEnter = (event: MapMouseEvent) => {
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = 'pointer';

    const hoverLayers = filterPresentMapLayers(map, PUBLIC_MAP_TRANSPORT_HOVER_LAYER_IDS);
    if (hoverLayers.length === 0) return;
    if (!isAnyMapLayerVisible(map, hoverLayers)) return;

    const feature = queryTopRenderedMapFeature(map, event.point, hoverLayers);
    if (!feature) return;
    const highlight = highlightFromTransportFeature(feature);
    if (highlight) setTransportStopHover(map, highlight);
  };

  const onLeave = () => {
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = '';
    setTransportStopHover(map, null);
  };

  const hoverCleanups: Array<() => void> = [];
  for (const layerId of PUBLIC_MAP_TRANSPORT_HOVER_LAYER_IDS) {
    map.on('mouseenter', layerId, onEnter);
    map.on('mouseleave', layerId, onLeave);
    hoverCleanups.push(() => {
      map.off('mouseenter', layerId, onEnter);
      map.off('mouseleave', layerId, onLeave);
    });
  }

  return () => {
    for (const cleanup of hoverCleanups) cleanup();
    setTransportStopHover(map, null);
    applySelectedTransportMarker(map, null);
    activeTransportLinePopup?.remove();
    activeTransportLinePopup = null;
  };
}
