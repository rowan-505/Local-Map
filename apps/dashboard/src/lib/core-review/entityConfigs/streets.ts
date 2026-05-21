import type { Geometry } from "geojson";
import { z } from "zod";

import type {
    CreateStreetPayload,
    Street,
    StreetLineStringGeoJson,
    UpdateStreetPayload,
} from "@/src/lib/api";
import { getStreet } from "@/src/lib/api";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";

import {
    createCoreReviewWriteMutations,
    detailRecordId,
} from "./shared";

import type { CoreEntityConfig, CoreEntityFormMode, CoreEntityFormValues } from "./types";

const GEOM_FIELD = "geom";

const nullableStringIdSchema = z.preprocess((value) => {
    if (value === "" || value === undefined) return null;
    return value;
}, z.string().nullable());

function streetFormSchema(mode: CoreEntityFormMode) {
    const base = z.object({
        myanmarName: z.string(),
        englishName: z.string(),
        road_class_id: z.string().trim().min(1, "Road class is required"),
        admin_area_id: nullableStringIdSchema,
        is_oneway: z.boolean(),
        bridge: z.boolean(),
        tunnel: z.boolean(),
        surface: z.string(),
        geom: z.custom<Geometry | null>(),
        edit_reason: z.string().optional(),
    });

    if (mode === "edit") {
        return base;
    }

    return base.omit({ edit_reason: true });
}

function lineFromFormValues(values: CoreEntityFormValues): StreetLineStringGeoJson {
    const geometry = getFormGeometry(values, GEOM_FIELD);
    if (!geometry || geometry.type !== "LineString") {
        throw new Error("Draw a street centerline on the map.");
    }
    if (geometry.coordinates.length < 2) {
        throw new Error("Centerline must have at least two coordinates.");
    }
    return geometry as StreetLineStringGeoJson;
}

function formValuesToStreetCreatePayload(values: CoreEntityFormValues): CreateStreetPayload {
    const surfaceTrimmed = String(values.surface ?? "").trim();
    return {
        myanmarName: String(values.myanmarName ?? "").trim() || undefined,
        englishName: String(values.englishName ?? "").trim() || undefined,
        admin_area_id: values.admin_area_id as string | null,
        road_class_id: String(values.road_class_id),
        is_oneway: Boolean(values.is_oneway),
        bridge: Boolean(values.bridge),
        tunnel: Boolean(values.tunnel),
        surface: surfaceTrimmed || undefined,
        geometry: lineFromFormValues(values),
    };
}

function formValuesToStreetUpdatePayload(values: CoreEntityFormValues): UpdateStreetPayload {
    const surfaceTrimmed = String(values.surface ?? "").trim();
    const reason = String(values.edit_reason ?? "").trim();
    return {
        myanmarName: String(values.myanmarName ?? "").trim() || undefined,
        englishName: String(values.englishName ?? "").trim() || undefined,
        admin_area_id: values.admin_area_id as string | null,
        road_class_id: String(values.road_class_id).trim() || null,
        is_oneway: Boolean(values.is_oneway),
        bridge: Boolean(values.bridge),
        tunnel: Boolean(values.tunnel),
        surface: surfaceTrimmed || null,
        geometry: lineFromFormValues(values),
        edit_reason: reason || undefined,
    };
}

const streetWriteMutations = createCoreReviewWriteMutations<Street>("streets");

