import { Prisma, type PrismaClient } from "@prisma/client";

export type RefAddressUsageTypeRow = {
    id: string;
    code: string;
    name_en: string;
    name_mm: string | null;
    helper_en: string | null;
    helper_mm: string | null;
    sort_order: number;
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
    is_active
`;

export class RefAddressUsageTypesRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listActiveAddressUsageTypes(): Promise<RefAddressUsageTypeRow[]> {
        return this.prisma.$queryRaw<RefAddressUsageTypeRow[]>(Prisma.sql`
            SELECT ${SELECT_COLUMNS}
            FROM ref.ref_address_usage_types
            WHERE is_active IS TRUE
            ORDER BY sort_order ASC NULLS LAST, name_en ASC
        `);
    }

    async getActiveAddressUsageTypeByCode(code: string): Promise<RefAddressUsageTypeRow | null> {
        const rows = await this.prisma.$queryRaw<RefAddressUsageTypeRow[]>(Prisma.sql`
            SELECT ${SELECT_COLUMNS}
            FROM ref.ref_address_usage_types
            WHERE lower(trim(code)) = lower(trim(${code}))
              AND is_active IS TRUE
            LIMIT 1
        `);
        return rows[0] ?? null;
    }
}
