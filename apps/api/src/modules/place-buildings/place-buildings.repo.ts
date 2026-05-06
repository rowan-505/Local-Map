import { Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type LinkedBuildingSummaryRow = {
    relation_type: string;
    is_primary: boolean;
    created_at: Date;
    building_public_id: string;
    building_name: string | null;
    building_type_id: string | null;
    ref_bt_id: string | null;
    ref_bt_code: string | null;
    ref_bt_name: string | null;
    ref_bt_name_mm: string | null;
    ref_bt_parent_id: string | null;
    building_type_code: string | null;
    building_type_name: string | null;
    building_type_name_mm: string | null;
    class_code: string;
    building_area_m2: number | null;
    building_admin_area_row_id: string | null;
    building_admin_area_canonical_name: string | null;
    building_admin_area_slug: string | null;
};

export type LinkedPlaceSummaryRow = {
    relation_type: string;
    is_primary: boolean;
    created_at: Date;
    place_public_id: string;
    place_primary_name: string;
    place_display_name: string;
    place_lat: number;
    place_lng: number;
    category_name: string | null;
};

export class PlaceBuildingsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async resolveActivePlaceInternalId(placePublicId: string, db: DbClient = this.prisma): Promise<bigint | null> {
        const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT p.id
            FROM core.core_places AS p
            WHERE p.public_id = CAST(${placePublicId} AS uuid)
              AND p.deleted_at IS NULL
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    /** Active, non-deleted building suitable for linking. */
    async resolveActiveBuildingInternalId(
        buildingPublicId: string,
        db: DbClient = this.prisma
    ): Promise<bigint | null> {
        const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT b.id
            FROM core.core_map_buildings AS b
            WHERE b.public_id = CAST(${buildingPublicId} AS uuid)
              AND b.deleted_at IS NULL
              AND b.is_active IS TRUE
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async resolveBuildingInternalIdAny(
        buildingPublicId: string,
        db: DbClient = this.prisma
    ): Promise<bigint | null> {
        const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT b.id
            FROM core.core_map_buildings AS b
            WHERE b.public_id = CAST(${buildingPublicId} AS uuid)
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    async linkExists(placeInternalId: bigint, buildingInternalId: bigint, db: DbClient = this.prisma): Promise<boolean> {
        const rows = await db.$queryRaw<{ ok: boolean }[]>(Prisma.sql`
            SELECT TRUE AS ok
            FROM core.core_place_buildings AS pb
            WHERE pb.place_id = ${placeInternalId}
              AND pb.building_id = ${buildingInternalId}
            LIMIT 1
        `);
        return Boolean(rows[0]?.ok);
    }

    async listBuildingsForPlace(placePublicId: string): Promise<LinkedBuildingSummaryRow[]> {
        return this.prisma.$queryRaw<LinkedBuildingSummaryRow[]>(Prisma.sql`
            SELECT
                pb.relation_type,
                pb.is_primary,
                pb.created_at,
                b.public_id::text AS building_public_id,
                b.name AS building_name,
                b.building_type_id::text AS building_type_id,
                bt.id::text AS ref_bt_id,
                bt.code AS ref_bt_code,
                bt.name AS ref_bt_name,
                bt.name_mm AS ref_bt_name_mm,
                bt.parent_id::text AS ref_bt_parent_id,
                bt.code AS building_type_code,
                bt.name AS building_type_name,
                bt.name_mm AS building_type_name_mm,
                b.class_code,
                b.area_m2::double precision AS building_area_m2,
                aa.id::text AS building_admin_area_row_id,
                aa.canonical_name AS building_admin_area_canonical_name,
                aa.slug AS building_admin_area_slug
            FROM core.core_places AS p
            INNER JOIN core.core_place_buildings AS pb
                ON pb.place_id = p.id
            INNER JOIN core.core_map_buildings AS b
                ON b.id = pb.building_id
            LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
            LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
            WHERE p.public_id = CAST(${placePublicId} AS uuid)
              AND p.deleted_at IS NULL
              AND b.deleted_at IS NULL
              AND b.is_active IS TRUE
            ORDER BY pb.is_primary DESC, pb.created_at ASC, b.id ASC
        `);
    }

    async listPlacesForBuilding(buildingPublicId: string): Promise<LinkedPlaceSummaryRow[]> {
        return this.prisma.$queryRaw<LinkedPlaceSummaryRow[]>(Prisma.sql`
            SELECT
                pb.relation_type,
                pb.is_primary,
                pb.created_at,
                p.public_id::text AS place_public_id,
                p.primary_name AS place_primary_name,
                COALESCE(p.display_name, p.primary_name) AS place_display_name,
                p.lat::double precision AS place_lat,
                p.lng::double precision AS place_lng,
                c.name AS category_name
            FROM core.core_map_buildings AS b
            INNER JOIN core.core_place_buildings AS pb
                ON pb.building_id = b.id
            INNER JOIN core.core_places AS p
                ON p.id = pb.place_id
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            WHERE b.public_id = CAST(${buildingPublicId} AS uuid)
              AND b.deleted_at IS NULL
              AND b.is_active IS TRUE
              AND p.deleted_at IS NULL
            ORDER BY pb.is_primary DESC, pb.created_at ASC, p.id ASC
        `);
    }

    async insertLink(
        placeInternalId: bigint,
        buildingInternalId: bigint,
        relationType: string,
        isPrimary: boolean
    ): Promise<LinkedBuildingSummaryRow | null> {
        return this.prisma.$transaction(async (tx) => {
            if (isPrimary) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE core.core_place_buildings AS pb
                    SET is_primary = FALSE
                    WHERE pb.place_id = ${placeInternalId}
                `);
            }

            await tx.$executeRaw(Prisma.sql`
                INSERT INTO core.core_place_buildings (place_id, building_id, relation_type, is_primary)
                VALUES (${placeInternalId}, ${buildingInternalId}, ${relationType}, ${isPrimary})
            `);

            const rows = await tx.$queryRaw<LinkedBuildingSummaryRow[]>(Prisma.sql`
                SELECT
                    pb.relation_type,
                    pb.is_primary,
                    pb.created_at,
                    b.public_id::text AS building_public_id,
                    b.name AS building_name,
                    b.building_type_id::text AS building_type_id,
                    bt.id::text AS ref_bt_id,
                    bt.code AS ref_bt_code,
                    bt.name AS ref_bt_name,
                    bt.name_mm AS ref_bt_name_mm,
                    bt.parent_id::text AS ref_bt_parent_id,
                    bt.code AS building_type_code,
                    bt.name AS building_type_name,
                    bt.name_mm AS building_type_name_mm,
                    b.class_code,
                    b.area_m2::double precision AS building_area_m2,
                    aa.id::text AS building_admin_area_row_id,
                    aa.canonical_name AS building_admin_area_canonical_name,
                    aa.slug AS building_admin_area_slug
                FROM core.core_place_buildings AS pb
                INNER JOIN core.core_map_buildings AS b
                    ON b.id = pb.building_id
                LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
                LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
                WHERE pb.place_id = ${placeInternalId}
                  AND pb.building_id = ${buildingInternalId}
                LIMIT 1
            `);

            return rows[0] ?? null;
        });
    }

    async deleteLink(placePublicId: string, buildingPublicId: string): Promise<boolean> {
        const result = await this.prisma.$executeRaw(Prisma.sql`
            DELETE FROM core.core_place_buildings AS pb
            USING core.core_places AS p,
                  core.core_map_buildings AS b
            WHERE pb.place_id = p.id
              AND pb.building_id = b.id
              AND p.public_id = CAST(${placePublicId} AS uuid)
              AND b.public_id = CAST(${buildingPublicId} AS uuid)
              AND p.deleted_at IS NULL
        `);

        return result > 0;
    }

    /**
     * Patch an existing link. When `is_primary` is set true, clears other primary flags for the place first.
     */
    async patchBuildingLinkForPlace(
        placePublicId: string,
        buildingPublicId: string,
        patch: { relation_type?: string; is_primary?: boolean }
    ): Promise<LinkedBuildingSummaryRow | null> {
        return this.prisma.$transaction(async (tx) => {
            const keyRows = await tx.$queryRaw<{ place_id: bigint; building_id: bigint }[]>(Prisma.sql`
                SELECT pb.place_id, pb.building_id
                FROM core.core_place_buildings AS pb
                INNER JOIN core.core_places AS p ON p.id = pb.place_id
                INNER JOIN core.core_map_buildings AS b ON b.id = pb.building_id
                WHERE p.public_id = CAST(${placePublicId} AS uuid)
                  AND p.deleted_at IS NULL
                  AND b.public_id = CAST(${buildingPublicId} AS uuid)
                  AND b.deleted_at IS NULL
                  AND b.is_active IS TRUE
                LIMIT 1
            `);

            const key = keyRows[0];

            if (!key) {
                return null;
            }

            const { place_id: placeInternalId, building_id: buildingInternalId } = key;

            if (patch.is_primary === true) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE core.core_place_buildings AS pb
                    SET is_primary = FALSE
                    WHERE pb.place_id = ${placeInternalId}
                `);
            }

            if (patch.relation_type !== undefined && patch.is_primary !== undefined) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE core.core_place_buildings AS pb
                    SET
                        relation_type = ${patch.relation_type},
                        is_primary = ${patch.is_primary}
                    WHERE pb.place_id = ${placeInternalId}
                      AND pb.building_id = ${buildingInternalId}
                `);
            } else if (patch.relation_type !== undefined) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE core.core_place_buildings AS pb
                    SET relation_type = ${patch.relation_type}
                    WHERE pb.place_id = ${placeInternalId}
                      AND pb.building_id = ${buildingInternalId}
                `);
            } else if (patch.is_primary !== undefined) {
                await tx.$executeRaw(Prisma.sql`
                    UPDATE core.core_place_buildings AS pb
                    SET is_primary = ${patch.is_primary}
                    WHERE pb.place_id = ${placeInternalId}
                      AND pb.building_id = ${buildingInternalId}
                `);
            }

            const rows = await tx.$queryRaw<LinkedBuildingSummaryRow[]>(Prisma.sql`
                SELECT
                    pb.relation_type,
                    pb.is_primary,
                    pb.created_at,
                    b.public_id::text AS building_public_id,
                    b.name AS building_name,
                    b.building_type_id::text AS building_type_id,
                    bt.id::text AS ref_bt_id,
                    bt.code AS ref_bt_code,
                    bt.name AS ref_bt_name,
                    bt.name_mm AS ref_bt_name_mm,
                    bt.parent_id::text AS ref_bt_parent_id,
                    bt.code AS building_type_code,
                    bt.name AS building_type_name,
                    bt.name_mm AS building_type_name_mm,
                    b.class_code,
                    b.area_m2::double precision AS building_area_m2,
                    aa.id::text AS building_admin_area_row_id,
                    aa.canonical_name AS building_admin_area_canonical_name,
                    aa.slug AS building_admin_area_slug
                FROM core.core_place_buildings AS pb
                INNER JOIN core.core_map_buildings AS b
                    ON b.id = pb.building_id
                LEFT JOIN ref.ref_building_types AS bt ON bt.id = b.building_type_id
                LEFT JOIN core.core_admin_areas AS aa ON aa.id = b.admin_area_id
                WHERE pb.place_id = ${placeInternalId}
                  AND pb.building_id = ${buildingInternalId}
                LIMIT 1
            `);

            return rows[0] ?? null;
        });
    }
}
