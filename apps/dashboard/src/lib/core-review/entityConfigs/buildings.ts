import type { Geometry } from "geojson";
import { z } from "zod";

import type { Building, BuildingGeometry, CreateBuildingPayload, UpdateBuildingPayload } from "@/src/lib/api";
import { getBuilding } from "@/src/lib/api";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";

import {
    createCoreReviewWriteMutations,
    detailRecordId,
} from "./shared";
import type { CoreEntityConfig, CoreEntityFormValues } from "./types";

const GEOM_FIELD = "geom";

const scoreFieldSchema = z.union([z.number().finite(), z.literal("")]);

function buildingFormSchema() {
    return z.object({
        name_mm: z.string(),
        name_en: z.string(),
        fallback_name: z.string(),
        building_type_id: z.string(),
        admin_area_id: z.string(),
        levels: z.string(),
        height_m: z.string(),
        confidence_score: z.string(),
        is_verified: z.boolean(),
        geom: z.custom<Geometry | null>(),
    });
}

function isBuildingGeometry(value: unknown): value is BuildingGeometry {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    const o = value as { type?: unknown; coordinates?: unknown };
    return (
        (o.type === "Polygon" || o.type === "MultiPolygon") && Array.isArray(o.coordinates)
    );
}

function formValuesToBuildingPayload(values: CoreEntityFormValues, isEdit: boolean): CreateBuildingPayload {
    const geometry = getFormGeometry(values, GEOM_FIELD);
    if (!isBuildingGeometry(geometry)) {
        throw new Error("Draw or paste a valid polygon footprint before saving.");
    }

    const payload: CreateBuildingPayload = {
        geometry,
        name_mm: String(values.name_mm ?? "").trim() || null,
        name_en: String(values.name_en ?? "").trim() || null,
        name: String(values.fallback_name ?? "").trim() || null,
    };

    const buildingTypeId = String(values.building_type_id ?? "").trim();
    const adminAreaId = String(values.admin_area_id ?? "").trim();

    if (isEdit) {
        payload.building_type_id = buildingTypeId || null;
        payload.admin_area_id = adminAreaId || null;
    } else {
        if (buildingTypeId) payload.building_type_id = buildingTypeId;
        if (adminAreaId) payload.admin_area_id = adminAreaId;
    }

    const levelsTrimmed = String(values.levels ?? "").trim();
    if (levelsTrimmed !== "") {
        const parsed = Number.parseInt(levelsTrimmed, 10);
        if (!Number.isFinite(parsed) || parsed < 0) {
            throw new Error("Levels must be a non-negative integer.");
        }
        payload.levels = parsed;
    }

    const heightTrimmed = String(values.height_m ?? "").trim();
    if (heightTrimmed !== "") {
        const parsed = Number.parseFloat(heightTrimmed);
        if (!Number.isFinite(parsed) || parsed < 0) {
            throw new Error("Height (m) must be a non-negative number.");
        }
        payload.height_m = parsed;
    }

    const confTrimmed = String(values.confidence_score ?? "").trim();
    payload.confidence_score = confTrimmed !== "" ? Number.parseFloat(confTrimmed) : 80;
    if (!Number.isFinite(payload.confidence_score)) {
        throw new Error("Confidence score must be a number.");
    }

    payload.is_verified = Boolean(values.is_verified);
    return payload;
}

const buildingWriteMutations = createCoreReviewWriteMutations<Building>("buildings");

export const BUILDINGS_ENTITY_CONFIG: CoreEntityConfig<
    Building,
    CreateBuildingPayload,
    UpdateBuildingPayload
