#!/usr/bin/env python3
"""
Validate overview PMTiles vector_layers match style/registry expectations.

Fails if:
  - any required source-layer is missing from the archive
  - forbidden legacy layers are present (mmr_country_highlight, mmr_admin0, mmr_admin0_overview)
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

REQUIRED_LAYERS = [
    "land",
    "ocean",
    "coastline",
    "countries",
    "country_boundaries",
    "populated_places",
    "lakes",
    "rivers",
    "mmr_admin0_z0_2",
    "mmr_admin0_z3_4",
    "mmr_admin0_z5_6",
    "mmr_admin1",
]

FORBIDDEN_LAYERS = [
    "mmr_country_highlight",
    "mmr_admin0",
    "mmr_admin0_overview",
]


def vector_layer_ids(pmtiles_path: Path) -> list[str]:
    result = subprocess.run(
        ["pmtiles", "show", str(pmtiles_path), "--metadata"],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(f"pmtiles show failed: {result.stderr.strip()}")

    meta = json.loads(result.stdout)
    layers = meta.get("vector_layers", [])
    return [layer.get("id", "") for layer in layers if layer.get("id")]


def main() -> None:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <path-to-myanmar-overview.pmtiles>", file=sys.stderr)
        raise SystemExit(1)

    path = Path(sys.argv[1])
    if not path.is_file():
        raise SystemExit(f"missing file: {path}")

    present = set(vector_layer_ids(path))
    missing = [name for name in REQUIRED_LAYERS if name not in present]
    forbidden = [name for name in FORBIDDEN_LAYERS if name in present]

    if missing:
        print("❌ missing required source-layers:", ", ".join(missing), file=sys.stderr)
    if forbidden:
        print("❌ forbidden legacy source-layers present:", ", ".join(forbidden), file=sys.stderr)

    if missing or forbidden:
        print(f"   present: {sorted(present)}", file=sys.stderr)
        raise SystemExit(1)

    print(f"✅ PMTiles metadata OK ({len(present)} layers)")
    print("   includes mmr_admin0_z0_2/z3_4/z5_6; no legacy admin0 layers")


if __name__ == "__main__":
    main()
