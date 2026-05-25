import { type PrismaClient } from "@prisma/client";

import type { ImportReviewEntityFamilySlug } from "./import-review-config.js";
import { getImportReviewEntityConfig } from "./import-review-config.js";
import { getImportReviewPublishFamilyConfig } from "./import-review-promotion-config.js";

export type ImportReviewColumnInfo = {
    column_name: string;
    is_nullable: "YES" | "NO";
    data_type: string;
    udt_name: string;
    column_default: string | null;
};

export type ImportReviewEntityColumnCapabilities = {
    entityFamily: ImportReviewEntityFamilySlug;
    schema: string;
    table: string;
    qualifiedTable: string;
    columns: ReadonlySet<string>;
    hasColumn: (column: string) => boolean;
    hasId: boolean;
    hasReviewBatchId: boolean;
    hasSourceSnapshotVersion: boolean;
    hasLocalStagingId: boolean;
    hasExternalId: boolean;
    hasCanonicalName: boolean;
    hasClassCode: boolean;
    hasConfidenceScore: boolean;
    hasReviewStatus: boolean;
    hasReviewDecision: boolean;
    hasReviewNote: boolean;
    hasPromotionStatus: boolean;
    hasPromotedCoreId: boolean;
    hasPromotedAt: boolean;
    hasPromotedBy: boolean;
    hasMatchedCoreId: boolean;
    hasMatchedCoreData: boolean;
    hasValidationErrors: boolean;
    hasValidationWarnings: boolean;
    hasReviewOverrides: boolean;
    hasNormalizedData: boolean;
    hasSourceRefs: boolean;
    hasParentId: boolean;
    hasAdminLevelId: boolean;
    hasSlug: boolean;
    hasGeom: boolean;
    hasPointGeom: boolean;
    hasCentroid: boolean;
    hasBarrierType: boolean;
    hasRouteCode: boolean;
    hasPublicName: boolean;
    hasOperatorName: boolean;
    hasRouteType: boolean;
    hasDirectionality: boolean;
    hasRouteId: boolean;
    hasVariantCode: boolean;
    hasDirectionName: boolean;
    hasOriginName: boolean;
    hasDestinationName: boolean;
    hasDistanceM: boolean;
    hasRouteVariantId: boolean;
    hasStopId: boolean;
    hasStopSequence: boolean;
    hasDistanceFromStartM: boolean;
    hasIsTimingPoint: boolean;
};

export type ImportReviewTargetColumnCapabilities = {
    schema: string;
    table: string;
    qualifiedTable: string;
    columns: ReadonlySet<string>;
    columnInfo: ReadonlyMap<string, ImportReviewColumnInfo>;
    uniqueColumns: ReadonlySet<string>;
    hasColumn: (column: string) => boolean;
    isRequired: (column: string) => boolean;
    isUnique: (column: string) => boolean;
    hasParentId: boolean;
    hasAdminLevelId: boolean;
    hasCanonicalName: boolean;
    hasSlug: boolean;
    hasGeom: boolean;
    hasCentroid: boolean;
    hasExternalId: boolean;
    hasSourceTypeId: boolean;
    hasSourceRefs: boolean;
    hasNormalizedData: boolean;
    hasIsActive: boolean;
    hasIsVerified: boolean;
    hasVerificationStatus: boolean;
    hasVerifiedAt: boolean;
    hasVerifiedBy: boolean;
    hasVerificationNote: boolean;
    hasCreatedAt: boolean;
    hasUpdatedAt: boolean;
    hasDeletedAt: boolean;
    hasName: boolean;
    hasLanguageCode: boolean;
    hasScriptCode: boolean;
    hasNameType: boolean;
    hasIsPrimary: boolean;
    hasSearchWeight: boolean;
    hasBarrierType: boolean;
    hasCoreStreetId: boolean;
    hasRouteCode: boolean;
    hasPublicName: boolean;
    hasOperatorName: boolean;
    hasRouteType: boolean;
    hasDirectionality: boolean;
    hasRouteId: boolean;
    hasVariantCode: boolean;
    hasDirectionName: boolean;
    hasOriginName: boolean;
    hasDestinationName: boolean;
    hasDistanceM: boolean;
    hasRouteVariantId: boolean;
    hasStopId: boolean;
    hasStopSequence: boolean;
    hasDistanceFromStartM: boolean;
    hasIsTimingPoint: boolean;
};

