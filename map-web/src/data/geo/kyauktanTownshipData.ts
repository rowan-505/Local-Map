/**
 * Kyauktan township boundary (Yangon). Geometry from OpenStreetMap relation 5996670 (ODbL).
 * Replace `kyauktan-township.json` to update the outline; keep valid GeoJSON FeatureCollection.
 */
import type { FeatureCollection } from 'geojson';
import kyauktanTownship from './kyauktan-township.json';

export const KYAUKTAN_TOWNSHIP_GEOJSON = kyauktanTownship as FeatureCollection;
