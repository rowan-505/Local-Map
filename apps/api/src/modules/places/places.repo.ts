import { Prisma, type PrismaClient } from "@prisma/client";

type ListPlacesParams = {
    limit: number;
    offset: number;
    q?: string;
    is_public?: boolean;
    is_verified?: boolean;
};

type EditablePlaceState = {
    public_id: string;
    lat: number;
    lng: number;
};

export type UpdatePlaceInput = {
    primary_name?: string;
    secondary_name?: string | null;
    name_local?: string | null;
    display_name?: string;
    category_id?: bigint | null;
    admin_area_id?: bigint | null;
    lat?: number;
    lng?: number;
    plus_code?: string | null;
    importance_score?: number | null;
    popularity_score?: number | null;
    confidence_score?: number | null;
    is_public?: boolean;
    is_verified?: boolean;
    source_type_id?: bigint | null;
    publish_status_id?: bigint | null;
};

export type CreatePlaceInput = {
    primary_name: string;
    secondary_name?: string | null;
    name_local?: string | null;
    display_name?: string;
    category_id: bigint;
    admin_area_id?: bigint | null;
    plus_code?: string | null;
    lat: number;
    lng: number;
    importance_score?: number | null;
    popularity_score?: number | null;
    confidence_score?: number | null;
    is_public?: boolean;
    is_verified?: boolean;
    source_type_id?: bigint | null;
    publish_status_id?: bigint | null;
};

export type PlaceRow = {
    public_id: string;
    primary_name: string;
    name_local: string | null;
    display_name: string;
    lat: number;
    lng: number;
    is_public: boolean;
    is_verified: boolean;
    created_at: Date;
    updated_at: Date;
    category_name: string | null;
    admin_area_name: string | null;
};

export type PlaceDetailRow = PlaceRow & {
    id: bigint;
    secondary_name: string | null;
    category_id: bigint;
    admin_area_id: bigint | null;
    plus_code: string | null;
    importance_score: number | null;
    popularity_score: number | null;
    confidence_score: number | null;
    source_type_id: bigint;
    publish_status_id: bigint | null;
    current_version_id: bigint | null;
    deleted_at: Date | null;
};

type PlaceFormCategoryRow = {
    id: bigint;
    name: string;
};

type PlaceFormAdminAreaRow = {
    id: bigint;
    canonical_name: string;
};

type PlaceFormRefRow = {
    id: bigint;
    code: string;
    name: string;
};

type PlaceDeleteRow = {
    public_id: string;
};

export type PlaceFormOptionsRow = {
    categories: PlaceFormCategoryRow[];
    admin_areas: PlaceFormAdminAreaRow[];
    source_types: PlaceFormRefRow[];
    publish_statuses: PlaceFormRefRow[];
};

export class PlacesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listPlaces(params: ListPlacesParams): Promise<PlaceRow[]> {
        const conditions: Prisma.Sql[] = [Prisma.sql`p.deleted_at IS NULL`];

        if (params.q) {
            const searchTerm = `%${params.q}%`;
            conditions.push(
                Prisma.sql`(
                    p.primary_name ILIKE ${searchTerm}
                    OR p.display_name ILIKE ${searchTerm}
                    OR p.name_local ILIKE ${searchTerm}
                )`
            );
        }

        if (params.is_public !== undefined) {
            conditions.push(Prisma.sql`p.is_public = ${params.is_public}`);
        }

        if (params.is_verified !== undefined) {
            conditions.push(Prisma.sql`p.is_verified = ${params.is_verified}`);
        }

