import { Prisma, type PrismaClient } from "@prisma/client";

export type MinimalReverseAddressRow = {
    nearby_name: string | null;
    nearby_type: string | null;
    nearby_distance_m: number | null;
    township: string | null;
    district: string | null;
    region_state: string | null;
    country: string | null;
    confidence: string | null;
};

export class ReverseSearchRepository {
    constructor(private readonly prisma: PrismaClient) {}

    /** Single-row raw lookup via core.reverse_address_minimal(lat, lng). Read-only. */
    async reverseAddressMinimal(lat: number, lng: number): Promise<MinimalReverseAddressRow | null> {
        const rows = await this.prisma.$queryRaw<MinimalReverseAddressRow[]>(
            Prisma.sql`
                SELECT
                    nearby_name,
                    nearby_type,
                    nearby_distance_m,
                    township,
                    district,
                    region_state,
                    country,
                    confidence
                FROM core.reverse_address_minimal(${lat}::double precision, ${lng}::double precision)
            `
        );
        return rows[0] ?? null;
    }
}
