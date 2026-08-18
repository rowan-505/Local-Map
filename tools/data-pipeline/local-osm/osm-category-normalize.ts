/**
 * OSM → CoreMap category normalization (local-osm pipeline).
 *
 * Keep aligned with pipeline_osm_category_normalize.sql.
 * Maps tags → stable CODE strings. Resolve numeric IDs via JOIN on code in SQL.
 */

export type OsmTagMap = Record<string, string | null | undefined>;

function tag(tags: OsmTagMap | null | undefined, key: string): string | null {
  if (tags == null) return null;
  const raw = tags[key];
  if (raw == null) return null;
  const v = String(raw).trim().toLowerCase();
  return v === "" ? null : v;
}

export function isCoastlineTags(tags: OsmTagMap | null | undefined): boolean {
  return tag(tags, "natural") === "coastline";
}

export function isWaterPolygonCandidateTags(
  tags: OsmTagMap | null | undefined
): boolean {
  const natural = tag(tags, "natural");
  const waterway = tag(tags, "waterway");
  return (
    natural === "water" ||
    tag(tags, "water") != null ||
    waterway === "riverbank"
  );
}

export function isLandAreaCandidateTags(
  tags: OsmTagMap | null | undefined
): boolean {
  if (tags == null) return false;
  if (tag(tags, "landuse") != null) return true;
  const natural = tag(tags, "natural");
  if (
    natural != null &&
    [
      "wetland",
      "wood",
      "forest",
      "grassland",
      "scrub",
      "heath",
      "sand",
      "beach",
      "bare_rock",
      "mud",
    ].includes(natural)
  ) {
    return true;
  }
  const leisure = tag(tags, "leisure");
  if (
    leisure != null &&
    ["park", "recreation_ground", "garden"].includes(leisure)
  ) {
    return true;
  }
  return tag(tags, "amenity") === "grave_yard";
}

/**
 * Map OSM landuse/natural/wetland/leisure → CoreMap land-area CODE.
 * NULL = unmapped (skip Core; report coverage).
 */
export function normalizeLandAreaClass(
  tags: OsmTagMap | null | undefined
): string | null {
  const landuse = tag(tags, "landuse");
  const natural = tag(tags, "natural");
  const wetland = tag(tags, "wetland");
  const leisure = tag(tags, "leisure");
  const amenity = tag(tags, "amenity");

  if (natural === "wetland") {
    switch (wetland) {
      case "marsh":
      case "swamp":
      case "mangrove":
      case "reedbed":
      case "saltmarsh":
      case "tidalflat":
      case "bog":
      case "fen":
      case "wet_meadow":
        return wetland;
      default:
        return "wetland";
    }
  }

  if (landuse != null) {
    switch (landuse) {
      case "residential":
      case "commercial":
      case "retail":
      case "industrial":
      case "construction":
      case "farmland":
      case "orchard":
      case "farmyard":
      case "paddy":
      case "aquaculture":
      case "cemetery":
      case "religious":
      case "military":
      case "quarry":
      case "landfill":
        return landuse;
      case "farm":
        return "farmland";
      case "meadow":
      case "grass":
        return "grassland";
      case "forest":
        return "forest";
      case "railway":
      case "highway":
        return "transport";
      case "education":
      case "school":
      case "university":
        return "education";
      case "hospital":
      case "clinic":
        return "healthcare";
      case "brownfield":
      case "greenfield":
        return "vacant";
      case "basin":
      case "reservoir":
        return null;
      default:
        return null;
    }
  }

  if (natural != null) {
    switch (natural) {
      case "wood":
      case "forest":
        return "forest";
      case "grassland":
        return "grassland";
      case "scrub":
      case "heath":
      case "sand":
      case "beach":
      case "bare_rock":
      case "mud":
        return natural;
      default:
        return null;
    }
  }

  if (leisure != null) {
    switch (leisure) {
      case "park":
      case "recreation_ground":
        return leisure;
      case "garden":
        return "park";
      case "nature_reserve":
        // Protected-area overlay family — not a land-area class.
        return null;
      default:
        return null;
    }
  }

  if (amenity === "grave_yard") return "cemetery";
  return null;
}

/**
 * Map OSM waterway/water/natural → CoreMap water CODE.
 * kind: 'line' | 'polygon'
 */
