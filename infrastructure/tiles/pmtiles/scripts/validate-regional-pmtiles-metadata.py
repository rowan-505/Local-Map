#!/usr/bin/env python3
"""
Validate regional PMTiles vector_layers match base-map.json expectations.

Fails if any required source-layer is missing from the archive.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REQUIRED_LAYERS = [
    "streets",
    "road_labels",
    "buildings",
    "water_polygons",
    "water_lines",
    "landuse",
    "admin_boundaries",
    "admin_areas",
]


def pmtiles_metadata(pmtiles_path: Path) -> dict:
    result = subprocess.run(
        ["pmtiles", "show", str(pmtiles_path), "--metadata"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"pmtiles show failed: {result.stderr.strip()}")
    return json.loads(result.stdout)


def vector_layer_ids(meta: dict) -> list[str]:
    layers = meta.get("vector_layers", [])
    return [layer.get("id", "") for layer in layers if layer.get("id")]


def main() -> None:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <path-to-regional.pmtiles>", file=sys.stderr)
        raise SystemExit(1)

    path = Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"missing file: {path}")

    meta = pmtiles_metadata(path)
    present = set(vector_layer_ids(meta))
    missing = [name for name in REQUIRED_LAYERS if name not in present]

    if missing:
        print("❌ missing required source-layers:", ", ".join(missing), file=sys.stderr)
        print(f"   present: {sorted(present)}", file=sys.stderr)
        raise SystemExit(1)

    tile_max = meta.get("maxzoom")
    print(f"✅ PMTiles metadata OK ({len(present)} layers, tile maxzoom={tile_max})")
    print(f"   required: {', '.join(REQUIRED_LAYERS)}")


if __name__ == "__main__":
    main()
