"use client";

import { ConfidenceBadge } from "@/src/components/review/ReviewStatusBadge";
import { coreReviewPath } from "@/src/lib/dashboardNavigation";

import AdminAreaBoundaryFilters from "../admin-areas/AdminAreaBoundaryFilters";
import {
    adminAreaBoundaryDetailFields,
    AdminAreaAddressUsageBadge,
    AdminAreaBoundaryConfidenceCell,
    AdminAreaBoundaryStatusBadge,
} from "../admin-areas/adminAreaBoundaryBadges";
import { StreetAttributesCell, StreetRoutingStatusBadge } from "../streets/streetRoutingBadges";
import { applyStreetDetailToListRow } from "../streets/applyStreetDetailToListRow";
import {
    applyAddressDetailToListRow,
    applyAdminAreaDetailToListRow,
    applyBuildingDetailToListRow,
    applyLandAreaDetailToListRow,
    applyMapFeatureDetailToListRow,
    applyPlaceDetailToListRow,
} from "./applyInlineEditDetailToListRow";
import { dash, formatArea, formatDate, yesNo } from "../utils/formatters";
import {
    buildingDisplayName,
    placeDisplayName,
    streetDisplayName,
} from "../utils/rowGeometry";
import {
    englishNameColumn,
    hl,
    myanmarNameColumn,
    standardNameAndVerificationColumns,
    verificationStatusColumn,
} from "./tableColumns";
import type { CoreReviewEntityConfig, CoreReviewFilterSupport } from "./entity-config-types";
import CoreReviewAddressDrawerView from "../components/CoreReviewAddressDrawerView";
import CoreReviewVerificationStatusCell from "../components/CoreReviewVerificationStatusCell";
import type {
    CoreReviewAddressRow,
    CoreReviewAdminAreaRow,
    CoreReviewBuildingRow,
    CoreReviewLandAreaRow,
    CoreReviewMapFeatureRow,
    CoreReviewPlaceRow,
    CoreReviewStreetRow,
} from "./types";

function verificationStatusDetailField(row: {
    verificationStatus?: string | null;
    isVerified: boolean;
}) {
    return {
        label: "Verification status",
        value: (
            <CoreReviewVerificationStatusCell
                status={row.verificationStatus}
                isVerifiedFallback={row.isVerified}
            />
        ),
    };
}

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

const FILTER_LANDUSE: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: true,
    categoryId: false,
    buildingTypeId: false,
    roadClassId: false,
    isPublic: false,
    includeDeleted: true,
    routeId: false,
    landAreaClassId: true,
    detailLevel: true,
    cropCode: true,
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
    boundaryStatus: true,
    addressUsage: true,
    isOfficialBoundary: true,
};

function buildingTypeLabel(row: CoreReviewBuildingRow): string {
    const code = row.buildingTypeCode?.trim();
    const name = row.buildingTypeName?.trim();
    if (code && name) {
        return `${code} — ${name}`;
    }
    if (code) {
        return code;
    }
    if (name) {
        return name;
    }
    return "unknown";
}

function roadClassLabel(row: CoreReviewStreetRow): string {
    if (row.roadClassName && row.roadClass && row.roadClassName !== row.roadClass) {
        return `${row.roadClassName} (${row.roadClass})`;
    }
    return dash(row.roadClassName ?? row.roadClass);
}

