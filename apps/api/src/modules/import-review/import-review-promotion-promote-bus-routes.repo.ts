import { Prisma, type PrismaClient } from "@prisma/client";

import { deriveImportReviewNames, isMyanmarScript, trimString } from "./import-review-name-fields.js";
import {
    buildVerificationMetadataTracking,
    getCoreVerificationColumnsForEntity,
} from "./import-review-promotion-core-verification.js";
import type { PromoteItemResult } from "./import-review-promotion-promote.types.js";
import {
    ImportReviewSchemaCapabilityRegistry,
    type ImportReviewEntityColumnCapabilities,
    type ImportReviewTargetColumnCapabilities,
} from "./import-review-schema-capabilities.js";

export const BUS_ROUTE_CANDIDATE_TABLE = "import_review.bus_route_candidates";
export const CORE_BUS_ROUTES_TABLE = "core.core_bus_routes";
export const CORE_BUS_ROUTE_NAMES_TABLE = "core.core_bus_route_names";

type BusRouteCandidateRow = {
    publish_item_id: bigint;
    id: bigint;
    review_batch_id: bigint;
    source_snapshot_version: string;
    local_staging_id: bigint;
    external_id: string | null;
    canonical_name: string | null;
    route_code: string | null;
    public_name: string | null;
    operator_name: string | null;
    route_type: string | null;
    directionality: string | null;
    source_refs: unknown;
    normalized_data: unknown;
    name_mm: string | null;
    name_en: string | null;
    matched_core_id: bigint | null;
    promoted_core_id: bigint | null;
};

const BUS_ROUTE_VERIFICATION_COLUMNS = getCoreVerificationColumnsForEntity("bus_routes");

function col(alias: string, column: string): Prisma.Sql {
    return Prisma.raw(`${alias}.${column}`);
}

function optionalColumnExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: string,
    typeSql: string
): Prisma.Sql {
    return caps.hasColumn(column) ? col(alias, column) : Prisma.raw(`NULL::${typeSql}`);
}

function optionalJsonTextExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    jsonColumn: "normalized_data" | "source_refs",
    key: string
): Prisma.Sql {
    return caps.hasColumn(jsonColumn) ? Prisma.sql`${col(alias, jsonColumn)}->>${key}` : Prisma.sql`NULL::text`;
}

function routeCodeExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`nullif(trim(coalesce(
        ${optionalColumnExpr(alias, caps, "route_code", "text")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", "route_code")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", "ref")},
        ''
    )), '')`;
}

function publicNameExpr(alias: string, caps: ImportReviewEntityColumnCapabilities): Prisma.Sql {
    return Prisma.sql`nullif(trim(coalesce(
        ${optionalColumnExpr(alias, caps, "public_name", "text")},
        ${optionalColumnExpr(alias, caps, "name_mm", "text")},
        ${optionalColumnExpr(alias, caps, "name_en", "text")},
        ${optionalColumnExpr(alias, caps, "canonical_name", "text")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", "public_name")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", "name")},
        ''
    )), '')`;
}

