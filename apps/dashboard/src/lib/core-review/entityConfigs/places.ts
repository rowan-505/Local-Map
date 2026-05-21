import type { Geometry } from "geojson";
import { z } from "zod";

import type {
    CreatePlacePayload,
    PlaceDetail,
    UpdatePlacePayload,
} from "@/src/lib/api";
import { getPlace } from "@/src/lib/api";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";

import { scoreFieldSchema } from "./buildings";
import {
    createCoreReviewWriteMutations,
    detailRecordId,
} from "./shared";
import type { CoreEntityConfig, CoreEntityFormMode, CoreEntityFormValues } from "./types";

const POINT_GEOM_FIELD = "point_geom";

function roundCoord(value: number) {
    return Number(value.toFixed(7));
}

function placeFormSchema(mode: CoreEntityFormMode) {
    const base = z.object({
        myanmarName: z.string(),
        englishName: z.string(),
        categoryId: z.string().min(1, "Category is required"),
        adminAreaId: z.string(),
        plusCode: z.string(),
        importanceScore: scoreFieldSchema,
        popularityScore: scoreFieldSchema,
        confidenceScore: scoreFieldSchema,
        isPublic: z.boolean(),
        isVerified: z.boolean(),
        sourceTypeId: z.string(),
        publishStatusId: z.string(),
        point_geom: z.custom<Geometry | null>(),
    });

    return base.refine(
        (values) => values.myanmarName.trim().length > 0 || values.englishName.trim().length > 0,
        { message: "Myanmar name or English name is required", path: ["myanmarName"] },
    ).refine(
        (values) => {
            if (!values.point_geom || values.point_geom.type !== "Point") return false;
            const [lng, lat] = values.point_geom.coordinates;
            return Number.isFinite(lng) && Number.isFinite(lat);
        },
        { message: "Click the map to set a location", path: ["point_geom"] },
    ).superRefine((values, ctx) => {
        if (mode === "edit" && !values.sourceTypeId.trim()) {
            ctx.addIssue({
                code: "custom",
                message: "Source type is required",
                path: ["sourceTypeId"],
            });
        }
    });
}

function pointFromFormValues(values: CoreEntityFormValues): { lat: number; lng: number } {
    const geometry = getFormGeometry(values, POINT_GEOM_FIELD);
    if (!geometry || geometry.type !== "Point") {
        throw new Error("Click the map to set a location.");
    }
    const [lng, lat] = geometry.coordinates;
    return { lat: roundCoord(Number(lat)), lng: roundCoord(Number(lng)) };
}

function formValuesToPlacePayload(values: CoreEntityFormValues): CreatePlacePayload {
    const { lat, lng } = pointFromFormValues(values);
    const mm = String(values.myanmarName ?? "").trim();
    const en = String(values.englishName ?? "").trim();

    return {
        ...(mm ? { myanmarName: mm } : {}),
        ...(en ? { englishName: en } : {}),
        categoryId: String(values.categoryId),
        adminAreaId: String(values.adminAreaId ?? "").trim() || null,
        lat,
        lng,
        plusCode: String(values.plusCode ?? "").trim() || null,
        importanceScore:
            values.importanceScore === "" ? 0 : (values.importanceScore as number),
        popularityScore:
            values.popularityScore === "" ? 0 : (values.popularityScore as number),
        confidenceScore:
            values.confidenceScore === "" ? 50 : (values.confidenceScore as number),
        isPublic: Boolean(values.isPublic),
        isVerified: Boolean(values.isVerified),
        sourceTypeId: String(values.sourceTypeId ?? "").trim() || null,
        publishStatusId: String(values.publishStatusId ?? "").trim() || null,
    };
}

const placeWriteMutations = createCoreReviewWriteMutations<PlaceDetail>("places");

export const PLACES_ENTITY_CONFIG: CoreEntityConfig<
    PlaceDetail,
    CreatePlacePayload,
    UpdatePlacePayload
