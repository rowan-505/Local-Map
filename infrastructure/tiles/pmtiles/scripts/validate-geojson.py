#!/usr/bin/env python3
"""
Lightweight GeoJSON validation for PMTiles export/build inputs.

Small files: full JSON parse (FeatureCollection check).
Large files: existence/size + ogrinfo read-only scan (avoids loading multi-GB JSON).
Optional manifest skip when layer fingerprint is unchanged and prior build verified OK.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

DEFAULT_FULL_VALIDATE_MAX_BYTES = 32 * 1024 * 1024  # 32 MiB


def file_fingerprint(path: Path) -> dict[str, int]:
    stat = path.stat()
    return {"size_bytes": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def load_manifest(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return data if isinstance(data, dict) else None


def can_skip_layer(manifest: dict | None, layer_key: str, path: Path) -> bool:
    if manifest is None:
        return False
    verification = manifest.get("verification")
    if not isinstance(verification, dict) or not verification.get("ok"):
        return False
    inputs = manifest.get("inputs")
    if not isinstance(inputs, dict):
        return False
    recorded = inputs.get(layer_key)
    if not isinstance(recorded, dict):
        return False
    current = file_fingerprint(path)
    return (
        recorded.get("size_bytes") == current["size_bytes"]
        and recorded.get("mtime_ns") == current["mtime_ns"]
    )


def validate_small(path: Path) -> None:
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"{path}: root must be a JSON object")
    if data.get("type") != "FeatureCollection":
        raise ValueError(f"{path}: expected FeatureCollection GeoJSON")
    features = data.get("features")
    if not isinstance(features, list):
        raise ValueError(f"{path}: FeatureCollection.features must be a list")


def validate_large(path: Path) -> None:
    result = subprocess.run(
        ["ogrinfo", "-ro", "-q", "-al", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "ogrinfo failed").strip()
        raise ValueError(f"{path}: {detail}")


def validate_geojson(path: Path, full_validate_max_bytes: int) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"missing file: {path}")
    size = path.stat().st_size
    if size == 0:
        raise ValueError(f"{path}: empty file")
    if size <= full_validate_max_bytes:
        validate_small(path)
    else:
        validate_large(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate GeoJSON for PMTiles pipeline")
    parser.add_argument("path", type=Path, help="GeoJSON file path")
    parser.add_argument(
        "--max-full-bytes",
        type=int,
        default=int(
            __import__("os").environ.get(
                "PMTILES_GEOJSON_FULL_VALIDATE_MAX_BYTES",
                str(DEFAULT_FULL_VALIDATE_MAX_BYTES),
            )
        ),
        help="Full JSON parse threshold in bytes (default 32 MiB)",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=None,
        help="Optional build manifest for unchanged-input skip",
    )
    parser.add_argument(
        "--layer",
        default=None,
        help="Layer key in manifest inputs (defaults to file name)",
    )
    args = parser.parse_args()

    path = args.path.resolve()
    layer_key = args.layer or path.name
    manifest = load_manifest(args.manifest) if args.manifest else None

    if can_skip_layer(manifest, layer_key, path):
        print(
            f"[validate] skip unchanged layer {layer_key} "
            f"(verified manifest: {args.manifest})",
            file=sys.stderr,
        )
        return 0

    validate_geojson(path, args.max_full_bytes)
    size = path.stat().st_size
    mode = "full" if size <= args.max_full_bytes else "lightweight"
    print(f"[validate] OK {layer_key} ({mode}, {size} bytes)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