function splitQualifiedTable(qualifiedTable: string): { schema: string; table: string } {
    const [schema, table] = qualifiedTable.includes(".")
        ? qualifiedTable.split(".", 2)
        : ["import_review", qualifiedTable];
    return { schema: schema!, table: table! };
}

export class ImportReviewSchemaCapabilityRegistry {
    private readonly columnCache = new Map<string, ImportReviewColumnInfo[]>();
    private readonly uniqueColumnCache = new Map<string, Set<string>>();

    constructor(private readonly prisma: PrismaClient) {}

    async getColumns(schema: string, table: string): Promise<ReadonlyMap<string, ImportReviewColumnInfo>> {
        const key = `${schema}.${table}`;
        let rows = this.columnCache.get(key);
        if (!rows) {
            rows = await this.prisma.$queryRaw<ImportReviewColumnInfo[]>`
                SELECT column_name, is_nullable, data_type, udt_name, column_default
                FROM information_schema.columns
                WHERE table_schema = ${schema}
                  AND table_name = ${table}
                ORDER BY ordinal_position
            `;
            this.columnCache.set(key, rows);
        }
        return new Map(rows.map((row) => [row.column_name, row]));
    }

    async hasColumn(schema: string, table: string, column: string): Promise<boolean> {
        const columns = await this.getColumns(schema, table);
        return columns.has(column);
    }

    async getEntityColumnCapabilities(
        entityFamily: ImportReviewEntityFamilySlug
    ): Promise<ImportReviewEntityColumnCapabilities> {
        const config = getImportReviewEntityConfig(entityFamily);
        const schema = "import_review";
        const table = config.importReviewTable;
        const qualifiedTable = `${schema}.${table}`;
        const columnInfo = await this.getColumns(schema, table);
        const columns = new Set(columnInfo.keys());
        const hasColumn = (column: string) => columns.has(column);

        return {
            entityFamily,
            schema,
            table,
            qualifiedTable,
            columns,
            hasColumn,
            hasId: hasColumn("id"),
            hasReviewBatchId: hasColumn("review_batch_id"),
            hasSourceSnapshotVersion: hasColumn("source_snapshot_version"),
            hasLocalStagingId: hasColumn("local_staging_id"),
            hasExternalId: hasColumn("external_id"),
            hasCanonicalName: hasColumn("canonical_name"),
            hasClassCode: hasColumn("class_code"),
            hasConfidenceScore: hasColumn("confidence_score"),
            hasReviewStatus: hasColumn("review_status"),
            hasReviewDecision: hasColumn("review_decision"),
            hasReviewNote: hasColumn("review_note"),
            hasPromotionStatus: hasColumn("promotion_status"),
            hasPromotedCoreId: hasColumn("promoted_core_id"),
            hasPromotedAt: hasColumn("promoted_at"),
            hasPromotedBy: hasColumn("promoted_by"),
            hasMatchedCoreId: hasColumn("matched_core_id"),
            hasMatchedCoreData: hasColumn("matched_core_data"),
            hasValidationErrors: hasColumn("validation_errors"),
            hasValidationWarnings: hasColumn("validation_warnings"),
            hasReviewOverrides: hasColumn("review_overrides"),
            hasNormalizedData: hasColumn("normalized_data"),
            hasSourceRefs: hasColumn("source_refs"),
            hasParentId: hasColumn("parent_id"),
            hasAdminLevelId: hasColumn("admin_level_id"),
            hasSlug: hasColumn("slug"),
            hasGeom: hasColumn("geom"),
            hasPointGeom: hasColumn("point_geom"),
            hasCentroid: hasColumn("centroid"),
            hasBarrierType: hasColumn("barrier_type"),
            hasRouteCode: hasColumn("route_code"),
            hasPublicName: hasColumn("public_name"),
            hasOperatorName: hasColumn("operator_name"),
            hasRouteType: hasColumn("route_type"),
            hasDirectionality: hasColumn("directionality"),
            hasRouteId: hasColumn("route_id"),
            hasVariantCode: hasColumn("variant_code"),
            hasDirectionName: hasColumn("direction_name"),
            hasOriginName: hasColumn("origin_name"),
            hasDestinationName: hasColumn("destination_name"),
            hasDistanceM: hasColumn("distance_m"),
            hasRouteVariantId: hasColumn("route_variant_id"),
            hasStopId: hasColumn("stop_id"),
            hasStopSequence: hasColumn("stop_sequence"),
            hasDistanceFromStartM: hasColumn("distance_from_start_m"),
            hasIsTimingPoint: hasColumn("is_timing_point"),
        };
    }

