import { Prisma, type PrismaClient } from "@prisma/client";

export type RefBoundaryStatusRow = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    helper_en: string | null;
    helper_mm: string | null;
    sort_order: number;
    default_is_official_boundary: boolean;
    default_boundary_confidence_score: number;
    default_address_usage_code: string | null;
    is_active: boolean;
};

const SELECT_COLUMNS = Prisma.sql`
    id::text AS id,
    code,
    name_en,
    name_mm,
    helper_en,
    helper_mm,
    sort_order,
    default_is_official_boundary,
    default_boundary_confidence_score::float8 AS default_boundary_confidence_score,
    default_address_usage_code,
    is_active
`;

export class RefBoundaryStatusesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listActiveBoundaryStatuses(): Promise<RefBoundaryStatusRow[]> {
        return this.prisma.$queryRaw<RefBoundaryStatusRow[]>(Prisma.sql`
            SELECT ${SELECT_COLUMNS}
            FROM ref.ref_boundary_statuses
            WHERE is_active IS TRUE
            ORDER BY sort_order ASC NULLS LAST, name_en ASC
        `);
    }

    async getActiveBoundaryStatusByCode(code: string): Promise<RefBoundaryStatusRow | null> {
        const rows = await this.prisma.$queryRaw<RefBoundaryStatusRow[]>(Prisma.sql`
            SELECT ${SELECT_COLUMNS}
            FROM ref.ref_boundary_statuses
            WHERE lower(trim(code)) = lower(trim(${code}))
              AND is_active IS TRUE
            LIMIT 1
        `);
        return rows[0] ?? null;
    }
}
