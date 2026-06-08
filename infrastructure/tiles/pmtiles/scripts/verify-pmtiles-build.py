#!/usr/bin/env python3
"""
Post-build PMTiles verification and build manifest writer.

Checks output exists, size > 1 MiB, optional `pmtiles show`, writes JSON manifest.
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

MIN_FILE_BYTES = 1024 * 1024  # 1 MiB
PMTILES_SHOW_MAX_CHARS = 4000


def run_pmtiles_show(path: Path) -> tuple[bool, str]:
    if shutil.which("pmtiles") is None:
        return True, "(pmtiles CLI not found — skipped)"
    result = subprocess.run(
        ["pmtiles", "show", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    output = (result.stdout or result.stderr or "").strip()
    if len(output) > PMTILES_SHOW_MAX_CHARS:
        output = output[:PMTILES_SHOW_MAX_CHARS] + "\n...(truncated)"
    return result.returncode == 0, output


def main() -> int:
    if len(sys.argv) < 4:
        print(
            f"usage: {sys.argv[0]} <region> <version> <output.pmtiles> [inputs.json]",
            file=sys.stderr,
        )
        return 2

    region = sys.argv[1]
    version = sys.argv[2]
    output_path = Path(sys.argv[3]).resolve()
    inputs: dict = {}
    if len(sys.argv) > 4 and sys.argv[4].strip():
        parsed = json.loads(sys.argv[4])
        if isinstance(parsed, dict):
            inputs = parsed

    verification: dict[str, object] = {
        "ok": False,
        "file_exists": output_path.is_file(),
        "min_size_ok": False,
        "file_size_bytes": 0,
        "pmtiles_show_ok": None,
        "pmtiles_show": None,
    }

    if output_path.is_file():
        size = output_path.stat().st_size
        verification["file_size_bytes"] = size
        verification["min_size_ok"] = size > MIN_FILE_BYTES
        show_ok, show_output = run_pmtiles_show(output_path)
        verification["pmtiles_show_ok"] = show_ok
        verification["pmtiles_show"] = show_output
        verification["ok"] = bool(verification["min_size_ok"] and show_ok)
    else:
        verification["pmtiles_show"] = f"missing file: {output_path}"

    manifest = {
        "region": region,
        "version": version,
        "output_path": str(output_path),
        "file_size_bytes": verification["file_size_bytes"],
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "verification": verification,
        "inputs": inputs,
    }

    manifest_path = output_path.with_name(f"{output_path.stem}.build-manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"[verify] manifest written: {manifest_path}", file=sys.stderr)

    if verification["ok"]:
        print(
            f"[verify] OK {output_path.name} "
            f"({verification['file_size_bytes']} bytes)",
            file=sys.stderr,
        )
        return 0

    print(f"[verify] FAILED {output_path.name}", file=sys.stderr)
    if not verification["file_exists"]:
        print("  - output file missing", file=sys.stderr)
    elif not verification["min_size_ok"]:
        print(f"  - file size must be > {MIN_FILE_BYTES} bytes", file=sys.stderr)
    elif verification.get("pmtiles_show_ok") is False:
        print("  - pmtiles show failed", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