export const CORE_REVIEW_BUILDINGS_CONFIG: CoreReviewEntityConfig<CoreReviewBuildingRow> = {
    segment: "buildings",
    entityKey: "buildings",
    apiSlug: "buildings",
    supportsInlineEdit: true,
    applyDetailToListRow: applyBuildingDetailToListRow,
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
        ...standardNameAndVerificationColumns<CoreReviewBuildingRow>({
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
        verificationStatusDetailField(r),
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Created", value: formatDate(r.createdAt) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
};

export const CORE_REVIEW_PLACES_CONFIG: CoreReviewEntityConfig<CoreReviewPlaceRow> = {
    segment: "places",
    entityKey: "places",
    apiSlug: "places",
    supportsInlineEdit: true,
    applyDetailToListRow: applyPlaceDetailToListRow,
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
    columns: [
        { id: "id", header: "ID", cell: (r) => r.id },
        myanmarNameColumn<CoreReviewPlaceRow>((r) => r.myanmarName),
        englishNameColumn<CoreReviewPlaceRow>((r) => r.englishName),
        {
            id: "imported_name",
            header: "Imported",
            cell: (r, q) => (
                <span className="block max-w-64 truncate" title={r.primaryName}>
                    {hl(dash(r.primaryName), q)}
                </span>
            ),
        },
        verificationStatusColumn<CoreReviewPlaceRow>(),
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
        verificationStatusDetailField(r),
        { label: "Created", value: formatDate(r.createdAt) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
};

export const CORE_REVIEW_STREETS_CONFIG: CoreReviewEntityConfig<CoreReviewStreetRow> = {
    segment: "roads",
    entityKey: "streets",
    apiSlug: "streets",
    supportsInlineEdit: true,
    applyDetailToListRow: applyStreetDetailToListRow,
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
    columns: [
        { id: "class", header: "Road class", cell: (r, q) => hl(roadClassLabel(r), q) },
        { id: "admin", header: "Admin area", cell: (r, q) => hl(dash(r.adminAreaName), q) },
        { id: "attributes", header: "Attributes", cell: (r) => <StreetAttributesCell row={r} /> },
        { id: "routing", header: "Routing", cell: (r) => <StreetRoutingStatusBadge row={r} /> },
        ...standardNameAndVerificationColumns<CoreReviewStreetRow>({
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
        { label: "Attributes", value: <StreetAttributesCell row={r} /> },
        { label: "Routing", value: <StreetRoutingStatusBadge row={r} /> },
        verificationStatusDetailField(r),
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
        waterClassCode?: string | null;
        waterClassNameEn?: string | null;
        verificationStatus?: string | null;
        isVerified: boolean;
        isActive: boolean;
        updatedAt: string | null;
    },
>(): CoreReviewEntityConfig<T>["columns"] {
    return [
        {
            id: "class",
            header: "Class",
            cell: (r, q) => hl(dash(r.waterClassNameEn ?? r.waterClassCode ?? r.classCode), q),
        },
        { id: "active", header: "Active", cell: (r) => yesNo(r.isActive) },
        ...standardNameAndVerificationColumns<T>({
            myanmar: (r) => r.name,
            english: () => null,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ];
}

function landAreaClassLabel(row: CoreReviewLandAreaRow): string {
    const en = row.landAreaClassNameEn?.trim();
    const mm = row.landAreaClassNameMm?.trim();
    if (en && mm) {
        return `${en} — ${mm}`;
    }
    return en || mm || row.landAreaClassCode?.trim() || row.classCode?.trim() || "—";
}

function landAreaDisplayName(row: CoreReviewLandAreaRow): string {
    return row.nameMm?.trim() || row.nameEn?.trim() || row.name?.trim() || "—";
}

export const CORE_REVIEW_LAND_AREAS_CONFIG: CoreReviewEntityConfig<CoreReviewLandAreaRow> = {
    segment: "land-areas",
    entityKey: "land-areas",
    apiSlug: "land-areas",
    supportsInlineEdit: true,
    applyDetailToListRow: applyLandAreaDetailToListRow,
    title: "Land areas",
    description:
        "Production land-area polygons — urban zones, farmland/paddy, landcover, and wetlands for map context.",
    overviewStatus: "ready",
    idKind: "public_id",
    geometryKind: "polygon",
    mapEntityType: "land_area",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "class_code", label: "Class", type: "text" },
        { value: "admin_area", label: "Admin area", type: "text" },
        { value: "detail_level", label: "Detail level", type: "text" },
        { value: "area_m2", label: "Area", type: "text" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_LANDUSE,
    getRowId: (r) => r.publicId,
    getRowTitle: landAreaDisplayName,
    getRowSubtitle: (r) => r.publicId,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search land areas (name, class, crop)…",
    columns: [
        { id: "public_id", header: "Public ID", cell: (r, q) => hl(r.publicId, q) },
        ...standardNameAndVerificationColumns<CoreReviewLandAreaRow>({
            myanmar: (r) => r.nameMm,
            english: (r) => r.nameEn,
        }),
        {
            id: "class",
            header: "Land area class",
            cell: (r, q) => hl(landAreaClassLabel(r), q),
        },
        { id: "admin", header: "Admin area", cell: (r, q) => hl(dash(r.adminAreaName), q) },
        { id: "detail", header: "Detail level", cell: (r) => dash(r.detailLevel) },
        { id: "crop", header: "Crop", cell: (r, q) => hl(dash(r.cropCode), q) },
        { id: "area", header: "Area (m²)", cell: (r) => formatArea(r.areaM2) },
        {
            id: "confidence",
            header: "Confidence",
            cell: (r) => <ConfidenceBadge score={r.confidenceScore} />,
        },
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "Public ID", value: r.publicId },
        { label: "External ID", value: dash(r.externalId) },
        { label: "Myanmar name", value: dash(r.nameMm) },
        { label: "English name", value: dash(r.nameEn) },
        { label: "Land area class", value: landAreaClassLabel(r) },
        { label: "Admin area", value: dash(r.adminAreaName) },
        { label: "Detail level", value: dash(r.detailLevel) },
        { label: "Crop code", value: dash(r.cropCode) },
        { label: "Irrigated", value: r.irrigated == null ? "—" : yesNo(r.irrigated) },
        { label: "Seasonality", value: dash(r.seasonality) },
        { label: "Area (m²)", value: formatArea(r.areaM2) },
        { label: "Confidence", value: <ConfidenceBadge score={r.confidenceScore} /> },
        verificationStatusDetailField(r),
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Created", value: formatDate(r.createdAt) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
    newPath: coreReviewPath("land-areas/new"),
};

const FILTER_MAP_FEATURE: CoreReviewFilterSupport = {
    isVerified: true,
    adminAreaId: false,
    categoryId: false,
    buildingTypeId: false,
    roadClassId: false,
    isPublic: false,
    includeDeleted: false,
    routeId: false,
};

function mapFeatureDetailFields(r: CoreReviewMapFeatureRow) {
    return [
        { label: "ID", value: r.id },
        { label: "Name", value: dash(r.name) },
        {
            label: "Class",
            value: dash(r.waterClassNameEn ?? r.waterClassCode ?? r.classCode),
        },
        verificationStatusDetailField(r),
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ];
}

export const CORE_REVIEW_WATER_LINES_CONFIG: CoreReviewEntityConfig<CoreReviewMapFeatureRow> = {
    segment: "water-lines",
    entityKey: "water-lines",
    apiSlug: "water-lines",
    supportsInlineEdit: true,
    applyDetailToListRow: applyMapFeatureDetailToListRow,
    title: "Water lines",
    description: "Linear water features.",
    overviewStatus: "partial",
    idKind: "numeric_id",
    geometryKind: "line",
    mapEntityType: "water_line",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "class_code", label: "Class", type: "text" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_MAP_FEATURE,
    getRowId: (r) => r.id,
    getRowTitle: (r) => dash(r.name) || r.id,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search water lines…",
    columns: genericClassColumns<CoreReviewMapFeatureRow>(),
    detailFields: mapFeatureDetailFields,
    newPath: coreReviewPath("water-lines/new"),
};

export const CORE_REVIEW_WATER_POLYGONS_CONFIG: CoreReviewEntityConfig<CoreReviewMapFeatureRow> = {
    segment: "water-polygons",
    entityKey: "water-polygons",
    apiSlug: "water-polygons",
    supportsInlineEdit: true,
    applyDetailToListRow: applyMapFeatureDetailToListRow,
    title: "Water polygons",
    description: "Water body polygons.",
    overviewStatus: "partial",
    idKind: "numeric_id",
    geometryKind: "polygon",
    mapEntityType: "water_polygon",
    defaultSortBy: "updated_at",
    sortOptions: [
        { value: "name", label: "Name", type: "text" },
        { value: "class_code", label: "Class", type: "text" },
        { value: "updated_at", label: "Updated", type: "date" },
    ],
    filterSupport: FILTER_MAP_FEATURE,
    getRowId: (r) => r.id,
    getRowTitle: (r) => dash(r.name) || r.id,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search water polygons…",
    columns: genericClassColumns<CoreReviewMapFeatureRow>(),
    detailFields: mapFeatureDetailFields,
    newPath: coreReviewPath("water-polygons/new"),
};

export const CORE_REVIEW_ADDRESSES_CONFIG: CoreReviewEntityConfig<CoreReviewAddressRow> = {
    segment: "addresses",
    entityKey: "addresses",
    apiSlug: "addresses",
    supportsInlineEdit: true,
    applyDetailToListRow: applyAddressDetailToListRow,
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
    getRowTitle: (r) => dash(r.displayFullAddress ?? r.fullAddress) || r.publicId,
    getRowSubtitle: (r) => r.publicId,
    getGeometry: (r) => r.geometry,
    searchPlaceholder: "Search addresses…",
    columns: [
        { id: "house", header: "House #", cell: (r, q) => hl(dash(r.houseNumber), q) },
        { id: "admin", header: "Admin area", cell: (r, q) => hl(dash(r.adminAreaName), q) },
        { id: "public", header: "Public", cell: (r) => yesNo(r.isPublic) },
        ...standardNameAndVerificationColumns<CoreReviewAddressRow>({
            myanmar: (r) => r.generatedFullAddressMy ?? r.myanmarName,
            english: (r) => r.generatedFullAddressEn ?? r.englishName,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "Public ID", value: r.publicId },
        { label: "Myanmar address", value: dash(r.generatedFullAddressMy) },
        { label: "English address", value: dash(r.generatedFullAddressEn) },
        { label: "Admin area", value: dash(r.adminAreaName) },
        { label: "Public", value: yesNo(r.isPublic) },
        verificationStatusDetailField(r),
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
    newPath: coreReviewPath("addresses/new"),
    extensions: {
        renderDrawerView: ({ row, rowId, successMessage }) => (
            <CoreReviewAddressDrawerView
                rowId={rowId}
                listRow={row}
                listGeometry={row.geometry}
                listRowUpdatedAt={row.updatedAt}
                geometryKind="point"
                mapEntityType="place"
                successMessage={successMessage}
            />
        ),
    },
};

export const CORE_REVIEW_ADMIN_AREAS_CONFIG: CoreReviewEntityConfig<CoreReviewAdminAreaRow> = {
    segment: "admin-areas",
    entityKey: "admin-areas",
    apiSlug: "admin-areas",
    supportsInlineEdit: true,
    applyDetailToListRow: applyAdminAreaDetailToListRow,
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
        {
            id: "boundary",
            header: "Boundary",
            cell: (r) => <AdminAreaBoundaryStatusBadge row={r} mode="list" />,
        },
        {
            id: "address_usage",
            header: "Address usage",
            cell: (r) => <AdminAreaAddressUsageBadge row={r} mode="list" />,
        },
        {
            id: "confidence",
            header: "Confidence",
            cell: (r) => <AdminAreaBoundaryConfidenceCell row={r} />,
        },
        { id: "active", header: "Active", cell: (r) => yesNo(r.isActive) },
        ...standardNameAndVerificationColumns<CoreReviewAdminAreaRow>({
            myanmar: (r) => r.nameMm ?? r.canonicalName,
            english: (r) => r.nameEn ?? null,
        }),
        { id: "updated", header: "Updated", cell: (r) => formatDate(r.updatedAt) },
    ],
    detailFields: (r) => [
        { label: "Public ID", value: r.publicId },
        { label: "Myanmar name", value: dash(r.canonicalName) },
        { label: "Slug", value: dash(r.slug) },
        { label: "Parent ID", value: dash(r.parentId) },
        { label: "Admin level ID", value: dash(r.adminLevelId) },
        ...adminAreaBoundaryDetailFields(r),
        verificationStatusDetailField(r),
        { label: "Active", value: yesNo(r.isActive) },
        { label: "Updated", value: formatDate(r.updatedAt) },
    ],
    extensions: {
        renderExtraFilters: ({ draft, setDraft }) => (
            <AdminAreaBoundaryFilters draft={draft} setDraft={setDraft} />
        ),
    },
    newPath: coreReviewPath("admin-areas/new"),
};

export const CORE_REVIEW_ENTITY_CONFIG_BY_SEGMENT = {
    buildings: CORE_REVIEW_BUILDINGS_CONFIG,
    places: CORE_REVIEW_PLACES_CONFIG,
    roads: CORE_REVIEW_STREETS_CONFIG,
    "land-areas": CORE_REVIEW_LAND_AREAS_CONFIG,
    "water-lines": CORE_REVIEW_WATER_LINES_CONFIG,
    "water-polygons": CORE_REVIEW_WATER_POLYGONS_CONFIG,
    addresses: CORE_REVIEW_ADDRESSES_CONFIG,
    "admin-areas": CORE_REVIEW_ADMIN_AREAS_CONFIG,
} as const;
