import type { Geometry } from "geojson";
import { z } from "zod";

import type { CoreReviewLanduseRow } from "@/src/features/core-review/config/types";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import {
    bool,
    createCoreReviewFetchDetail,
    createCoreReviewWriteMutations,
    detailRecordId,
    nullableFormString,
    optionalBooleanSchema,
    optionalFormRefId,
    optionalGeometrySchema,
    optionalStringSchema,
    polygonFromDetailGeometry,
    requirePolygonGeometry,
    standardPublicIdReadonlyFields,
    standardTimestampReadonlyFields,
    str,
    yesNoFormat,
} from "./shared";
import type { CoreEntityConfig, CoreEntityFormMode, CoreEntityFormValues } from "./types";

const GEOM_FIELD = "geom";

type LanduseDetail = CoreReviewLanduseRow & {
    sourceTags?: unknown;
    normalizedData?: unknown;
    sourceRefs?: unknown;
    sourceStagingId?: string | null;
};

function landuseFormSchema(mode: CoreEntityFormMode) {
    const fields: Record<string, z.ZodTypeAny> = {
        name_mm: optionalStringSchema,
        name_en: optionalStringSchema,
        landuse_class_id: z.string().min(1, "Landuse class is required"),
        admin_area_id: optionalStringSchema,
        confidence_score: z.string(),
        is_verified: optionalBooleanSchema,
        detail_level: z.enum(["zone", "parcel"]),
        crop_code: optionalStringSchema,
        irrigated: optionalBooleanSchema,
        seasonality: optionalStringSchema,
        geom: optionalGeometrySchema,
    };
    if (mode === "edit") {
        fields.edit_reason = optionalStringSchema;
    }
    return z.object(fields).superRefine((data, ctx) => {
        if (!data.geom) {
            ctx.addIssue({
                code: "custom",
                message: "Draw a landuse polygon on the map before saving.",
                path: ["geom"],
            });
        }
    });
}

function parseConfidence(raw: unknown, fallback: number): number {
    const trimmed = String(raw ?? "").trim();
    const parsed = trimmed !== "" ? Number.parseFloat(trimmed) : fallback;
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        throw new Error("Confidence score must be between 0 and 100.");
    }
    return parsed;
}

function landusePayload(values: CoreEntityFormValues, mode: CoreEntityFormMode) {
    const payload: Record<string, unknown> = {
        geom: requirePolygonGeometry(values, GEOM_FIELD),
        landuse_class_id: String(values.landuse_class_id ?? "").trim(),
        admin_area_id: optionalFormRefId(values.admin_area_id),
        name_mm: nullableFormString(values.name_mm),
        name_en: nullableFormString(values.name_en),
        confidence_score: parseConfidence(values.confidence_score, mode === "create" ? 90 : 90),
        is_verified: bool(values.is_verified),
        detail_level: values.detail_level === "parcel" ? "parcel" : "zone",
        crop_code: nullableFormString(values.crop_code),
        seasonality: nullableFormString(values.seasonality),
    };

    if (values.irrigated === true || values.irrigated === false) {
        payload.irrigated = values.irrigated;
    } else if (mode === "edit") {
        payload.irrigated = null;
    }

    if (mode === "edit") {
        const reason = String(values.edit_reason ?? "").trim();
        if (reason) {
            payload.edit_reason = reason;
        }
    }

    return payload;
}

const landuseWriteMutations = createCoreReviewWriteMutations<LanduseDetail>("landuse");

export const LANDUSE_ENTITY_CONFIG: CoreEntityConfig<
    LanduseDetail,
    Record<string, unknown>,
    Record<string, unknown>
