import { z } from "zod";

import type {
    CoreReviewAddressRow,
    CoreReviewAdminAreaRow,
    CoreReviewBusRouteRow,
    CoreReviewBusRouteVariantRow,
    CoreReviewBusStopRow,
    CoreReviewLanduseRow,
    CoreReviewNameDto,
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
    optionalNumberStringSchema,
    optionalStringSchema,
    pointFromDetailGeometry,
    polygonFromDetailGeometry,
    requireLineGeometry,
    requirePointGeometry,
    requirePolygonGeometry,
    standardIdReadonlyFields,
    standardPublicIdReadonlyFields,
    standardTimestampReadonlyFields,
    str,
    yesNoFormat,
} from "./shared";
import type { CoreEntityConfig, CoreEntityFormMode, CoreEntityFormValues } from "./types";

type BusStopDetail = CoreReviewBusStopRow & {
    sourceTypeId?: string | null;
    names?: CoreReviewNameDto[];
};

type AddressDetail = CoreReviewAddressRow & {
    unitNumber?: string | null;
    postalCode?: string | null;
    streetId?: string | null;
    sourceTypeId?: string | null;
};

type AdminAreaDetail = CoreReviewAdminAreaRow & {
    sourceTypeId?: string | null;
};

type LanduseDetail = CoreReviewLanduseRow & {
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

// ── Bus stops ───────────────────────────────────────────────────────────────

const BUS_STOP_GEOM = "geom";

function busStopFormSchema(_mode: CoreEntityFormMode) {
    return z.object({
        name: optionalStringSchema,
        name_local: optionalStringSchema,
        stop_code: optionalStringSchema,
        admin_area_id: optionalStringSchema,
        source_type_id: optionalStringSchema,
        is_active: optionalBooleanSchema,
        is_verified: optionalBooleanSchema,
        geom: optionalGeometrySchema,
    });
}

function busStopPayload(values: CoreEntityFormValues) {
    return {
        name: nullableFormString(values.name),
        name_local: nullableFormString(values.name_local),
        stop_code: nullableFormString(values.stop_code),
        admin_area_id: optionalFormRefId(values.admin_area_id),
        source_type_id: optionalFormRefId(values.source_type_id),
        is_active: bool(values.is_active),
        is_verified: bool(values.is_verified),
        geom: requirePointGeometry(values, BUS_STOP_GEOM),
    };
}

export const BUS_STOPS_ENTITY_CONFIG = baseWriteConfig<BusStopDetail>({
    entityKey: "bus-stops",
    label: "Bus stop",
    labelPlural: "Bus stops",
    routeSegment: "bus-stops",
    coreReviewSlug: "bus-stops",
    apiBase: "/core-review/bus-stops",
    listRoute: coreReviewPath("bus-stops"),
    createRoute: coreReviewPath("bus-stops/new"),
    editRoute: (id) => coreReviewPath(`bus-stops/${id}/edit`),
    geometry: {
        fieldKey: BUS_STOP_GEOM,
        geometryType: "point",
        title: "Stop location",
    },
    editableFields: [
        { key: "name", label: "Name", type: "text" },
        { key: "name_local", label: "Local name", type: "text" },
        { key: "stop_code", label: "Stop code", type: "text" },
        { key: "admin_area_id", label: "Admin area", type: "ref", refSource: "admin-areas" },
        { key: "source_type_id", label: "Source type", type: "ref", refSource: "reference-options:source_types" },
        { key: "is_active", label: "Active", type: "boolean" },
        { key: "is_verified", label: "Verified", type: "boolean" },
    ],
    readonlyMetadata: [
        ...standardPublicIdReadonlyFields(),
        ...standardIdReadonlyFields(),
        ...standardTimestampReadonlyFields(),
    ],
    defaultFormValues: {
        name: "",
        name_local: "",
        stop_code: "",
        admin_area_id: "",
        source_type_id: "",
        is_active: true,
        is_verified: false,
        geom: null,
    },
    formSchema: busStopFormSchema,
    detailToFormValues: (detail) => ({
        name: str(detail.name),
        name_local: str(detail.nameLocal),
        stop_code: str(detail.stopCode),
        admin_area_id: str(detail.adminAreaId),
        source_type_id: str(detail.sourceTypeId),
        is_active: bool(detail.isActive),
        is_verified: bool(detail.isVerified),
        geom: pointFromDetailGeometry(detail.geometry),
    }),
    getDetailId: (detail) => detail.publicId,
    fetchDetail: createCoreReviewFetchDetail<BusStopDetail>("bus-stops"),
    formValuesToCreatePayload: busStopPayload,
    formValuesToUpdatePayload: busStopPayload,
    createDescription: "Set the bus stop location and attributes, then save.",
    editDescription: (detail) => `public_id: ${detail.publicId}`,
});

// ── Bus routes (no geometry) ────────────────────────────────────────────────

function busRouteFormSchema(_mode: CoreEntityFormMode) {
    return z.object({
        route_code: optionalStringSchema,
        public_name: optionalStringSchema,
        operator_name: optionalStringSchema,
        route_type: optionalStringSchema,
        directionality: optionalStringSchema,
        source_type_id: optionalStringSchema,
        is_active: optionalBooleanSchema,
        is_verified: optionalBooleanSchema,
    });
}

function busRoutePayload(values: CoreEntityFormValues) {
    return {
        route_code: nullableFormString(values.route_code),
        public_name: nullableFormString(values.public_name),
        operator_name: nullableFormString(values.operator_name),
        route_type: nullableFormString(values.route_type),
        directionality: nullableFormString(values.directionality),
        source_type_id: optionalFormRefId(values.source_type_id),
        is_active: bool(values.is_active),
        is_verified: bool(values.is_verified),
    };
}

export const BUS_ROUTES_ENTITY_CONFIG = baseWriteConfig<CoreReviewBusRouteRow>({
    entityKey: "bus-routes",
    label: "Bus route",
    labelPlural: "Bus routes",
    routeSegment: "bus-routes",
    coreReviewSlug: "bus-routes",
    apiBase: "/core-review/bus-routes",
    listRoute: coreReviewPath("bus-routes"),
    createRoute: coreReviewPath("bus-routes/new"),
    editRoute: (id) => coreReviewPath(`bus-routes/${id}/edit`),
    editableFields: [
        { key: "route_code", label: "Route code", type: "text" },
        { key: "public_name", label: "Public name", type: "text" },
        { key: "operator_name", label: "Operator", type: "text" },
        { key: "route_type", label: "Route type", type: "text" },
        { key: "directionality", label: "Directionality", type: "text" },
        { key: "source_type_id", label: "Source type", type: "ref", refSource: "reference-options:source_types" },
        { key: "is_active", label: "Active", type: "boolean" },
        { key: "is_verified", label: "Verified", type: "boolean" },
    ],
    readonlyMetadata: [
        ...standardIdReadonlyFields(),
        {
            key: "variant_count",
            label: "Variant count",
            type: "text",
            detailPath: "variantCount",
            format: (v) => (v == null ? "—" : String(v)),
        },
        ...standardTimestampReadonlyFields(),
    ],
    defaultFormValues: {
        route_code: "",
        public_name: "",
        operator_name: "",
        route_type: "",
        directionality: "",
        source_type_id: "",
        is_active: true,
        is_verified: false,
    },
    formSchema: busRouteFormSchema,
    detailToFormValues: (detail) => ({
        route_code: str(detail.routeCode),
        public_name: str(detail.publicName),
        operator_name: str(detail.operatorName),
        route_type: str(detail.routeType),
        directionality: str(detail.directionality),
        source_type_id: "",
        is_active: bool(detail.isActive),
        is_verified: bool(detail.isVerified),
    }),
    getDetailId: (detail) => detail.id,
    fetchDetail: createCoreReviewFetchDetail<CoreReviewBusRouteRow>("bus-routes"),
    formValuesToCreatePayload: busRoutePayload,
    formValuesToUpdatePayload: busRoutePayload,
    createDescription: "Route metadata only (no geometry).",
    editDescription: (detail) => `id: ${detail.id}`,
});

// ── Bus route variants ────────────────────────────────────────────────────────

const VARIANT_GEOM = "geom";

function busRouteVariantFormSchema(_mode: CoreEntityFormMode) {
    return z.object({
        route_id: optionalStringSchema,
        variant_code: optionalStringSchema,
        direction_name: optionalStringSchema,
        origin_name: optionalStringSchema,
        destination_name: optionalStringSchema,
        distance_m: optionalNumberStringSchema,
        is_active: optionalBooleanSchema,
        is_verified: optionalBooleanSchema,
        geom: optionalGeometrySchema,
    });
}

function busRouteVariantPayload(values: CoreEntityFormValues) {
    const routeId = String(values.route_id ?? "").trim();
    if (!routeId) {
        throw new Error("Bus route is required.");
    }
    const distanceTrimmed = String(values.distance_m ?? "").trim();
    let distance_m: number | null = null;
    if (distanceTrimmed !== "") {
        const parsed = Number.parseFloat(distanceTrimmed);
        if (!Number.isFinite(parsed) || parsed < 0) {
            throw new Error("Distance (m) must be a non-negative number.");
        }
        distance_m = parsed;
    }
    return {
        route_id: routeId,
        variant_code: nullableFormString(values.variant_code),
        direction_name: nullableFormString(values.direction_name),
        origin_name: nullableFormString(values.origin_name),
        destination_name: nullableFormString(values.destination_name),
        distance_m,
        is_active: bool(values.is_active),
        is_verified: bool(values.is_verified),
        geom: requireLineGeometry(values, VARIANT_GEOM),
    };
}

export const BUS_ROUTE_VARIANTS_ENTITY_CONFIG = baseWriteConfig<CoreReviewBusRouteVariantRow>({
    entityKey: "bus-route-variants",
    label: "Bus route variant",
    labelPlural: "Bus route variants",
    routeSegment: "bus-route-variants",
    coreReviewSlug: "bus-route-variants",
    apiBase: "/core-review/bus-route-variants",
    listRoute: coreReviewPath("bus-route-variants"),
    createRoute: coreReviewPath("bus-route-variants/new"),
    editRoute: (id) => coreReviewPath(`bus-route-variants/${id}/edit`),
    geometry: {
        fieldKey: VARIANT_GEOM,
        geometryType: "line",
        title: "Variant path",
        showVertices: true,
    },
    editableFields: [
        {
            key: "route_id",
            label: "Bus route",
            type: "ref",
            refSource: "core-review:bus-routes",
            required: true,
        },
        { key: "variant_code", label: "Variant code", type: "text" },
        { key: "direction_name", label: "Direction name", type: "text" },
        { key: "origin_name", label: "Origin", type: "text" },
        { key: "destination_name", label: "Destination", type: "text" },
        { key: "distance_m", label: "Distance (m)", type: "number", numberMin: 0 },
        { key: "is_active", label: "Active", type: "boolean" },
        { key: "is_verified", label: "Verified", type: "boolean" },
    ],
    readonlyMetadata: [
        ...standardIdReadonlyFields(),
        { key: "route_code", label: "Route code", type: "text", detailPath: "routeCode" },
        { key: "route_name", label: "Route name", type: "text", detailPath: "routePublicName" },
    ],
    defaultFormValues: {
        route_id: "",
        variant_code: "",
        direction_name: "",
        origin_name: "",
        destination_name: "",
        distance_m: "",
        is_active: true,
        is_verified: false,
        geom: null,
    },
    formSchema: busRouteVariantFormSchema,
    detailToFormValues: (detail) => ({
        route_id: str(detail.routeId),
        variant_code: str(detail.variantCode),
        direction_name: str(detail.directionName),
        origin_name: str(detail.originName),
        destination_name: str(detail.destinationName),
        distance_m: detail.distanceM != null ? String(detail.distanceM) : "",
        is_active: bool(detail.isActive),
        is_verified: bool(detail.isVerified),
        geom: lineFromDetailGeometry(detail.geometry),
    }),
    getDetailId: (detail) => detail.id,
    fetchDetail: createCoreReviewFetchDetail<CoreReviewBusRouteVariantRow>("bus-route-variants"),
    formValuesToCreatePayload: busRouteVariantPayload,
    formValuesToUpdatePayload: busRouteVariantPayload,
    createDescription: "Draw the variant path on the map, then save.",
    editDescription: (detail) => `id: ${detail.id}`,
});

// ── Landuse / water (polygon + line factory) ──────────────────────────────────

function mapFeatureFormSchema(_mode: CoreEntityFormMode) {
    return z.object({
        name: optionalStringSchema,
        class_code: optionalStringSchema,
        is_active: optionalBooleanSchema,
        is_verified: optionalBooleanSchema,
        geom: optionalGeometrySchema,
    });
}

function createMapFeatureConfig(
    entityKey: "landuse" | "water-lines" | "water-polygons",
    label: string,
    labelPlural: string,
    geometryType: "polygon" | "line",
    geometryTitle: string,
): CoreEntityConfig<LanduseDetail, Record<string, unknown>, Record<string, unknown>> {
    const toGeom =
        geometryType === "line" ? lineFromDetailGeometry : polygonFromDetailGeometry;
    const toPayload =
        geometryType === "line"
            ? (values: CoreEntityFormValues) => mapWaterLinePayload(values, "geom")
            : (values: CoreEntityFormValues) => mapClassifiedFeaturePayload(values, "geom");

    return baseWriteConfig<LanduseDetail>({
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
            { key: "class_code", label: "Class code", type: "text" },
            { key: "is_active", label: "Active", type: "boolean" },
            { key: "is_verified", label: "Verified", type: "boolean" },
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
            is_verified: false,
            geom: null,
        },
        formSchema: mapFeatureFormSchema,
        detailToFormValues: (detail) => ({
            name: str(detail.name),
            class_code: str(detail.classCode),
            is_active: bool(detail.isActive),
            is_verified: bool(detail.isVerified),
            geom: toGeom(detail.geometry),
        }),
        getDetailId: (detail) => detail.id,
        fetchDetail: createCoreReviewFetchDetail<LanduseDetail>(entityKey),
        formValuesToCreatePayload: toPayload,
        formValuesToUpdatePayload: toPayload,
        createDescription: `Draw the ${label.toLowerCase()} geometry on the map, then save.`,
        editDescription: (detail) => `id: ${detail.id}`,
    });
}

