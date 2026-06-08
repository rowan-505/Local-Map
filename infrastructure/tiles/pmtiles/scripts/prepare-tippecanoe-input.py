#!/usr/bin/env python3
"""
Build-time GeoJSON → GeoJSONSeq with per-feature tippecanoe minzoom/maxzoom hints.

Does not change export SQL. Layer names stay identical to base-map.json source-layer ids.
Writes a sidecar <output>.stats.json with before/after counts and zoom visibility.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Any

# Must match packages/map-style/base-map.json source-layer names.
# Native tile detail caps (tippecanoe per-feature maxzoom). Public map camera max is z20.
# build-region.sh runs admin_areas/admin_boundaries in a separate tippecanoe pass capped at z14
# (per-feature hints here still apply inside that pass).
LAYER_MAXZOOM: dict[str, int] = {
    "streets": 20,
    "road_labels": 20,
    "buildings": 20,
    "admin_areas": 14,
    "admin_boundaries": 14,
    "admin_area_label_points": 20,
    "landuse": 20,
    "water_polygons": 20,
    "water_lines": 20,
    "village_labels": 20,
}

ADMIN_BOUNDARY_LEVEL_MAXZOOM: dict[str, int] = {
    "country": 14,
    "state_region": 14,
    "state": 14,
    "region": 14,
    "district": 14,
    "township": 18,
    "ward_village_tract": 20,
    "ward": 20,
    "village_tract": 20,
}
ADMIN_BOUNDARY_DEFAULT_MAXZOOM = 14

LAYER_MINZOOM: dict[str, int] = {
    "road_labels": 12,
    "buildings": 14,
    "admin_areas": 7,
    "admin_boundaries": 8,
    "landuse": 8,
    "water_polygons": 8,
    "water_lines": 9,
    "village_labels": 12,
}

# Admin label points — match base-map.json symbol layer minzoom tiers.
ADMIN_LEVEL_MINZOOM: dict[str, int] = {
    "township": 7,
    "district": 7,
    "city": 7,
    "state": 7,
    "region": 7,
    "ward": 10,
    "village_tract": 10,
    "village": 12,
    "locality": 12,
    "hamlet": 12,
    "neighborhood": 12,
    "quarter": 12,
}
ADMIN_LEVEL_DEFAULT_MINZOOM = 10

# Road class → tile minzoom. All features keep maxzoom 20 (full detail through z20).
STREET_CLASS_MINZOOM: dict[str, int] = {
    "motorway": 8,
    "trunk": 8,
    "primary": 8,
    "secondary": 10,
    "tertiary": 10,
    "residential": 12,
    "unclassified": 12,
    "unknown": 12,
    "service": 14,
    "track": 14,
    "path": 14,
    "footway": 14,
    "pedestrian": 14,
}

STREET_CLASS_DEFAULT_MINZOOM = 12
VISIBILITY_ZOOMS = (8, 10, 12, 14, 16, 18)


def street_minzoom(properties: dict[str, Any]) -> int:
    raw = properties.get("road_class_code") or properties.get("road_class") or "unknown"
    code = str(raw).strip().lower() or "unknown"
    return STREET_CLASS_MINZOOM.get(code, STREET_CLASS_DEFAULT_MINZOOM)


def admin_label_minzoom(properties: dict[str, Any]) -> int:
    raw = properties.get("admin_level_code") or ""
    code = str(raw).strip().lower()
    return ADMIN_LEVEL_MINZOOM.get(code, ADMIN_LEVEL_DEFAULT_MINZOOM)


def feature_minzoom(layer: str, properties: dict[str, Any]) -> int:
    if layer == "streets":
        return street_minzoom(properties)
    if layer == "admin_area_label_points":
        return admin_label_minzoom(properties)
    return LAYER_MINZOOM.get(layer, 8)


def admin_boundary_maxzoom(properties: dict[str, Any]) -> int:
    raw = properties.get("admin_level_code") or ""
    code = str(raw).strip().lower()
    return ADMIN_BOUNDARY_LEVEL_MAXZOOM.get(code, ADMIN_BOUNDARY_DEFAULT_MAXZOOM)


def feature_maxzoom(layer: str, properties: dict[str, Any]) -> int:
    if layer in ("admin_boundaries", "admin_areas"):
        return admin_boundary_maxzoom(properties)
    return LAYER_MAXZOOM.get(layer, 20)


def annotate_feature(layer: str, feature: dict[str, Any]) -> dict[str, Any]:
    props = feature.get("properties")
    if not isinstance(props, dict):
        props = {}
    maxzoom = feature_maxzoom(layer, props)
    minzoom = feature_minzoom(layer, props)
    if minzoom > maxzoom:
        minzoom = maxzoom
    out = dict(feature)
    out["tippecanoe"] = {
        "layer": layer,
        "minzoom": minzoom,
        "maxzoom": maxzoom,
    }
    return out


def iter_features(path: Path):
    if path.suffix == ".geojsonseq" or path.name.endswith(".geojsonseq"):
        with path.open(encoding="utf-8") as handle:
            for line_no, line in enumerate(handle, start=1):
                text = line.strip()
                if not text:
                    continue
                try:
                    yield json.loads(text)
                except json.JSONDecodeError as exc:
                    raise ValueError(f"{path}:{line_no}: invalid JSON line: {exc}") from exc
        return

    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict) or data.get("type") != "FeatureCollection":
        raise ValueError(f"{path}: expected FeatureCollection GeoJSON")
    features = data.get("features")
    if not isinstance(features, list):
        raise ValueError(f"{path}: FeatureCollection.features must be a list")
    for feature in features:
        if isinstance(feature, dict):
            yield feature


def visible_at_zoom(minzoom_hist: Counter[int], zoom: int) -> int:
    return sum(count for mz, count in minzoom_hist.items() if mz <= zoom)


def write_stats(
    layer: str,
    output_path: Path,
    input_count: int,
    output_count: int,
    minzoom_hist: Counter[int],
    road_class_hist: Counter[str] | None,
) -> Path:
    stats_path = Path(f"{output_path}.stats.json")
    visible = {str(z): visible_at_zoom(minzoom_hist, z) for z in VISIBILITY_ZOOMS}
    payload = {
        "layer": layer,
        "input_features": input_count,
        "output_features": output_count,
        "minzoom_histogram": {str(k): minzoom_hist[k] for k in sorted(minzoom_hist)},
        "visible_at_zoom": visible,
    }
    if road_class_hist is not None:
        payload["road_class_histogram"] = dict(road_class_hist.most_common())
    stats_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return stats_path


def main() -> int:
    if len(sys.argv) != 4:
        print(
            "usage: prepare-tippecanoe-input.py <layer> <input.geojson|.geojsonseq> <output.geojsonseq>",
            file=sys.stderr,
        )
        return 2

    layer = sys.argv[1]
    input_path = Path(sys.argv[2])
    output_path = Path(sys.argv[3])
    layer_maxzoom = int(LAYER_MAXZOOM.get(layer, 20))

    if not input_path.is_file():
        print(f"error: missing input file: {input_path}", file=sys.stderr)
        return 1

    input_count = 0
    output_count = 0
    minzoom_hist: Counter[int] = Counter()
    road_class_hist: Counter[str] | None = Counter() if layer == "streets" else None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as out:
        for feature in iter_features(input_path):
            input_count += 1
            props = feature.get("properties")
            if not isinstance(props, dict):
                props = {}
            if road_class_hist is not None:
                raw = props.get("road_class_code") or props.get("road_class") or "unknown"
                road_class_hist[str(raw).strip().lower() or "unknown"] += 1

            annotated = annotate_feature(layer, feature)
            minzoom = int(annotated["tippecanoe"]["minzoom"])
            minzoom_hist[minzoom] += 1

            out.write(json.dumps(annotated, ensure_ascii=False, separators=(",", ":")))
            out.write("\n")
            output_count += 1

    stats_path = write_stats(layer, output_path, input_count, output_count, minzoom_hist, road_class_hist)

    print(
        f"[prepare] {layer}: {input_count} -> {output_count} features "
        f"(native tile detail to z{layer_maxzoom} default; stats={stats_path.name})",
        file=sys.stderr,
    )
    if layer == "streets":
        parts = [f"z{z}={visible_at_zoom(minzoom_hist, z)}" for z in VISIBILITY_ZOOMS]
        print(f"[prepare] {layer} visible by minzoom: {', '.join(parts)}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
