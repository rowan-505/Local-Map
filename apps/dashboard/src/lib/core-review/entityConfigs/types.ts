import type { ReactNode } from "react";
import type { Geometry } from "geojson";
import type { z } from "zod";

import type { CoreGeometryType } from "@/src/components/core-review/geometry";
import type { CoreReviewEntitySlug } from "@/src/lib/api";

export type CoreEntityKey =
    | "buildings"
    | "places"
    | "streets"
    | "bus-stops"
    | "bus-routes"
    | "bus-route-variants"
    | "landuse"
    | "water-lines"
    | "water-polygons"
    | "addresses"
    | "admin-areas";

export type CoreEntityFieldType =
    | "text"
    | "textarea"
    | "number"
    | "boolean"
    | "select"
    | "ref"
    | "surface-preset"
    | "date-readonly"
    | "json-readonly";

export type CoreRefSourceKind =
    | "building-types"
    | "road-classes"
    | "place-form-options:categories"
    | "place-form-options:source_types"
    | "place-form-options:publish_statuses"
    | "admin-areas"
    | "reference-options:source_types"
    | "reference-options:admin_levels"
    | "core-review:bus-routes"
    | "streets"
    | "landuse-classes";

export type CoreEntityFieldDef = {
    key: string;
    label: string;
    type: CoreEntityFieldType;
    required?: boolean;
    createOnly?: boolean;
    editOnly?: boolean;
    placeholder?: string;
    helpText?: string;
    refSource?: CoreRefSourceKind;
    /** Static select options when type is `select`. */
    selectOptions?: { value: string; label: string }[];
    numberMin?: number;
    numberMax?: number;
    numberStep?: number;
    /** Detail record path for readonly metadata (dot path). */
    detailPath?: string;
    format?: (value: unknown) => ReactNode;
};

export type CoreEntityGeometryConfig = {
    fieldKey: string;
    geometryType: CoreGeometryType;
    title?: string;
    enableSnapping?: boolean;
    showVertices?: boolean;
    /** POST /streets/validate-geometry for line entities. */
    validateWithApi?: boolean;
};

export type CoreEntityFormMode = "create" | "edit";

export type CoreEntityFormValues = Record<string, unknown> & {
    /** Polygon/line footprint (buildings, streets, landuse, etc.). */
    geom?: Geometry | null;
    /** Point location (places, addresses). */
    point_geom?: Geometry | null;
    /** Optional entrance point (addresses). */
    entrance_geom?: Geometry | null;
};

export type CoreEntityEditExtrasContext<TDetail = unknown> = {
    detail: TDetail;
    reload: () => Promise<void>;
    isSaving: boolean;
};

export type CoreEntityConfig<TDetail = unknown, TCreate = unknown, TUpdate = unknown> = {
    entityKey: CoreEntityKey;
    label: string;
    labelPlural: string;
    routeSegment: string;
    /** GET list/detail slug when using `/core-review/:entity`. */
    coreReviewSlug?: CoreReviewEntitySlug;
    apiBase: string;
    listRoute: string;
    createRoute: string;
    editRoute: (id: string) => string;
    /** When false, form renders read-only save with a TODO banner (no fake saves). */
    writeApiAvailable: boolean;
    geometry?: CoreEntityGeometryConfig;
    secondaryGeometry?: CoreEntityGeometryConfig;
    editableFields: CoreEntityFieldDef[];
    readonlyMetadata: CoreEntityFieldDef[];
    defaultFormValues: CoreEntityFormValues;
    formSchema: (mode: CoreEntityFormMode) => z.ZodType<CoreEntityFormValues>;
    detailToFormValues: (detail: TDetail) => CoreEntityFormValues;
    formValuesToCreatePayload: (values: CoreEntityFormValues) => TCreate;
    formValuesToUpdatePayload: (values: CoreEntityFormValues) => TUpdate;
    getDetailId: (detail: TDetail) => string;
    fetchDetail: (id: string) => Promise<TDetail>;
    createEntity: (payload: TCreate) => Promise<TDetail>;
    updateEntity: (id: string, payload: TUpdate) => Promise<TDetail>;
    createDescription?: string;
    editDescription?: (detail: TDetail) => string;
    renderEditExtras?: (ctx: CoreEntityEditExtrasContext<TDetail>) => ReactNode;
    /** Static notice shown above the form (e.g. pending backend validation). */
    formNotice?: ReactNode;
    onAfterCreate?: (detail: TDetail) => void;
    onAfterUpdate?: (detail: TDetail) => void;
};