    async getTargetColumnCapabilities(targetTable: string): Promise<ImportReviewTargetColumnCapabilities> {
        const { schema, table } = splitQualifiedTable(targetTable);
        const qualifiedTable = `${schema}.${table}`;
        const columnInfo = await this.getColumns(schema, table);
        const columns = new Set(columnInfo.keys());
        const uniqueColumns = await this.getUniqueColumns(schema, table);
        const hasColumn = (column: string) => columns.has(column);
        const isRequired = (column: string) => columnInfo.get(column)?.is_nullable === "NO";
        const isUnique = (column: string) => uniqueColumns.has(column);

        return {
            schema,
            table,
            qualifiedTable,
            columns,
            columnInfo,
            uniqueColumns,
            hasColumn,
            isRequired,
            isUnique,
            hasParentId: hasColumn("parent_id"),
            hasAdminLevelId: hasColumn("admin_level_id"),
            hasCanonicalName: hasColumn("canonical_name"),
            hasSlug: hasColumn("slug"),
            hasGeom: hasColumn("geom"),
            hasCentroid: hasColumn("centroid"),
            hasExternalId: hasColumn("external_id"),
            hasSourceTypeId: hasColumn("source_type_id"),
            hasSourceRefs: hasColumn("source_refs"),
            hasNormalizedData: hasColumn("normalized_data"),
            hasIsActive: hasColumn("is_active"),
            hasIsVerified: hasColumn("is_verified"),
            hasVerificationStatus: hasColumn("verification_status"),
            hasVerifiedAt: hasColumn("verified_at"),
            hasVerifiedBy: hasColumn("verified_by"),
            hasVerificationNote: hasColumn("verification_note"),
            hasCreatedAt: hasColumn("created_at"),
            hasUpdatedAt: hasColumn("updated_at"),
            hasDeletedAt: hasColumn("deleted_at"),
            hasName: hasColumn("name"),
            hasLanguageCode: hasColumn("language_code"),
            hasScriptCode: hasColumn("script_code"),
            hasNameType: hasColumn("name_type"),
            hasIsPrimary: hasColumn("is_primary"),
            hasSearchWeight: hasColumn("search_weight"),
            hasBarrierType: hasColumn("barrier_type"),
            hasCoreStreetId: hasColumn("core_street_id"),
            hasRouteCode: hasColumn("route_code"),
            hasPublicName: hasColumn("public_name"),
            hasOperatorName: hasColumn("operator_name"),
            hasRouteType: hasColumn("route_type"),
            hasDirectionality: hasColumn("directionality"),
            hasRouteId: hasColumn("route_id"),
            hasVariantCode: hasColumn("variant_code"),
            hasDirectionName: hasColumn("direction_name"),
            hasOriginName: hasColumn("origin_name"),
            hasDestinationName: hasColumn("destination_name"),
            hasDistanceM: hasColumn("distance_m"),
            hasRouteVariantId: hasColumn("route_variant_id"),
            hasStopId: hasColumn("stop_id"),
            hasStopSequence: hasColumn("stop_sequence"),
            hasDistanceFromStartM: hasColumn("distance_from_start_m"),
            hasIsTimingPoint: hasColumn("is_timing_point"),
        };
    }

    async getTargetColumnCapabilitiesForEntity(
        entityFamily: ImportReviewEntityFamilySlug
    ): Promise<ImportReviewTargetColumnCapabilities | null> {
        const config = getImportReviewPublishFamilyConfig(entityFamily);
        if (!config) {
            return null;
        }
        return this.getTargetColumnCapabilities(config.coreTargetTable);
    }

    private async getUniqueColumns(schema: string, table: string): Promise<ReadonlySet<string>> {
        const key = `${schema}.${table}`;
        const cached = this.uniqueColumnCache.get(key);
        if (cached) {
            return cached;
        }
        const rows = await this.prisma.$queryRaw<{ column_name: string }[]>`
            SELECT a.attname AS column_name
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
            WHERE n.nspname = ${schema}
              AND c.relname = ${table}
              AND i.indisunique
              AND i.indpred IS NULL
        `;
        const set = new Set(rows.map((row) => row.column_name));
        this.uniqueColumnCache.set(key, set);
        return set;
    }
}
