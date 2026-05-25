import { Prisma, type PrismaClient } from "@prisma/client";

import { ImportReviewSchemaCapabilityRegistry } from "../import-review/import-review-schema-capabilities.js";
import {
    CORE_VERIFICATION_STATUSES,
    getCoreVerificationEntityConfig,
    listCoreVerificationEntityConfigs,
    type CoreVerificationEntityConfig,
    type CoreVerificationFamily,
    type CoreVerificationStatus,
} from "./core-verification.config.js";
import type {
    CoreVerificationEditPatch,
    CoreVerificationListQuery,
    CoreVerificationStatusPatch,
} from "./core-verification.schema.js";

type Caps = Awaited<ReturnType<ImportReviewSchemaCapabilityRegistry["getTargetColumnCapabilities"]>>;

type VerificationSupport = {
    table_exists: boolean;
    verification_supported: boolean;
    unsupported_reason: string | null;
    missing_verification_columns: string[];
};

type SummaryRow = {
    family: CoreVerificationFamily;
    label: string;
    table: string;
    path: string;
    total: number;
    unverified: number;
    verified: number;
    needs_fix: number;
    questionable: number;
    rejected_after_core_review: number;
    support: VerificationSupport;
};

type ListRow = {
    id: string;
    family: CoreVerificationFamily;
    display_name: string | null;
    verification_status: string | null;
    is_verified: boolean | null;
    verification_note: string | null;
    verified_at: string | null;
    verified_by: string | null;
    created_at: string | null;
    updated_at: string | null;
    external_id: string | null;
    admin_area_id: string | null;
    is_active: boolean | null;
    has_geometry: boolean;
    geometry_label: string;
    source_lineage: Record<string, unknown> | null;
};

function qtable(qualifiedTable: string): Prisma.Sql {
    return Prisma.raw(qualifiedTable);
}

function c(column: string): Prisma.Sql {
    return Prisma.raw(`t.${column}`);
}

function hasAll(caps: Caps, columns: readonly string[]): boolean {
    return columns.every((column) => caps.hasColumn(column));
}

function textCol(caps: Caps, column: string): Prisma.Sql {
    return caps.hasColumn(column) ? Prisma.sql`NULLIF(trim(${c(column)}::text), '')` : Prisma.sql`NULL::text`;
}

function nullableCol(caps: Caps, column: string, type: string): Prisma.Sql {
    return caps.hasColumn(column) ? c(column) : Prisma.raw(`NULL::${type}`);
}

function idExpr(config: CoreVerificationEntityConfig, caps: Caps): Prisma.Sql {
    if (!hasAll(caps, config.idColumns)) {
        return Prisma.sql`NULL::text`;
    }
    if (config.idColumns.length === 1) {
        return Prisma.sql`${c(config.idColumns[0]!)}::text`;
    }
    return Prisma.join(config.idColumns.map((column) => Prisma.sql`${c(column)}::text`), " || ':' || ");
}

function parseId(config: CoreVerificationEntityConfig, id: string): string[] | null {
    if (config.idColumns.length === 1) {
        return [id];
    }
    const parts = id.split(/[:_,]/).map((part) => part.trim()).filter(Boolean);
    return parts.length === config.idColumns.length ? parts : null;
}

function idWhere(config: CoreVerificationEntityConfig, caps: Caps, id: string): Prisma.Sql | null {
    if (!hasAll(caps, config.idColumns)) return null;
    const parts = parseId(config, id);
    if (!parts) return null;
    return Prisma.join(
        config.idColumns.map((column, index) => Prisma.sql`${c(column)}::text = ${parts[index]!}`),
        " AND "
    );
}

function supportFor(caps: Caps): VerificationSupport {
    if (caps.columns.size === 0) {
        return {
            table_exists: false,
            verification_supported: false,
            unsupported_reason: "Target table does not exist.",
            missing_verification_columns: ["is_verified", "verification_status"],
        };
    }
    const missing = ["is_verified", "verification_status"].filter((column) => !caps.hasColumn(column));
    return {
        table_exists: true,
        verification_supported: missing.length === 0,
        unsupported_reason: missing.length > 0 ? `Missing verification column(s): ${missing.join(", ")}.` : null,
        missing_verification_columns: missing,
    };
}

