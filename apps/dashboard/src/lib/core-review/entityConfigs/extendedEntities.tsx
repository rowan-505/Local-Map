import { z } from "zod";

import type {
    CoreReviewAddressRow,
    CoreReviewAdminAreaRow,
    CoreReviewMapFeatureRow,
} from "@/src/features/core-review/config/types";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import {
    bool,
    createCoreReviewFetchDetail,
    createCoreReviewWriteMutations,
    detailRecordId,
    lineFromDetailGeometry,
    mapClassifiedFeaturePayload,
    mapWaterLinePayload,
    nullableFormString,
    optionalBooleanSchema,
    optionalFormRefId,
    optionalGeometrySchema,
    optionalStringSchema,
    parseOptionalFormRefId,
    parseRequiredFormRefId,
    pointFromDetailGeometry,
    polygonFromDetailGeometry,
    requirePointGeometry,
    requirePolygonGeometry,
    standardIdReadonlyFields,
    standardPublicIdReadonlyFields,
    standardTimestampReadonlyFields,
    str,
    verificationStatusFormField,
    verificationStatusFromDetail,
    verificationStatusWritePayload,
} from "./shared";
import type { CoreEntityConfig, CoreEntityFormMode, CoreEntityFormValues } from "./types";

type AddressDetail = CoreReviewAddressRow & {
    unitNumber?: string | null;
    postalCode?: string | null;
    streetId?: string | null;
    streetPublicId?: string | null;
    sourceTypeId?: string | null;
    sourceRefs?: unknown;
    normalizedData?: unknown;
    components?: import("@/src/features/core-review/config/types").CoreReviewAddressComponent[];
};

type AdminAreaDetail = CoreReviewAdminAreaRow & {
    sourceTypeId?: string | null;
    nameMm?: string | null;
    nameEn?: string | null;
};

type MapFeatureDetail = CoreReviewMapFeatureRow & {
    sourceStagingId?: string | null;
    normalizedData?: unknown;
    sourceRefs?: unknown;
};

function baseWriteConfig<TDetail>(
    partial: Omit<
        CoreEntityConfig<TDetail, Record<string, unknown>, Record<string, unknown>>,
        "writeApiAvailable" | "formValuesToCreatePayload" | "formValuesToUpdatePayload" | "createEntity" | "updateEntity" | "getDetailId"
    > & {
        coreReviewSlug: NonNullable<CoreEntityConfig["coreReviewSlug"]>;
        formValuesToCreatePayload: (values: CoreEntityFormValues) => Record<string, unknown>;
        formValuesToUpdatePayload: (values: CoreEntityFormValues) => Record<string, unknown>;
        getDetailId?: (detail: TDetail) => string;
    },
): CoreEntityConfig<TDetail, Record<string, unknown>, Record<string, unknown>> {
    const mutations = createCoreReviewWriteMutations<TDetail>(partial.coreReviewSlug);
    return {
        ...partial,
        writeApiAvailable: true,
        createEntity: mutations.createEntity,
        updateEntity: mutations.updateEntity,
        getDetailId: partial.getDetailId ?? ((detail) => detailRecordId(detail as { publicId?: string; public_id?: string; id?: string | number })),
    };
}

// ── Landuse / water (polygon + line factory) ──────────────────────────────────

function mapFeatureFormSchema(entityKey: "water-lines" | "water-polygons", _mode: CoreEntityFormMode) {
    return z
        .object({
            name: optionalStringSchema,
            class_code: z.string().trim().min(1, "Class code is required"),
            is_active: optionalBooleanSchema,
            verification_status: optionalStringSchema,
            geom: optionalGeometrySchema,
        })
        .superRefine((data, ctx) => {
            if (!data.geom) {
                ctx.addIssue({
                    code: "custom",
                    message:
                        entityKey === "water-lines"
                            ? "Draw a water line on the map before saving."
                            : "Draw a water polygon on the map before saving.",
                    path: ["geom"],
                });
            }
        });
}