> = {
    entityKey: "landuse",
    label: "Landuse",
    labelPlural: "Landuse",
    routeSegment: "landuse",
    coreReviewSlug: "landuse",
    apiBase: "/core-review/landuse",
    listRoute: coreReviewPath("landuse"),
    createRoute: coreReviewPath("landuse/new"),
    editRoute: (id) => coreReviewPath(`landuse/${id}/edit`),
    geometry: {
        fieldKey: GEOM_FIELD,
        geometryType: "polygon",
        title: "Landuse footprint",
        showVertices: true,
    },
    editableFields: [
        { key: "name_mm", label: "Myanmar name", type: "text", placeholder: "Optional" },
        { key: "name_en", label: "English name", type: "text", placeholder: "Optional" },
        {
            key: "landuse_class_id",
            label: "Landuse class",
            type: "ref",
            refSource: "landuse-classes",
            required: true,
            helpText: "Category from ref.ref_landuse_classes (separate from feature name).",
        },
        { key: "admin_area_id", label: "Admin area", type: "ref", refSource: "admin-areas" },
        {
            key: "detail_level",
            label: "Detail level",
            type: "select",
            selectOptions: [
                { value: "zone", label: "Zone — large area (e.g. paddy block)" },
                { value: "parcel", label: "Parcel — small plot (e.g. individual paddy)" },
            ],
        },
        {
            key: "crop_code",
            label: "Crop code",
            type: "text",
            placeholder: "e.g. rice",
            helpText: "Defaults to rice when class is paddy on create (API).",
        },
        { key: "irrigated", label: "Irrigated", type: "boolean" },
        {
            key: "seasonality",
            label: "Seasonality",
            type: "text",
            placeholder: "Optional",
        },
        {
            key: "confidence_score",
            label: "Confidence score",
            type: "number",
            numberMin: 0,
            numberMax: 100,
        },
        { key: "is_verified", label: "Verified", type: "boolean" },
        {
            key: "edit_reason",
            label: "Edit note",
            type: "textarea",
            editOnly: true,
            placeholder: "Optional review note for audit log",
        },
    ],
    readonlyMetadata: [
        ...standardPublicIdReadonlyFields(),
        { key: "external_id", label: "External ID", type: "text", detailPath: "externalId" },
        {
            key: "source_staging_id",
            label: "Source staging ID",
            type: "text",
            detailPath: "sourceStagingId",
        },
        ...standardTimestampReadonlyFields(),
        { key: "class_code", label: "Legacy class code", type: "text", detailPath: "classCode" },
        {
            key: "area_m2",
            label: "Area (m²)",
            type: "text",
            detailPath: "areaM2",
            format: (v) => (v == null ? "—" : String(v)),
        },
        {
            key: "manual_override",
            label: "Manual override",
            type: "text",
            detailPath: "manualOverride",
            format: yesNoFormat,
        },
        { key: "source_tags", label: "Source tags", type: "json-readonly", detailPath: "sourceTags" },
        { key: "normalized_data", label: "Normalized data", type: "json-readonly", detailPath: "normalizedData" },
        { key: "source_refs", label: "Source refs", type: "json-readonly", detailPath: "sourceRefs" },
    ],
    defaultFormValues: {
        name_mm: "",
        name_en: "",
        landuse_class_id: "",
        admin_area_id: "",
        confidence_score: "90",
        is_verified: false,
        detail_level: "zone",
        crop_code: "",
        irrigated: false,
        seasonality: "",
        edit_reason: "",
        geom: null,
    },
    formSchema: landuseFormSchema,
    detailToFormValues: (detail) => ({
        name_mm: detail.nameMm ?? "",
        name_en: detail.nameEn ?? "",
        landuse_class_id:
            detail.landuseClassId != null
                ? String(detail.landuseClassId)
                : "",
        admin_area_id: detail.adminAreaId != null ? String(detail.adminAreaId) : "",
        confidence_score:
            detail.confidenceScore != null ? String(detail.confidenceScore) : "90",
        is_verified: Boolean(detail.isVerified),
        detail_level: detail.detailLevel === "parcel" ? "parcel" : "zone",
        crop_code: str(detail.cropCode),
        irrigated: detail.irrigated === true,
        seasonality: str(detail.seasonality),
        edit_reason: "",
        geom: polygonFromDetailGeometry(detail.geometry) as Geometry | null,
    }),
    formValuesToCreatePayload: (values) => landusePayload(values, "create"),
    formValuesToUpdatePayload: (values) => landusePayload(values, "edit"),
    getDetailId: detailRecordId,
    fetchDetail: createCoreReviewFetchDetail<LanduseDetail>("landuse"),
    createEntity: landuseWriteMutations.createEntity,
    updateEntity: landuseWriteMutations.updateEntity,
    createDescription:
        "Draw the landuse polygon on the map. Names are optional for residential, farmland, and paddy areas.",
    editDescription: (detail) => `public_id: ${detail.publicId}`,
    writeApiAvailable: true,
};
