/**
 * Canonical OSM place=* → CoreMap settlement type.
 * Keep aligned with system.pipeline_canonical_settlement_type in pipeline_settlements.sql.
 * Does not invent names. OSM hamlet/quarter/suburb/neighbourhood/locality stay in source metadata.
 */

export const OSM_SETTLEMENT_PLACE_VALUES = [
  "city",
  "town",
  "village",
  "hamlet",
  "suburb",
  "quarter",
  "neighbourhood",
  "neighborhood",
  "locality",
] as const;

export type OsmSettlementPlace = (typeof OSM_SETTLEMENT_PLACE_VALUES)[number];
export type CanonicalSettlementType = "city" | "town" | "village" | "local_area";

export function canonicalSettlementType(
  place: string | null | undefined
): CanonicalSettlementType | null {
  const v = String(place ?? "")
    .trim()
    .toLowerCase();
  switch (v) {
    case "city":
      return "city";
    case "town":
      return "town";
    case "village":
      return "village";
    case "hamlet":
      return "village";
    case "quarter":
    case "suburb":
    case "neighbourhood":
    case "neighborhood":
    case "locality":
    case "local_area":
      return "local_area";
    default:
      return null;
  }
}

export function isCanonicalSettlementType(
  type: string | null | undefined
): boolean {
  const v = String(type ?? "")
    .trim()
    .toLowerCase();
  return v === "city" || v === "town" || v === "village" || v === "local_area";
}

export function canonicalSettlementDuplicateThresholdM(
  type: string | null | undefined
): number | null {
  switch (String(type ?? "").trim().toLowerCase()) {
    case "city":
      return 500;
    case "town":
      return 300;
    case "village":
      return 100;
    case "local_area":
      return 80;
    default:
      return null;
  }
}

/** OSM original names only. Never generate a missing name. */
export function settlementCanonicalNameFromTags(
  tags: Record<string, string | null | undefined> | null | undefined
): string | null {
  if (tags == null) return null;
  const keys = [
    "name:my",
    "name:mm",
    "name:my-MM",
    "name",
    "official_name",
    "name:en",
    "alt_name",
  ];
  for (const key of keys) {
    const raw = tags[key];
    if (raw == null) continue;
    const v = String(raw).trim();
    if (v !== "") return v;
  }
  return null;
}
