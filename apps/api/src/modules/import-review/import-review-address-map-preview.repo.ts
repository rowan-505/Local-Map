import { Prisma, type PrismaClient } from "@prisma/client";

import type { AddressMapPreviewLayers } from "./import-review-address-responses.js";
import type { ImportReviewGeoJson } from "./import-review.types.js";

export class ImportReviewAddressMapPreviewRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async fetchMapPreviewLayers(args: {
        matchedBuildingId: bigint | null;
        matchedStreetId: bigint | null;
        matchedAdminAreaId: bigint | null;
    }): Promise<Pick<
        AddressMapPreviewLayers,
        "matched_building" | "matched_street" | "matched_admin_area"
    >> {
        const [matched_building, matched_street, matched_admin_area] = await Promise.all([
            args.matchedBuildingId !== null
                ? this.fetchBuildingGeoJson(args.matchedBuildingId)
                : Promise.resolve(null),
            args.matchedStreetId !== null
                ? this.fetchStreetGeoJson(args.matchedStreetId)
                : Promise.resolve(null),
            args.matchedAdminAreaId !== null
                ? this.fetchAdminAreaGeoJson(args.matchedAdminAreaId)
                : Promise.resolve(null),
        ]);

        return { matched_building, matched_street, matched_admin_area };
    }

    private async fetchBuildingGeoJson(id: bigint): Promise<ImportReviewGeoJson | null> {
        const rows = await this.prisma.$queryRaw<Array<{ geojson: unknown }>>`
            SELECT ST_AsGeoJSON(b.geom)::json AS geojson
            FROM core.core_map_buildings AS b
            WHERE b.id = ${id}
              AND b.deleted_at IS NULL
              AND b.geom IS NOT NULL
              AND NOT ST_IsEmpty(b.geom)
            LIMIT 1
        `;
        return (rows[0]?.geojson as ImportReviewGeoJson | null) ?? null;
    }

    private async fetchStreetGeoJson(id: bigint): Promise<ImportReviewGeoJson | null> {
        const rows = await this.prisma.$queryRaw<Array<{ geojson: unknown }>>`
            SELECT ST_AsGeoJSON(s.geom)::json AS geojson
            FROM core.core_streets AS s
            WHERE s.id = ${id}
              AND s.deleted_at IS NULL
              AND s.is_active IS TRUE
              AND s.geom IS NOT NULL
              AND NOT ST_IsEmpty(s.geom)
            LIMIT 1
        `;
        return (rows[0]?.geojson as ImportReviewGeoJson | null) ?? null;
    }

    private async fetchAdminAreaGeoJson(id: bigint): Promise<ImportReviewGeoJson | null> {
        const rows = await this.prisma.$queryRaw<Array<{ geojson: unknown }>>`
            SELECT ST_AsGeoJSON(aa.geom)::json AS geojson
            FROM core.core_admin_areas AS aa
            WHERE aa.id = ${id}
              AND aa.deleted_at IS NULL
              AND aa.is_active IS TRUE
              AND aa.geom IS NOT NULL
              AND NOT ST_IsEmpty(aa.geom)
            LIMIT 1
        `;
        return (rows[0]?.geojson as ImportReviewGeoJson | null) ?? null;
    }
}
