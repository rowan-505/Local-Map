"use client";

import type { ReactNode } from "react";

import { ConfidenceBadge, VerifiedBadge } from "@/src/components/review/ReviewStatusBadge";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import { dash, formatArea, formatDate, yesNo } from "../utils/formatters";
import {
    buildingDisplayName,
    placeDisplayName,
    streetDisplayName,
} from "../utils/rowGeometry";
import { hl, standardNameAndVerifiedColumns } from "./tableColumns";
import type { CoreReviewEntityConfig, CoreReviewFilterSupport } from "./entity-config-types";
import type {
    CoreReviewAddressRow,
    CoreReviewAdminAreaRow,
    CoreReviewBuildingRow,
    CoreReviewBusRouteRow,
    CoreReviewBusRouteVariantRow,
    CoreReviewBusStopRow,
    CoreReviewLanduseRow,
    CoreReviewPlaceRow,
    CoreReviewStreetRow,
} from "./types";

const FILTER_BUILDINGS: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: true,
    categoryId: false,
    buildingTypeId: true,
    roadClassId: false,
    isPublic: false,
    includeDeleted: false,
    routeId: false,
};

const FILTER_PLACES: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: true,
    categoryId: true,
    buildingTypeId: false,
    roadClassId: false,
    isPublic: true,
    includeDeleted: false,
    routeId: false,
};

const FILTER_STREETS: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: true,
    categoryId: false,
    buildingTypeId: false,
    roadClassId: true,
    isPublic: false,
    includeDeleted: false,
    routeId: false,
};

const FILTER_BUS_STOPS: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: true,
    categoryId: false,
    buildingTypeId: false,
    roadClassId: false,
    isPublic: false,
    includeDeleted: false,
    routeId: false,
};

const FILTER_BUS_ROUTES: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: false,
    categoryId: false,
    buildingTypeId: false,
    roadClassId: false,
    isPublic: false,
    includeDeleted: false,
    routeId: false,
};

const FILTER_BUS_VARIANTS: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: false,
    categoryId: false,
    buildingTypeId: false,
    roadClassId: false,
    isPublic: false,
    includeDeleted: false,
    routeId: true,
};

const FILTER_LANDUSE: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: false,
    categoryId: false,
    buildingTypeId: false,
    roadClassId: false,
    isPublic: false,
    includeDeleted: false,
    routeId: false,
};

const FILTER_ADDRESSES: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: true,
    categoryId: false,
    buildingTypeId: false,
    roadClassId: false,
    isPublic: true,
    includeDeleted: false,
    routeId: false,
};

const FILTER_ADMIN_AREAS: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: true,
    categoryId: false,
    buildingTypeId: false,
    roadClassId: false,
    isPublic: false,
    includeDeleted: false,
    routeId: false,
};

function buildingTypeLabel(row: CoreReviewBuildingRow): string {
    return row.buildingTypeName?.trim() || row.buildingTypeCode?.trim() || "Unclassified";
}

function roadClassLabel(row: CoreReviewStreetRow): string {
    if (row.roadClassName && row.roadClass && row.roadClassName !== row.roadClass) {
        return `${row.roadClassName} (${row.roadClass})`;
    }
    return dash(row.roadClassName ?? row.roadClass);
}