function statusExpr(caps: Caps): Prisma.Sql {
    return caps.hasVerificationStatus ? Prisma.sql`${c("verification_status")}::text` : Prisma.sql`'unsupported'::text`;
}

function verifiedExpr(caps: Caps): Prisma.Sql {
    return caps.hasIsVerified ? Prisma.sql`${c("is_verified")}` : Prisma.sql`NULL::boolean`;
}

function geometryExpr(config: CoreVerificationEntityConfig, caps: Caps): { hasSql: Prisma.Sql; label: string; geojsonSql: Prisma.Sql } {
    const column = config.geometryColumn;
    if (!column || !caps.hasColumn(column)) {
        return {
            hasSql: Prisma.sql`false`,
            label: "No geometry",
            geojsonSql: Prisma.sql`NULL::jsonb`,
        };
    }
    return {
        hasSql: Prisma.sql`${c(column)} IS NOT NULL`,
        label: column,
        geojsonSql: Prisma.sql`ST_AsGeoJSON(${c(column)})::jsonb`,
    };
}

async function displayExpr(
    registry: ImportReviewSchemaCapabilityRegistry,
    config: CoreVerificationEntityConfig,
    caps: Caps
): Promise<Prisma.Sql> {
    const expressions: Prisma.Sql[] = [];
    if (config.nameTable) {
        const nameCaps = await registry.getTargetColumnCapabilities(config.nameTable.table);
        if (
            nameCaps.columns.size > 0 &&
            nameCaps.hasColumn(config.nameTable.ownerColumn) &&
            nameCaps.hasColumn("name") &&
            caps.hasColumn(config.nameTable.targetColumn)
        ) {
            expressions.push(Prisma.sql`(
                SELECT n.name
                FROM ${qtable(config.nameTable.table)} AS n
                WHERE n.${Prisma.raw(config.nameTable.ownerColumn)} = ${c(config.nameTable.targetColumn)}
                ORDER BY coalesce(n.is_primary, false) DESC, n.id
                LIMIT 1
            )`);
        }
    }
    for (const column of config.displayColumns) {
        expressions.push(textCol(caps, column));
    }
    if (config.family === "bus_route_stops" && hasAll(caps, config.idColumns)) {
        expressions.push(Prisma.sql`concat('Variant ', t.route_variant_id, ' stop ', t.stop_id, ' seq ', t.stop_sequence)`);
    }
    expressions.push(Prisma.sql`concat(${config.label}, ' ', ${idExpr(config, caps)})`);
    return Prisma.sql`coalesce(${Prisma.join(expressions, ", ")})`;
}

function sourceLineageExpr(caps: Caps): Prisma.Sql {
    if (!caps.hasSourceRefs) {
        return Prisma.sql`NULL::jsonb`;
    }
    return Prisma.sql`jsonb_build_object(
        'review_batch_id', t.source_refs->>'review_batch_id',
        'publish_batch_id', t.source_refs->>'publish_batch_id',
        'source_snapshot_version', t.source_refs->>'source_snapshot_version',
        'review_candidate_id', t.source_refs->>'review_candidate_id'
    )`;
}

