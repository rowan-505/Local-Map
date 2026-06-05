#!/usr/bin/env python3
"""
Build land-aligned Myanmar admin0 overview outlines for overview PMTiles.

Derives geometry from the same Natural Earth `land` polygons that paint `overview-land`.
Produces three zoom-tier exports (not one geometry for all zooms):

  - mmr_admin0_z0_2.geojsonseq  (simplify 0.03°, drop islands < 50 km²)
  - mmr_admin0_z3_4.geojsonseq  (simplify 0.015°, drop islands < 10 km²)
  - mmr_admin0_z5_6.geojsonseq  (simplify 0.005°, drop islands < 1 km²)

Pipeline: clip land to Myanmar mask → dissolve (unary union) → MakeValid →
filter tiny fragments → minimal SimplifyPreserveTopology → remove duplicate vertices.
"""
from __future__ import annotations

import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

from osgeo import ogr

# Myanmar approximate latitude for sq-deg → km² conversion.
_MMR_REF_LAT_DEG = 19.0
_SQ_DEG_TO_KM2 = 111.32 * 111.32 * math.cos(math.radians(_MMR_REF_LAT_DEG))


@dataclass(frozen=True)
class ZoomTier:
    layer_id: str
    output_name: str
    simplify_tolerance_deg: float
    min_island_km2: float
    zoom_band: str


ZOOM_TIERS: tuple[ZoomTier, ...] = (
    ZoomTier("mmr_admin0_z0_2", "mmr_admin0_z0_2.geojsonseq", 0.03, 50.0, "z0-z2"),
    ZoomTier("mmr_admin0_z3_4", "mmr_admin0_z3_4.geojsonseq", 0.015, 10.0, "z3-z4"),
    ZoomTier("mmr_admin0_z5_6", "mmr_admin0_z5_6.geojsonseq", 0.005, 1.0, "z5-z6"),
)


def read_geojsonseq(path: Path) -> list[dict]:
    features: list[dict] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                features.append(json.loads(line))
    return features


def write_geojsonseq(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for feature in features:
            handle.write(json.dumps(feature, separators=(",", ":")) + "\n")


def geom_from_geojson(geometry: dict) -> ogr.Geometry:
    return ogr.CreateGeometryFromJson(json.dumps(geometry))


def flatten_polygons(geom: ogr.Geometry) -> list[ogr.Geometry]:
    gtype = geom.GetGeometryType()
    if gtype in (ogr.wkbPolygon, ogr.wkbPolygon25D):
        return [geom.Clone()]
    if gtype in (ogr.wkbMultiPolygon, ogr.wkbMultiPolygon25D):
        return [geom.GetGeometryRef(i).Clone() for i in range(geom.GetGeometryCount())]
    if gtype in (ogr.wkbGeometryCollection, ogr.wkbGeometryCollection25D):
        parts: list[ogr.Geometry] = []
        for i in range(geom.GetGeometryCount()):
            parts.extend(flatten_polygons(geom.GetGeometryRef(i)))
        return parts
    return []


def polygon_area_km2(geom: ogr.Geometry) -> float:
    """Approximate geodesic area from WGS84 polygon (OGR returns square degrees)."""
    return max(geom.GetArea(), 0.0) * _SQ_DEG_TO_KM2


def count_vertices(geom: ogr.Geometry) -> int:
    total = 0
    for poly in flatten_polygons(geom):
        ring = poly.GetGeometryRef(0)
        if ring is not None:
            total += ring.GetPointCount()
    return total


def make_valid(geom: ogr.Geometry) -> ogr.Geometry:
    fixed = geom.MakeValid()
    if fixed is None or fixed.IsEmpty():
        return geom.Clone()
    return fixed


def remove_repeated_points(geom: ogr.Geometry, epsilon: float = 1e-9) -> ogr.Geometry:
    """Drop consecutive duplicate ring vertices (ST_RemoveRepeatedPoints equivalent)."""
    parts: list[ogr.Geometry] = []
    for poly in flatten_polygons(geom):
        ring = poly.GetGeometryRef(0)
        if ring is None:
            continue
        cleaned = ogr.Geometry(ogr.wkbLinearRing)
        prev: tuple[float, float] | None = None
        for i in range(ring.GetPointCount()):
            x, y = ring.GetX(i), ring.GetY(i)
            if prev is None or abs(x - prev[0]) > epsilon or abs(y - prev[1]) > epsilon:
                cleaned.AddPoint(x, y)
                prev = (x, y)
        if cleaned.GetPointCount() < 4:
            continue
        out_poly = ogr.Geometry(ogr.wkbPolygon)
        out_poly.AddGeometry(cleaned)
        for h in range(1, poly.GetGeometryCount()):
            hole = poly.GetGeometryRef(h)
            if hole is not None:
                out_poly.AddGeometry(hole.Clone())
        parts.append(out_poly)

    if not parts:
        return geom.Clone()
    if len(parts) == 1:
        return parts[0]
    multi = ogr.Geometry(ogr.wkbMultiPolygon)
    for part in parts:
        multi.AddGeometry(part)
    return multi


def union_land_inside_myanmar(land_path: Path, mask_geom: ogr.Geometry) -> ogr.Geometry:
    union: ogr.Geometry | None = None
    for feature in read_geojsonseq(land_path):
        land_geom = geom_from_geojson(feature["geometry"])
        if not mask_geom.Intersects(land_geom):
            continue
        clipped = land_geom.Intersection(mask_geom)
        if clipped is None or clipped.IsEmpty():
            continue
        for part in flatten_polygons(clipped):
            union = part if union is None else union.Union(part)
    if union is None or union.IsEmpty():
        raise SystemExit("no Natural Earth land intersection inside Myanmar mask")
    return make_valid(union)


def filter_small_fragments(geom: ogr.Geometry, min_km2: float) -> ogr.Geometry:
    kept: list[ogr.Geometry] = []
    for part in flatten_polygons(geom):
        if polygon_area_km2(part) >= min_km2:
            kept.append(part)
    if not kept:
        raise SystemExit(f"all fragments removed at min_island_km2={min_km2}")
    result: ogr.Geometry = kept[0]
    for part in kept[1:]:
        result = result.Union(part)
    return make_valid(result)


def simplify_tier(geom: ogr.Geometry, tolerance_deg: float) -> ogr.Geometry:
    if tolerance_deg <= 0:
        return geom.Clone()
    simplified = geom.SimplifyPreserveTopology(tolerance_deg)
    if simplified is None or simplified.IsEmpty():
        return geom.Clone()
    return make_valid(simplified)


def geometry_to_feature(geom: ogr.Geometry, properties: dict) -> dict:
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": json.loads(geom.ExportToJson()),
    }


