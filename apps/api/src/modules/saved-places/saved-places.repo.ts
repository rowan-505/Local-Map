import { Prisma, type PrismaClient } from "@prisma/client";

export const SAVED_PLACE_ENTITY_TYPE = "place";
export const SAVED_MAP_POINT_ENTITY_TYPE = "map_point";

/** Unified row shape for list / detail queries (covers place + map_point saves). */
export type SavedPlaceRow = {
    saved_id: bigint;
    entity_type: string;
    entity_id: bigint | null;
    display_name: string | null;
    category_code: string | null;
    category_name: string | null;
    custom_name: string | null;
    address_line: string | null;
    plus_code: string | null;
    latitude: number | null;
    longitude: number | null;
    admin_area_id: bigint | null;
    created_at: Date;
};

export type SaveablePlace = {
    id: bigint;
    admin_area_id: bigint | null;
};

// Shared projection so list and detail return identical shapes.
const savedItemSelect = Prisma.sql`
    SELECT
        sp.id AS saved_id,
        sp.entity_type AS entity_type,
        sp.entity_id AS entity_id,
        p.display_name AS display_name,
        c.code AS category_code,
        c.name AS category_name,
        sp.custom_name AS custom_name,
        sp.address_line AS address_line,
        sp.plus_code AS plus_code,
        sp.latitude AS latitude,
        sp.longitude AS longitude,
        COALESCE(sp.admin_area_id, p.admin_area_id) AS admin_area_id,
        sp.created_at AS created_at
    FROM app.user_saved_places sp
    LEFT JOIN core.core_places p
        ON p.id = sp.entity_id
       AND sp.entity_type = 'place'
       AND p.deleted_at IS NULL
    LEFT JOIN ref.ref_poi_categories c
        ON c.id = p.category_id
`;

export class SavedPlacesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    /**
     * Resolves the internal user id from a JWT subject (public_id uuid).
     * Compares as text so a non-uuid subject (e.g. dev bypass) yields no row
     * instead of a Postgres cast error.
     */
    async findUserIdByPublicId(publicId: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM app_auth.auth_users
            WHERE public_id::text = ${publicId}
              AND deleted_at IS NULL
            LIMIT 1
        `);

        return rows[0]?.id ?? null;
    }

    /** Only public, non-deleted places are saveable. Returns null otherwise. */
    async findSaveablePlace(placeId: bigint): Promise<SaveablePlace | null> {
        const rows = await this.prisma.$queryRaw<SaveablePlace[]>(Prisma.sql`
            SELECT id, admin_area_id
            FROM core.core_places
            WHERE id = ${placeId}
              AND is_public = true
              AND deleted_at IS NULL
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async listForUser(userId: bigint): Promise<SavedPlaceRow[]> {
        return this.prisma.$queryRaw<SavedPlaceRow[]>(Prisma.sql`
            ${savedItemSelect}
            WHERE sp.user_id = ${userId}
            ORDER BY sp.created_at DESC, sp.id DESC
        `);
    }

    async findSavedItem(userId: bigint, savedId: bigint): Promise<SavedPlaceRow | null> {
        const rows = await this.prisma.$queryRaw<SavedPlaceRow[]>(Prisma.sql`
            ${savedItemSelect}
            WHERE sp.id = ${savedId}
              AND sp.user_id = ${userId}
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    /** Inserts a saved place. Throws Prisma P2002 on the (user, place) unique index. */
    async insertSavedPlace(input: {
        userId: bigint;
        placeId: bigint;
        adminAreaId: bigint | null;
    }): Promise<bigint> {
        const created = await this.prisma.userSavedPlace.create({
            data: {
                userId: input.userId,
                entityType: SAVED_PLACE_ENTITY_TYPE,
                entityId: input.placeId,
                adminAreaId: input.adminAreaId,
            },
            select: { id: true },
        });

        return created.id;
    }

    /**
     * Inserts a saved map point. Uses raw SQL so geom can be derived from
     * lat/lng via PostGIS (ST_MakePoint). entity_id stays NULL for map points.
     */
    async insertSavedMapPoint(input: {
        userId: bigint;
        customName: string | null;
        latitude: number;
        longitude: number;
        addressLine: string | null;
        plusCode: string | null;
        adminAreaId: bigint | null;
    }): Promise<bigint> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            INSERT INTO app.user_saved_places
                (user_id, entity_type, entity_id, custom_name, latitude, longitude,
                 address_line, plus_code, admin_area_id, geom)
            VALUES (
                ${input.userId},
                ${SAVED_MAP_POINT_ENTITY_TYPE},
                NULL,
                ${input.customName},
                ${input.latitude},
                ${input.longitude},
                ${input.addressLine},
                ${input.plusCode},
                ${input.adminAreaId},
                ST_SetSRID(ST_MakePoint(${input.longitude}, ${input.latitude}), 4326)
            )
            RETURNING id
        `);

        return rows[0]!.id;
    }

    /** Owner-scoped delete. Returns number of rows removed (0 = not found / not owner). */
    async deleteOwnedSavedPlace(userId: bigint, savedId: bigint): Promise<number> {
        const result = await this.prisma.userSavedPlace.deleteMany({
            where: { id: savedId, userId },
        });

        return result.count;
    }
}