function buildWhere(config: CoreVerificationEntityConfig, caps: Caps, query: CoreVerificationListQuery): Prisma.Sql {
    const where: Prisma.Sql[] = [];
    if (caps.hasDeletedAt) where.push(Prisma.sql`t.deleted_at IS NULL`);
    if (query.is_verified !== undefined && caps.hasIsVerified) where.push(Prisma.sql`t.is_verified = ${query.is_verified}`);
    if (query.verification_status && caps.hasVerificationStatus) where.push(Prisma.sql`t.verification_status = ${query.verification_status}`);
    if (query.admin_area_id !== undefined && caps.hasColumn("admin_area_id")) where.push(Prisma.sql`t.admin_area_id = ${query.admin_area_id}`);
    if (query.created_from && caps.hasCreatedAt) where.push(Prisma.sql`t.created_at >= ${query.created_from}::timestamptz`);
    if (query.created_to && caps.hasCreatedAt) where.push(Prisma.sql`t.created_at <= ${query.created_to}::timestamptz`);
    if (query.updated_from && caps.hasUpdatedAt) where.push(Prisma.sql`t.updated_at >= ${query.updated_from}::timestamptz`);
    if (query.updated_to && caps.hasUpdatedAt) where.push(Prisma.sql`t.updated_at <= ${query.updated_to}::timestamptz`);
    if (caps.hasSourceRefs) {
        if (query.review_batch_id) where.push(Prisma.sql`t.source_refs->>'review_batch_id' = ${query.review_batch_id}`);
        if (query.publish_batch_id) where.push(Prisma.sql`t.source_refs->>'publish_batch_id' = ${query.publish_batch_id}`);
        if (query.source_snapshot_version) where.push(Prisma.sql`t.source_refs->>'source_snapshot_version' = ${query.source_snapshot_version}`);
    }
    if (query.q) {
        const search = `%${query.q}%`;
        const terms = config.searchColumns
            .filter((column) => caps.hasColumn(column))
            .map((column) => Prisma.sql`${c(column)}::text ILIKE ${search}`);
        if (terms.length > 0) {
            where.push(Prisma.sql`(${Prisma.join(terms, " OR ")})`);
        }
    }
    return where.length > 0 ? Prisma.sql`WHERE ${Prisma.join(where, " AND ")}` : Prisma.empty;
}

function orderBy(caps: Caps): Prisma.Sql {
    if (caps.hasUpdatedAt) return Prisma.sql`ORDER BY t.updated_at DESC`;
    if (caps.hasCreatedAt) return Prisma.sql`ORDER BY t.created_at DESC`;
    return Prisma.sql`ORDER BY 1`;
}

function jsonValue(value: unknown): Prisma.Sql {
    return Prisma.sql`${JSON.stringify(value)}::jsonb`;
}

function editableValue(value: unknown): Prisma.Sql {
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return Prisma.sql`${value}`;
    }
    return jsonValue(value);
}

export class CoreVerificationRepository {
    private readonly registry: ImportReviewSchemaCapabilityRegistry;

    constructor(private readonly prisma: PrismaClient) {
        this.registry = new ImportReviewSchemaCapabilityRegistry(prisma);
    }

    async summary(): Promise<{ statuses: readonly string[]; families: SummaryRow[]; totals: Record<string, number> }> {
        const families: SummaryRow[] = [];
        const totals = Object.fromEntries(CORE_VERIFICATION_STATUSES.map((status) => [status, 0])) as Record<string, number>;
        totals.total = 0;
        for (const config of listCoreVerificationEntityConfigs()) {
            const caps = await this.registry.getTargetColumnCapabilities(config.table);
            const support = supportFor(caps);
            if (!support.table_exists || !hasAll(caps, config.idColumns)) {
                families.push({
                    family: config.family,
                    label: config.label,
                    table: config.table,
                    path: config.path,
                    total: 0,
                    unverified: 0,
                    verified: 0,
                    needs_fix: 0,
                    questionable: 0,
                    rejected_after_core_review: 0,
                    support,
                });
                continue;
            }
            const rows = await this.prisma.$queryRaw<Record<string, bigint>[]>(Prisma.sql`
                SELECT
                    count(*)::bigint AS total,
                    count(*) FILTER (WHERE ${statusExpr(caps)} = 'unverified')::bigint AS unverified,
                    count(*) FILTER (WHERE ${statusExpr(caps)} = 'verified')::bigint AS verified,
                    count(*) FILTER (WHERE ${statusExpr(caps)} = 'needs_fix')::bigint AS needs_fix,
                    count(*) FILTER (WHERE ${statusExpr(caps)} = 'questionable')::bigint AS questionable,
                    count(*) FILTER (WHERE ${statusExpr(caps)} = 'rejected_after_core_review')::bigint AS rejected_after_core_review
                FROM ${qtable(config.table)} AS t
                ${caps.hasDeletedAt ? Prisma.sql`WHERE t.deleted_at IS NULL` : Prisma.empty}
            `);
            const row = rows[0] ?? {};
            const item = {
                family: config.family,
                label: config.label,
                table: config.table,
                path: config.path,
                total: Number(row.total ?? 0n),
                unverified: Number(row.unverified ?? 0n),
                verified: Number(row.verified ?? 0n),
                needs_fix: Number(row.needs_fix ?? 0n),
                questionable: Number(row.questionable ?? 0n),
                rejected_after_core_review: Number(row.rejected_after_core_review ?? 0n),
                support,
            };
            families.push(item);
            totals.total += item.total;
            for (const status of CORE_VERIFICATION_STATUSES) {
                totals[status] += item[status];
            }
        }
        return { statuses: CORE_VERIFICATION_STATUSES, families, totals };
    }