> = {
    entityKey: "places",
    label: "Place",
    labelPlural: "Places",
    routeSegment: "places",
    coreReviewSlug: "places",
    apiBase: "/places",
    listRoute: coreReviewPath("places"),
    createRoute: coreReviewPath("places/new"),
    editRoute: (id) => coreReviewPath(`places/${id}/edit`),
    geometry: {
        fieldKey: POINT_GEOM_FIELD,
        geometryType: "point",
        title: "Place location",
    },
    editableFields: [
        { key: "myanmarName", label: "Myanmar name", type: "text" },
        { key: "englishName", label: "English name", type: "text" },
        {
            key: "categoryId",
            label: "Category",
            type: "ref",
            refSource: "place-form-options:categories",
            required: true,
        },
        { key: "adminAreaId", label: "Admin area", type: "ref", refSource: "admin-areas" },
        { key: "plusCode", label: "Plus code", type: "text", placeholder: "Optional" },
        { key: "importanceScore", label: "Importance score", type: "number", placeholder: "Optional" },
        { key: "popularityScore", label: "Popularity score", type: "number", placeholder: "Optional" },
        { key: "confidenceScore", label: "Confidence score", type: "number", numberMin: 0, numberMax: 100 },
        { key: "isPublic", label: "Public", type: "boolean" },
        { key: "isVerified", label: "Verified", type: "boolean" },
        {
            key: "sourceTypeId",
            label: "Source type",
            type: "ref",
            refSource: "place-form-options:source_types",
        },
        {
            key: "publishStatusId",
            label: "Publish status",
            type: "ref",
            refSource: "place-form-options:publish_statuses",
        },
    ],
    readonlyMetadata: [
        { key: "id", label: "Internal ID", type: "text", detailPath: "id" },
        { key: "public_id", label: "Public ID", type: "text", detailPath: "public_id" },
        { key: "display_name", label: "Display name", type: "text", detailPath: "display_name" },
        { key: "primary_name", label: "Primary name", type: "text", detailPath: "primary_name" },
        { key: "category_name", label: "Category", type: "text", detailPath: "category_name" },
        { key: "admin_area_name", label: "Admin area", type: "text", detailPath: "admin_area_name" },
        { key: "created_at", label: "Created", type: "date-readonly", detailPath: "created_at" },
        { key: "updated_at", label: "Updated", type: "date-readonly", detailPath: "updated_at" },
    ],
    defaultFormValues: {
        myanmarName: "",
        englishName: "",
        categoryId: "",
        adminAreaId: "",
        plusCode: "",
        importanceScore: "",
        popularityScore: "",
        confidenceScore: "",
        isPublic: true,
        isVerified: false,
        sourceTypeId: "",
        publishStatusId: "",
        point_geom: null,
    },
    formSchema: placeFormSchema,
    detailToFormValues: (detail) => ({
        myanmarName: detail.myanmarName ?? "",
        englishName: detail.englishName ?? "",
        categoryId: detail.category_id,
        adminAreaId: detail.admin_area_id ?? "",
        plusCode: detail.plus_code ?? "",
        importanceScore: detail.importance_score ?? "",
        popularityScore: detail.popularity_score ?? "",
        confidenceScore: detail.confidence_score ?? "",
        isPublic: detail.is_public,
        isVerified: detail.is_verified,
        sourceTypeId: detail.source_type_id,
        publishStatusId: detail.publish_status_id ?? "",
        point_geom: {
            type: "Point",
            coordinates: [detail.lng, detail.lat],
        },
    }),
    formValuesToCreatePayload: formValuesToPlacePayload,
    formValuesToUpdatePayload: (values) => {
        const mm = String(values.myanmarName ?? "").trim();
        const en = String(values.englishName ?? "").trim();
        const payload = formValuesToPlacePayload(values);
        return {
            ...payload,
            myanmarName: mm,
            englishName: en,
            sourceTypeId: String(values.sourceTypeId ?? "").trim(),
        };
    },
    getDetailId: detailRecordId,
    fetchDetail: getPlace,
    createEntity: placeWriteMutations.createEntity,
    updateEntity: placeWriteMutations.updateEntity,
    createDescription: "Set the place location on the map and fill in attributes. All changes go through the API.",
    editDescription: (detail) => `public_id: ${detail.public_id}`,
    writeApiAvailable: true,
};