export function normalizeWaterClass(
  tags: OsmTagMap | null | undefined,
  kind: "line" | "polygon" = "line"
): string | null {
  if (isCoastlineTags(tags)) return null;

  const waterway = tag(tags, "waterway");
  const water = tag(tags, "water");
  const natural = tag(tags, "natural");

  let raw: string | null;
  if (kind === "line") {
    raw = waterway;
  } else {
    raw =
      water ??
      (natural === "water" ? "water" : null) ??
      (waterway === "riverbank" ? "river" : waterway);
  }

  if (raw == null) return null;

  if (
    [
      "yes",
      "no",
      "seasonal",
      "intermittent",
      "tidal",
      "permanent",
      "intermittent;yes",
      "yes;intermittent",
    ].includes(raw)
  ) {
    return null;
  }

  if (raw === "lake;pond" || raw === "pond;lake") return "lake";
  if (
    ["fish_pond", "fish farming pond", "fish_farm", "fishpond"].includes(raw)
  ) {
    return "fishpond";
  }
  if (raw === "stream_pool" || raw === "stream pool") return "stream_pool";
  if (raw === "lock_gate" || raw === "lock gate") return "lock_gate";
  if (raw === "sluice_gate" || raw === "sluice gate") return "sluice_gate";
  if (raw === "tidal_channel" || raw === "tidal channel") return "tidal_channel";
  if (raw === "riverbank") return "river";

  const allowed = new Set([
    "river",
    "stream",
    "canal",
    "ditch",
    "drain",
    "tidal_channel",
    "water",
    "lake",
    "pond",
    "reservoir",
    "basin",
    "lagoon",
    "oxbow",
    "moat",
    "wastewater",
    "dam",
    "weir",
    "lock",
    "waterfall",
    "dock",
    "boatyard",
    "fishpond",
    "stream_pool",
    "lock_gate",
    "sluice_gate",
  ]);
  return allowed.has(raw) ? raw : null;
}

export function isCoremapLandAreaCode(code: string | null | undefined): boolean {
  if (code == null) return false;
  const c = String(code).trim().toLowerCase();
  return [
    "residential",
    "commercial",
    "retail",
    "industrial",
    "construction",
    "farmland",
    "paddy",
    "orchard",
    "farmyard",
    "aquaculture",
    "forest",
    "grassland",
    "scrub",
    "heath",
    "sand",
    "beach",
    "bare_rock",
    "mud",
    "park",
    "recreation_ground",
    "education",
    "healthcare",
    "religious",
    "cemetery",
    "government",
    "military",
    "vacant",
    "quarry",
    "landfill",
    "transport",
    "other",
    "wetland",
    "marsh",
    "swamp",
    "mangrove",
    "reedbed",
    "saltmarsh",
    "tidalflat",
    "bog",
    "fen",
    "wet_meadow",
  ].includes(c);
}

/** OSM tags that belong in the protected-area overlay family (not ordinary parks). */
export function isProtectedAreaCandidateTags(
  tags: OsmTagMap | null | undefined
): boolean {
  const boundary = tag(tags, "boundary");
  const leisure = tag(tags, "leisure");
  return (
    boundary === "protected_area" ||
    boundary === "national_park" ||
    leisure === "nature_reserve"
  );
}

/**
 * Map OSM protected-area tags → CoreMap protected-area CODE.
 * Keep protect_class / designation / protection_title as raw metadata.
 */
export function normalizeProtectedAreaClass(
  tags: OsmTagMap | null | undefined
): string | null {
  if (!isProtectedAreaCandidateTags(tags)) return null;

  const boundary = tag(tags, "boundary");
  const leisure = tag(tags, "leisure");
  const title = tag(tags, "protection_title");
  const designation = tag(tags, "designation");
  const protectClass = tag(tags, "protect_class");

  if (boundary === "national_park") return "national_park";

  const titleOrDes = `${title ?? ""} ${designation ?? ""}`;
  if (/(wildlife|sanctuar)/.test(titleOrDes)) return "wildlife_protected_area";
  if (/(forest.?reserve|reserved.?forest)/.test(titleOrDes)) return "forest_reserve";
  if (/(marine|mpa)/.test(titleOrDes)) return "marine_protected_area";

  if (leisure === "nature_reserve") return "nature_reserve";
  if (boundary === "protected_area") return "other";
  if (protectClass != null || title != null || designation != null) return "other";
  return null;
}

export function isCoremapProtectedAreaCode(
  code: string | null | undefined
): boolean {
  if (code == null) return false;
  return [
    "national_park",
    "nature_reserve",
    "wildlife_protected_area",
    "forest_reserve",
    "marine_protected_area",
    "other",
  ].includes(String(code).trim().toLowerCase());
}
