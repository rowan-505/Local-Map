/**
 * MapLibre paint expressions for transport mode colors.
 * Color tokens live in `publicMapMarkerStyles.ts`.
 */
import type { ExpressionSpecification } from 'maplibre-gl';
import { TRANSPORT_MARKER_COLORS } from './publicMapMarkerStyles';

export const TRANSPORT_MODE_BUS_COLOR = TRANSPORT_MARKER_COLORS.bus;
export const TRANSPORT_MODE_RAIL_COLOR = TRANSPORT_MARKER_COLORS.rail;
export const TRANSPORT_MODE_FERRY_COLOR = TRANSPORT_MARKER_COLORS.ferry;
export const TRANSPORT_MODE_FALLBACK_COLOR = TRANSPORT_MARKER_COLORS.fallback;
export const TRANSPORT_MAJOR_POINT_COLOR = TRANSPORT_MARKER_COLORS.majorPoint;
export const TRANSPORT_SELECTED_PIN_COLOR = TRANSPORT_MARKER_COLORS.selectedPin;

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

const MAJOR_STOP_TYPES = ['bus_station', 'terminal', 'rail_station', 'ferry_terminal', 'airport'];

/** Station/terminal-class stops use indigo; ordinary stops follow mode color. */
export function transportStopFillExpression(): ExpressionSpecification {
  return [
    'case',
    [
      'in',
      ['coalesce', ['get', 'stop_type'], 'bus_stop'],
      ['literal', MAJOR_STOP_TYPES],
    ],
    TRANSPORT_MAJOR_POINT_COLOR,
    transportModeColorExpression(),
  ] as ExpressionSpecification;
}

/** Major bus terminals/interchanges use indigo; rail/ferry keep mode colors. */
export function transportTerminalFillExpression(): ExpressionSpecification {
  return [
    'case',
    ['in', ['coalesce', ['get', 'mode'], ''], ['literal', ['bus', 'local_bus']]],
    TRANSPORT_MAJOR_POINT_COLOR,
    transportModeColorExpression(),
  ] as ExpressionSpecification;
}
