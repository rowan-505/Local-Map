import { Prisma } from "@prisma/client";

import type { ImportReviewEntityFamilyConfig } from "./import-review-config.js";
import { buildGeometrySelect, colRef } from "./import-review-candidate-sql.js";

/** GeoJSON geometry only — for detail/map when list rows omit geom. */
export function buildCandidateGeometrySelect(config: ImportReviewEntityFamilyConfig): Prisma.Sql {
    const parts: Prisma.Sql[] = [
        Prisma.sql`${colRef(config, "id")} AS id`,
    ];

    const primaryGeom = config.geometryColumns.primary;
    if (primaryGeom !== undefined) {
        parts.push(buildGeometrySelect(config, true, primaryGeom, "geometry"));
    } else {
        parts.push(Prisma.sql`NULL::json AS geometry`);
    }

    const secondaryGeom = config.geometryColumns.secondary;
    if (secondaryGeom !== undefined) {
        parts.push(buildGeometrySelect(config, true, secondaryGeom, "centroid"));
    } else if (primaryGeom !== undefined && config.routeFamily === "places") {
        parts.push(buildGeometrySelect(config, true, primaryGeom, "centroid"));
    } else if (primaryGeom !== undefined && config.routeFamily === "roads") {
        parts.push(buildGeometrySelect(config, true, primaryGeom, "centroid"));
    } else {
        parts.push(Prisma.sql`NULL::json AS centroid`);
    }

    return Prisma.join(parts, ", ");
}
