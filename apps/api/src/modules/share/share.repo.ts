import { Prisma, type PrismaClient } from "@prisma/client";

import type { ShareLinkRow } from "./share.types.js";

// Shared projection — internal `id` and access counters are intentionally never selected.
const shareSelect = Prisma.sql`
    SELECT
        code,
        target_type,
        place_public_id::text AS place_public_id,
        lat,
        lng,
        zoom::double precision AS zoom,
        address_line,
        plus_code
    FROM share.share_links
`;

export type InsertShareLinkInput = {
    code: string;
    targetType: "point" | "place";
    placePublicId: string | null;
    lat: number | null;
    lng: number | null;
    zoom: number | null;
    addressLine: string | null;
    plusCode: string | null;
};

export class ShareRepository {
    constructor(private readonly prisma: PrismaClient) {}

    /** Only public, non-deleted places can be shared. */
    async placeExists(placePublicId: string): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ exists: boolean }[]>(Prisma.sql`
            SELECT EXISTS (
                SELECT 1
                FROM core.core_places
                WHERE public_id = CAST(${placePublicId} AS uuid)
                  AND deleted_at IS NULL
                  AND is_public = true
            ) AS exists
        `);

        return rows[0]?.exists === true;
    }

    async findByCode(code: string): Promise<ShareLinkRow | null> {
        const rows = await this.prisma.$queryRaw<ShareLinkRow[]>(Prisma.sql`
            ${shareSelect}
            WHERE code = ${code}
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async findPlaceShare(placePublicId: string): Promise<ShareLinkRow | null> {
        const rows = await this.prisma.$queryRaw<ShareLinkRow[]>(Prisma.sql`
            ${shareSelect}
            WHERE target_type = 'place'
              AND place_public_id = CAST(${placePublicId} AS uuid)
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    /**
     * Point dedup. Matches the DB unique index expression exactly (lat/lng rounded
     * to 5 dp, zoom to 2 dp with NULL coalesced to -1) so a found row is the same
     * row the unique index would treat as a duplicate.
     */
    async findPointShare(
        lat: number,
        lng: number,
        zoom: number | null,
    ): Promise<ShareLinkRow | null> {
        const rows = await this.prisma.$queryRaw<ShareLinkRow[]>(Prisma.sql`
            ${shareSelect}
            WHERE target_type = 'point'
              AND round(lat::numeric, 5) = round(${lat}::numeric, 5)
              AND round(lng::numeric, 5) = round(${lng}::numeric, 5)
              AND round(coalesce(zoom, -1), 2) = round(coalesce(${zoom}::numeric, -1), 2)
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    /** Inserts a new share link and returns the public projection. */
    async insert(input: InsertShareLinkInput): Promise<ShareLinkRow> {
        const rows = await this.prisma.$queryRaw<ShareLinkRow[]>(Prisma.sql`
            INSERT INTO share.share_links
                (code, target_type, place_public_id, lat, lng, zoom, address_line, plus_code)
            VALUES (
                ${input.code},
                ${input.targetType},
                CAST(${input.placePublicId} AS uuid),
                ${input.lat},
                ${input.lng},
                ${input.zoom},
                ${input.addressLine},
                ${input.plusCode}
            )
            RETURNING
                code,
                target_type,
                place_public_id::text AS place_public_id,
                lat,
                lng,
                zoom::double precision AS zoom,
                address_line,
                plus_code
        `);

        return rows[0]!;
    }

    /** Best-effort access tracking. Failures here must not affect the resolve response. */
    async recordAccess(code: string): Promise<void> {
        await this.prisma.$executeRaw(Prisma.sql`
            UPDATE share.share_links
            SET access_count = access_count + 1,
                last_accessed_at = now()
            WHERE code = ${code}
        `);
    }
}