export const CORE_REVIEW_BUILDINGS_CONFIG: CoreReviewEntityConfig<CoreReviewBuildingRow> = {
    segment: "buildings",
    apiSlug: "buildings",
    title: "Buildings",
    description:
        "Production building footprints in core — search, verify, and edit dashboard-sourced polygons.",
    overviewStatus: "ready",
    idKind: "public_id",
    geometryKind: "polygon",
    mapEntityType: "building",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "building_type", label: "Building Type", type: "text" },
        { value: "admin_area", label: "Admin Area", type: "text" },
        { value: "created", label: "Created", type: "date" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_BUILDINGS,
    getRowId: (r) => r.publicId,
    getRowTitle: buildingDisplayName,
    getRowSubtitle: (r) => r.publicId,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search buildings…",
    newPath: coreReviewPath("buildings/new"),
    editPath: (id) => coreReviewPath(`buildings/${id}/edit`),
    columns: [
        {
            id: "type",
            header: "Building type",
            cell: (r, q) => hl(buildingTypeLabel(r), q),
        },
        {
            id: "admin",
            header: "Admin area",
            cell: (r, q) => hl(dash(r.adminAreaName), q),
        },
        { id: "area", header: "Area (m²)", cell: (r) => formatArea(r.areaM2) },
        { id: "levels", header: "Levels", cell: (r) => dash(r.levels) },
        ...standardNameAndVerifiedColumns<CoreReviewBuildingRow>({
            myanmar: (r) => r.nameMm,
            english: (r) => r.nameEn,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "Public ID", value: r.publicId },
        { label: "External ID", value: dash(r.externalId) },
        { label: "Myanmar name", value: dash(r.nameMm) },
        { label: "English name", value: dash(r.nameEn) },
        { label: "Building type", value: buildingTypeLabel(r) },
        { label: "Admin area", value: dash(r.adminAreaName) },
        { label: "Area (m²)", value: formatArea(r.areaM2) },
        { label: "Levels", value: dash(r.levels) },
        { label: "Confidence", value: <ConfidenceBadge score={r.confidenceScore} /> },
        { label: "Verified", value: <VerifiedBadge verified={r.isVerified} /> },
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Created", value: formatDate(r.createdAt) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
};

export const CORE_REVIEW_PLACES_CONFIG: CoreReviewEntityConfig<CoreReviewPlaceRow> = {
    segment: "places",
    apiSlug: "places",
    title: "Places",
    description: "Points of interest and place records linked to categories and admin areas.",
    overviewStatus: "ready",
    idKind: "public_id",
    geometryKind: "point",
    mapEntityType: "place",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "category", label: "Category", type: "text" },
        { value: "admin_area", label: "Admin Area", type: "text" },
        { value: "created", label: "Created", type: "date" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_PLACES,
    getRowId: (r) => r.publicId,
    getRowTitle: placeDisplayName,
    getRowSubtitle: (r) => r.publicId,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search places…",
    newPath: coreReviewPath("places/new"),
    editPath: (id) => coreReviewPath(`places/${id}/edit`),
    columns: [
        ...standardNameAndVerifiedColumns<CoreReviewPlaceRow>({
            myanmar: (r) => r.myanmarName,
            english: (r) => r.englishName,
        }),
        { id: "category", header: "Category", cell: (r, q) => hl(dash(r.categoryName), q) },
        { id: "admin", header: "Admin area", cell: (r, q) => hl(dash(r.adminAreaName), q) },
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "Public ID", value: r.publicId },
        { label: "Myanmar name", value: dash(r.myanmarName) },
        { label: "English name", value: dash(r.englishName) },
        { label: "Category", value: dash(r.categoryName) },
        { label: "Admin area", value: dash(r.adminAreaName) },
        { label: "Coordinates", value: `${r.lat}, ${r.lng}` },
        { label: "Verified", value: <VerifiedBadge verified={r.isVerified} /> },
        { label: "Created", value: formatDate(r.createdAt) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
};

export const CORE_REVIEW_STREETS_CONFIG: CoreReviewEntityConfig<CoreReviewStreetRow> = {
    segment: "roads",
    apiSlug: "streets",
    title: "Roads",
    description: "Street centerlines, road classes, and geometry for the core routing graph.",
    overviewStatus: "partial",
    idKind: "public_id",
    geometryKind: "line",
    mapEntityType: "road",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "admin_area", label: "Admin Area", type: "text" },
        { value: "created", label: "Created", type: "date" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_STREETS,
    getRowId: (r) => r.publicId,
    getRowTitle: streetDisplayName,
    getRowSubtitle: (r) => r.publicId,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search roads…",
    newPath: coreReviewPath("roads/new"),
    editPath: (id) => coreReviewPath(`roads/${id}/edit`),
    columns: [
        { id: "class", header: "Road class", cell: (r, q) => hl(roadClassLabel(r), q) },
        { id: "admin", header: "Admin area", cell: (r, q) => hl(dash(r.adminAreaName), q) },
        { id: "oneway", header: "Oneway", cell: (r) => yesNo(r.isOneway) },
        ...standardNameAndVerifiedColumns<CoreReviewStreetRow>({
            myanmar: (r) => r.myanmarName,
            english: (r) => r.englishName,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "Public ID", value: r.publicId },
        { label: "Myanmar name", value: dash(r.myanmarName) },
        { label: "English name", value: dash(r.englishName) },
        { label: "Canonical name", value: streetDisplayName(r) },
        { label: "Road class", value: roadClassLabel(r) },
        { label: "Admin area", value: dash(r.adminAreaName) },
        { label: "Oneway", value: yesNo(r.isOneway) },
        { label: "Surface", value: dash(r.surface) },
        { label: "Verified", value: <VerifiedBadge verified={r.isVerified} /> },
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Deleted", value: r.deletedAt ? formatDate(r.deletedAt) : "—" },
        { label: "Created", value: formatDate(r.createdAt) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
};

function genericClassColumns<
    T extends {
        name: string | null;
        classCode: string | null;
        isVerified: boolean;
        isActive: boolean;
        updatedAt: string | null;
    },
>(): CoreReviewEntityConfig<T>["columns"] {
    return [
        { id: "class", header: "Class", cell: (r, q) => hl(dash(r.classCode), q) },
        { id: "active", header: "Active", cell: (r) => yesNo(r.isActive) },
        ...standardNameAndVerifiedColumns<T>({
            myanmar: (r) => r.name,
            english: () => null,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ];
}

export const CORE_REVIEW_BUS_STOPS_CONFIG: CoreReviewEntityConfig<CoreReviewBusStopRow> = {
    segment: "bus-stops",
    apiSlug: "bus-stops",
    title: "Bus stops",
    description: "Transit stop locations and metadata.",
    overviewStatus: "partial",
    idKind: "public_id",
    geometryKind: "point",
    mapEntityType: "place",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "admin_area", label: "Admin Area", type: "text" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_BUS_STOPS,
    getRowId: (r) => r.publicId,
    getRowTitle: (r) => dash(r.name) || r.publicId,
    getRowSubtitle: (r) => dash(r.stopCode),
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search bus stops…",
    columns: [
        { id: "code", header: "Stop code", cell: (r, q) => hl(dash(r.stopCode), q) },
        { id: "admin", header: "Admin area", cell: (r, q) => hl(dash(r.adminAreaName), q) },
        { id: "active", header: "Active", cell: (r) => yesNo(r.isActive) },
        ...standardNameAndVerifiedColumns<CoreReviewBusStopRow>({
            myanmar: (r) => r.nameLocal,
            english: (r) => r.name,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "Public ID", value: r.publicId },
        { label: "Myanmar name", value: dash(r.nameLocal) },
        { label: "English name", value: dash(r.name) },
        { label: "Stop code", value: dash(r.stopCode) },
        { label: "Admin area", value: dash(r.adminAreaName) },
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Verified", value: <VerifiedBadge verified={r.isVerified} /> },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
    newPath: coreReviewPath("bus-stops/new"),
    editPath: (id) => coreReviewPath(`bus-stops/${id}/edit`),
};

export const CORE_REVIEW_BUS_ROUTES_CONFIG: CoreReviewEntityConfig<CoreReviewBusRouteRow> = {
    segment: "bus-routes",
    apiSlug: "bus-routes",
    title: "Bus routes",
    description: "Route definitions and service patterns.",
    overviewStatus: "partial",
    idKind: "numeric_id",
    geometryKind: "none",
    mapEntityType: "generic",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_BUS_ROUTES,
    getRowId: (r) => r.id,
    getRowTitle: (r) => dash(r.publicName) || dash(r.routeCode) || r.id,
    getGeometry: () => null,
    searchPlaceholder: "Search routes (name, code, operator)…",
    columns: [
        { id: "code", header: "Route code", cell: (r, q) => hl(dash(r.routeCode), q) },
        { id: "operator", header: "Operator", cell: (r, q) => hl(dash(r.operatorName), q) },
        { id: "type", header: "Type", cell: (r, q) => hl(dash(r.routeType), q) },
        { id: "active", header: "Active", cell: (r) => yesNo(r.isActive) },
        ...standardNameAndVerifiedColumns<CoreReviewBusRouteRow>({
            myanmar: () => null,
            english: (r) => r.publicName,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "ID", value: r.id },
        { label: "English name", value: dash(r.publicName) },
        { label: "Route code", value: dash(r.routeCode) },
        { label: "Operator", value: dash(r.operatorName) },
        { label: "Type", value: dash(r.routeType) },
        { label: "Directionality", value: dash(r.directionality) },
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Verified", value: <VerifiedBadge verified={r.isVerified} /> },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
    newPath: coreReviewPath("bus-routes/new"),
    editPath: (id) => coreReviewPath(`bus-routes/${id}/edit`),
};

export const CORE_REVIEW_BUS_ROUTE_VARIANTS_CONFIG: CoreReviewEntityConfig<CoreReviewBusRouteVariantRow> =
    {
        segment: "bus-route-variants",
        apiSlug: "bus-route-variants",
        title: "Bus route variants",
        description: "Directional or scheduled variants of bus routes.",
        overviewStatus: "partial",
        idKind: "numeric_id",
        geometryKind: "line",
        mapEntityType: "road",
        defaultSortBy: "id",
        sortOptions: [
            { value: "name", label: "Name", type: "text" },
            { value: "id", label: "ID", type: "text" },
            { value: "route_id", label: "Route ID", type: "text" },
        ],
        filterSupport: FILTER_BUS_VARIANTS,
        getRowId: (r) => r.id,
        getRowTitle: (r) =>
            [r.directionName, r.originName, r.destinationName].filter(Boolean).join(" → ") || r.id,
        getGeometry: (r) => r.geometry,
        searchPlaceholder: "Search variants…",
        columns: [
            { id: "route", header: "Route", cell: (r, q) => hl(dash(r.routeCode ?? r.routePublicName), q) },
            { id: "direction", header: "Direction", cell: (r, q) => hl(dash(r.directionName), q) },
            { id: "active", header: "Active", cell: (r) => yesNo(r.isActive) },
            ...standardNameAndVerifiedColumns<CoreReviewBusRouteVariantRow>({
                myanmar: (r) => r.originName,
                english: (r) => r.destinationName,
            }),
        ],
        detailFields: (r) => [
            { label: "ID", value: r.id },
            { label: "Route ID", value: r.routeId },
            { label: "Variant code", value: dash(r.variantCode) },
            { label: "Direction", value: dash(r.directionName) },
            { label: "Distance (m)", value: dash(r.distanceM) },
            { label: "Verified", value: <VerifiedBadge verified={r.isVerified} /> },
            { label: "Active", value: yesNo(r.isActive) },
        ],
        newPath: coreReviewPath("bus-route-variants/new"),
        editPath: (id) => coreReviewPath(`bus-route-variants/${id}/edit`),
    };

export const CORE_REVIEW_LANDUSE_CONFIG: CoreReviewEntityConfig<CoreReviewLanduseRow> = {
    segment: "landuse",
    apiSlug: "landuse",
    title: "Landuse",
    description: "Land-use polygons from core schema.",
    overviewStatus: "partial",
    idKind: "numeric_id",
    geometryKind: "polygon",
    mapEntityType: "landuse",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "class_code", label: "Class", type: "text" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_LANDUSE,
    getRowId: (r) => r.id,
    getRowTitle: (r) => dash(r.name) || r.id,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search landuse (name or class code)…",
    columns: genericClassColumns<CoreReviewLanduseRow>(),
    detailFields: (r) => [
        { label: "ID", value: r.id },
        { label: "Myanmar name", value: dash(r.name) },
        { label: "Class", value: dash(r.classCode) },
        { label: "Verified", value: <VerifiedBadge verified={r.isVerified} /> },
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
    newPath: coreReviewPath("landuse/new"),
    editPath: (id) => coreReviewPath(`landuse/${id}/edit`),
};

export const CORE_REVIEW_WATER_LINES_CONFIG: CoreReviewEntityConfig<CoreReviewLanduseRow> = {
    ...CORE_REVIEW_LANDUSE_CONFIG,
    segment: "water-lines",
    apiSlug: "water-lines",
    title: "Water lines",
    description: "Linear water features.",
    geometryKind: "line",
    mapEntityType: "water_line",
    searchPlaceholder: "Search water lines…",
    newPath: coreReviewPath("water-lines/new"),
    editPath: (id) => coreReviewPath(`water-lines/${id}/edit`),
};

export const CORE_REVIEW_WATER_POLYGONS_CONFIG: CoreReviewEntityConfig<CoreReviewLanduseRow> = {
    ...CORE_REVIEW_LANDUSE_CONFIG,
    segment: "water-polygons",
    apiSlug: "water-polygons",
    title: "Water polygons",
    description: "Water body polygons.",
    mapEntityType: "water_polygon",
    searchPlaceholder: "Search water polygons…",
    newPath: coreReviewPath("water-polygons/new"),
    editPath: (id) => coreReviewPath(`water-polygons/${id}/edit`),
};

export const CORE_REVIEW_ADDRESSES_CONFIG: CoreReviewEntityConfig<CoreReviewAddressRow> = {
    segment: "addresses",
    apiSlug: "addresses",
    title: "Addresses",
    description: "Structured addresses and components.",
    overviewStatus: "ready",
    idKind: "public_id",
    geometryKind: "point",
    mapEntityType: "place",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Address", type: "text" },
        { value: "admin_area", label: "Admin Area", type: "text" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_ADDRESSES,
    getRowId: (r) => r.publicId,
    getRowTitle: (r) => dash(r.fullAddress) || r.publicId,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search addresses…",
    columns: [
        { id: "house", header: "House #", cell: (r, q) => hl(dash(r.houseNumber), q) },
        { id: "admin", header: "Admin area", cell: (r, q) => hl(dash(r.adminAreaName), q) },
        { id: "public", header: "Public", cell: (r) => yesNo(r.isPublic) },
        ...standardNameAndVerifiedColumns<CoreReviewAddressRow>({
            myanmar: () => null,
            english: (r) => r.fullAddress,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "Public ID", value: r.publicId },
        { label: "English name", value: dash(r.fullAddress) },
        { label: "Admin area", value: dash(r.adminAreaName) },
        { label: "Public", value: yesNo(r.isPublic) },
        { label: "Verified", value: <VerifiedBadge verified={r.isVerified} /> },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
    newPath: coreReviewPath("addresses/new"),
    editPath: (id) => coreReviewPath(`addresses/${id}/edit`),
};

export const CORE_REVIEW_ADMIN_AREAS_CONFIG: CoreReviewEntityConfig<CoreReviewAdminAreaRow> = {
    segment: "admin-areas",
    apiSlug: "admin-areas",
    title: "Admin areas",
    description: "Administrative boundary hierarchy.",
    overviewStatus: "partial",
    idKind: "public_id",
    geometryKind: "polygon",
    mapEntityType: "generic",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_ADMIN_AREAS,
    getRowId: (r) => r.publicId,
    getRowTitle: (r) => r.canonicalName || r.publicId,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search admin areas…",
    columns: [
        { id: "slug", header: "Slug", cell: (r, q) => hl(dash(r.slug), q) },
        { id: "level", header: "Admin level", cell: (r) => dash(r.adminLevelId) },
        { id: "active", header: "Active", cell: (r) => yesNo(r.isActive) },
        ...standardNameAndVerifiedColumns<CoreReviewAdminAreaRow>({
            myanmar: (r) => r.canonicalName,
            english: () => null,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "Public ID", value: r.publicId },
        { label: "Myanmar name", value: dash(r.canonicalName) },
        { label: "Slug", value: dash(r.slug) },
        { label: "Parent ID", value: dash(r.parentId) },
        { label: "Admin level ID", value: dash(r.adminLevelId) },
        { label: "Verified", value: <VerifiedBadge verified={r.isVerified} /> },
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
    newPath: coreReviewPath("admin-areas/new"),
    editPath: (id) => coreReviewPath(`admin-areas/${id}/edit`),
};

export const CORE_REVIEW_ENTITY_CONFIG_BY_SEGMENT = {
    buildings: CORE_REVIEW_BUILDINGS_CONFIG,
    places: CORE_REVIEW_PLACES_CONFIG,
    roads: CORE_REVIEW_STREETS_CONFIG,
    "bus-stops": CORE_REVIEW_BUS_STOPS_CONFIG,
    "bus-routes": CORE_REVIEW_BUS_ROUTES_CONFIG,
    "bus-route-variants": CORE_REVIEW_BUS_ROUTE_VARIANTS_CONFIG,
    landuse: CORE_REVIEW_LANDUSE_CONFIG,
    "water-lines": CORE_REVIEW_WATER_LINES_CONFIG,
    "water-polygons": CORE_REVIEW_WATER_POLYGONS_CONFIG,
    addresses: CORE_REVIEW_ADDRESSES_CONFIG,
    "admin-areas": CORE_REVIEW_ADMIN_AREAS_CONFIG,
} as const;
