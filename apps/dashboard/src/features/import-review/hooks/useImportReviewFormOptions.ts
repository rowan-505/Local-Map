"use client";

import { useEffect, useState } from "react";

import {
    getImportReviewFormOptions,
    type ImportReviewFormOptionsResponse,
} from "@/src/lib/api";
import { formatImportReviewApiError } from "../api/importReviewApiErrors";
import { isAbortError } from "@/src/lib/api";

import type { ImportReviewReferenceOptionsBundle } from "../api/importReviewApiClient";

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
            name: r.label,
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

export function useImportReviewFormOptions(enabled: boolean) {
    const [formOptions, setFormOptions] = useState<ImportReviewFormOptionsBundle>(EMPTY_FORM_OPTIONS);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const c = new AbortController();
        let active = true;

        void getImportReviewFormOptions({ signal: c.signal })
            .then((data) => {
                if (active) {
                    setFormOptions(data);
                    setError("");
                }
            })
            .catch((err) => {
                if (!active || isAbortError(err)) {
                    return;
                }
                setFormOptions(EMPTY_FORM_OPTIONS);
                setError(formatImportReviewApiError(err, "Failed to load form options."));
            })
            .finally(() => {
                if (active) {
                    setIsLoading(false);
                }
            });

        queueMicrotask(() => {
            if (active) {
                setIsLoading(true);
            }
        });

        return () => {
            active = false;
            c.abort();
        };
    }, [enabled]);

    return {
        formOptions,
        legacyBundle: toLegacyReferenceBundle(formOptions),
        isLoading,
        error,
    };
}

/** @deprecated Use useImportReviewFormOptions */
export function useImportReviewReferenceOptions(enabled: boolean) {
    const { formOptions, legacyBundle, isLoading, error } = useImportReviewFormOptions(enabled);
    return { bundle: legacyBundle, formOptions, isLoading, error };
}