    async list(family: string, query: CoreVerificationListQuery) {
        const config = this.configOrThrow(family);
        const caps = await this.registry.getTargetColumnCapabilities(config.table);
        const support = supportFor(caps);
        if (!support.table_exists || !hasAll(caps, config.idColumns)) {
            return { family: config.family, label: config.label, support, items: [], total: 0, limit: query.limit, offset: query.offset };
        }
        const display = await displayExpr(this.registry, config, caps);
        const geom = geometryExpr(config, caps);
        const where = buildWhere(config, caps, query);
        const rows = await this.prisma.$queryRaw<(ListRow & { total_count: bigint })[]>(Prisma.sql`
            SELECT
                ${idExpr(config, caps)} AS id,
                ${config.family}::text AS family,
                ${display} AS display_name,
                ${statusExpr(caps)} AS verification_status,
                ${verifiedExpr(caps)} AS is_verified,
                ${nullableCol(caps, "verification_note", "text")}::text AS verification_note,
                ${nullableCol(caps, "verified_at", "timestamptz")}::text AS verified_at,
                ${nullableCol(caps, "verified_by", "bigint")}::text AS verified_by,
                ${nullableCol(caps, "created_at", "timestamptz")}::text AS created_at,
                ${nullableCol(caps, "updated_at", "timestamptz")}::text AS updated_at,
                ${nullableCol(caps, "external_id", "text")}::text AS external_id,
                ${nullableCol(caps, "admin_area_id", "bigint")}::text AS admin_area_id,
                ${nullableCol(caps, "is_active", "boolean")} AS is_active,
                ${geom.hasSql} AS has_geometry,
                ${geom.label}::text AS geometry_label,
                ${sourceLineageExpr(caps)} AS source_lineage,
                count(*) OVER()::bigint AS total_count
            FROM ${qtable(config.table)} AS t
            ${where}
            ${orderBy(caps)}
            LIMIT ${query.limit}
            OFFSET ${query.offset}
        `);
        return {
            family: config.family,
            label: config.label,
            support,
            items: rows.map(({ total_count: _total, ...row }) => row),
            total: Number(rows[0]?.total_count ?? 0n),
            limit: query.limit,
            offset: query.offset,
        };
    }

    async detail(family: string, id: string) {
        const config = this.configOrThrow(family);
        const caps = await this.registry.getTargetColumnCapabilities(config.table);
        const support = supportFor(caps);
        const where = idWhere(config, caps, id);
        if (!support.table_exists || !where) return null;
        const display = await displayExpr(this.registry, config, caps);
        const geom = geometryExpr(config, caps);
        const rows = await this.prisma.$queryRaw<Record<string, unknown>[]>(Prisma.sql`
            SELECT
                ${idExpr(config, caps)} AS id,
                ${config.family}::text AS family,
                ${display} AS display_name,
                ${statusExpr(caps)} AS verification_status,
                ${verifiedExpr(caps)} AS is_verified,
                ${nullableCol(caps, "verification_note", "text")}::text AS verification_note,
                ${nullableCol(caps, "verified_at", "timestamptz")}::text AS verified_at,
                ${nullableCol(caps, "verified_by", "bigint")}::text AS verified_by,
                ${nullableCol(caps, "source_refs", "jsonb")} AS source_refs,
                ${nullableCol(caps, "normalized_data", "jsonb")} AS normalized_data,
                ${geom.geojsonSql} AS geometry,
                ${geom.label}::text AS geometry_label,
                to_jsonb(t) - 'geom' - 'point_geom' - 'entry_geom' - 'footprint_geom' AS properties
            FROM ${qtable(config.table)} AS t
            WHERE ${where}
            LIMIT 1
        `);
        return rows[0] ? { ...rows[0], support, safe_editable_fields: config.safeEditableFields.filter((f) => caps.hasColumn(f)) } : null;
    }

