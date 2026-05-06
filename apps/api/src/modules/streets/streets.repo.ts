import { Prisma, type PrismaClient } from "@prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

type ListStreetsParams = {
    limit: number;
    q?: string;
    sortBy: "name" | "admin_area" | "created" | "updated";
    sortOrder: "asc" | "desc";
};

type StreetGeometry =
    | {
          type: "LineString";
          coordinates: number[][];
      }
    | {
          type: "MultiLineString";
          coordinates: number[][][];
      }
    | null;

export type StreetRow = {
    public_id: string;
    canonical_name: string;
    admin_area_id: string | null;
    admin_area_name: string | null;
    source_type_id?: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    geometry: StreetGeometry;
    names: StreetNameRow[];
    myanmar_name: string | null;
    english_name: string | null;
};

export type UpdateStreetInput = {
    myanmarName?: string;
    englishName?: string;
    adminAreaId?: bigint | null;
    canonical_name?: string;
    admin_area_id?: bigint | null;
};

export type CreateStreetInput = {
    myanmarName?: string;
    englishName?: string;
    canonical_name: string;
    adminAreaId?: bigint | null;
    sourceTypeId?: bigint | null;
    admin_area_id?: bigint | null;
    source_type_id: bigint;
    geometry: StreetGeometry;
    is_active?: boolean;
};

export type StreetNameRow = {
    id: string;
    name: string;
    language_code: string | null;
    script_code: string | null;
    name_type: string;
    is_primary: boolean;
};

function streetsListOrderBy(sortBy: ListStreetsParams["sortBy"], sortOrder: ListStreetsParams["sortOrder"]): Prisma.Sql {
    const dir = sortOrder === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

    switch (sortBy) {
        case "name":
            return Prisma.sql`LOWER(COALESCE(s.canonical_name, '')) ${dir} NULLS LAST, s.public_id ASC`;
        case "admin_area":
            return Prisma.sql`LOWER(COALESCE(aa.canonical_name, '')) ${dir} NULLS LAST, s.public_id ASC`;
        case "created":
            return Prisma.sql`s.created_at ${dir} NULLS LAST, s.public_id ASC`;
        case "updated":
            return Prisma.sql`s.updated_at ${dir} NULLS LAST, s.public_id ASC`;
        default:
            return Prisma.sql`s.updated_at DESC NULLS LAST, s.public_id ASC`;
    }
}

export class StreetsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listStreets(params: ListStreetsParams): Promise<StreetRow[]> {
        const searchClause =
            params.q === undefined
                ? Prisma.sql`TRUE`
                : Prisma.sql`(
                    COALESCE(s.canonical_name, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(street_names.myanmar_name, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(street_names.english_name, '') ILIKE ${`%${params.q}%`}
                    OR COALESCE(aa.canonical_name, '') ILIKE ${`%${params.q}%`}
                    OR (CASE WHEN s.is_active THEN 'Yes' ELSE 'No' END) ILIKE ${`%${params.q}%`}
                    OR s.updated_at::text ILIKE ${`%${params.q}%`}
                )`;

        const orderByClause = streetsListOrderBy(params.sortBy, params.sortOrder);

