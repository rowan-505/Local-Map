import { Prisma, type PrismaClient } from "@prisma/client";

type ListStreetsParams = {
    limit: number;
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
};

export type UpdateStreetInput = {
    canonical_name?: string;
    admin_area_id?: bigint | null;
};

export class StreetsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listStreets(params: ListStreetsParams): Promise<StreetRow[]> {
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
                END AS geometry
            FROM core.core_streets AS s
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = s.admin_area_id
            ORDER BY s.updated_at DESC, s.public_id DESC
            LIMIT ${params.limit}
        `);
    }

    async getStreetByPublicId(publicId: string): Promise<StreetRow | null> {
        const rows = await this.prisma.$queryRaw<StreetRow[]>(Prisma.sql`
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
                END AS geometry
            FROM core.core_streets AS s
            LEFT JOIN core.core_admin_areas AS aa
                ON aa.id = s.admin_area_id
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

    async updateStreet(publicId: string, input: UpdateStreetInput): Promise<StreetRow | null> {
        const assignments: Prisma.Sql[] = [Prisma.sql`updated_at = now()`];

        if (input.canonical_name !== undefined) {
            assignments.push(Prisma.sql`canonical_name = ${input.canonical_name}`);
        }

        if (input.admin_area_id !== undefined) {
            assignments.push(Prisma.sql`admin_area_id = ${input.admin_area_id}`);
        }

        const updatedRows = await this.prisma.$executeRaw(Prisma.sql`
            UPDATE core.core_streets
            SET ${Prisma.join(assignments, ", ")}
            WHERE public_id = CAST(${publicId} AS uuid)
        `);

        if (updatedRows === 0) {
            return null;
        }

        return this.getStreetByPublicId(publicId);
    }
}
