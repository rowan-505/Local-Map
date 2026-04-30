import type { StyleSpecification } from "maplibre-gl";
import BaseMapStyle from "@local-map/map-style/base-map.json";

export const PLACE_MAP_STYLE: StyleSpecification = BaseMapStyle as StyleSpecification;

export const PLACE_MAP_DEFAULT_CENTER: [number, number] = [96.3242, 16.6395];