> = {
    entityKey: "buildings",
    label: "Building",
    labelPlural: "Buildings",
    routeSegment: "buildings",
    coreReviewSlug: "buildings",
    apiBase: "/buildings",
    listRoute: coreReviewPath("buildings"),
    createRoute: coreReviewPath("buildings/new"),
    editRoute: (id) => coreReviewPath(`buildings/${id}/edit`),
    geometry: {
        fieldKey: GEOM_FIELD,
        geometryType: "polygon",
        title: "Building footprint",
        showVertices: true,
    },
    editableFields: [
        { key: "name_mm", label: "Myanmar name", type: "text" },
        { key: "name_en", label: "English name", type: "text" },
        { key: "fallback_name", label: "Fallback name", type: "text", helpText: "Used when localized names are empty." },
        { key: "building_type_id", label: "Building type", type: "ref", refSource: "building-types" },
        { key: "admin_area_id", label: "Admin area", type: "ref", refSource: "admin-areas" },
        { key: "levels", label: "Levels", type: "number", numberMin: 0, numberStep: 1, placeholder: "Optional" },
        { key: "height_m", label: "Height (m)", type: "number", numberMin: 0, placeholder: "Optional" },
        { key: "confidence_score", label: "Confidence score", type: "number", numberMin: 0, numberMax: 100 },
        { key: "is_verified", label: "Verified", type: "boolean" },
    ],
    readonlyMetadata: [
        { key: "id", label: "Internal ID", type: "text", detailPath: "id" },
        { key: "public_id", label: "Public ID", type: "text", detailPath: "public_id" },
        { key: "external_id", label: "External ID", type: "text", detailPath: "external_id" },
        { key: "created_at", label: "Created", type: "date-readonly", detailPath: "created_at" },
        { key: "updated_at", label: "Updated", type: "date-readonly", detailPath: "updated_at" },
        { key: "class_code", label: "Class code", type: "text", detailPath: "class_code" },
        {
            key: "area_m2",
            label: "Area (m²)",
            type: "text",
            detailPath: "area_m2",
            format: (v) => (v == null ? "—" : String(v)),
        },
        {
            key: "is_active",
            label: "Active",
            type: "text",
            detailPath: "is_active",
            format: (v) => (v ? "Yes" : "No"),
        },
        { key: "source_refs", label: "Source refs", type: "json-readonly", detailPath: "source_refs" },
        { key: "normalized_data", label: "Normalized data", type: "json-readonly", detailPath: "normalized_data" },
    ],
    defaultFormValues: {
        name_mm: "",
        name_en: "",
        fallback_name: "",
        building_type_id: "",
        admin_area_id: "",
        levels: "",
        height_m: "",
        confidence_score: "80",
        is_verified: false,
        geom: null,
    },
    formSchema: buildingFormSchema,
    detailToFormValues: (detail) => ({
        name_mm: detail.name_mm ?? "",
        name_en: detail.name_en ?? "",
        fallback_name: detail.fallback_name ?? detail.name ?? "",
        building_type_id:
            detail.building_type_id != null
                ? String(detail.building_type_id)
                : detail.building_type?.id != null
                  ? String(detail.building_type.id)
                  : "",
        admin_area_id: detail.admin_area_id != null ? String(detail.admin_area_id) : "",
        levels: detail.levels != null ? String(detail.levels) : "",
        height_m: detail.height_m != null ? String(detail.height_m) : "",
        confidence_score:
            detail.confidence_score != null ? String(detail.confidence_score) : "80",
        is_verified: Boolean(detail.is_verified),
        geom: detail.geometry ?? null,
    }),
    formValuesToCreatePayload: (values) => formValuesToBuildingPayload(values, false),
    formValuesToUpdatePayload: (values) => formValuesToBuildingPayload(values, true),
    getDetailId: detailRecordId,
    fetchDetail: getBuilding,
    createEntity: buildingWriteMutations.createEntity,
    updateEntity: buildingWriteMutations.updateEntity,
    createDescription:
        "Draw the building footprint on the map, then save. The API validates geometry and metadata.",
    editDescription: (detail) => `public_id: ${detail.public_id}`,
    writeApiAvailable: true,
};

export { scoreFieldSchema };
