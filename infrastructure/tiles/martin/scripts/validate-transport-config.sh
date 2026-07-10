#!/usr/bin/env bash
# Validate Martin transport table sources in config.yaml (and config.local.yaml when present).
# Ensures maxzoom: 22 and required MVT property columns for the public web transport overlay.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MARTIN_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

python3 - "${MARTIN_DIR}" <<'PY'
from __future__ import annotations

import re
import sys
from pathlib import Path

martin_dir = Path(sys.argv[1])
expected_maxzoom = 22

transport_tables = [
    "transport_stops_v",
    "transport_terminals_v",
    "transport_route_paths_v",
    "transport_infrastructure_lines_v",
]

required_props = {
    "transport_stops_v": ["id", "public_id", "name", "stop_type", "mode", "review_status"],
    "transport_terminals_v": ["id", "public_id", "name", "mode", "review_status"],
    "transport_route_paths_v": ["id", "mode", "review_status"],
    "transport_infrastructure_lines_v": ["id", "public_id", "name", "mode", "review_status"],
}

failures = 0


def parse_table_blocks(text: str) -> dict[str, dict[str, str]]:
    lines = text.splitlines()
    tables: dict[str, dict[str, str]] = {}
    current: str | None = None
    table_indent: int | None = None
    props_indent: int | None = None
    in_props = False

    for line in lines:
        if not line.strip() or line.lstrip().startswith("#"):
            continue

        indent = len(line) - len(line.lstrip())
        stripped = line.strip()

        table_match = re.match(r"^([A-Za-z0-9_]+):\s*$", stripped)
        if table_match and stripped != "properties:":
            name = table_match.group(1)
            if name in transport_tables:
                current = name
                table_indent = indent
                tables[current] = {"maxzoom": "", "properties": []}
                in_props = False
                props_indent = None
                continue

        if current is None or table_indent is None:
            continue

        if indent <= table_indent and stripped.endswith(":") and not in_props:
            current = None
            table_indent = None
            in_props = False
            props_indent = None
            continue

        if stripped == "properties:":
            in_props = True
            props_indent = indent
            continue

        prop_match = re.match(r"^([A-Za-z0-9_]+):\s*", stripped)
        if not prop_match:
            continue

        key = prop_match.group(1)
        if in_props and props_indent is not None and indent > props_indent:
            tables[current]["properties"].append(key)
            continue

        if key == "maxzoom":
            tables[current]["maxzoom"] = stripped.split(":", 1)[1].strip()

    return tables


def validate_file(path: Path, label: str) -> None:
    global failures

    if not path.is_file():
        print(f"SKIP {label}: file not found ({path})")
        return

    print(f"== {label}: {path}")
    tables = parse_table_blocks(path.read_text(encoding="utf-8"))

    for table in transport_tables:
        block = tables.get(table)
        if block is None:
            print(f"  FAIL {table}: missing table block")
            failures += 1
            continue

        maxzoom = block.get("maxzoom", "")
        if str(maxzoom) != str(expected_maxzoom):
            print(f"  FAIL {table}: maxzoom={maxzoom or 'MISSING'} (expected {expected_maxzoom})")
            failures += 1
        else:
            print(f"  OK   {table}: maxzoom={maxzoom}")

        props = set(block.get("properties", []))
        if not props:
            print(f"  FAIL {table}: missing properties block (MVT would ship geometry + id only)")
            failures += 1
            continue

        for prop in required_props[table]:
            if prop not in props:
                print(f"  FAIL {table}: missing property {prop}")
                failures += 1


validate_file(martin_dir / "config.yaml", "production")
validate_file(martin_dir / "config.local.yaml", "local")

if failures:
    print(f"\nTransport Martin config validation failed ({failures} issue(s)).")
    sys.exit(1)

print("\nTransport Martin config validation passed.")
PY