        return this.prisma.$queryRaw<PlaceRow[]>(Prisma.sql`
            SELECT
                p.public_id,
                p.primary_name,
                p.name_local,
                p.display_name,
                p.lat,
                p.lng,
                p.is_public,
                p.is_verified,
                p.created_at,
                p.updated_at,
                c.name AS category_name,
                aa.canonical_name AS admin_area_name
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = p.admin_area_id
            WHERE ${Prisma.join(conditions, " AND ")}
            ORDER BY p.created_at DESC, p.updated_at DESC, p.public_id DESC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async getPlaceByPublicId(publicId: string): Promise<PlaceRow | null> {
        const rows = await this.prisma.$queryRaw<PlaceRow[]>(Prisma.sql`
            SELECT
                p.public_id,
                p.primary_name,
                p.name_local,
                p.display_name,
                p.lat,
                p.lng,
                p.is_public,
                p.is_verified,
                p.created_at,
                p.updated_at,
                c.name AS category_name,
                aa.canonical_name AS admin_area_name
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = p.admin_area_id
            WHERE p.public_id = CAST(${publicId} AS uuid)
              AND p.deleted_at IS NULL
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async getPlaceStateByPublicId(publicId: string): Promise<EditablePlaceState | null> {
        const rows = await this.prisma.$queryRaw<EditablePlaceState[]>(Prisma.sql`
            SELECT
                p.public_id,
                p.lat,
                p.lng
            FROM core.core_places AS p
            WHERE p.public_id = CAST(${publicId} AS uuid)
              AND p.deleted_at IS NULL
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async getPlaceDetailByPublicId(publicId: string): Promise<PlaceDetailRow | null> {
        const rows = await this.prisma.$queryRaw<PlaceDetailRow[]>(Prisma.sql`
            SELECT
                p.id,
                p.public_id,
                p.primary_name,
                p.secondary_name,
                p.name_local,
                p.display_name,
                p.category_id,
                c.name AS category_name,
                p.admin_area_id,
                aa.canonical_name AS admin_area_name,
                p.lat,
                p.lng,
                p.plus_code,
                p.importance_score::double precision AS importance_score,
                p.popularity_score::double precision AS popularity_score,
                p.confidence_score::double precision AS confidence_score,
                p.is_public,
                p.is_verified,
                p.source_type_id,
                p.publish_status_id,
                p.current_version_id,
                p.created_at,
                p.updated_at,
                p.deleted_at
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = p.admin_area_id
            WHERE p.public_id = CAST(${publicId} AS uuid)
              AND p.deleted_at IS NULL
            LIMIT 1
        `);

        return rows[0] ?? null;
    }

    async getPlaceFormOptions(): Promise<PlaceFormOptionsRow> {
        const [categories, adminAreas, sourceTypes, publishStatuses] = await Promise.all([
            this.prisma.refPoiCategory.findMany({
                select: {
                    id: true,
                    name: true,
                },
                orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
            }),
            this.prisma.coreAdminArea.findMany({
                where: {
                    isActive: true,
                },
                select: {
                    id: true,
                    canonicalName: true,
                },
                orderBy: {
                    canonicalName: "asc",
                },
            }),
            this.prisma.$queryRaw<PlaceFormRefRow[]>(Prisma.sql`
                SELECT id, code, name
                FROM ref.ref_source_types
                ORDER BY name ASC
            `),
            this.prisma.$queryRaw<PlaceFormRefRow[]>(Prisma.sql`
                SELECT id, code, name
                FROM ref.ref_publish_statuses
                ORDER BY name ASC
            `),
        ]);

        return {
            categories: categories.map((category) => ({
                id: category.id,
                name: category.name,
            })),
            admin_areas: adminAreas.map((adminArea) => ({
                id: adminArea.id,
                canonical_name: adminArea.canonicalName,
            })),
            source_types: sourceTypes,
            publish_statuses: publishStatuses,
        };
    }

    async hasCategory(categoryId: bigint): Promise<boolean> {
        const category = await this.prisma.refPoiCategory.findFirst({
            where: {
                id: categoryId,
            },
            select: {
                id: true,
            },
        });

        return Boolean(category);
    }

    async hasActiveAdminArea(adminAreaId: bigint): Promise<boolean> {
        const adminArea = await this.prisma.coreAdminArea.findFirst({
            where: {
                id: adminAreaId,
                isActive: true,
            },
            select: {
                id: true,
            },
        });

        return Boolean(adminArea);
    }

    async hasSourceType(sourceTypeId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM ref.ref_source_types
            WHERE id = ${sourceTypeId}
            LIMIT 1
        `);

        return rows.length > 0;
    }

    async hasPublishStatus(publishStatusId: bigint): Promise<boolean> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM ref.ref_publish_statuses
            WHERE id = ${publishStatusId}
            LIMIT 1
        `);

        return rows.length > 0;
    }

    async getSourceTypeIdByCode(code: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM ref.ref_source_types
            WHERE code = ${code}
            LIMIT 1
        `);

