/**
 * Pure TypeScript mirrors of candidate validation / source-status mapping.
 * SQL remains the source of truth at runtime; these helpers keep unit tests
 * aligned with pipeline_candidate_validation.sql.
 */

export type ValidationStatus = "valid" | "warning" | "invalid";
export type SourceStatus =
  | "source_new"
  | "source_changed"
  | "source_unchanged"
  | "source_missing";

export type DiffType = "new" | "changed" | "unchanged" | "deleted_candidate";

export function mapDiffToSourceStatus(
  diffType: string | null | undefined,
): SourceStatus | null {
  const key = (diffType ?? "").trim().toLowerCase();
  switch (key) {
    case "new":
    case "source_new":
      return "source_new";
    case "changed":
    case "source_changed":
      return "source_changed";
    case "unchanged":
    case "source_unchanged":
      return "source_unchanged";
    case "deleted_candidate":
    case "source_missing":
      return "source_missing";
    default:
      return null;
  }
}

export function classifySourceByHash(args: {
  currentId: number | null;
  previousId: number | null;
  currentHash: string | null;
  previousHash: string | null;
}): DiffType {
  if (args.currentId == null) return "deleted_candidate";
  if (args.previousId == null) return "new";
  if ((args.currentHash ?? "") !== (args.previousHash ?? "")) return "changed";
  return "unchanged";
}

/** Myanmar WGS84 envelope used by SQL helper (approximate). */
export function geomInMyanmarBounds(lon: number, lat: number): boolean {
  return lon >= 92.1 && lon <= 101.2 && lat >= 9.5 && lat <= 28.6;
}

export type ValidateCandidateInput = {
  family: string;
  externalId: string | null;
  hasGeometry: boolean;
  geometryValid?: boolean;
  geometryType?: string | null;
  inMyanmarBounds?: boolean;
  classCode?: string | null;
  classId?: number | null;
  canonicalName?: string | null;
  adminLevelId?: number | null;
  normalizedDataEmpty?: boolean;
  identityIsCanonicalLong?: boolean;
};

/**
 * Mirrors the high-level SQL checks (not PostGIS geometry internals).
 */
export function validateCandidate(input: ValidateCandidateInput): {
  status: ValidationStatus;
  notes: string[];
} {
  const family = (input.family ?? "").trim().toLowerCase();
  const notes: string[] = [];
  let invalid = false;
  let warning = false;

  if (!input.identityIsCanonicalLong) {
    notes.push("canonical_external_identity_missing_or_invalid");
    invalid = true;
  }

  const expectLine = ["roads", "water_lines", "routing_roads"].includes(family);
  const expectPoly = [
    "buildings",
    "landuse",
    "water_polygons",
    "admin_areas",
  ].includes(family);
  const expectPoint = family === "places";
  const barrier = family === "routing_barriers";
  const requireClass = family === "roads" || family === "places" || family === "landuse";
  const requireName = family === "admin_areas";
  const requireAdminLevel = family === "admin_areas";

  if (expectLine || expectPoly || expectPoint || barrier) {
    if (!input.hasGeometry) {
      notes.push("geometry_missing");
      invalid = true;
    } else {
      if (input.geometryValid === false) {
        notes.push("geometry_invalid");
        invalid = true;
      }
      const g = (input.geometryType ?? "").toUpperCase();
      if (expectLine && !["LINESTRING", "MULTILINESTRING"].includes(g)) {
        notes.push("geometry_type_mismatch_line");
        invalid = true;
      } else if (expectPoly && !["POLYGON", "MULTIPOLYGON"].includes(g)) {
        notes.push("geometry_type_mismatch_polygon");
        invalid = true;
      } else if (expectPoint && !["POINT", "MULTIPOINT"].includes(g)) {
        notes.push("geometry_type_mismatch_point");
        invalid = true;
      } else if (
        barrier &&
        !["POINT", "MULTIPOINT", "LINESTRING", "MULTILINESTRING"].includes(g)
      ) {
        notes.push("geometry_type_mismatch_barrier");
        invalid = true;
      }
      if (input.inMyanmarBounds === false) {
        notes.push("geometry_outside_myanmar_bounds");
        invalid = true;
      }
    }
  }

  const hasClass =
    input.classId != null ||
    (input.classCode != null && input.classCode.trim() !== "");
  if (requireClass && !hasClass) {
    notes.push("category_or_class_mapping_missing");
    invalid = true;
  } else if (
    !requireClass &&
    !hasClass &&
    ["buildings", "water_lines", "water_polygons", "routing_barriers"].includes(
      family,
    )
  ) {
    notes.push("category_or_class_mapping_missing");
    warning = true;
  }

  if (requireAdminLevel && input.adminLevelId == null) {
    notes.push("admin_level_mapping_missing");
    invalid = true;
  }

  const hasName =
    input.canonicalName != null && input.canonicalName.trim() !== "";
  if (requireName && !hasName) {
    notes.push("required_name_missing");
    invalid = true;
  } else if (
    !hasName &&
    ["roads", "places", "buildings", "landuse", "water_lines", "water_polygons"].includes(
      family,
    )
  ) {
    notes.push("optional_name_missing");
    warning = true;
  }

  if (
    input.normalizedDataEmpty &&
    ["roads", "places", "buildings", "admin_areas", "landuse"].includes(family)
  ) {
    notes.push("normalized_data_empty");
    warning = true;
  }

  return {
    status: invalid ? "invalid" : warning ? "warning" : "valid",
    notes,
  };
}
