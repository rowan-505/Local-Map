import type { TransportMapSelection } from './transportMapSelection';

const STATION_STOP_TYPES = new Set([
  'bus_station',
  'rail_station',
  'ferry_terminal',
  'terminal',
  'airport',
]);

/** User-facing type label for the detail card metadata row. */
export function transportStopTypeLabel(
  selection: TransportMapSelection | null | undefined,
  stopType: string,
  mode: string,
): string {
  if (selection?.kind === 'terminal') {
    return mode === 'ferry' ? 'Ferry terminal' : 'Terminal';
  }

  const normalized = stopType.trim().toLowerCase();
  if (normalized === 'bus_stop' || (mode === 'bus' && normalized === 'stop')) {
    return 'Bus stop';
  }
  if (STATION_STOP_TYPES.has(normalized)) {
    return normalized === 'ferry_terminal' ? 'Ferry terminal' : 'Station';
  }
  if (normalized === 'station') {
    return 'Station';
  }
  if (normalized === 'terminal') {
    return 'Terminal';
  }
  if (mode === 'ferry' || mode === 'water') {
    return 'Ferry stop';
  }
  if (mode === 'rail' || mode === 'train') {
    return 'Rail stop';
  }
  return 'Transport stop';
}

/** Left sidebar header title for transport detail mode. */
export function transportStopPanelHeaderTitle(
  selection: TransportMapSelection | null | undefined,
  stopType: string,
  mode: string,
): string {
  if (selection?.kind === 'terminal') {
    return 'Terminal details';
  }

  const typeLabel = transportStopTypeLabel(selection, stopType, mode);
  if (typeLabel === 'Bus stop' || typeLabel === 'Ferry stop' || typeLabel === 'Rail stop') {
    return 'Stop details';
  }
  if (
    typeLabel === 'Station' ||
    typeLabel === 'Ferry terminal' ||
    typeLabel === 'Terminal'
  ) {
    return 'Station details';
  }
  return 'Stop details';
}

/** Uppercase entity chip shown inside the detail card (matches mutedLabel styling). */
export function transportStopEntityLabel(
  selection: TransportMapSelection | null | undefined,
  stopType: string,
  mode: string,
): string {
  if (selection?.kind === 'terminal') {
    return 'TERMINAL';
  }

  const normalized = stopType.trim().toLowerCase();
  if (normalized === 'terminal' || normalized === 'ferry_terminal') {
    return 'TERMINAL';
  }
  if (
    normalized === 'station' ||
    normalized === 'bus_station' ||
    normalized === 'rail_station' ||
    normalized === 'airport'
  ) {
    return 'STATION';
  }
  if (STATION_STOP_TYPES.has(normalized) && normalized !== 'bus_stop') {
    return normalized === 'ferry_terminal' ? 'TERMINAL' : 'STATION';
  }
  if (mode === 'rail' || mode === 'train') {
    return 'STATION';
  }
  return 'BUS STOP';
}

/** @deprecated Use {@link transportStopEntityLabel} for card chip labels. */
export function transportStopEyebrowLabel(
  selection: TransportMapSelection | null | undefined,
  stopType: string,
  mode: string,
): string {
  return transportStopEntityLabel(selection, stopType, mode);
}
