/**
 * Opaque map handle for internal use — swap the implementation in `mapEngine` without touching parents.
 */
import type { Map, MapMouseEvent } from 'maplibre-gl';

export type MapEngine = Map;
export type { MapMouseEvent };
