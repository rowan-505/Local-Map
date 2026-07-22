/**
 * Shared OSM source-identity helpers for the local-osm pipeline.
 *
 * Canonical NEW pipeline identity:
 *   osm:node:<id> | osm:way:<id> | osm:relation:<id>
 *
 * Legacy production identity (preserved; matched via identity key):
 *   osm:N:<id> | osm:W:<id> | osm:R:<id>
 *
 * Keep this module aligned with pipeline_source_identity.sql.
 */

export type OsmFeatureTypeCanonical = "node" | "way" | "relation";

export type OsmIdentityClass =
  | "canonical_long"
  | "legacy_short"
  | "null_or_blank"
  | "other";

export function osmFeatureTypeCanonical(
  featureType: string | null | undefined
): OsmFeatureTypeCanonical | null {
  if (featureType == null) return null;
  const raw = String(featureType).trim().toLowerCase();
  if (raw === "n" || raw === "node") return "node";
  if (raw === "w" || raw === "way") return "way";
  if (raw === "r" || raw === "rel" || raw === "relation") return "relation";
  return null;
}

export function osmExternalId(
  featureType: string | null | undefined,
  osmId: string | number | bigint | null | undefined
): string | null {
  const type = osmFeatureTypeCanonical(featureType);
  if (type == null || osmId == null) return null;
  const id = String(osmId).trim();
  if (id === "" || !/^[0-9]+$/.test(id)) return null;
  return `osm:${type}:${id}`;
}

export function osmIdentityKey(
  externalId: string | null | undefined
): string | null {
  if (externalId == null) return null;
  let raw = String(externalId).trim();
  if (raw === "") return null;

  if (raw.toLowerCase().startsWith("osm:")) {
    raw = raw.slice(4);
  }

  raw = raw.replaceAll("/", ":");
  const parts = raw.split(":");
  if (parts.length < 2) return null;

  const type = osmFeatureTypeCanonical(parts[0]);
  const id = (parts[1] ?? "").trim();
  if (type == null || id === "" || !/^[0-9]+$/.test(id)) return null;
  return `osm:${type}:${id}`;
}

export function osmIdentityMatches(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const keyA = osmIdentityKey(a);
  const keyB = osmIdentityKey(b);
  return keyA != null && keyA === keyB;
}

export function osmClassifyIdentity(
  externalId: string | null | undefined
): OsmIdentityClass {
  if (externalId == null || String(externalId).trim() === "") {
    return "null_or_blank";
  }
  const value = String(externalId).trim();
  if (/^osm:(node|way|relation):[0-9]+$/.test(value)) return "canonical_long";
  if (/^osm:[NWR]:[0-9]+$/.test(value)) return "legacy_short";
  return "other";
}
