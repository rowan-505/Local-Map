import { Prisma, type PrismaClient } from "@prisma/client";

import { composeCoreAddressFromComponents } from "./addresses-compose.js";
import type { CoreAddressComponentRowDb } from "./addresses.repo.js";

export type CoreAddressComponentUpsertRow = {
    id?: bigint | undefined;
    component_type_code: string;
    component_value: string;
    language_code: string;
    confidence_score?: number | null | undefined;
    match_type?: string | null | undefined;
};

export class CoreReviewAddressComponentsRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listActiveComponents(addressId: bigint): Promise<CoreAddressComponentRowDb[]> {
        return this.prisma.$queryRaw<CoreAddressComponentRowDb[]>`
            SELECT
                c.id,
                c.address_id,
                coalesce(c.component_type_code, rt.code) AS component_type_code,
                c.component_value,
                coalesce(c.language_code, 'und') AS language_code,
                c.sort_order,
                c.confidence_score,
                c.match_type,
                c.source_admin_area_id,
                c.boundary_status,
                c.address_usage,
                c.source_refs
            FROM core.core_address_components AS c
            LEFT JOIN ref.ref_address_component_types AS rt ON rt.id = c.component_type_id
            WHERE c.address_id = ${addressId}
            ORDER BY coalesce(c.sort_order, 100) ASC, c.id ASC
        `;
    }

    async softDeleteComponents(addressId: bigint, ids: readonly bigint[]): Promise<void> {
        if (ids.length === 0) {
            return;
        }
        await this.prisma.$executeRaw`
            DELETE FROM core.core_address_components
            WHERE address_id = ${addressId}
              AND id = ANY(${ids}::bigint[])
        `;
    }

    async upsertComponent(
        addressId: bigint,
        row: CoreAddressComponentUpsertRow
    ): Promise<bigint> {
        const value = row.component_value.trim();
        if (value === "") {
            throw new Error("component_value cannot be empty");
        }

        if (row.id !== undefined) {
            const updated = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
                UPDATE core.core_address_components AS c
                SET
                    component_type_code = ${row.component_type_code},
                    component_value = ${value},
                    language_code = ${row.language_code},
                    confidence_score = ${row.confidence_score ?? null},
                    match_type = ${row.match_type ?? null},
                    component_type_id = coalesce(
                        c.component_type_id,
                        (SELECT id FROM ref.ref_address_component_types WHERE code = ${row.component_type_code} LIMIT 1)
                    ),
                    sort_order = coalesce(
                        c.sort_order,
                        (SELECT rank FROM ref.ref_address_component_types WHERE code = ${row.component_type_code} LIMIT 1),
                        100
                    ),
                    updated_at = now()
                WHERE c.id = ${row.id}
                  AND c.address_id = ${addressId}
                  AND EXISTS (
                      SELECT 1 FROM ref.ref_address_component_types WHERE code = ${row.component_type_code}
                  )
                RETURNING c.id
            `;
            const id = updated[0]?.id;
            if (id === undefined) {
                throw new Error(`Component id=${row.id.toString()} not found`);
            }
            return id;
        }

        const inserted = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            INSERT INTO core.core_address_components (
                address_id,
                component_type_id,
                component_type_code,
                component_value,
                language_code,
                sort_order,
                confidence_score,
                match_type,
                source_refs
            )
            SELECT
                ${addressId},
                rt.id,
                ${row.component_type_code},
                ${value},
                ${row.language_code},
                rt.rank,
                ${row.confidence_score ?? null},
                ${row.match_type ?? null},
                jsonb_build_object('source', 'core_review_edit')
            FROM ref.ref_address_component_types AS rt
            WHERE rt.code = ${row.component_type_code}
            ON CONFLICT (address_id, component_type_code, language_code, component_value) DO NOTHING
            RETURNING id
        `;
        const id = inserted[0]?.id;
        if (id !== undefined) {
            return id;
        }
        const existing = await this.prisma.$queryRaw<Array<{ id: bigint }>>`
            SELECT id FROM core.core_address_components
            WHERE address_id = ${addressId}
              AND component_type_code = ${row.component_type_code}
              AND language_code = ${row.language_code}
              AND component_value = ${value}
            LIMIT 1
        `;
        if (existing[0]) {
            return existing[0].id;
        }
        throw new Error("Failed to insert core address component");
    }

    async refreshGeneratedFullAddress(addressId: bigint): Promise<string | null> {
        const components = await this.listActiveComponents(addressId);
        const composed = composeCoreAddressFromComponents(components);
        const display = composed.displayFullAddress?.trim();
        if (!display) {
            throw new Error("Cannot refresh full_address: no composable components");
        }

        const houseNumber = pickUndValue(components, "house_number");
        const unitNumber = pickUndValue(components, "unit");
        const postalCode = pickUndValue(components, "postcode");

        await this.prisma.$executeRaw`
            UPDATE core.core_addresses
            SET
                full_address = ${display},
                house_number = ${houseNumber},
                unit_number = ${unitNumber},
                updated_at = now()
            WHERE id = ${addressId}
        `;

        if (postalCode) {
            try {
                await this.prisma.$executeRaw`
                    UPDATE core.core_addresses
                    SET postal_code = ${postalCode}
                    WHERE id = ${addressId}
                `;
            } catch {
                try {
                    await this.prisma.$executeRaw`
                        UPDATE core.core_addresses
                        SET postcode = ${postalCode}
                        WHERE id = ${addressId}
                    `;
                } catch {
                    /* legacy schema without postal columns */
                }
            }
        }

        return display;
    }
}

function pickUndValue(
    components: readonly CoreAddressComponentRowDb[],
    typeCode: string
): string | null {
    const rows = components.filter((c) => c.component_type_code === typeCode);
    for (const lang of ["und", "en", "my"] as const) {
        const hit = rows.find((r) => r.language_code === lang);
        if (hit?.component_value.trim()) {
            return hit.component_value.trim();
        }
    }
    return rows[0]?.component_value.trim() ?? null;
}
