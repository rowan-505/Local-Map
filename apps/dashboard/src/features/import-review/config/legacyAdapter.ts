import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";

import { IMPORT_REVIEW_REVIEW_EDITABLE_FIELDS } from "./constants";
import type { ImportReviewEntityConfig, ImportReviewGeometryType, ImportReviewTableColumn } from "./types";

/** @deprecated Use ImportReviewTableColumn from features/import-review/config */
export type ImportReviewEntityColumnSource = ImportReviewTableColumn["source"];

/** @deprecated Use ImportReviewTableColumn from features/import-review/config */
export type ImportReviewEntityTableColumn = ImportReviewTableColumn;

/** Legacy route config consumed by ImportReviewEntityPage and nav (unchanged shape). */
export type ImportReviewEntityRouteConfig = {
    slug: string;
    apiFamily: string;
    label: string;
    pluralLabel: string;
    geometryType: DataReviewGeometryKind;
    mapLayerType: ImportReviewEntityType;
    tableColumns: ImportReviewEntityTableColumn[];
    editableFields: readonly string[];
    riskLevel: "low" | "medium" | "high";
    supportsBulkApproval: boolean;
    supportsOverrides: boolean;
    legacyDedicatedPage?: boolean;
};

export function toDataReviewGeometryKind(geometryType: ImportReviewGeometryType): DataReviewGeometryKind {
    switch (geometryType) {
        case "point":
            return "point";
        case "line":
        case "mixed":
            return "line";
        case "polygon":
            return "polygon";
        case "none":
            return "point";
        default: {
            const _exhaustive: never = geometryType;
            return _exhaustive;
        }
    }
}

export function toLegacyRouteConfig(config: ImportReviewEntityConfig): ImportReviewEntityRouteConfig {
    return {
        slug: config.slug,
        apiFamily: config.apiFamily,
        label: config.label,
        pluralLabel: config.pluralLabel,
        geometryType: toDataReviewGeometryKind(config.geometryType),
        mapLayerType: config.mapEntityType,
        tableColumns: [...config.tableColumns],
        editableFields: IMPORT_REVIEW_REVIEW_EDITABLE_FIELDS,
        riskLevel: config.riskLevel,
        supportsBulkApproval: config.supportsBulkActions,
        supportsOverrides: config.supportsOverrideEditor,
        legacyDedicatedPage: config.legacyDedicatedPage,
    };
}
