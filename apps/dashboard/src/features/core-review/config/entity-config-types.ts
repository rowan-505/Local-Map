import type { ReactNode } from "react";

import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import type { DataTableSortOption } from "@/src/components/dashboard/DataTableToolbar";
import type { CoreReviewEntitySlug } from "@/src/lib/api";
import type { ImportReviewGeoJson } from "@/src/lib/api";

export type CoreReviewIdKind = "public_id" | "numeric_id";

export type CoreReviewFilterSupport = {
    isVerified: boolean;
    adminAreaId: boolean;
    categoryId: boolean;
    buildingTypeId: boolean;
    roadClassId: boolean;
    isPublic: boolean;
    includeDeleted: boolean;
    routeId: boolean;
};

export type CoreReviewOverviewStatus = "ready" | "partial" | "todo";

export type CoreReviewColumnDef<T> = {
    id: string;
    header: string;
    cell: (row: T, searchHighlight: string) => ReactNode;
};

export type CoreReviewEntityExtensions<T> = {
    headerActions?: ReactNode;
    renderDrawerActions?: (ctx: {
        row: T;
        detail: T | null;
        close: () => void;
        reloadList: () => void;
    }) => ReactNode;
    renderExtraFilters?: (ctx: {
        draft: import("../hooks/useCoreReviewListState").CoreReviewListDraft;
        setDraft: React.Dispatch<
            React.SetStateAction<import("../hooks/useCoreReviewListState").CoreReviewListDraft>
        >;
    }) => ReactNode;
    wrapPage?: (content: ReactNode) => ReactNode;
};

export type CoreReviewEntityConfig<T extends Record<string, unknown> = Record<string, unknown>> = {
    segment: string;
    apiSlug: CoreReviewEntitySlug;
    title: string;
    description: string;
    overviewStatus: CoreReviewOverviewStatus;
    idKind: CoreReviewIdKind;
    geometryKind: DataReviewGeometryKind | "none";
    mapEntityType: ImportReviewEntityType;
    defaultSortBy: string;
    sortOptions: DataTableSortOption[];
    filterSupport: CoreReviewFilterSupport;
    columns: CoreReviewColumnDef<T>[];
    getRowId: (row: T) => string;
    getRowTitle: (row: T) => string;
    getRowSubtitle?: (row: T) => string | null;
    getGeometry: (row: T) => ImportReviewGeoJson | null;
    detailFields: (row: T) => { label: string; value: ReactNode }[];
    searchPlaceholder: string;
    editPath?: (id: string) => string;
    newPath?: string;
    extensions?: CoreReviewEntityExtensions<T>;
};