function createMapFeatureConfig(
    entityKey: "water-lines" | "water-polygons",
    label: string,
    labelPlural: string,
    geometryType: "polygon" | "line",
    geometryTitle: string,
): CoreEntityConfig<MapFeatureDetail, Record<string, unknown>, Record<string, unknown>> {
    const toGeom =
        geometryType === "line" ? lineFromDetailGeometry : polygonFromDetailGeometry;
    const toPayload =
        geometryType === "line"
            ? (values: CoreEntityFormValues) => mapWaterLinePayload(values, "geom")
            : (values: CoreEntityFormValues) => mapClassifiedFeaturePayload(values, "geom");

    return baseWriteConfig<MapFeatureDetail>({
        entityKey,
        label,
        labelPlural,
        routeSegment: entityKey,
        coreReviewSlug: entityKey,
        apiBase: `/core-review/${entityKey}`,
        listRoute: coreReviewPath(entityKey),
        createRoute: coreReviewPath(`${entityKey}/new`),
        editRoute: (id) => coreReviewPath(`${entityKey}/${id}/edit`),
        geometry: {
            fieldKey: "geom",
            geometryType,
            title: geometryTitle,
            showVertices: true,
        },
        editableFields: [
            { key: "name", label: "Name", type: "text" },
            { key: "class_code", label: "Class code", type: "text", required: true },
            { key: "is_active", label: "Active", type: "boolean" },
            verificationStatusFormField(),
        ],
        readonlyMetadata: [
            ...standardIdReadonlyFields(),
            { key: "external_id", label: "External ID", type: "text", detailPath: "externalId" },
            {
                key: "source_staging_id",
                label: "Source staging ID",
                type: "text",
                detailPath: "sourceStagingId",
            },
            ...standardTimestampReadonlyFields(),
            { key: "source_refs", label: "Source refs", type: "json-readonly", detailPath: "sourceRefs" },
            {
                key: "normalized_data",
                label: "Normalized data",
                type: "json-readonly",
                detailPath: "normalizedData",
            },
        ],
        defaultFormValues: {
            name: "",
            class_code: "",
            is_active: true,
            verification_status: "unverified",
            geom: null,
        },
        formSchema: (mode) => mapFeatureFormSchema(entityKey, mode),
        detailToFormValues: (detail) => ({
            name: str(detail.name),
            class_code: str(detail.classCode),
            is_active: bool(detail.isActive),
            verification_status: verificationStatusFromDetail(detail),
            geom: toGeom(detail.geometry),
        }),
        getDetailId: (detail) => detail.id,
        fetchDetail: createCoreReviewFetchDetail<MapFeatureDetail>(entityKey),
        formValuesToCreatePayload: toPayload,
        formValuesToUpdatePayload: toPayload,
        createDescription: `Draw the ${label.toLowerCase()} geometry on the map, then save.`,
        editDescription: (detail) => `id: ${detail.id}`,
    });
}

export const WATER_LINES_ENTITY_CONFIG = createMapFeatureConfig(
    "water-lines",
    "Water line",
    "Water lines",
    "line",
    "Water line geometry",
);

export const WATER_POLYGONS_ENTITY_CONFIG = createMapFeatureConfig(
    "water-polygons",
    "Water polygon",
    "Water polygons",
    "polygon",
    "Water polygon footprint",
);

// ── Addresses ───────────────────────────────────────────────────────────────
// Township-only rollout does NOT apply here. Keep generic admin area selection
// (`ref` + `admin-areas`) and pass admin_area_id through save unchanged — ward,
// village tract, township, district, and other active levels remain valid.

