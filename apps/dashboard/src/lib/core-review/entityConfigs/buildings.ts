import type { Geometry } from "geojson";
import { z } from "zod";

import type { Building, BuildingGeometry, CreateBuildingPayload, UpdateBuildingPayload } from "@/src/lib/api";
import { getBuilding } from "@/src/lib/api";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";
import { buildingAdminAreaForUpdatePayload } from "@/src/lib/core-review/buildingAdminAreaPayload";
import { townshipAdminEntityField } from "@/src/lib/core-review/townshipAdminEntityField";

import {
    createCoreReviewWriteMutations,
    detailRecordId,
    verificationStatusFormField,
    verificationStatusFromDetail,
    verificationStatusWritePayload,
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
        admin_area_manual_override: z.boolean().optional(),
        admin_area_explicit_clear: z.boolean().optional(),
        levels: z.string(),
        height_m: z.string(),
        confidence_score: z.string(),
        verification_status: z.string(),
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
        // Canonical names live in core_map_building_names via name_mm/name_en.
        // Do not write legacy core_map_buildings.name.
    };

    const buildingTypeId = String(values.building_type_id ?? "").trim();

    const adminSlice = buildingAdminAreaForUpdatePayload(values);
    if (isEdit) {
        payload.building_type_id = buildingTypeId || null;
        Object.assign(payload, adminSlice);
    } else {
        if (buildingTypeId) payload.building_type_id = buildingTypeId;
        if (adminSlice.admin_area_id) {
            payload.admin_area_id = adminSlice.admin_area_id;
        } else if (adminSlice.explicitClearAdminArea) {
            payload.admin_area_id = null;
            payload.explicitClearAdminArea = true;
        }
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

    Object.assign(payload, verificationStatusWritePayload(values));
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
        basemapOnly: true,
    },
    editableFields: [
        { key: "name_mm", label: "Myanmar name", type: "text" },
        { key: "name_en", label: "English name", type: "text" },
        {
            key: "fallback_name",
            label: "Derived display name",
            type: "text",
            helpText: "Read-only display from names table. Not written to core_map_buildings.name.",
        },
        { key: "building_type_id", label: "Building type", type: "ref", refSource: "building-types" },
        townshipAdminEntityField({
            slug: "buildings",
            geometryFieldKey: GEOM_FIELD,
            adminAreaIdKey: "admin_area_id",
        }),
        { key: "levels", label: "Levels", type: "number", numberMin: 0, numberStep: 1, placeholder: "Optional" },
        { key: "height_m", label: "Height (m)", type: "number", numberMin: 0, placeholder: "Optional" },
        { key: "confidence_score", label: "Confidence score", type: "number", numberMin: 0, numberMax: 100 },
        verificationStatusFormField(),
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
        admin_area_manual_override: false,
        admin_area_explicit_clear: false,
        levels: "",
        height_m: "",
        confidence_score: "80",
        verification_status: "unverified",
        geom: null,
    },
    formSchema: buildingFormSchema,
    detailToFormValues: (detail) => {
        const d = detail as Building & {
            nameMm?: string | null;
            nameEn?: string | null;
            buildingTypeId?: string | number | null;
            adminAreaId?: string | number | null;
            confidenceScore?: number | null;
        };
        return {
            name_mm: d.name_mm ?? d.nameMm ?? "",
            name_en: d.name_en ?? d.nameEn ?? "",
            fallback_name: d.fallback_name ?? d.name ?? "",
            building_type_id:
                d.building_type_id != null
                    ? String(d.building_type_id)
                    : d.buildingTypeId != null
                      ? String(d.buildingTypeId)
                      : d.building_type?.id != null
                        ? String(d.building_type.id)
                        : "",
            admin_area_id:
                d.admin_area_id != null
                    ? String(d.admin_area_id)
                    : d.adminAreaId != null
                      ? String(d.adminAreaId)
                      : "",
            admin_area_explicit_clear: false,
            levels: d.levels != null ? String(d.levels) : "",
            height_m: d.height_m != null ? String(d.height_m) : "",
            confidence_score:
                d.confidence_score != null
                    ? String(d.confidence_score)
                    : d.confidenceScore != null
                      ? String(d.confidenceScore)
                      : "80",
            verification_status: verificationStatusFromDetail(d),
            geom: d.geometry ?? null,
        };
    },
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