def export_tier(
    dissolved: ogr.Geometry,
    tier: ZoomTier,
    source_props: dict,
    out_dir: Path,
) -> int:
    filtered = filter_small_fragments(dissolved, tier.min_island_km2)
    simplified = simplify_tier(filtered, tier.simplify_tolerance_deg)
    cleaned = remove_repeated_points(simplified)
    verts = count_vertices(cleaned)

    props = {
        **source_props,
        "boundary_role": "overview",
        "boundary_source": "natural_earth_land",
        "boundary_precision": "high",
        "zoom_band": tier.zoom_band,
        "layer_id": tier.layer_id,
        "simplify_tolerance_deg": tier.simplify_tolerance_deg,
        "min_island_km2": tier.min_island_km2,
        "vertex_count": verts,
    }
    out_path = out_dir / tier.output_name
    write_geojsonseq(out_path, [geometry_to_feature(cleaned, props)])
    print(
        f"  ✅ {out_path} ({tier.zoom_band}, simplify={tier.simplify_tolerance_deg}°, "
        f"min_island={tier.min_island_km2} km², {verts} vertices)"
    )
    return verts


def prepare_boundaries(out_dir: Path) -> None:
    mask_path = out_dir / "mmr_country_highlight.geojsonseq"
    land_path = out_dir / "land.geojsonseq"
    for path in (mask_path, land_path):
        if not path.is_file():
            raise SystemExit(f"missing input: {path}")

    mask_features = read_geojsonseq(mask_path)
    if not mask_features:
        raise SystemExit(f"no features in {mask_path}")

    mask_geom = geom_from_geojson(mask_features[0]["geometry"])
    source_props = dict(mask_features[0].get("properties") or {})

    dissolved = union_land_inside_myanmar(land_path, mask_geom)
    before_verts = count_vertices(dissolved)
    print(f"  dissolved land∩mask: {before_verts} vertices (before tier simplify)")

    for tier in ZOOM_TIERS:
        export_tier(dissolved, tier, source_props, out_dir)

    print(f"  summary: before={before_verts} vertices; tiers={[t.layer_id for t in ZOOM_TIERS]}")


def main() -> None:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <natural-earth-clipped-dir>", file=sys.stderr)
        raise SystemExit(1)

    out_dir = Path(sys.argv[1])
    print("→ Preparing high-precision land-aligned Myanmar admin0 boundary tiers")
    prepare_boundaries(out_dir)


if __name__ == "__main__":
    main()