function addressFormSchema(_mode: CoreEntityFormMode) {
    return z
        .object({
            full_address: optionalStringSchema,
            house_number: optionalStringSchema,
            unit_number: optionalStringSchema,
            postal_code: optionalStringSchema,
            street_id: optionalStringSchema,
            admin_area_id: optionalStringSchema,
            source_type_id: optionalStringSchema,
            is_public: optionalBooleanSchema,
            verification_status: optionalStringSchema,
            point_geom: optionalGeometrySchema,
            entrance_geom: optionalGeometrySchema,
        })
        .superRefine((data, ctx) => {
            if (
                !data.point_geom ||
                (typeof data.point_geom === "object" &&
                    "type" in data.point_geom &&
                    data.point_geom.type !== "Point")
            ) {
                ctx.addIssue({
                    code: "custom",
                    message: "Click the map to set the address location.",
                    path: ["point_geom"],
                });
            }
        });
}

function addressPayload(values: CoreEntityFormValues) {
    const entrance = values.entrance_geom;
    const components = values.address_components as
        | { upsert?: unknown[]; delete_ids?: string[] }
        | undefined;
    return {
        house_number: nullableFormString(values.house_number),
        unit_number: nullableFormString(values.unit_number),
        postal_code: nullableFormString(values.postal_code),
        street_id: optionalFormRefId(values.street_id),
        admin_area_id: optionalFormRefId(values.admin_area_id),
        source_type_id: optionalFormRefId(values.source_type_id),
        is_public: bool(values.is_public),
        ...verificationStatusWritePayload(values),
        point_geom: requirePointGeometry(values, "point_geom"),
        entrance_geom:
            entrance && typeof entrance === "object" && "type" in entrance && entrance.type === "Point"
                ? entrance
                : null,
        ...(components &&
        ((components.upsert?.length ?? 0) > 0 || (components.delete_ids?.length ?? 0) > 0)
            ? { components }
            : {}),
    };
}

export const ADDRESSES_ENTITY_CONFIG = baseWriteConfig<AddressDetail>({
    entityKey: "addresses",
    label: "Address",
    labelPlural: "Addresses",
    routeSegment: "addresses",
    coreReviewSlug: "addresses",
    apiBase: "/core-review/addresses",
    listRoute: coreReviewPath("addresses"),
    createRoute: coreReviewPath("addresses/new"),
    editRoute: (id) => coreReviewPath(`addresses/${id}/edit`),
    geometry: {
        fieldKey: "point_geom",
        geometryType: "point",
        title: "Address location",
    },
    secondaryGeometry: {
        fieldKey: "entrance_geom",
        geometryType: "point",
        title: "Entrance location",
    },
    editableFields: [
        { key: "house_number", label: "House number", type: "text" },
        { key: "unit_number", label: "Unit number", type: "text" },
        { key: "postal_code", label: "Postal code", type: "text" },
        { key: "street_id", label: "Street", type: "ref", refSource: "streets" },
        { key: "admin_area_id", label: "Admin area", type: "ref", refSource: "admin-areas" },
        { key: "source_type_id", label: "Source type", type: "ref", refSource: "reference-options:source_types" },
        { key: "is_public", label: "Public", type: "boolean" },
        verificationStatusFormField(),
    ],
    readonlyMetadata: [
        ...standardPublicIdReadonlyFields(),
        ...standardIdReadonlyFields(),
        ...standardTimestampReadonlyFields(),
        {
            key: "generated_en",
            label: "Generated address (EN)",
            type: "text",
            detailPath: "generatedFullAddressEn",
        },
        {
            key: "generated_my",
            label: "Generated address (MY)",
            type: "text",
            detailPath: "generatedFullAddressMy",
        },
        {
            key: "cached_full",
            label: "DB cache (full_address)",
            type: "text",
            detailPath: "cachedFullAddress",
        },
        {
            key: "components_json",
            label: "Components",
            type: "json-readonly",
            detailPath: "components",
        },
    ],
    defaultFormValues: {
        full_address: "",
        house_number: "",
        unit_number: "",
        postal_code: "",
        street_id: "",
        admin_area_id: "",
        source_type_id: "",
        is_public: true,
        verification_status: "unverified",
        point_geom: null,
        entrance_geom: null,
        address_components: { upsert: [] },
    },
    formSchema: addressFormSchema,
    detailToFormValues: (detail) => ({
        full_address: str(detail.displayFullAddress ?? detail.generatedFullAddressEn ?? detail.fullAddress),
        house_number: str(detail.houseNumber),
        unit_number: str(detail.unitNumber),
        postal_code: str(detail.postalCode),
        street_id: str(detail.streetId),
        admin_area_id: str(detail.adminAreaId),
        source_type_id: str(detail.sourceTypeId),
        is_public: bool(detail.isPublic),
        verification_status: verificationStatusFromDetail(detail),
        point_geom: pointFromDetailGeometry(detail.geometry),
        entrance_geom: pointFromDetailGeometry(detail.entranceGeometry),
    }),
    getDetailId: (detail) => detail.publicId,
    fetchDetail: createCoreReviewFetchDetail<AddressDetail>("addresses"),
    formValuesToCreatePayload: addressPayload,
    formValuesToUpdatePayload: addressPayload,
    createDescription: "Set address location and attributes, then save.",
    editDescription: (detail) => `public_id: ${detail.publicId}`,
});

