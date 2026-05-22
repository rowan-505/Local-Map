import {
    IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
    IMPORT_REVIEW_DEFAULT_SORT,
    IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
} from "../constants";
import { createImportReviewEntityConfig } from "../createEntityConfig";
import { REF_ADMIN_LEVEL_ID } from "../refSources";

export const adminAreasImportReviewEntityConfig = createImportReviewEntityConfig({
    slug: "admin-areas",
    apiFamily: "admin_areas",
    label: "Admin area",
    pluralLabel: "Admin areas",
    geometryType: "polygon",
    mapLayerType: "polygon",
    mapEntityType: "generic",
    riskLevel: "low",
    tableColumns: [
        ...IMPORT_REVIEW_DEFAULT_ID_COLUMNS,
        { key: "effective_name_mm", label: "Myanmar name", source: "row" },
        { key: "effective_name_en", label: "English name", source: "row" },
        { key: "effective_admin_level_id", label: "Admin level", source: "row" },
        { key: "effective_slug", label: "Slug", source: "row", mono: true },
        ...IMPORT_REVIEW_COMMON_TABLE_COLUMNS,
    ],
    searchableFields: ["canonical_name", "slug", "external_id"],
    filterFields: IMPORT_REVIEW_STANDARD_FILTER_FIELDS,
    overrideEditableFields: ["name_mm", "name_en", "admin_level_id", "parent_id", "slug"],
    refDropdownFields: [REF_ADMIN_LEVEL_ID],
    defaultSort: IMPORT_REVIEW_DEFAULT_SORT,
    supportsBulkActions: true,
    supportsMapPreview: true,
    supportsVertexPreview: true,
    supportsGeometryEditLater: false,
    supportsPromotion: false,
    supportsOverrideEditor: true,
});