    async updateStatus(family: string, id: string, patch: CoreVerificationStatusPatch, verifiedBy: bigint | null) {
        const config = this.configOrThrow(family);
        const caps = await this.registry.getTargetColumnCapabilities(config.table);
        const support = supportFor(caps);
        const where = idWhere(config, caps, id);
        if (!where) return null;
        if (!support.verification_supported) {
            throw new Error(support.unsupported_reason ?? "Verification columns are unsupported for this target.");
        }
        this.assertStatusPatch(patch);
        const assignments: Prisma.Sql[] = [
            Prisma.sql`t.verification_status = ${patch.verification_status}`,
            Prisma.sql`t.is_verified = ${patch.verification_status === "verified"}`,
        ];
        if (caps.hasVerifiedAt) assignments.push(Prisma.sql`t.verified_at = ${patch.verification_status === "verified" ? Prisma.sql`now()` : Prisma.sql`NULL`}`);
        if (caps.hasVerifiedBy) assignments.push(Prisma.sql`t.verified_by = ${patch.verification_status === "verified" ? verifiedBy : null}`);
        if (caps.hasVerificationNote) assignments.push(Prisma.sql`t.verification_note = ${patch.verification_note ?? null}`);
        if (caps.hasUpdatedAt) assignments.push(Prisma.sql`t.updated_at = now()`);
        if (patch.verification_status === "rejected_after_core_review" && patch.deactivate === true && patch.deactivate_confirmation === "DEACTIVATE" && caps.hasIsActive) {
            assignments.push(Prisma.sql`t.is_active = false`);
        }
        const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            UPDATE ${qtable(config.table)} AS t
            SET ${Prisma.join(assignments, ", ")}
            WHERE ${where}
            RETURNING ${idExpr(config, caps)} AS id
        `);
        return rows[0] ? this.detail(family, rows[0].id) : null;
    }

    async edit(family: string, id: string, patch: CoreVerificationEditPatch) {
        const config = this.configOrThrow(family);
        const caps = await this.registry.getTargetColumnCapabilities(config.table);
        const where = idWhere(config, caps, id);
        if (!where) return null;
        const allowed = new Set(config.safeEditableFields.filter((field) => caps.hasColumn(field)));
        const entries = Object.entries(patch.changes).filter(([field]) => allowed.has(field));
        if (entries.length === 0) {
            throw new Error("No supported safe editable fields were provided.");
        }
        const assignments = entries.map(([field, value]) => Prisma.sql`t.${Prisma.raw(field)} = ${editableValue(value)}`);
        if (caps.hasUpdatedAt) assignments.push(Prisma.sql`t.updated_at = now()`);
        const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
            UPDATE ${qtable(config.table)} AS t
            SET ${Prisma.join(assignments, ", ")}
            WHERE ${where}
            RETURNING ${idExpr(config, caps)} AS id
        `);
        return rows[0] ? this.detail(family, rows[0].id) : null;
    }

    private configOrThrow(family: string): CoreVerificationEntityConfig {
        const config = getCoreVerificationEntityConfig(family);
        if (!config) throw new Error(`Unsupported core verification family: ${family}`);
        return config;
    }

    private assertStatusPatch(patch: CoreVerificationStatusPatch): void {
        if (patch.verification_status === "needs_fix" && !patch.verification_note) {
            throw new Error("verification_note is required when marking needs_fix.");
        }
        if (patch.verification_status === "rejected_after_core_review" && !patch.verification_note) {
            throw new Error("verification_note is required when rejecting after core review.");
        }
    }
}