// ── Admin areas ─────────────────────────────────────────────────────────────

function adminAreaFormSchema(_mode: CoreEntityFormMode) {
    return z
        .object({
            canonical_name: z.string().trim().min(1, "Canonical name is required"),
            name_mm: optionalStringSchema,
            name_en: optionalStringSchema,
            slug: optionalStringSchema,
            parent_id: optionalStringSchema,
            admin_level_id: z.string().min(1, "Admin level is required"),
            source_type_id: optionalStringSchema,
            is_active: optionalBooleanSchema,
            verification_status: optionalStringSchema,
            boundary_status: z.string().trim().min(1, "Boundary status is required"),
            address_usage: z.string().trim().min(1, "Address usage is required"),
            is_official_boundary: optionalBooleanSchema,
            boundary_confidence_score: z.coerce
                .number()
                .min(0, "Must be between 0 and 100")
                .max(100, "Must be between 0 and 100"),
            boundary_note: optionalStringSchema,
            geom: optionalGeometrySchema,
        })
        .superRefine((data, ctx) => {
            if (!data.geom) {
                ctx.addIssue({
                    code: "custom",
                    message: "Draw an admin boundary polygon before saving.",
                    path: ["geom"],
                });
            }
        });
}

function adminAreaPayload(values: CoreEntityFormValues) {
    const canonicalName = String(values.canonical_name ?? "").trim();
    if (!canonicalName) {
        throw new Error("Canonical name is required.");
    }
    const adminLevelId = parseRequiredFormRefId(values.admin_level_id, "Admin level");
    const parentId = parseOptionalFormRefId(values.parent_id);
    const sourceTypeId = parseOptionalFormRefId(values.source_type_id);
    const boundaryStatus = String(values.boundary_status ?? "").trim();
    const addressUsage = String(values.address_usage ?? "").trim();
    if (!boundaryStatus) {
        throw new Error("Boundary status is required.");
    }
    if (!addressUsage) {
        throw new Error("Address usage is required.");
    }
    return {
        canonical_name: canonicalName,
        name_mm: nullableFormString(values.name_mm),
        name_en: nullableFormString(values.name_en),
        slug: nullableFormString(values.slug),
        adminLevelId,
        admin_level_id: adminLevelId,
        parentId,
        parent_id: parentId,
        ...(sourceTypeId !== null
            ? { sourceTypeId: sourceTypeId, source_type_id: sourceTypeId }
            : {}),
        boundaryStatus,
        boundary_status: boundaryStatus,
        addressUsage,
        address_usage: addressUsage,
        isOfficialBoundary: bool(values.is_official_boundary),
        is_official_boundary: bool(values.is_official_boundary),
        boundaryConfidenceScore: Number(values.boundary_confidence_score),
        boundary_confidence_score: Number(values.boundary_confidence_score),
        boundaryNote: nullableFormString(values.boundary_note),
        boundary_note: nullableFormString(values.boundary_note),
        is_active: bool(values.is_active),
        ...verificationStatusWritePayload(values),
        geom: requirePolygonGeometry(values, "geom"),
    };
}

