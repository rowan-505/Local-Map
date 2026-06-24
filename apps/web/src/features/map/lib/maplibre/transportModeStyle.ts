/**
 * Mode-based color tokens + expressions for the Martin transport overlay (overlay only —
 * never the basemap or POIs). Kept to a small, limited palette: one color per transport mode
 * family, shared across route paths, terminals, and stops so a rider learns "violet = bus",
 * "teal = rail", "blue = ferry" once. Shape/size still distinguishes routes vs terminals vs stops.
 */
import type { ExpressionSpecification } from 'maplibre-gl';

export const TRANSPORT_MODE_BUS_COLOR = '#7c3aed'; // violet-600 — bus / local bus
export const TRANSPORT_MODE_RAIL_COLOR = '#0f766e'; // teal-700 — rail / train
export const TRANSPORT_MODE_FERRY_COLOR = '#2563eb'; // blue-600 — ferry / water
export const TRANSPORT_MODE_FALLBACK_COLOR = '#64748b'; // slate-500 — unknown / other

/**
 * `match` on `["get","mode"]` mapping mode families to the palette above.
 * Null/empty/unrecognized modes fall back to slate. Used for line-color (routes) and
 * circle-color (terminals, stops).
 */
export function transportModeColorExpression(): ExpressionSpecification {
  return [
    'match',
    ['get', 'mode'],
    ['bus', 'local_bus'],
    TRANSPORT_MODE_BUS_COLOR,
    ['rail', 'train'],
    TRANSPORT_MODE_RAIL_COLOR,
    ['ferry', 'water'],
    TRANSPORT_MODE_FERRY_COLOR,
    TRANSPORT_MODE_FALLBACK_COLOR,
  ] as ExpressionSpecification;
}
