import { Prisma } from "@prisma/client";

/** Verification metadata columns that may exist on core entity tables. */
export const CORE_VERIFICATION_COLUMNS = [
    "is_verified",
    "verification_status",
    "verified_at",
    "verified_by",
    "verification_note",
] as const;

export type CoreVerificationColumn = (typeof CORE_VERIFICATION_COLUMNS)[number];

export type CoreVerificationDefaults = Partial<{
    is_verified: boolean;
    verification_status: string;
    verified_at: null;
    verified_by: null;
    verification_note: null;
}>;

/** Registry for current and future import-review promotion targets. */
export const CORE_ENTITY_VERIFICATION_CONFIG = {
    buildings: {
        table: "core.core_map_buildings",
        columns: [...CORE_VERIFICATION_COLUMNS] as CoreVerificationColumn[],
    },
    places: {
        table: "core.core_places",
        columns: [...CORE_VERIFICATION_COLUMNS] as CoreVerificationColumn[],
    },
    landuse: {
        table: "core.core_map_landuse",
        columns: [...CORE_VERIFICATION_COLUMNS] as CoreVerificationColumn[],
    },
    water_lines: {
        table: "core.core_map_water_lines",
        columns: [...CORE_VERIFICATION_COLUMNS] as CoreVerificationColumn[],
    },
    water_polygons: {
        table: "core.core_map_water_polygons",
        columns: [...CORE_VERIFICATION_COLUMNS] as CoreVerificationColumn[],
    },
    bus_stops: {
        table: "core.core_bus_stops",
        columns: [...CORE_VERIFICATION_COLUMNS] as CoreVerificationColumn[],
    },
    roads: {
        table: "core.core_streets",
        columns: [...CORE_VERIFICATION_COLUMNS] as CoreVerificationColumn[],
    },
    addresses: {
        table: "core.core_addresses",
        columns: [...CORE_VERIFICATION_COLUMNS] as CoreVerificationColumn[],
    },
    admin_areas: {
        table: "core.core_admin_areas",
        columns: [...CORE_VERIFICATION_COLUMNS] as CoreVerificationColumn[],
    },
    routing_barriers: {
        table: null as string | null,
        columns: [] as CoreVerificationColumn[],
    },
} as const;

export type CoreEntityVerificationKey = keyof typeof CORE_ENTITY_VERIFICATION_CONFIG;

export function normalizeCoreVerificationColumns(
    targetTableColumns: readonly string[] | readonly CoreVerificationColumn[]
): CoreVerificationColumn[] {
    const allowed = new Set<string>(CORE_VERIFICATION_COLUMNS);
    const out: CoreVerificationColumn[] = [];
    for (const col of targetTableColumns) {
        if (allowed.has(col)) {
            out.push(col as CoreVerificationColumn);
        }
    }
    return out;
}

/**
 * Build insert defaults for only the verification columns present on the target table.
 */
export function buildCoreVerificationDefaults(
    targetTableColumns: readonly string[] | readonly CoreVerificationColumn[]
): CoreVerificationDefaults {
    const columns = normalizeCoreVerificationColumns(targetTableColumns);
    const defaults: CoreVerificationDefaults = {};
    if (columns.includes("is_verified")) {
        defaults.is_verified = false;
    }
    if (columns.includes("verification_status")) {
        defaults.verification_status = "unverified";
    }
    if (columns.includes("verified_at")) {
        defaults.verified_at = null;
    }
    if (columns.includes("verified_by")) {
        defaults.verified_by = null;
    }
    if (columns.includes("verification_note")) {
        defaults.verification_note = null;
    }
    return defaults;
}

export function isCoreRowAlreadyVerified(
    row: unknown,
    targetTableColumns: readonly string[] | readonly CoreVerificationColumn[]
): boolean {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
        return false;
    }
    const o = row as Record<string, unknown>;
    const columns = normalizeCoreVerificationColumns(targetTableColumns);
    if (columns.includes("is_verified") && o.is_verified === true) {
        return true;
    }
    if (columns.includes("verification_status") && o.verification_status === "verified") {
        return true;
    }
    if (columns.includes("verified_at") && o.verified_at != null) {
        return true;
    }
    return false;
}

/**
 * Merge verification defaults for updates without overwriting verified rows.
 */
export function applyVerificationDefaults(
    existing: unknown,
    targetTableColumns: readonly string[] | readonly CoreVerificationColumn[]
): {
    values: CoreVerificationDefaults;
    skipped_already_verified: boolean;
} {
    const columns = normalizeCoreVerificationColumns(targetTableColumns);
    if (columns.length === 0) {
        return { values: {}, skipped_already_verified: false };
    }
    if (isCoreRowAlreadyVerified(existing, columns)) {
        const preserved: CoreVerificationDefaults = {};
        if (existing && typeof existing === "object" && !Array.isArray(existing)) {
            const o = existing as Record<string, unknown>;
            if (columns.includes("is_verified") && typeof o.is_verified === "boolean") {
                preserved.is_verified = o.is_verified;
            }
            if (columns.includes("verification_status") && typeof o.verification_status === "string") {
                preserved.verification_status = o.verification_status;
            }
            if (columns.includes("verified_at") && (o.verified_at === null || typeof o.verified_at === "string")) {
                preserved.verified_at = null;
            }
            if (columns.includes("verified_by") && (o.verified_by === null || typeof o.verified_by === "number")) {
                preserved.verified_by = null;
            }
            if (columns.includes("verification_note") && (o.verification_note === null || typeof o.verification_note === "string")) {
                preserved.verification_note = null;
            }
        }
        return { values: preserved, skipped_already_verified: true };
    }
    return {
        values: buildCoreVerificationDefaults(columns),
        skipped_already_verified: false,
    };
}

