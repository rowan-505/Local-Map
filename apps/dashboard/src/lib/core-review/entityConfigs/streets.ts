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
import { formatVerificationStatusLabel } from "@/src/features/core-review/config/verificationStatus";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";
import { entityAdminAreaIdForPayload } from "@/src/lib/core-review/entityAdminAreaPayload";
import { roadAdminAreaForStreetUpdatePayload } from "@/src/lib/core-review/roadAdminAreaPayload";
import { townshipAdminEntityField } from "@/src/lib/core-review/townshipAdminEntityField";

import {
    createCoreReviewWriteMutations,
    detailRecordId,
    verificationStatusFormField,
    verificationStatusFromDetail,
    verificationStatusWritePayload,
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
        admin_area_manual_override: z.boolean().optional(),
        admin_area_explicit_clear: z.boolean().optional(),
        travel_direction: z.enum(["both", "forward", "reverse", "reversible", "alternating", "unknown"]),
        bridge: z.boolean(),
        tunnel: z.boolean(),
        surface: z.string(),
        verification_status: z.string(),
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
        ...(entityAdminAreaIdForPayload(values, "admin_area_id") !== undefined
            ? { admin_area_id: entityAdminAreaIdForPayload(values, "admin_area_id") as string | null }
            : {}),
        road_class_id: String(values.road_class_id),
        travel_direction: String(values.travel_direction ?? "both") as CreateStreetPayload["travel_direction"],
        bridge: Boolean(values.bridge),
        tunnel: Boolean(values.tunnel),
        surface: surfaceTrimmed || undefined,
        geometry: lineFromFormValues(values),
        ...verificationStatusWritePayload(values),
    };
}

function streetNamePayload(values: CoreEntityFormValues): Pick<UpdateStreetPayload, "myanmarName" | "englishName"> {
    const myanmarTrimmed = String(values.myanmarName ?? "").trim();
    const englishTrimmed = String(values.englishName ?? "").trim();
    return {
        ...(myanmarTrimmed ? { myanmarName: myanmarTrimmed } : {}),
        ...(englishTrimmed ? { englishName: englishTrimmed } : {}),
    };
}

function formValuesToStreetUpdatePayload(values: CoreEntityFormValues): UpdateStreetPayload {
    const surfaceTrimmed = String(values.surface ?? "").trim();
    const reason = String(values.edit_reason ?? "").trim();
    return {
        ...streetNamePayload(values),
        ...roadAdminAreaForStreetUpdatePayload(values),
        road_class_id: String(values.road_class_id).trim() || null,
        travel_direction: String(values.travel_direction ?? "both") as UpdateStreetPayload["travel_direction"],
        bridge: Boolean(values.bridge),
        tunnel: Boolean(values.tunnel),
        surface: surfaceTrimmed || null,
        geometry: lineFromFormValues(values),
        edit_reason: reason || undefined,
        ...verificationStatusWritePayload(values),
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
        basemapOnly: true,
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
        townshipAdminEntityField({
            slug: "streets",
            geometryFieldKey: GEOM_FIELD,
            adminAreaIdKey: "admin_area_id",
        }),
        {
            key: "travel_direction",
            label: "Travel direction",
            type: "select",
            helpText: "Authoritative direction. Legacy one-way output is derived from this value.",
            selectOptions: [
                { value: "both", label: "Both directions" },
                { value: "forward", label: "Forward" },
                { value: "reverse", label: "Reverse" },
                { value: "reversible", label: "Reversible" },
                { value: "alternating", label: "Alternating" },
                { value: "unknown", label: "Unknown" },
            ],
        },
        { key: "bridge", label: "Bridge", type: "boolean" },
        { key: "tunnel", label: "Tunnel", type: "boolean" },
        verificationStatusFormField(),
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
        { key: "routing_status", label: "Legacy routing status", type: "text", detailPath: "routing_status" },
        { key: "edit_status", label: "Legacy edit status", type: "text", detailPath: "edit_status" },
        {
            key: "manual_override",
            label: "Manual override",
            type: "text",
            detailPath: "manual_override",
            format: (v) => (v ? "Yes" : "No"),
        },
        {
            key: "verification_status",
            label: "Verification status",
            type: "text",
            detailPath: "verification_status",
            format: (v) => formatVerificationStatusLabel(typeof v === "string" ? v : undefined),
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
        admin_area_manual_override: false,
        admin_area_explicit_clear: false,
        travel_direction: "both",
        bridge: false,
        tunnel: false,
        surface: "",
        verification_status: "unverified",
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

        const detailRecord = detail as Street & {
            name_mm?: string | null;
            name_en?: string | null;
            roadClassId?: string | null;
            adminAreaId?: string | null;
            manualOverride?: boolean;
            isOneway?: boolean;
            travelDirection?: Street["travel_direction"];
        };
        return {
            myanmarName: detailRecord.myanmarName ?? detailRecord.name_mm ?? "",
            englishName: detailRecord.englishName ?? detailRecord.name_en ?? "",
            road_class_id: detailRecord.road_class_id ?? detailRecord.roadClassId ?? "",
            admin_area_id: detailRecord.admin_area_id ?? detailRecord.adminAreaId ?? "",
            admin_area_manual_override: Boolean(
                detailRecord.manual_override ?? detailRecord.manualOverride,
            ),
            admin_area_explicit_clear: false,
            travel_direction:
                detailRecord.travel_direction ??
                detailRecord.travelDirection ??
                ((detailRecord.is_oneway ?? detailRecord.isOneway) ? "forward" : "both"),
            bridge: detailRecord.bridge ?? false,
            tunnel: detailRecord.tunnel ?? false,
            surface: detailRecord.surface ?? "",
            verification_status: verificationStatusFromDetail(
                detail as { verification_status?: string | null; is_verified?: boolean | null },
            ),
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