        return this.prisma.$queryRaw<StreetRow[]>(Prisma.sql`
            SELECT
                s.public_id,
                s.canonical_name,
                s.admin_area_id::text AS admin_area_id,
                aa.canonical_name AS admin_area_name,
                s.is_active,
                s.created_at,
                s.updated_at,
                CASE
                    WHEN s.geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(s.geom)::json
                END AS geometry,
                COALESCE(street_names.names, '[]'::json) AS names,
                street_names.myanmar_name,
                street_names.english_name
            FROM core.core_streets AS s
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = s.admin_area_id
            LEFT JOIN LATERAL (${streetNamesJsonSql()}) AS street_names ON true
            WHERE ${searchClause}
            ORDER BY ${orderByClause}
            LIMIT ${params.limit}
        `);
    }

    async getStreetByPublicId(
        publicId: string,
        db: DbClient = this.prisma
    ): Promise<StreetRow | null> {
        const rows = await db.$queryRaw<StreetRow[]>(Prisma.sql`
            SELECT
                s.public_id,
                s.canonical_name,
                s.admin_area_id::text AS admin_area_id,
                aa.canonical_name AS admin_area_name,
                s.source_type_id::text AS source_type_id,
                s.is_active,
                s.created_at,
                s.updated_at,
                CASE
                    WHEN s.geom IS NULL THEN NULL
                    ELSE ST_AsGeoJSON(s.geom)::json
                END AS geometry,
                COALESCE(street_names.names, '[]'::json) AS names,
                street_names.myanmar_name,
                street_names.english_name
            FROM core.core_streets AS s
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = s.admin_area_id
            LEFT JOIN LATERAL (${streetNamesJsonSql()}) AS street_names ON true
            WHERE s.public_id = CAST(${publicId} AS uuid)
            LIMIT 1
        `);

        return rows[0] ?? null;
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

    async getSourceTypeIdByCode(code: string): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM ref.ref_source_types
            WHERE code = ${code}
            LIMIT 1
        `);

        return rows[0]?.id ?? null;
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

    async createStreet(input: CreateStreetInput): Promise<StreetRow | null> {
        return this.prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<{ public_id: string }[]>(Prisma.sql`
                INSERT INTO core.core_streets (
                    canonical_name,
                    geom,
                    admin_area_id,
                    source_type_id,
                    is_active,
                    created_at,
                    updated_at
                )
                VALUES (
                    ${input.canonical_name},
                    ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(input.geometry)}), 4326),
                    ${input.admin_area_id ?? null},
                    ${input.source_type_id},
                    ${input.is_active ?? true},
                    now(),
                    now()
                )
                RETURNING public_id
            `);

            const publicId = rows[0]?.public_id;

            if (!publicId) {
                return null;
            }

            await this.syncOfficialStreetName(tx, publicId, "my", input.myanmarName);
            await this.syncOfficialStreetName(tx, publicId, "en", input.englishName);

            return this.getStreetByPublicId(publicId, tx);
        });
    }

    async updateStreet(publicId: string, input: UpdateStreetInput): Promise<StreetRow | null> {
        const assignments: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];

        if (input.admin_area_id !== undefined) {
            assignments.push(Prisma.sql`admin_area_id = ${input.admin_area_id}`);
        }

        const updatedRows = await this.prisma.$transaction(async (tx) => {
            if (input.myanmarName !== undefined) {
                await this.syncOfficialStreetName(tx, publicId, "my", input.myanmarName);
            }

            if (input.englishName !== undefined) {
                await this.syncOfficialStreetName(tx, publicId, "en", input.englishName);
            }

            const names = await getOfficialStreetNames(tx, publicId);
            assignments.push(Prisma.sql`canonical_name = ${deriveStreetCanonicalName(names)}`);

            return tx.$executeRaw(Prisma.sql`
                UPDATE core.core_streets
                SET ${Prisma.join(assignments, ", ")}
                WHERE public_id = CAST(${publicId} AS uuid)
            `);
        });

        if (updatedRows === 0) {
            return null;
        }

        return this.getStreetByPublicId(publicId);
    }

    private async syncOfficialStreetName(
        tx: Prisma.TransactionClient,
        publicId: string,
        languageCode: "my" | "en",
        value: string | undefined
    ) {
        if (value === undefined) {
            return;
        }

        const metadata = getNameMetadata(languageCode);

        if (value.trim() === "") {
            await tx.$executeRaw(Prisma.sql`
                DELETE FROM core.core_street_names AS sn
                USING core.core_streets AS s
                WHERE s.id = sn.street_id
                  AND s.public_id = CAST(${publicId} AS uuid)
                  AND sn.language_code = ${metadata.languageCode}
                  AND sn.script_code = ${metadata.scriptCode}
                  AND sn.name_type = 'official'
                  AND sn.is_primary = true
            `);
            return;
        }

        const updatedRows = await tx.$executeRaw(Prisma.sql`
            UPDATE core.core_street_names AS sn
            SET
                name = ${value.trim()},
                script_code = ${metadata.scriptCode}
            FROM core.core_streets AS s
            WHERE s.id = sn.street_id
              AND s.public_id = CAST(${publicId} AS uuid)
              AND sn.language_code = ${metadata.languageCode}
              AND sn.name_type = 'official'
              AND sn.is_primary = true
        `);

        if (updatedRows > 0) {
            return;
        }

        await tx.$executeRaw(Prisma.sql`
            INSERT INTO core.core_street_names (
                street_id,
                name,
                language_code,
                script_code,
                name_type,
                is_primary
            )
            SELECT
                s.id,
                ${value.trim()},
                ${metadata.languageCode},
                ${metadata.scriptCode},
                'official',
                true
            FROM core.core_streets AS s
            WHERE s.public_id = CAST(${publicId} AS uuid)
              AND NOT EXISTS (
                  SELECT 1
                  FROM core.core_street_names AS sn
                  WHERE sn.street_id = s.id
                    AND sn.language_code = ${metadata.languageCode}
                    AND sn.name_type = 'official'
                    AND sn.is_primary = true
              )
        `);
    }
}

async function getOfficialStreetNames(tx: Prisma.TransactionClient, publicId: string) {
    const rows = await tx.$queryRaw<{ language_code: string | null; name: string }[]>(Prisma.sql`
        SELECT sn.language_code, sn.name
        FROM core.core_street_names AS sn
        INNER JOIN core.core_streets AS s
            ON s.id = sn.street_id
        WHERE s.public_id = CAST(${publicId} AS uuid)
          AND sn.name_type = 'official'
          AND sn.is_primary = true
          AND sn.language_code IN ('my', 'en')
    `);

    return {
        myanmarName: rows.find((row) => row.language_code === "my")?.name,
        englishName: rows.find((row) => row.language_code === "en")?.name,
    };
}

function getNameMetadata(languageCode: "my" | "en") {
    return languageCode === "my"
        ? { languageCode: "my", scriptCode: "Mymr" }
        : { languageCode: "en", scriptCode: "Latn" };
}

export function deriveStreetCanonicalName(names: { myanmarName?: string; englishName?: string }) {
    return names.englishName || names.myanmarName || "Unnamed Street";
}

function streetNamesJsonSql() {
    return Prisma.sql`
        SELECT
            json_agg(
                json_build_object(
                    'id', sn.id::text,
                    'name', sn.name,
                    'language_code', sn.language_code,
                    'script_code', sn.script_code,
                    'name_type', sn.name_type,
                    'is_primary', sn.is_primary
                )
                ORDER BY sn.is_primary DESC, sn.name ASC
            ) AS names,
            max(sn.name) FILTER (
                WHERE sn.language_code = 'my'
                  AND sn.script_code = 'Mymr'
                  AND sn.name_type = 'official'
                  AND sn.is_primary = true
            ) AS myanmar_name,
            max(sn.name) FILTER (
                WHERE sn.language_code = 'en'
                  AND sn.script_code = 'Latn'
                  AND sn.name_type = 'official'
                  AND sn.is_primary = true
            ) AS english_name
        FROM core.core_street_names AS sn
        WHERE sn.street_id = s.id
    `;
}
