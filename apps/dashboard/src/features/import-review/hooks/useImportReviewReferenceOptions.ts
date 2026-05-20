"use client";

import { useEffect, useState } from "react";

import { getImportReviewReferenceOptionsBundle, type ImportReviewReferenceOptionsBundle } from "../api/importReviewApiClient";
import { formatImportReviewApiError } from "../api/importReviewApiErrors";
import { isAbortError } from "@/src/lib/api";

const EMPTY_BUNDLE: ImportReviewReferenceOptionsBundle = {
    ref_poi_categories: [],
    ref_road_classes: [],
    ref_building_types: [],
    ref_admin_levels: [],
    ref_address_component_types: [],
    ref_source_types: [],
    core_admin_areas: [],
};

export function useImportReviewReferenceOptions(enabled: boolean) {
    const [bundle, setBundle] = useState<ImportReviewReferenceOptionsBundle>(EMPTY_BUNDLE);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!enabled) {
            return;
        }
        const c = new AbortController();
        setIsLoading(true);
        setError("");
        getImportReviewReferenceOptionsBundle({ signal: c.signal })
            .then(setBundle)
            .catch((err) => {
                if (isAbortError(err)) {
                    return;
                }
                setBundle(EMPTY_BUNDLE);
                setError(formatImportReviewApiError(err, "Failed to load reference options."));
            })
            .finally(() => {
                if (!c.signal.aborted) {
                    setIsLoading(false);
                }
            });
        return () => c.abort();
    }, [enabled]);

    return { bundle, isLoading, error };
}