        return rows[0]?.id ?? null;
    }

    async createPlace(input: CreatePlaceInput): Promise<PlaceDetailRow | null> {
        const rows = await this.prisma.$queryRaw<{ public_id: string }[]>(Prisma.sql`
            INSERT INTO core.core_places (
                primary_name,
                secondary_name,
                name_local,
                display_name,
                category_id,
                admin_area_id,
                point_geom,
                lat,
                lng,
                plus_code,
                importance_score,
                popularity_score,
                confidence_score,
                is_public,
                is_verified,
                source_type_id,
                publish_status_id,
                created_at,
                updated_at,
                deleted_at
            )
            VALUES (
                ${input.primary_name},
                ${input.secondary_name ?? null},
                ${input.name_local ?? null},
                ${input.display_name ?? input.primary_name},
                ${input.category_id},
                ${input.admin_area_id ?? null},
                ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326),
                ${input.lat},
                ${input.lng},
                ${input.plus_code ?? null},
                ${input.importance_score ?? 0},
                ${input.popularity_score ?? 0},
                ${input.confidence_score ?? 0},
                ${input.is_public ?? true},
                ${input.is_verified ?? false},
                ${input.source_type_id},
                ${input.publish_status_id ?? null},
                now(),
                now(),
                null
            )
            RETURNING public_id
        `);

        const publicId = rows[0]?.public_id;

        if (!publicId) {
            return null;
        }

        return this.getPlaceDetailByPublicId(publicId);
    }

    async updatePlaceByPublicId(publicId: string, input: UpdatePlaceInput): Promise<boolean> {
        const currentPlace = await this.getPlaceStateByPublicId(publicId);

        if (!currentPlace) {
            return false;
        }

        const assignments: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];

        if (input.primary_name !== undefined) {
            assignments.push(Prisma.sql`primary_name = ${input.primary_name}`);
        }

        if (input.secondary_name !== undefined) {
            assignments.push(Prisma.sql`secondary_name = ${input.secondary_name}`);
        }

        if (input.name_local !== undefined) {
            assignments.push(Prisma.sql`name_local = ${input.name_local}`);
        }

        if (input.display_name !== undefined) {
            assignments.push(Prisma.sql`display_name = ${input.display_name}`);
        }

        if (input.category_id !== undefined) {
            assignments.push(Prisma.sql`category_id = ${input.category_id}`);
        }

        if (input.admin_area_id !== undefined) {
            assignments.push(Prisma.sql`admin_area_id = ${input.admin_area_id}`);
        }

        if (input.plus_code !== undefined) {
            assignments.push(Prisma.sql`plus_code = ${input.plus_code}`);
        }

        if (input.importance_score !== undefined) {
            assignments.push(Prisma.sql`importance_score = ${input.importance_score}`);
        }

        if (input.popularity_score !== undefined) {
            assignments.push(Prisma.sql`popularity_score = ${input.popularity_score}`);
        }

        if (input.confidence_score !== undefined) {
            assignments.push(Prisma.sql`confidence_score = ${input.confidence_score}`);
        }

        if (input.is_public !== undefined) {
            assignments.push(Prisma.sql`is_public = ${input.is_public}`);
        }

        if (input.is_verified !== undefined) {
            assignments.push(Prisma.sql`is_verified = ${input.is_verified}`);
        }

        if (input.source_type_id !== undefined) {
            assignments.push(Prisma.sql`source_type_id = ${input.source_type_id}`);
        }

        if (input.publish_status_id !== undefined) {
            assignments.push(Prisma.sql`publish_status_id = ${input.publish_status_id}`);
        }

        if (input.lat !== undefined || input.lng !== undefined) {
            const nextLat = input.lat ?? currentPlace.lat;
            const nextLng = input.lng ?? currentPlace.lng;

            assignments.push(Prisma.sql`lat = ${nextLat}`);
            assignments.push(Prisma.sql`lng = ${nextLng}`);
            assignments.push(
                Prisma.sql`point_geom = ST_SetSRID(ST_MakePoint(${nextLng}, ${nextLat}), 4326)`
            );
        }

        const updatedRows = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE core.core_places
            SET ${Prisma.join(assignments, ", ")}
            WHERE public_id = CAST(${publicId} AS uuid)
              AND deleted_at IS NULL
        `);

        return updatedRows > 0;
    }

    async updatePlace(publicId: string, input: UpdatePlaceInput): Promise<PlaceDetailRow | null> {
        const didUpdate = await this.updatePlaceByPublicId(publicId, input);

        if (!didUpdate) {
            return null;
        }

        return this.getPlaceDetailByPublicId(publicId);
    }

    async deletePlace(publicId: string): Promise<PlaceDeleteRow | null> {
        const rows = await this.prisma.$queryRaw<PlaceDeleteRow[]>(Prisma.sql`
            UPDATE core.core_places
            SET
                deleted_at = now(),
                updated_at = now(),
                is_public = false
            WHERE public_id = CAST(${publicId} AS uuid)
              AND deleted_at IS NULL
            RETURNING public_id
        `);

        return rows[0] ?? null;
    }
}