export const ADMIN_AREAS_ENTITY_CONFIG = baseWriteConfig<AdminAreaDetail>({
    entityKey: "admin-areas",
    label: "Admin area",
    labelPlural: "Admin areas",
    routeSegment: "admin-areas",
    coreReviewSlug: "admin-areas",
    apiBase: "/core-review/admin-areas",
    listRoute: coreReviewPath("admin-areas"),
    createRoute: coreReviewPath("admin-areas/new"),
    editRoute: (id) => coreReviewPath(`admin-areas/${id}/edit`),
    geometry: {
        fieldKey: "geom",
        geometryType: "polygon",
        title: "Admin boundary",
        showVertices: true,
        autoEnterVertexEdit: false,
        basemapOnly: true,
    },
    editableFields: [
        { key: "canonical_name", label: "Canonical name", type: "text", required: true },
        { key: "name_mm", label: "Myanmar name", type: "text" },
        { key: "name_en", label: "English name", type: "text" },
        { key: "slug", label: "Slug", type: "text" },
        { key: "parent_id", label: "Parent admin area", type: "ref", refSource: "admin-areas" },
        {
            key: "admin_level_id",
            label: "Admin level",
            type: "ref",
            refSource: "reference-options:admin_levels",
            required: true,
        },
        {
            key: "source_type_id",
            label: "Source type",
            type: "ref",
            refSource: "reference-options:source_types",
            helpText: "Optional — defaults to manual when left blank.",
        },
        { key: "is_active", label: "Active", type: "boolean" },
        verificationStatusFormField(),
    ],
    readonlyMetadata: [
        ...standardPublicIdReadonlyFields(),
        ...standardIdReadonlyFields(),
        ...standardTimestampReadonlyFields(),
        {
            key: "centroid",
            label: "Centroid (API-derived)",
            type: "json-readonly",
            detailPath: "centroid",
        },
    ],
    defaultFormValues: {
        canonical_name: "",
        name_mm: "",
        name_en: "",
        slug: "",
        parent_id: "",
        admin_level_id: "",
        source_type_id: "",
        is_active: true,
        verification_status: "unverified",
        boundary_status: "",
        address_usage: "",
        is_official_boundary: false,
        boundary_confidence_score: "",
        boundary_note: "",
        geom: null,
    },
    formSchema: adminAreaFormSchema,
    detailToFormValues: (detail) => ({
        canonical_name: str(detail.canonicalName),
        name_mm: str(detail.nameMm),
        name_en: str(detail.nameEn),
        slug: str(detail.slug),
        parent_id: str(detail.parentId),
        admin_level_id: str(detail.adminLevelId),
        source_type_id: str(detail.sourceTypeId),
        is_active: bool(detail.isActive),
        verification_status: verificationStatusFromDetail(detail),
        boundary_status: str(detail.boundaryStatus),
        address_usage: str(detail.addressUsage),
        is_official_boundary: detail.isOfficialBoundary ?? false,
        boundary_confidence_score:
            detail.boundaryConfidenceScore === null || detail.boundaryConfidenceScore === undefined
                ? ""
                : detail.boundaryConfidenceScore,
        boundary_note: str(detail.boundaryNote),
        geom: polygonFromDetailGeometry(detail.geometry),
    }),
    getDetailId: (detail) => detail.publicId,
    fetchDetail: createCoreReviewFetchDetail<AdminAreaDetail>("admin-areas"),
    formValuesToCreatePayload: adminAreaPayload,
    formValuesToUpdatePayload: adminAreaPayload,
    createDescription: "Draw the admin boundary polygon, then save.",
    editDescription: (detail) => `public_id: ${detail.publicId}`,
    formNotice: (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {/* TODO: Validate child geometry is inside/intersects parent when backend endpoint exists. */}
            Parent/child geometry validation is not wired yet — confirm boundaries manually until the API supports
            topology checks.
        </p>
    ),
});
