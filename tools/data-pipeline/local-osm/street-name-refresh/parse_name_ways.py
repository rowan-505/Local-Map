#!/usr/bin/env python3
"""Convert an Osmium-filtered way XML file into name-only CSV metadata.

The input must contain OSM ways only. Node references are ignored deliberately:
this workflow never decodes or writes street geometry.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import xml.etree.ElementTree as ET
from collections import Counter
from pathlib import Path


CURRENT_TAGS = ("name", "name:my", "name:en", "name:und")
SECONDARY_TAGS = ("official_name", "short_name", "loc_name", "alt_name", "old_name")


def nonblank(value: str | None) -> bool:
    return bool(value and value.strip())


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-csv", required=True, type=Path)
    parser.add_argument("--summary-json", required=True, type=Path)
    parser.add_argument("--pbf-path", required=True, type=Path)
    parser.add_argument("--pbf-timestamp", required=True)
    parser.add_argument("--ways-scanned", required=True, type=int)
    args = parser.parse_args()

    args.output_csv.parent.mkdir(parents=True, exist_ok=True)
    args.summary_json.parent.mkdir(parents=True, exist_ok=True)

    ways = 0
    tag_counts: Counter[str] = Counter()
    other_language_counts: Counter[str] = Counter()

    with args.output_csv.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(
            output,
            fieldnames=("osm_way_id", "osm_version", "osm_timestamp", "tags_json"),
        )
        writer.writeheader()

        for _, element in ET.iterparse(args.input, events=("end",)):
            if element.tag != "way":
                # Tag attributes are needed when their parent way closes. The
                # parent clear below releases both tags and node references.
                continue

            tags = {
                child.attrib["k"]: child.attrib.get("v", "")
                for child in element
                if child.tag == "tag" and "k" in child.attrib
            }
            ways += 1
            for key in CURRENT_TAGS + SECONDARY_TAGS:
                if nonblank(tags.get(key)):
                    tag_counts[key] += 1
            for key, value in tags.items():
                if key.startswith("name:") and key not in CURRENT_TAGS and nonblank(value):
                    tag_counts["other_name:* "] += 1
                    other_language_counts[key] += 1

            writer.writerow(
                {
                    "osm_way_id": element.attrib["id"],
                    "osm_version": element.attrib.get("version") or "",
                    "osm_timestamp": element.attrib.get("timestamp") or "",
                    "tags_json": json.dumps(
                        tags, ensure_ascii=False, separators=(",", ":"), sort_keys=True
                    ),
                }
            )
            element.clear()

    summary = {
        "pbf_path": str(args.pbf_path.resolve()),
        "pbf_sha256": sha256(args.pbf_path),
        "pbf_timestamp": args.pbf_timestamp,
        "osm_ways_scanned": args.ways_scanned,
        "name_metadata_ways": ways,
        "tag_counts": {
            "name": tag_counts["name"],
            "name:my": tag_counts["name:my"],
            "name:en": tag_counts["name:en"],
            "name:und": tag_counts["name:und"],
            "other_name:*": tag_counts["other_name:* "],
            **{key: tag_counts[key] for key in SECONDARY_TAGS},
        },
        "other_language_tag_counts": dict(
            sorted(other_language_counts.items(), key=lambda item: (-item[1], item[0]))
        ),
    }
    args.summary_json.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
