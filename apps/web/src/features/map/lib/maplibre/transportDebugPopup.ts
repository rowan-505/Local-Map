/**
 * Debug-only inspection popups for the Martin transport overlay.
 * A single map-click handler hit-tests `TRANSPORT_LAYER_IDS` (point layers before line layers)
 * and shows the normalized attributes for the top-priority feature. No API calls, no edit actions.
 * POI selection is kept separate in `poiMapInteractions`, which yields to transport hits.
 */
import maplibregl, {
  type MapGeoJSONFeature,
  type MapMouseEvent,
} from 'maplibre-gl';
import type { MapEngine } from '../mapEngineTypes';
import { TRANSPORT_LAYER_IDS } from './transportLayers';
import {
  buildTransportPopupModel,
  resolveTransportKind,
  type TransportPopupModel,
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

/** Renders an unknown value for debug display; null/undefined become an em dash. */
function debugValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'string' ? value : String(value);
}

/**
 * Curated dev-only field list. Surfaces the raw (possibly generated OSM) name and key
 * attributes that the user-facing title/labels intentionally hide, so debugging stays easy
 * without ever leaking generated names into production UI.
 */
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

/** Dev-only collapsible debug block (curated fields + raw JSON); never in production builds. */
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

function buildPopupHtml(model: TransportPopupModel, debugHtml?: string): string {
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

/** Transport hit layers that currently exist in the style. */
function presentHitLayers(map: MapEngine): string[] {
  return TRANSPORT_LAYER_IDS.filter((id) => map.getLayer(id));
}

/** True when at least one transport hit layer is visible (overlay toggled on). */
function isTransportOverlayEnabled(map: MapEngine, layers: readonly string[]): boolean {
  return layers.some((id) => map.getLayoutProperty(id, 'visibility') !== 'none');
}

/** Lower rank = higher priority. Unknown layers sort last. */
function transportLayerRank(layerId: string | undefined): number {
  const index = layerId ? TRANSPORT_LAYER_IDS.indexOf(layerId as never) : -1;
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/** Picks the highest-priority transport feature under the cursor (points before lines). */
function pickPriorityFeature(
  map: MapEngine,
  point: MapMouseEvent['point'],
  layers: readonly string[],
): MapGeoJSONFeature | null {
  const hits = map.queryRenderedFeatures(point, { layers: [...layers] });
  if (hits.length === 0) return null;

  let best = hits[0];
  let bestRank = transportLayerRank(best.layer?.id);
  for (const hit of hits) {
    const rank = transportLayerRank(hit.layer?.id);
    if (rank < bestRank) {
      best = hit;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * Binds the transport debug popup + hover cursor. Safe to call after each map load;
 * returns an unsubscribe that removes listeners and the popup.
 */
export function bindTransportDebugPopups(map: MapEngine): () => void {
  const popup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    maxWidth: '260px',
  });

  const onClick = (event: MapMouseEvent) => {
    const layers = presentHitLayers(map);
    if (layers.length === 0) return;
    if (!isTransportOverlayEnabled(map, layers)) return;

    const feature = pickPriorityFeature(map, event.point, layers);
    if (!feature) return;

    const properties = (feature.properties ?? {}) as Record<string, unknown>;
    const kind = resolveTransportKind(feature.sourceLayer, feature.layer?.id);
    if (!kind) return;

    const model = buildTransportPopupModel(kind, properties);

    let debugHtml: string | undefined;
    if (import.meta.env.DEV) {
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
      debugHtml = buildDebugBlockHtml(debugInfo);
    }

    popup.setLngLat(event.lngLat).setHTML(buildPopupHtml(model, debugHtml)).addTo(map);
  };

  const onEnter = () => {
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = 'pointer';
  };
  const onLeave = () => {
    const canvas = map.getCanvas();
    if (canvas?.style) canvas.style.cursor = '';
  };

  map.on('click', onClick);
  const hoverCleanups: Array<() => void> = [];
  for (const layerId of TRANSPORT_LAYER_IDS) {
    map.on('mouseenter', layerId, onEnter);
    map.on('mouseleave', layerId, onLeave);
    hoverCleanups.push(() => {
      map.off('mouseenter', layerId, onEnter);
      map.off('mouseleave', layerId, onLeave);
    });
  }

  return () => {
    map.off('click', onClick);
    for (const cleanup of hoverCleanups) cleanup();
    popup.remove();
  };
}