export const LANDUSE_ENTITY_CONFIG = createMapFeatureConfig(
    "landuse",
    "Landuse",
    "Landuse",
    "polygon",
    "Landuse footprint",
);

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

function addressFormSchema(_mode: CoreEntityFormMode) {
    return z.object({
        full_address: optionalStringSchema,
        house_number: optionalStringSchema,
        unit_number: optionalStringSchema,
        postal_code: optionalStringSchema,
        street_id: optionalStringSchema,
        admin_area_id: optionalStringSchema,
        source_type_id: optionalStringSchema,
        is_public: optionalBooleanSchema,
        is_verified: optionalBooleanSchema,
        point_geom: optionalGeometrySchema,
        entrance_geom: optionalGeometrySchema,
    });
}

function addressPayload(values: CoreEntityFormValues) {
    const entrance = values.entrance_geom;
    return {
        full_address: nullableFormString(values.full_address),
        house_number: nullableFormString(values.house_number),
        unit_number: nullableFormString(values.unit_number),
        postal_code: nullableFormString(values.postal_code),
        street_id: optionalFormRefId(values.street_id),
        admin_area_id: optionalFormRefId(values.admin_area_id),
        source_type_id: optionalFormRefId(values.source_type_id),
        is_public: bool(values.is_public),
        is_verified: bool(values.is_verified),
        point_geom: requirePointGeometry(values, "point_geom"),
        entrance_geom:
            entrance && typeof entrance === "object" && "type" in entrance && entrance.type === "Point"
                ? entrance
                : null,
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
        { key: "full_address", label: "Full address", type: "textarea" },
        { key: "house_number", label: "House number", type: "text" },
        { key: "unit_number", label: "Unit number", type: "text" },
        { key: "postal_code", label: "Postal code", type: "text" },
        { key: "street_id", label: "Street", type: "ref", refSource: "streets" },
        { key: "admin_area_id", label: "Admin area", type: "ref", refSource: "admin-areas" },
        { key: "source_type_id", label: "Source type", type: "ref", refSource: "reference-options:source_types" },
        { key: "is_public", label: "Public", type: "boolean" },
        { key: "is_verified", label: "Verified", type: "boolean" },
    ],
    readonlyMetadata: [
        ...standardPublicIdReadonlyFields(),
        ...standardIdReadonlyFields(),
        ...standardTimestampReadonlyFields(),
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
        is_verified: false,
        point_geom: null,
        entrance_geom: null,
    },
    formSchema: addressFormSchema,
    detailToFormValues: (detail) => ({
        full_address: str(detail.fullAddress),
        house_number: str(detail.houseNumber),
        unit_number: str(detail.unitNumber),
        postal_code: str(detail.postalCode),
        street_id: str(detail.streetId),
        admin_area_id: str(detail.adminAreaId),
        source_type_id: str(detail.sourceTypeId),
        is_public: bool(detail.isPublic),
        is_verified: bool(detail.isVerified),
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
    return z.object({
        canonical_name: optionalStringSchema,
        slug: optionalStringSchema,
        parent_id: optionalStringSchema,
        admin_level_id: optionalStringSchema,
        source_type_id: optionalStringSchema,
        is_active: optionalBooleanSchema,
        is_verified: optionalBooleanSchema,
        geom: optionalGeometrySchema,
    });
}

function adminAreaPayload(values: CoreEntityFormValues) {
    const adminLevelId = String(values.admin_level_id ?? "").trim();
    if (!adminLevelId) {
        throw new Error("Admin level is required.");
    }
    return {
        canonical_name: nullableFormString(values.canonical_name),
        slug: nullableFormString(values.slug),
        parent_id: optionalFormRefId(values.parent_id),
        admin_level_id: adminLevelId,
        source_type_id: optionalFormRefId(values.source_type_id),
        is_active: bool(values.is_active),
        is_verified: bool(values.is_verified),
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
    },
    editableFields: [
        { key: "canonical_name", label: "Canonical name", type: "text", required: true },
        { key: "slug", label: "Slug", type: "text" },
        { key: "parent_id", label: "Parent admin area", type: "ref", refSource: "admin-areas" },
        {
            key: "admin_level_id",
            label: "Admin level",
            type: "ref",
            refSource: "reference-options:admin_levels",
        },
        { key: "source_type_id", label: "Source type", type: "ref", refSource: "reference-options:source_types" },
        { key: "is_active", label: "Active", type: "boolean" },
        { key: "is_verified", label: "Verified", type: "boolean" },
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
        slug: "",
        parent_id: "",
        admin_level_id: "",
        source_type_id: "",
        is_active: true,
        is_verified: false,
        geom: null,
    },
    formSchema: adminAreaFormSchema,
    detailToFormValues: (detail) => ({
        canonical_name: str(detail.canonicalName),
        slug: str(detail.slug),
        parent_id: str(detail.parentId),
        admin_level_id: str(detail.adminLevelId),
        source_type_id: str(detail.sourceTypeId),
        is_active: bool(detail.isActive),
        is_verified: bool(detail.isVerified),
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