function textExpr(
    alias: string,
    caps: ImportReviewEntityColumnCapabilities,
    column: "operator_name" | "route_type" | "directionality" | "external_id" | "canonical_name"
): Prisma.Sql {
    return Prisma.sql`nullif(trim(coalesce(
        ${optionalColumnExpr(alias, caps, column, "text")},
        ${optionalJsonTextExpr(alias, caps, "normalized_data", column)},
        ''
    )), '')`;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function scalarText(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildSourceRefs(candidate: BusRouteCandidateRow, publishBatchId: bigint): Record<string, unknown> {
    return {
        ...asRecord(candidate.source_refs),
        review_candidate_id: candidate.id.toString(),
        review_batch_id: candidate.review_batch_id.toString(),
        publish_batch_id: publishBatchId.toString(),
        source_snapshot_version: candidate.source_snapshot_version,
        local_staging_id: candidate.local_staging_id.toString(),
        entity_family: "bus_routes",
    };
}

function buildNormalizedData(candidate: BusRouteCandidateRow): Record<string, unknown> {
    return {
        ...asRecord(candidate.normalized_data),
        promotion: {
            promoted_from: BUS_ROUTE_CANDIDATE_TABLE,
            promoted_at: new Date().toISOString(),
            phase: "12A_bus_route_promotion",
        },
    };
}

function insertColumnsAndValues(args: {
    targetCaps: ImportReviewTargetColumnCapabilities;
    routeCode: string;
    publicName: string;
    operatorName: string | null;
    routeType: string | null;
    directionality: string | null;
    externalId: string | null;
    sourceTypeId: bigint;
    sourceRefsJson: string;
    normalizedJson: string;
}): { columns: Prisma.Sql[]; values: Prisma.Sql[] } {
    const columns: Prisma.Sql[] = [];
    const values: Prisma.Sql[] = [];
    const push = (column: string, value: Prisma.Sql) => {
        if (args.targetCaps.hasColumn(column)) {
            columns.push(Prisma.raw(column));
            values.push(value);
        }
    };
    push("route_code", Prisma.sql`${args.routeCode}`);
    push("public_name", Prisma.sql`${args.publicName}`);
    push("operator_name", Prisma.sql`${args.operatorName}`);
    push("route_type", Prisma.sql`${args.routeType}`);
    push("directionality", Prisma.sql`${args.directionality}`);
    push("external_id", Prisma.sql`${args.externalId}`);
    push("source_type_id", Prisma.sql`${args.sourceTypeId}`);
    push("source_refs", Prisma.sql`${args.sourceRefsJson}::jsonb`);
    push("normalized_data", Prisma.sql`${args.normalizedJson}::jsonb`);
    push("is_active", Prisma.sql`true`);
    for (const column of BUS_ROUTE_VERIFICATION_COLUMNS) {
        if (!args.targetCaps.hasColumn(column)) continue;
        if (column === "is_verified") push(column, Prisma.sql`false`);
        if (column === "verification_status") push(column, Prisma.sql`'unverified'`);
        if (column === "verified_at" || column === "verified_by" || column === "verification_note") {
            push(column, Prisma.sql`NULL`);
        }
    }
    push("created_at", Prisma.sql`now()`);
    push("updated_at", Prisma.sql`now()`);
    return { columns, values };
}

function updateSetSql(args: {
    targetCaps: ImportReviewTargetColumnCapabilities;
    routeCode: string;
    publicName: string;
    operatorName: string | null;
    routeType: string | null;
    directionality: string | null;
    externalId: string | null;
    sourceTypeId: bigint;
    sourceRefsJson: string;
    normalizedJson: string;
}): Prisma.Sql {
    const assignments: Prisma.Sql[] = [];
    const push = (column: string, value: Prisma.Sql) => {
        if (args.targetCaps.hasColumn(column)) {
            assignments.push(Prisma.sql`${Prisma.raw(column)} = ${value}`);
        }
    };
    push("route_code", Prisma.sql`${args.routeCode}`);
    push("public_name", Prisma.sql`${args.publicName}`);
    push("operator_name", Prisma.sql`${args.operatorName}`);
    push("route_type", Prisma.sql`${args.routeType}`);
    push("directionality", Prisma.sql`${args.directionality}`);
    push("external_id", Prisma.sql`${args.externalId}`);
    push("source_type_id", Prisma.sql`${args.sourceTypeId}`);
    push("source_refs", Prisma.sql`${args.sourceRefsJson}::jsonb`);
    push("normalized_data", Prisma.sql`${args.normalizedJson}::jsonb`);
    push("is_active", Prisma.sql`true`);
    for (const column of BUS_ROUTE_VERIFICATION_COLUMNS) {
        if (!args.targetCaps.hasColumn(column)) continue;
        if (column === "is_verified") push(column, Prisma.sql`false`);
        if (column === "verification_status") push(column, Prisma.sql`'unverified'`);
        if (column === "verified_at" || column === "verified_by" || column === "verification_note") {
            push(column, Prisma.sql`NULL`);
        }
    }
    push("updated_at", Prisma.sql`now()`);
    return Prisma.join(assignments, ", ");
}

function activeTargetWhere(targetCaps: ImportReviewTargetColumnCapabilities, alias: string): Prisma.Sql {
    const checks: Prisma.Sql[] = [];
    if (targetCaps.hasIsActive) checks.push(Prisma.sql`coalesce(${col(alias, "is_active")}, true)`);
    if (targetCaps.hasDeletedAt) checks.push(Prisma.sql`${col(alias, "deleted_at")} IS NULL`);
    return checks.length > 0 ? Prisma.join(checks, " AND ") : Prisma.sql`true`;
}

function unverifiedWhere(targetCaps: ImportReviewTargetColumnCapabilities, alias: string): Prisma.Sql {
    if (targetCaps.hasIsVerified) return Prisma.sql`coalesce(${col(alias, "is_verified")}, false) IS FALSE`;
    if (targetCaps.hasVerificationStatus) return Prisma.sql`coalesce(${col(alias, "verification_status")}, 'unverified') <> 'verified'`;
    return Prisma.sql`true`;
}

export class ImportReviewPromotionPromoteBusRoutesRepository {
    private readonly schemaRegistry: ImportReviewSchemaCapabilityRegistry;

    constructor(private readonly prisma: PrismaClient) {
        this.schemaRegistry = new ImportReviewSchemaCapabilityRegistry(prisma);
    }

    async checkBusRouteCoreExists(targetId: bigint): Promise<boolean> {
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_BUS_ROUTES_TABLE);
        if (!targetCaps.hasColumn("id")) return false;
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_bus_routes AS br
            WHERE br.id = ${targetId}
              AND ${activeTargetWhere(targetCaps, "br")}
            LIMIT 1
        `);
        return rows.length > 0;
    }

    async insertBusRoute(batchId: bigint, publishItemId: bigint, promotedBy: bigint | null): Promise<PromoteItemResult> {
        return this.promoteBusRoute(batchId, publishItemId, promotedBy, "insert");
    }

    async updateBusRoute(batchId: bigint, publishItemId: bigint, promotedBy: bigint | null): Promise<PromoteItemResult> {
        return this.promoteBusRoute(batchId, publishItemId, promotedBy, "update");
    }

    private async promoteBusRoute(
        batchId: bigint,
        publishItemId: bigint,
        promotedBy: bigint | null,
        mode: "insert" | "update"
    ): Promise<PromoteItemResult> {
        try {
            const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_BUS_ROUTES_TABLE);
            const missingRequired = ["id", "route_code", "public_name", "source_type_id"]
                .filter((column) => !targetCaps.hasColumn(column));
            if (missingRequired.length > 0) {
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: `core.core_bus_routes is missing required column(s): ${missingRequired.join(", ")}.`,
                    before_data: null,
                    after_data: null,
                };
            }

            const candidate = await this.fetchCandidate(batchId, publishItemId);
            if (!candidate) {
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: "Bus route candidate not found.",
                    before_data: null,
                    after_data: null,
                };
            }

            const routeCode = candidate.route_code;
            const publicName = candidate.public_name;
            if (!routeCode || !publicName) {
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: "Bus route promotion blocked: route_code and public_name are required.",
                    before_data: null,
                    after_data: null,
                };
            }
            const sourceTypeId = await this.resolveSourceTypeId(candidate);
            if (!sourceTypeId) {
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: "Bus route promotion blocked: source_type_id could not be resolved.",
                    before_data: null,
                    after_data: null,
                };
            }

            const existingId =
                mode === "update"
                    ? (candidate.matched_core_id ?? candidate.promoted_core_id ?? await this.findExistingPromotedCore(candidate.id))
                    : await this.findExistingPromotedCore(candidate.id);
            const beforeData = existingId ? await this.fetchTargetData(existingId) : null;
            const sourceRefsJson = JSON.stringify(buildSourceRefs(candidate, batchId));
            const normalizedJson = JSON.stringify(buildNormalizedData(candidate));

            if (existingId) {
                const setSql = updateSetSql({
                    targetCaps,
                    routeCode,
                    publicName,
                    operatorName: candidate.operator_name,
                    routeType: candidate.route_type,
                    directionality: candidate.directionality,
                    externalId: candidate.external_id,
                    sourceTypeId,
                    sourceRefsJson,
                    normalizedJson,
                });
                const rows = await this.prisma.$queryRaw<{ id: bigint; route_code: string; public_name: string }[]>(Prisma.sql`
                    UPDATE core.core_bus_routes AS br
                    SET ${setSql}
                    WHERE br.id = ${existingId}
                      AND ${activeTargetWhere(targetCaps, "br")}
                      AND ${unverifiedWhere(targetCaps, "br")}
                    RETURNING id, route_code, public_name
                `);
                const row = rows[0];
                if (!row) {
                    return {
                        publish_item_id: publishItemId,
                        outcome: "failed",
                        target_id: null,
                        error_message: "Bus route update blocked: target missing, inactive, deleted, or already verified.",
                        before_data: beforeData,
                        after_data: null,
                    };
                }
                const namesSynced = await this.syncNames(row.id, candidate);
                return {
                    publish_item_id: publishItemId,
                    outcome: "updated",
                    target_id: row.id,
                    error_message: null,
                    before_data: beforeData,
                    after_data: { id: row.id.toString(), route_code: row.route_code, public_name: row.public_name, names_synced: namesSynced },
                    ...buildVerificationMetadataTracking({ outcome: "updated", beforeData, entityKey: "bus_routes" }),
                };
            }

            const duplicate = await this.findActiveRouteCode(routeCode, targetCaps);
            if (duplicate) {
                return {
                    publish_item_id: publishItemId,
                    outcome: "failed",
                    target_id: null,
                    error_message: "Bus route insert blocked: active core route already has this route_code.",
                    before_data: null,
                    after_data: null,
                };
            }

            const { columns, values } = insertColumnsAndValues({
                targetCaps,
                routeCode,
                publicName,
                operatorName: candidate.operator_name,
                routeType: candidate.route_type,
                directionality: candidate.directionality,
                externalId: candidate.external_id,
                sourceTypeId,
                sourceRefsJson,
                normalizedJson,
            });
            const rows = await this.prisma.$queryRaw<{ id: bigint; route_code: string; public_name: string }[]>(Prisma.sql`
                INSERT INTO core.core_bus_routes (${Prisma.join(columns, ", ")})
                VALUES (${Prisma.join(values, ", ")})
                RETURNING id, route_code, public_name
            `);
            const row = rows[0]!;
            const namesSynced = await this.syncNames(row.id, candidate);
            return {
                publish_item_id: publishItemId,
                outcome: "inserted",
                target_id: row.id,
                error_message: null,
                before_data: null,
                after_data: { id: row.id.toString(), route_code: row.route_code, public_name: row.public_name, names_synced: namesSynced },
                ...buildVerificationMetadataTracking({ outcome: "inserted", beforeData: null, entityKey: "bus_routes" }),
            };
        } catch (err) {
            return {
                publish_item_id: publishItemId,
                outcome: "failed",
                target_id: null,
                error_message: err instanceof Error ? err.message : "Bus route promotion failed.",
                before_data: null,
                after_data: null,
            };
        }
    }

    private async fetchCandidate(batchId: bigint, publishItemId: bigint): Promise<BusRouteCandidateRow | null> {
        const caps = await this.schemaRegistry.getEntityColumnCapabilities("bus_routes");
        const rows = await this.prisma.$queryRaw<BusRouteCandidateRow[]>(Prisma.sql`
            SELECT
                spi.id AS publish_item_id,
                br.id,
                br.review_batch_id,
                br.source_snapshot_version,
                br.local_staging_id,
                ${textExpr("br", caps, "external_id")} AS external_id,
                ${textExpr("br", caps, "canonical_name")} AS canonical_name,
                ${routeCodeExpr("br", caps)} AS route_code,
                ${publicNameExpr("br", caps)} AS public_name,
                ${textExpr("br", caps, "operator_name")} AS operator_name,
                ${textExpr("br", caps, "route_type")} AS route_type,
                ${textExpr("br", caps, "directionality")} AS directionality,
                ${optionalColumnExpr("br", caps, "source_refs", "jsonb")} AS source_refs,
                ${optionalColumnExpr("br", caps, "normalized_data", "jsonb")} AS normalized_data,
                ${optionalColumnExpr("br", caps, "name_mm", "text")} AS name_mm,
                ${optionalColumnExpr("br", caps, "name_en", "text")} AS name_en,
                ${optionalColumnExpr("br", caps, "matched_core_id", "bigint")} AS matched_core_id,
                ${optionalColumnExpr("br", caps, "promoted_core_id", "bigint")} AS promoted_core_id
            FROM system.system_publish_items AS spi
            INNER JOIN import_review.bus_route_candidates AS br
                ON br.id = spi.review_candidate_id
               AND spi.review_candidate_table = ${BUS_ROUTE_CANDIDATE_TABLE}
            WHERE spi.id = ${publishItemId}
              AND spi.publish_batch_id = ${batchId}
              AND spi.entity_family = 'bus_routes'
            LIMIT 1
        `);
        return rows[0] ?? null;
    }

    private async resolveSourceTypeId(candidate: BusRouteCandidateRow): Promise<bigint | null> {
        const refs = asRecord(candidate.source_refs);
        const data = asRecord(candidate.normalized_data);
        const code = scalarText(refs.source_type_code) ?? scalarText(refs.source) ?? scalarText(data.source_type_code) ?? scalarText(data.source) ?? "osm";
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM ref.ref_source_types
            WHERE code = ${code}
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    private async fetchTargetData(targetId: bigint): Promise<Record<string, unknown> | null> {
        const rows = await this.prisma.$queryRaw<{ data: unknown }[]>`
            SELECT to_jsonb(br.*) AS data
            FROM core.core_bus_routes AS br
            WHERE br.id = ${targetId}
            LIMIT 1
        `;
        return rows[0]?.data ? asRecord(rows[0].data) : null;
    }

    private async findExistingPromotedCore(candidateId: bigint): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
            SELECT id
            FROM core.core_bus_routes
            WHERE source_refs->>'entity_family' = 'bus_routes'
              AND source_refs->>'review_candidate_id' = ${candidateId.toString()}
            LIMIT 1
        `;
        return rows[0]?.id ?? null;
    }

    private async findActiveRouteCode(
        routeCode: string,
        targetCaps: ImportReviewTargetColumnCapabilities
    ): Promise<bigint | null> {
        const rows = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
            SELECT id
            FROM core.core_bus_routes AS br
            WHERE br.route_code = ${routeCode}
              AND ${activeTargetWhere(targetCaps, "br")}
            LIMIT 1
        `);
        return rows[0]?.id ?? null;
    }

    private async syncNames(routeId: bigint, candidate: BusRouteCandidateRow): Promise<number> {
        const targetCaps = await this.schemaRegistry.getTargetColumnCapabilities(CORE_BUS_ROUTE_NAMES_TABLE);
        if (!targetCaps.hasRouteId || !targetCaps.hasName) {
            return 0;
        }

        const rows = this.deriveNameRows(candidate);
        let inserted = 0;
        for (const row of rows) {
            const columns: Prisma.Sql[] = [Prisma.raw("route_id"), Prisma.raw("name")];
            const values: Prisma.Sql[] = [Prisma.sql`${routeId}`, Prisma.sql`${row.name}`];
            if (targetCaps.hasLanguageCode) {
                columns.push(Prisma.raw("language_code"));
                values.push(Prisma.sql`${row.languageCode}`);
            }
            if (targetCaps.hasNameType) {
                columns.push(Prisma.raw("name_type"));
                values.push(Prisma.sql`'primary'`);
            }
            if (targetCaps.hasIsPrimary) {
                columns.push(Prisma.raw("is_primary"));
                values.push(Prisma.sql`true`);
            }
            const existingLanguageCheck = targetCaps.hasLanguageCode
                ? Prisma.sql`AND coalesce(n.language_code, '') = coalesce(${row.languageCode}, '')`
                : Prisma.empty;
            const existingNameTypeCheck = targetCaps.hasNameType
                ? Prisma.sql`AND coalesce(n.name_type, '') = 'primary'`
                : Prisma.empty;
            const result = await this.prisma.$queryRaw<{ id: bigint }[]>(Prisma.sql`
                INSERT INTO core.core_bus_route_names (${Prisma.join(columns, ", ")})
                SELECT ${Prisma.join(values, ", ")}
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM core.core_bus_route_names AS n
                    WHERE n.route_id = ${routeId}
                      AND lower(trim(n.name)) = lower(trim(${row.name}))
                      ${existingLanguageCheck}
                      ${existingNameTypeCheck}
                )
                RETURNING id
            `);
            inserted += result.length;
        }
        return inserted;
    }

    private deriveNameRows(candidate: BusRouteCandidateRow): Array<{ name: string; languageCode: string }> {
        const out: Array<{ name: string; languageCode: string }> = [];
        const push = (name: string | null, languageCode: string) => {
            if (!name) return;
            if (candidate.external_id && name === candidate.external_id) return;
            if (out.some((row) => row.name.toLowerCase() === name.toLowerCase() && row.languageCode === languageCode)) return;
            out.push({ name, languageCode });
        };
        const derived = deriveImportReviewNames(candidate);
        push(trimString(candidate.name_mm), "my");
        push(trimString(candidate.name_en), "en");
        push(derived.name_mm, "my");
        push(derived.name_en, "en");
        push(candidate.public_name, candidate.public_name && isMyanmarScript(candidate.public_name) ? "my" : "und");
        push(candidate.canonical_name, candidate.canonical_name && isMyanmarScript(candidate.canonical_name) ? "my" : "und");
        push(derived.name_und, "und");
        return out;
    }
}
