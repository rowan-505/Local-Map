"use client";

import { useQuery } from "@tanstack/react-query";

import { getImportReviewFormOptions, type ImportReviewFormOptionsResponse } from "@/src/lib/api";

import type { ImportReviewReferenceOptionsBundle } from "../api/importReviewApiClient";
import { formatImportReviewApiError } from "../api/importReviewApiErrors";
import { importReviewOptionsQueryDefaults } from "./importReviewQueryConfig";
import { importReviewQueryKeys } from "./importReviewQueryKeys";

export type ImportReviewFormOptionsBundle = ImportReviewFormOptionsResponse;

const EMPTY_FORM_OPTIONS: ImportReviewFormOptionsBundle = {
    admin_areas: [],
    admin_levels: [],
    road_classes: [],
    poi_categories: [],
    building_types: [],
    landuse_classes: [],
    waterway_classes: [],
    water_classes: [],
    barrier_types: [],
    surface_presets: [],
};

/** Legacy bundle shape for components still keyed by refSource. */
export function toLegacyReferenceBundle(
    options: ImportReviewFormOptionsBundle
): ImportReviewReferenceOptionsBundle {
    const mapRef = (rows: ImportReviewFormOptionsBundle["poi_categories"]) =>
        rows.map((r) => ({
            id: String(r.value),
            code: r.code ?? null,
            name: r.name ?? null,
        }));

    return {
        ref_poi_categories: mapRef(options.poi_categories),
        ref_road_classes: mapRef(options.road_classes),
        ref_building_types: mapRef(options.building_types),
        ref_landuse_classes: mapRef(options.landuse_classes),
        ref_admin_levels: mapRef(options.admin_levels),
        ref_address_component_types: [],
        ref_source_types: [],
        core_admin_areas: options.admin_areas.map((a) => ({
            id: a.id,
            code: a.canonical_name,
            name: a.label,
        })),
    };
}

/**
 * Cached GET /api/import-review/options — deduped across all import-review entity UIs.
 */
export function useImportReviewFormOptions(enabled: boolean) {
    const query = useQuery({
        queryKey: importReviewQueryKeys.formOptions(),
        queryFn: ({ signal }) => getImportReviewFormOptions({ signal }),
        enabled,
        ...importReviewOptionsQueryDefaults,
        refetchOnMount: false,
    });

    const formOptions = enabled ? (query.data ?? EMPTY_FORM_OPTIONS) : EMPTY_FORM_OPTIONS;

    return {
        formOptions,
        legacyBundle: toLegacyReferenceBundle(formOptions),
        isLoading: enabled && query.isPending && !query.data,
        error: query.error
            ? formatImportReviewApiError(query.error, "Failed to load form options.")
            : "",
    };
}

/** @deprecated Use useImportReviewFormOptions */
export function useImportReviewReferenceOptions(enabled: boolean) {
    const { formOptions, legacyBundle, isLoading, error } = useImportReviewFormOptions(enabled);
    return { bundle: legacyBundle, formOptions, isLoading, error };
}