export const STREETS_ENTITY_CONFIG: CoreEntityConfig<Street, CreateStreetPayload, UpdateStreetPayload> = {
    entityKey: "streets",
    label: "Street",
    labelPlural: "Streets",
    routeSegment: "roads",
    coreReviewSlug: "streets",
    apiBase: "/streets",
    listRoute: coreReviewPath("roads"),
    createRoute: coreReviewPath("roads/new"),
    editRoute: (id) => coreReviewPath(`roads/${id}/edit`),
    geometry: {
        fieldKey: GEOM_FIELD,
        geometryType: "line",
        title: "Road centerline",
        enableSnapping: true,
        showVertices: true,
        validateWithApi: true,
    },
    editableFields: [
        {
            key: "road_class_id",
            label: "Road class",
            type: "ref",
            refSource: "road-classes",
            required: true,
        },
        { key: "myanmarName", label: "Myanmar name", type: "text", placeholder: "ဥပမာ · အောင်မင်္ဂလာ" },
        { key: "englishName", label: "English name", type: "text", placeholder: "Example — Aung Mingalar" },
        {
            key: "surface",
            label: "Surface",
            type: "surface-preset",
            helpText: "Common OSM-style surface values, or type a custom value.",
        },
        { key: "admin_area_id", label: "Admin area", type: "ref", refSource: "admin-areas" },
        { key: "is_oneway", label: "One-way", type: "boolean" },
        { key: "bridge", label: "Bridge", type: "boolean" },
        { key: "tunnel", label: "Tunnel", type: "boolean" },
        {
            key: "edit_reason",
            label: "Edit reason",
            type: "textarea",
            editOnly: true,
            placeholder: "Optional note for audit trail",
        },
    ],
    readonlyMetadata: [
        { key: "public_id", label: "Public ID", type: "text", detailPath: "public_id" },
        { key: "canonical_name", label: "Canonical name", type: "text", detailPath: "canonical_name" },
        { key: "routing_status", label: "Routing status", type: "text", detailPath: "routing_status" },
        { key: "edit_status", label: "Edit status", type: "text", detailPath: "edit_status" },
        {
            key: "manual_override",
            label: "Manual override",
            type: "text",
            detailPath: "manual_override",
            format: (v) => (v ? "Yes" : "No"),
        },
        {
            key: "is_verified",
            label: "Verified",
            type: "text",
            detailPath: "is_verified",
            format: (v) => (v ? "Yes" : "No"),
        },
        {
            key: "source_type_id",
            label: "Source type ID",
            type: "text",
            detailPath: "source_type_id",
        },
        {
            key: "is_active",
            label: "Active",
            type: "text",
            detailPath: "is_active",
            format: (v) => (v ? "Yes" : "No"),
        },
        {
            key: "deleted_at",
            label: "Deleted at",
            type: "date-readonly",
            detailPath: "deleted_at",
            format: (v) => (v ? String(v) : "—"),
        },
        { key: "last_edited_at", label: "Last edited", type: "date-readonly", detailPath: "last_edited_at" },
        { key: "created_at", label: "Created", type: "date-readonly", detailPath: "created_at" },
        { key: "updated_at", label: "Updated", type: "date-readonly", detailPath: "updated_at" },
    ],
    defaultFormValues: {
        myanmarName: "",
        englishName: "",
        road_class_id: "",
        admin_area_id: "",
        is_oneway: false,
        bridge: false,
        tunnel: false,
        surface: "",
        geom: null,
        edit_reason: "",
    },
    formSchema: streetFormSchema,
    detailToFormValues: (detail) => {
        let geometry: Geometry | null = null;
        if (detail.geometry?.type === "LineString") {
            geometry = detail.geometry as StreetLineStringGeoJson;
        } else if (detail.geometry?.type === "MultiLineString" && detail.geometry.coordinates[0]) {
            geometry = {
                type: "LineString",
                coordinates: detail.geometry.coordinates[0],
            };
        }

        return {
            myanmarName: detail.myanmarName ?? "",
            englishName: detail.englishName ?? "",
            road_class_id: detail.road_class_id ?? "",
            admin_area_id: detail.admin_area_id ?? "",
            is_oneway: detail.is_oneway,
            bridge: detail.bridge,
            tunnel: detail.tunnel,
            surface: detail.surface ?? "",
            geom: geometry,
            edit_reason: "",
        };
    },
    formValuesToCreatePayload: formValuesToStreetCreatePayload,
    formValuesToUpdatePayload: formValuesToStreetUpdatePayload,
    getDetailId: detailRecordId,
    fetchDetail: getStreet,
    createEntity: streetWriteMutations.createEntity,
    updateEntity: streetWriteMutations.updateEntity,
    createDescription:
        "Draw the centerline on the map, then save. Kyauktan is the default view. All changes go through the API.",
    editDescription: (detail) => `public_id: ${detail.public_id}`,
    writeApiAvailable: true,
};