export function getCoreVerificationColumnsForEntity(
    entityKey: CoreEntityVerificationKey
): CoreVerificationColumn[] {
    return [...CORE_ENTITY_VERIFICATION_CONFIG[entityKey].columns];
}

export function getCoreVerificationColumnsForTable(table: string): CoreVerificationColumn[] {
    for (const cfg of Object.values(CORE_ENTITY_VERIFICATION_CONFIG)) {
        if (cfg.table === table) {
            return [...cfg.columns];
        }
    }
    return [];
}

function coreVerificationAlreadyVerifiedSql(
    tableAlias: string,
    columns: readonly CoreVerificationColumn[]
): Prisma.Sql {
    const checks: Prisma.Sql[] = [];
    if (columns.includes("is_verified")) {
        checks.push(Prisma.sql`${Prisma.raw(tableAlias)}.is_verified = true`);
    }
    if (columns.includes("verification_status")) {
        checks.push(Prisma.sql`${Prisma.raw(tableAlias)}.verification_status = 'verified'`);
    }
    if (columns.includes("verified_at")) {
        checks.push(Prisma.sql`${Prisma.raw(tableAlias)}.verified_at IS NOT NULL`);
    }
    if (checks.length === 0) {
        return Prisma.sql`false`;
    }
    return Prisma.join(checks, " OR ");
}

/** Comma-prefixed column list for INSERT, e.g. ", is_verified, verification_status". */
export function coreVerificationInsertColumnsSql(
    columns: readonly CoreVerificationColumn[]
): Prisma.Sql {
    if (columns.length === 0) {
        return Prisma.empty;
    }
    return Prisma.sql`, ${Prisma.raw(columns.join(", "))}`;
}

/** SELECT value list aligned with {@link coreVerificationInsertColumnsSql}. */
export function coreVerificationInsertValuesSql(
    columns: readonly CoreVerificationColumn[]
): Prisma.Sql {
    if (columns.length === 0) {
        return Prisma.empty;
    }
    const parts: Prisma.Sql[] = [];
    for (const col of columns) {
        switch (col) {
            case "is_verified":
                parts.push(Prisma.sql`false`);
                break;
            case "verification_status":
                parts.push(Prisma.sql`'unverified'`);
                break;
            case "verified_at":
                parts.push(Prisma.sql`NULL::timestamptz`);
                break;
            case "verified_by":
                parts.push(Prisma.sql`NULL::bigint`);
                break;
            case "verification_note":
                parts.push(Prisma.sql`NULL::text`);
                break;
            default:
                break;
        }
    }
    return Prisma.sql`, ${Prisma.join(parts, ", ")}`;
}

/** UPDATE SET assignments preserving verified rows. Returns empty when no columns. */
export function coreVerificationUpdateSetSql(
    tableAlias: string,
    columns: readonly CoreVerificationColumn[]
): Prisma.Sql {
    if (columns.length === 0) {
        return Prisma.empty;
    }
    const guard = coreVerificationAlreadyVerifiedSql(tableAlias, columns);
    const a = tableAlias;
    const parts: Prisma.Sql[] = [];
    for (const col of columns) {
        switch (col) {
            case "is_verified":
                parts.push(
                    Prisma.sql`is_verified = CASE WHEN ${guard} THEN ${Prisma.raw(a)}.is_verified ELSE false END`
                );
                break;
            case "verification_status":
                parts.push(
                    Prisma.sql`verification_status = CASE WHEN ${guard} THEN ${Prisma.raw(a)}.verification_status ELSE 'unverified' END`
                );
                break;
            case "verified_at":
                parts.push(
                    Prisma.sql`verified_at = CASE WHEN ${guard} THEN ${Prisma.raw(a)}.verified_at ELSE NULL::timestamptz END`
                );
                break;
            case "verified_by":
                parts.push(
                    Prisma.sql`verified_by = CASE WHEN ${guard} THEN ${Prisma.raw(a)}.verified_by ELSE NULL::bigint END`
                );
                break;
            case "verification_note":
                parts.push(
                    Prisma.sql`verification_note = CASE WHEN ${guard} THEN ${Prisma.raw(a)}.verification_note ELSE NULL::text END`
                );
                break;
            default:
                break;
        }
    }
    if (parts.length === 0) {
        return Prisma.empty;
    }
    return Prisma.join(parts, ", ");
}

/** Same as {@link coreVerificationUpdateSetSql} with a leading comma for SET lists. */
export function coreVerificationUpdateSetClauseSql(
    tableAlias: string,
    columns: readonly CoreVerificationColumn[]
): Prisma.Sql {
    if (columns.length === 0) {
        return Prisma.empty;
    }
    const inner = coreVerificationUpdateSetSql(tableAlias, columns);
    return Prisma.sql`, ${inner}`;
}

export function buildVerificationMetadataTracking(args: {
    outcome: "inserted" | "updated" | "skipped" | "failed";
    beforeData: unknown | null;
    entityKey: CoreEntityVerificationKey;
}): {
    verification_metadata_applied: boolean;
    verification_metadata_skipped_already_verified: boolean;
} {
    const columns = getCoreVerificationColumnsForEntity(args.entityKey);
    if (columns.length === 0) {
        return {
            verification_metadata_applied: false,
            verification_metadata_skipped_already_verified: false,
        };
    }
    if (args.outcome === "inserted") {
        return {
            verification_metadata_applied: true,
            verification_metadata_skipped_already_verified: false,
        };
    }
    if (args.outcome === "updated") {
        const skipped = isCoreRowAlreadyVerified(args.beforeData, columns);
        return {
            verification_metadata_applied: !skipped,
            verification_metadata_skipped_already_verified: skipped,
        };
    }
    return {
        verification_metadata_applied: false,
        verification_metadata_skipped_already_verified: false,
    };
}
