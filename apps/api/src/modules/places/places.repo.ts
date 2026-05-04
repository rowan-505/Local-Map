import { Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

type ListPlacesParams = {
    limit: number;
    offset: number;
    q?: string;
    category?: string;
    is_public?: boolean;
    is_verified?: boolean;
};

type EditablePlaceState = {
    public_id: string;
    lat: number;
    lng: number;
};

export type UpdatePlaceInput = {
    myanmarName?: string;
    englishName?: string;
    categoryId?: bigint | null;
    adminAreaId?: bigint | null;
    sourceTypeId?: bigint | null;
    category_id?: bigint | null;
    admin_area_id?: bigint | null;
    lat?: number;
    lng?: number;
    plus_code?: string | null;
    importance_score?: number | null;
    popularity_score?: number | null;
    confidence_score?: number | null;
    isPublic?: boolean;
    isVerified?: boolean;
    is_public?: boolean;
    is_verified?: boolean;
    source_type_id?: bigint | null;
    publish_status_id?: bigint | null;
};

export type CreatePlaceInput = {
    myanmarName?: string;
    englishName?: string;
    primary_name: string;
    display_name: string;
    category_id: bigint;
    admin_area_id?: bigint | null;
    plus_code?: string | null;
    lat: number;
    lng: number;
    importance_score?: number | null;
    popularity_score?: number | null;
    confidence_score?: number | null;
    isPublic?: boolean;
    isVerified?: boolean;
    is_public?: boolean;
    is_verified?: boolean;
    source_type_id?: bigint | null;
    publish_status_id?: bigint | null;
};

export type PlaceRow = {
    id: bigint;
    public_id: string;
    primary_name: string;
    display_name: string;
    category_id: bigint;
    admin_area_id: bigint | null;
    lat: number;
    lng: number;
    importance_score: number | null;
    popularity_score: number | null;
    confidence_score: number | null;
    is_public: boolean;
    is_verified: boolean;
    source_type_id: bigint;
    publish_status_id: bigint | null;
    created_at: Date;
    updated_at: Date;
    names: PlaceNameRow[];
    myanmar_name: string | null;
    english_name: string | null;
    category_name: string | null;
    admin_area_name: string | null;
};

export type PlaceDetailRow = PlaceRow & {
    plus_code: string | null;
    current_version_id: bigint | null;
    deleted_at: Date | null;
};

export type PlaceNameRow = {
    id: string;
    name: string;
    language_code: string | null;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
    search_weight: number;
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

        if (params.is_public !== undefined) {
            conditions.push(Prisma.sql`p.is_public = ${params.is_public}`);
        }

        if (params.q) {
            const searchTerm = `%${params.q}%`;
            conditions.push(
                Prisma.sql`(
                    p.primary_name ILIKE ${searchTerm}
                    OR p.display_name ILIKE ${searchTerm}
                    OR EXISTS (
                        SELECT 1
                        FROM core.core_place_names AS pn
                        WHERE pn.place_id = p.id
                          AND pn.name ILIKE ${searchTerm}
                    )
                )`
            );
        }

        if (params.is_verified !== undefined) {
            conditions.push(Prisma.sql`p.is_verified = ${params.is_verified}`);
        }

        const categoryFilter = buildCategoryFilter(params.category);

        return this.prisma.$queryRaw<PlaceRow[]>(Prisma.sql`
            ${categoryFilter.cte}
            SELECT
                p.id,
                p.public_id,
                p.primary_name,
                COALESCE(p.display_name, mm_name.name, en_name.name, p.primary_name) AS display_name,
                p.category_id,
                p.admin_area_id,
                p.lat,
                p.lng,
                p.importance_score::double precision AS importance_score,
                p.popularity_score::double precision AS popularity_score,
                p.confidence_score::double precision AS confidence_score,
                p.is_public,
                p.is_verified,
                p.source_type_id,
                p.publish_status_id,
                p.created_at,
                p.updated_at,
                COALESCE(place_names.names, '[]'::json) AS names,
                mm_name.name AS myanmar_name,
                en_name.name AS english_name,
                c.name AS category_name,
                aa.canonical_name AS admin_area_name
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = p.admin_area_id
            LEFT JOIN LATERAL (${mmNameLateralSql()}) mm_name ON true
            LEFT JOIN LATERAL (${enNameLateralSql()}) en_name ON true
            LEFT JOIN LATERAL (${placeNamesJsonAggSql()}) place_names ON true
            WHERE ${Prisma.join(conditions, " AND ")}
              ${categoryFilter.condition}
            ORDER BY p.created_at DESC, p.updated_at DESC, p.public_id DESC
            LIMIT ${params.limit}
            OFFSET ${params.offset}
        `);
    }

    async getPlaceByPublicId(publicId: string): Promise<PlaceRow | null> {
        const rows = await this.prisma.$queryRaw<PlaceRow[]>(Prisma.sql`
            SELECT
                p.id,
                p.public_id,
                p.primary_name,
                COALESCE(p.display_name, mm_name.name, en_name.name, p.primary_name) AS display_name,
                p.category_id,
                p.admin_area_id,
                p.lat,
                p.lng,
                p.importance_score::double precision AS importance_score,
                p.popularity_score::double precision AS popularity_score,
                p.confidence_score::double precision AS confidence_score,
                p.is_public,
                p.is_verified,
                p.source_type_id,
                p.publish_status_id,
                p.created_at,
                p.updated_at,
                COALESCE(place_names.names, '[]'::json) AS names,
                mm_name.name AS myanmar_name,
                en_name.name AS english_name,
                c.name AS category_name,
                aa.canonical_name AS admin_area_name
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = p.admin_area_id
            LEFT JOIN LATERAL (${mmNameLateralSql()}) mm_name ON true
            LEFT JOIN LATERAL (${enNameLateralSql()}) en_name ON true
            LEFT JOIN LATERAL (${placeNamesJsonAggSql()}) place_names ON true
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

    async getPlaceDetailByPublicId(
        publicId: string,
        db: DbClient = this.prisma
    ): Promise<PlaceDetailRow | null> {
        const rows = await db.$queryRaw<PlaceDetailRow[]>(Prisma.sql`
            SELECT
                p.id,
                p.public_id,
                p.primary_name,
                COALESCE(p.display_name, mm_name.name, en_name.name, p.primary_name) AS display_name,
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
                p.created_at,
                p.updated_at,
                p.current_version_id,
                p.deleted_at,
                COALESCE(place_names.names, '[]'::json) AS names,
                mm_name.name AS myanmar_name,
                en_name.name AS english_name
            FROM core.core_places AS p
            LEFT JOIN ref.ref_poi_categories AS c
                ON c.id = p.category_id
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = p.admin_area_id
            LEFT JOIN LATERAL (${mmNameLateralSql()}) mm_name ON true
            LEFT JOIN LATERAL (${enNameLateralSql()}) en_name ON true
            LEFT JOIN LATERAL (${placeNamesJsonAggSql()}) place_names ON true
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

    async getPublishStatusIdByCode(code: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM ref.ref_publish_statuses
            WHERE code = ${code}
            LIMIT 1
        `);

        return rows[0]?.id ?? null;
    }

    async createPlace(input: CreatePlaceInput): Promise<PlaceDetailRow | null> {
        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<{ public_id: string }[]>(Prisma.sql`
                INSERT INTO core.core_places (
                    primary_name,
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
                    ${input.display_name},
                    ${input.category_id},
                    ${input.admin_area_id ?? null},
                    ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326),
                    ${input.lat},
                    ${input.lng},
                    ${input.plus_code ?? null},
                    ${input.importance_score ?? 0},
                    ${input.popularity_score ?? 0},
                    ${input.confidence_score ?? 50},
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

            const mm = input.myanmarName?.trim() ? input.myanmarName.trim() : null;
            const en = input.englishName?.trim() ? input.englishName.trim() : null;

            await syncDashboardPlaceNames(tx, publicId, mm, en);

            return this.getPlaceDetailByPublicId(publicId, tx);
        });
    }

    async updatePlaceByPublicId(publicId: string, input: UpdatePlaceInput): Promise<boolean> {
        const currentPlace = await this.getPlaceStateByPublicId(publicId);

        if (!currentPlace) {
            return false;
        }

        const assignments: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];

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

        return this.prisma.$transaction(async (tx) => {
            if (input.myanmarName !== undefined || input.englishName !== undefined) {
                const currentNames = await loadDashboardNameSlots(tx, publicId);
                const mm =
                    input.myanmarName !== undefined
                        ? input.myanmarName.trim() === ""
                            ? null
                            : input.myanmarName.trim()
                        : currentNames.mm;
                const en =
                    input.englishName !== undefined
                        ? input.englishName.trim() === ""
                            ? null
                            : input.englishName.trim()
                        : currentNames.en;

                if (!mm && !en) {
                    throw new Error("PLACE_NAMES_REQUIRED");
                }

                await syncDashboardPlaceNames(tx, publicId, mm, en);
            }

            const slots = await loadDashboardNameSlots(tx, publicId);

            if (!slots.mm && !slots.en) {
                throw new Error("PLACE_NAMES_REQUIRED");
            }

            const primary_name = slots.mm ?? slots.en ?? "Unnamed Place";
            const display_name = slots.mm ?? slots.en ?? "Unnamed Place";

            assignments.push(Prisma.sql`primary_name = ${primary_name}`);
            assignments.push(Prisma.sql`display_name = ${display_name}`);

            const updatedRows = await tx.$executeRaw(Prisma.sql`
                UPDATE core.core_places
                SET ${Prisma.join(assignments, ", ")}
                WHERE public_id = CAST(${publicId} AS uuid)
                  AND deleted_at IS NULL
            `);

            return updatedRows > 0;
        });
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

async function syncDashboardPlaceNames(
    tx: Prisma.TransactionClient,
    publicId: string,
    myanmarName: string | null,
    englishName: string | null
): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
        DELETE FROM core.core_place_names AS pn
        USING core.core_places AS p
        WHERE p.id = pn.place_id
          AND p.public_id = CAST(${publicId} AS uuid)
          AND (
              (
                  pn.language_code IN ('mm', 'my')
                  AND pn.name_type = 'official'
              )
              OR (
                  upper(trim(COALESCE(pn.script_code, ''))) = 'MYMR'
                  AND pn.name_type = 'official'
              )
          )
    `);

    await tx.$executeRaw(Prisma.sql`
        DELETE FROM core.core_place_names AS pn
        USING core.core_places AS p
        WHERE p.id = pn.place_id
          AND p.public_id = CAST(${publicId} AS uuid)
          AND pn.language_code = 'en'
          AND pn.name_type IN ('english', 'official')
    `);

    if (myanmarName) {
        await tx.$executeRaw(Prisma.sql`
            INSERT INTO core.core_place_names (
                place_id,
                name,
                language_code,
                script_code,
                name_type,
                is_primary,
                search_weight
            )
            SELECT
                p.id,
                ${myanmarName},
                'mm',
                'MYMR',
                'official',
                true,
                100
            FROM core.core_places AS p
            WHERE p.public_id = CAST(${publicId} AS uuid)
        `);
    }

    if (englishName) {
        const englishPrimary = !myanmarName;

        await tx.$executeRaw(Prisma.sql`
            INSERT INTO core.core_place_names (
                place_id,
                name,
                language_code,
                script_code,
                name_type,
                is_primary,
                search_weight
            )
            SELECT
                p.id,
                ${englishName},
                'en',
                'Latn',
                'english',
                ${englishPrimary},
                90
            FROM core.core_places AS p
            WHERE p.public_id = CAST(${publicId} AS uuid)
        `);
    }
}

async function loadDashboardNameSlots(
    tx: Prisma.TransactionClient,
    publicId: string
): Promise<{ mm: string | null; en: string | null }> {
    const rows = await tx.$queryRaw<
        { mm: string | null; en_english: string | null; en_official: string | null }[]
    >(Prisma.sql`
        SELECT
            (
                SELECT pn.name
                FROM core.core_place_names AS pn
                INNER JOIN core.core_places AS p ON p.id = pn.place_id
                WHERE p.public_id = CAST(${publicId} AS uuid)
                  AND pn.name_type = 'official'
                  AND (
                      pn.language_code IN ('mm', 'my')
                      OR upper(trim(COALESCE(pn.script_code, ''))) = 'MYMR'
                  )
                ORDER BY
                    CASE pn.language_code
                        WHEN 'mm' THEN 0
                        WHEN 'my' THEN 1
                        ELSE 2
                    END,
                    pn.is_primary DESC
                LIMIT 1
            ) AS mm,
            (
                SELECT pn.name
                FROM core.core_place_names AS pn
                INNER JOIN core.core_places AS p ON p.id = pn.place_id
                WHERE p.public_id = CAST(${publicId} AS uuid)
                  AND pn.language_code = 'en'
                  AND pn.name_type = 'english'
                ORDER BY pn.is_primary DESC, pn.search_weight DESC
                LIMIT 1
            ) AS en_english,
            (
                SELECT pn.name
                FROM core.core_place_names AS pn
                INNER JOIN core.core_places AS p ON p.id = pn.place_id
                WHERE p.public_id = CAST(${publicId} AS uuid)
                  AND pn.language_code = 'en'
                  AND pn.name_type = 'official'
                  AND upper(trim(COALESCE(pn.script_code, ''))) = 'LATN'
                ORDER BY pn.is_primary DESC
                LIMIT 1
            ) AS en_official
    `);

    const row = rows[0];

    if (!row) {
        return { mm: null, en: null };
    }

    return {
        mm: row.mm,
        en: row.en_english ?? row.en_official,
    };
}

export function derivePrimaryName(names: { myanmarName?: string; englishName?: string }) {
    const mm = names.myanmarName?.trim();
    const en = names.englishName?.trim();

    return mm || en || "Unnamed Place";
}

export function deriveDisplayName(names: { myanmarName?: string; englishName?: string }) {
    const mm = names.myanmarName?.trim();
    const en = names.englishName?.trim();

    return mm || en || "Unnamed Place";
}

function mmNameLateralSql() {
    return Prisma.sql`
        SELECT pn.name AS name
        FROM core.core_place_names pn
        WHERE pn.place_id = p.id
          AND (
              pn.language_code IN ('mm', 'my')
              OR upper(trim(coalesce(pn.script_code, ''))) = 'MYMR'
          )
        ORDER BY pn.is_primary DESC, pn.search_weight DESC NULLS LAST, pn.id ASC
        LIMIT 1
    `;
}

function enNameLateralSql() {
    return Prisma.sql`
        SELECT pn.name AS name
        FROM core.core_place_names pn
        WHERE pn.place_id = p.id
          AND (
              pn.language_code = 'en'
              OR upper(trim(coalesce(pn.script_code, ''))) = 'LATN'
          )
        ORDER BY pn.search_weight DESC NULLS LAST, pn.id ASC
        LIMIT 1
    `;
}

function placeNamesJsonAggSql() {
    return Prisma.sql`
        SELECT COALESCE(
            json_agg(
                json_build_object(
                    'id', pn.id::text,
                    'name', pn.name,
                    'language_code', pn.language_code,
                    'script_code', pn.script_code,
                    'name_type', pn.name_type,
                    'is_primary', pn.is_primary,
                    'search_weight', pn.search_weight
                )
                ORDER BY pn.is_primary DESC, pn.search_weight DESC NULLS LAST, pn.name ASC
            ),
            '[]'::json
        ) AS names
        FROM core.core_place_names pn
        WHERE pn.place_id = p.id
    `;
}

function buildCategoryFilter(categoryCode: string | undefined) {
    if (!categoryCode || categoryCode.toLowerCase() === "all") {
        return {
            cte: Prisma.empty,
            condition: Prisma.empty,
        };
    }

    return {
        cte: Prisma.sql`
            WITH RECURSIVE category_tree AS (
                SELECT id
                FROM ref.ref_poi_categories
                WHERE code = ${categoryCode}
                  AND is_public = true
                  AND is_searchable = true

                UNION ALL

                SELECT child.id
                FROM ref.ref_poi_categories AS child
                INNER JOIN category_tree AS parent
                    ON child.parent_id = parent.id
                WHERE child.is_public = true
                  AND child.is_searchable = true
            )
        `,
        condition: Prisma.sql`
            AND p.category_id IN (
                SELECT id
                FROM category_tree
            )
        `,
    };
}
