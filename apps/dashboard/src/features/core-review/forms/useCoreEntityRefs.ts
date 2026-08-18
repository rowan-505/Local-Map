"use client";

import { useCallback, useEffect, useState } from "react";

import type {
    PlaceFormOption,
    RefBuildingType,
    RefLandAreaClass,
    RefWaterClass,
    RoadClassOption,
    Street,
    ImportReviewReferenceOptionDto,
} from "@/src/lib/api";
import { mapRefBuildingTypesToSelectOptions } from "@/src/lib/building-type/display";
import {
    getImportReviewReferenceOptions,
    getPlaceFormOptions,
    type PlaceFormOptions,
} from "@/src/lib/api";

import type { CoreRefSourceKind } from "@/src/lib/core-review/entityConfigs/types";
import {
    useCoreReviewRefBuildingTypes,
    useCoreReviewRefLandAreaClasses,
    useCoreReviewRefRoadClasses,
    useCoreReviewRefStreets,
    useCoreReviewRefWaterClasses,
} from "../hooks/coreReviewRefQueries";

export type CoreRefOption = {
    value: string;
    label: string;
    code?: string;
    name?: string | null;
    name_mm?: string | null;
    parent_id?: string | null;
};

export type CoreRefLoadState = {
    options: CoreRefOption[];
    isLoading: boolean;
    error: string | null;
    reload: () => void;
};

function mapBuildingTypes(items: RefBuildingType[]): CoreRefOption[] {
    return mapRefBuildingTypesToSelectOptions(items);
}

function mapRoadClasses(items: RoadClassOption[]): CoreRefOption[] {
    return items.map((item) => ({
        value: item.id,
        label: `${item.name} (${item.code})`,
        code: item.code,
    }));
}

function mapPlaceFormCategoryOptions(items: PlaceFormOption[]): CoreRefOption[] {
    return items.map((item) => ({
        value: item.id,
        label: item.label ?? item.id,
        code: item.code,
        name: item.name ?? null,
        name_mm: item.name_mm ?? null,
        parent_id: item.parent_id,
    }));
}

function mapReferenceOptions(items: ImportReviewReferenceOptionDto[]): CoreRefOption[] {
    return items.map((item) => ({
        value: item.id,
        label: item.name
            ? item.code
                ? `${item.name} (${item.code})`
                : item.name
            : item.code ?? item.id,
        code: item.code ?? undefined,
    }));
}

function mapAdminLevelOptions(items: ImportReviewReferenceOptionDto[]): CoreRefOption[] {
    return items.map((item) => {
        const code = item.code?.trim() ?? "";
        const name = item.name?.trim() ?? "";
        const label =
            code && name ? `${code} — ${name} (${code})` : code || name || item.id;
        return {
            value: item.id,
            label,
            code: code || undefined,
        };
    });
}

function mapLandAreaClasses(items: RefLandAreaClass[]): CoreRefOption[] {
    return items
        .filter((item) => item.is_active)
        .map((item) => ({
            value: item.id,
            label: item.name_mm ? `${item.name_en} — ${item.name_mm}` : item.name_en,
            code: item.code,
        }));
}

function mapWaterClasses(items: RefWaterClass[]): CoreRefOption[] {
    return items
        .filter((item) => item.is_active)
        .map((item) => ({
            value: item.id,
            label: item.name_mm
                ? `${item.name_en} (${item.code}) — ${item.name_mm}`
                : `${item.name_en} (${item.code})`,
            code: item.code,
            parent_id: item.parent_id,
        }));
}

function mapStreets(items: Street[]): CoreRefOption[] {
    return items.map((item) => ({
        value: item.public_id,
        label: item.canonical_name || item.public_id,
    }));
}

function optionsFromPlaceFormOptions(
    data: PlaceFormOptions,
    key: "categories" | "source_types" | "publish_statuses",
): CoreRefOption[] {
    if (key === "categories") {
        return mapPlaceFormCategoryOptions(data.categories);
    }
    return data[key].map((item) => ({
        value: item.id,
        label: item.label ?? item.id,
        code: item.code,
    }));
}

function emptyRefState(reload: () => void = () => undefined): CoreRefLoadState {
    return { options: [], isLoading: false, error: null, reload };
}

export function useCoreEntityRefs(sources: CoreRefSourceKind[]): Record<CoreRefSourceKind, CoreRefLoadState> {
    const [buildingTypes, setBuildingTypes] = useState<CoreRefOption[]>([]);
    const [buildingTypesLoading, setBuildingTypesLoading] = useState(false);
    const [buildingTypesError, setBuildingTypesError] = useState<string | null>(null);

    const [roadClasses, setRoadClasses] = useState<CoreRefOption[]>([]);
    const [roadClassesLoading, setRoadClassesLoading] = useState(false);
    const [roadClassesError, setRoadClassesError] = useState<string | null>(null);

    const [placeFormOptions, setPlaceFormOptions] = useState<PlaceFormOptions | null>(null);
    const [placeFormLoading, setPlaceFormLoading] = useState(false);
    const [placeFormError, setPlaceFormError] = useState<string | null>(null);

    const [referenceOptions, setReferenceOptions] = useState<Awaited<
        ReturnType<typeof getImportReviewReferenceOptions>
    > | null>(null);
    const [referenceLoading, setReferenceLoading] = useState(false);
    const [referenceError, setReferenceError] = useState<string | null>(null);

    const [streets, setStreets] = useState<CoreRefOption[]>([]);
    const [streetsLoading, setStreetsLoading] = useState(false);
    const [streetsError, setStreetsError] = useState<string | null>(null);

    const [landAreaClasses, setLandAreaClasses] = useState<CoreRefOption[]>([]);
    const [landAreaClassesLoading, setLandAreaClassesLoading] = useState(false);
    const [landAreaClassesError, setLandAreaClassesError] = useState<string | null>(null);

    const [waterClasses, setWaterClasses] = useState<CoreRefOption[]>([]);
    const [waterClassesLoading, setWaterClassesLoading] = useState(false);
    const [waterClassesError, setWaterClassesError] = useState<string | null>(null);

    const needsBuildingTypes = sources.includes("building-types");
    const needsRoadClasses = sources.includes("road-classes");
    const needsPlaceForm = sources.some((s) => s.startsWith("place-form-options:"));
    const needsReferenceOptions = sources.some((s) => s.startsWith("reference-options:"));
    const needsStreets = sources.includes("streets");
    const needsLandAreaClasses = sources.includes("land-area-classes");
    const needsWaterClasses = sources.includes("water-classes");

    // Global cached reference data (React Query).
    const buildingTypesQuery = useCoreReviewRefBuildingTypes(needsBuildingTypes);
    const roadClassesQuery = useCoreReviewRefRoadClasses(needsRoadClasses);
    const streetsQuery = useCoreReviewRefStreets(100, needsStreets);
    const landAreaClassesQuery = useCoreReviewRefLandAreaClasses(needsLandAreaClasses);
    const waterClassesQuery = useCoreReviewRefWaterClasses(needsWaterClasses);

    const loadPlaceFormOptions = useCallback(async () => {
        if (!needsPlaceForm) return;
        setPlaceFormLoading(true);
        setPlaceFormError(null);
        try {
            const data = await getPlaceFormOptions();
            setPlaceFormOptions(data);
        } catch (err) {
            setPlaceFormOptions(null);
            setPlaceFormError(err instanceof Error ? err.message : "Could not load form options.");
        } finally {
            setPlaceFormLoading(false);
        }
    }, [needsPlaceForm]);

    const loadReferenceOptions = useCallback(async () => {
        if (!needsReferenceOptions) return;
        setReferenceLoading(true);
        setReferenceError(null);
        try {
            const data = await getImportReviewReferenceOptions();
            setReferenceOptions(data);
        } catch (err) {
            setReferenceOptions(null);
            setReferenceError(err instanceof Error ? err.message : "Could not load reference options.");
        } finally {
            setReferenceLoading(false);
        }
    }, [needsReferenceOptions]);

    useEffect(() => {
        if (!needsBuildingTypes) {
            setBuildingTypes([]);
            setBuildingTypesLoading(false);
            setBuildingTypesError(null);
            return;
        }
        setBuildingTypes(mapBuildingTypes(buildingTypesQuery.data ?? []));
        setBuildingTypesLoading(buildingTypesQuery.isFetching && !(buildingTypesQuery.data?.length));
        setBuildingTypesError(
            buildingTypesQuery.error instanceof Error
                ? buildingTypesQuery.error.message
                : buildingTypesQuery.error
                  ? String(buildingTypesQuery.error)
                  : null
        );
    }, [needsBuildingTypes, buildingTypesQuery.data, buildingTypesQuery.error, buildingTypesQuery.isFetching]);

    useEffect(() => {
        if (!needsRoadClasses) {
            setRoadClasses([]);
            setRoadClassesLoading(false);
            setRoadClassesError(null);
            return;
        }
        setRoadClasses(mapRoadClasses(roadClassesQuery.data ?? []));
        setRoadClassesLoading(roadClassesQuery.isFetching && !(roadClassesQuery.data?.length));
        setRoadClassesError(
            roadClassesQuery.error instanceof Error
                ? roadClassesQuery.error.message
                : roadClassesQuery.error
                  ? String(roadClassesQuery.error)
                  : null
        );
    }, [needsRoadClasses, roadClassesQuery.data, roadClassesQuery.error, roadClassesQuery.isFetching]);

    useEffect(() => {
        void loadPlaceFormOptions();
    }, [loadPlaceFormOptions]);

    useEffect(() => {
        void loadReferenceOptions();
    }, [loadReferenceOptions]);

    useEffect(() => {
        if (!needsStreets) {
            setStreets([]);
            setStreetsLoading(false);
            setStreetsError(null);
            return;
        }
        setStreets(mapStreets(streetsQuery.data ?? []));
        setStreetsLoading(streetsQuery.isFetching && !(streetsQuery.data?.length));
        setStreetsError(
            streetsQuery.error instanceof Error
                ? streetsQuery.error.message
                : streetsQuery.error
                  ? String(streetsQuery.error)
                  : null
        );
    }, [needsStreets, streetsQuery.data, streetsQuery.error, streetsQuery.isFetching]);

    useEffect(() => {
        if (!needsLandAreaClasses) {
            setLandAreaClasses([]);
            setLandAreaClassesLoading(false);
            setLandAreaClassesError(null);
            return;
        }
        setLandAreaClasses(mapLandAreaClasses(landAreaClassesQuery.data ?? []));
        setLandAreaClassesLoading(landAreaClassesQuery.isFetching && !(landAreaClassesQuery.data?.length));
        setLandAreaClassesError(
            landAreaClassesQuery.error instanceof Error
                ? landAreaClassesQuery.error.message
                : landAreaClassesQuery.error
                  ? String(landAreaClassesQuery.error)
                  : null
        );
    }, [needsLandAreaClasses, landAreaClassesQuery.data, landAreaClassesQuery.error, landAreaClassesQuery.isFetching]);

    useEffect(() => {
        if (!needsWaterClasses) {
            setWaterClasses([]);
            setWaterClassesLoading(false);
            setWaterClassesError(null);
            return;
        }
        setWaterClasses(mapWaterClasses(waterClassesQuery.data ?? []));
        setWaterClassesLoading(waterClassesQuery.isFetching && !(waterClassesQuery.data?.length));
        setWaterClassesError(
            waterClassesQuery.error instanceof Error
                ? waterClassesQuery.error.message
                : waterClassesQuery.error
                  ? String(waterClassesQuery.error)
                  : null
        );
    }, [needsWaterClasses, waterClassesQuery.data, waterClassesQuery.error, waterClassesQuery.isFetching]);

    const adminAreasState = emptyRefState();

    return {
        "building-types": {
            options: buildingTypes,
            isLoading: buildingTypesLoading,
            error: buildingTypesError,
            reload: () => void buildingTypesQuery.refetch(),
        },
        "road-classes": {
            options: roadClasses,
            isLoading: roadClassesLoading,
            error: roadClassesError,
            reload: () => void roadClassesQuery.refetch(),
        },
        "place-form-options:categories": {
            options: placeFormOptions ? optionsFromPlaceFormOptions(placeFormOptions, "categories") : [],
            isLoading: placeFormLoading,
            error: placeFormError,
            reload: () => void loadPlaceFormOptions(),
        },
        "place-form-options:source_types": {
            options: placeFormOptions ? optionsFromPlaceFormOptions(placeFormOptions, "source_types") : [],
            isLoading: placeFormLoading,
            error: placeFormError,
            reload: () => void loadPlaceFormOptions(),
        },
        "place-form-options:publish_statuses": {
            options: placeFormOptions ? optionsFromPlaceFormOptions(placeFormOptions, "publish_statuses") : [],
            isLoading: placeFormLoading,
            error: placeFormError,
            reload: () => void loadPlaceFormOptions(),
        },
        "admin-areas": adminAreasState,
        "reference-options:source_types": {
            options: referenceOptions
                ? mapReferenceOptions(referenceOptions.ref_source_types)
                : [],
            isLoading: referenceLoading,
            error: referenceError,
            reload: () => void loadReferenceOptions(),
        },
        "reference-options:admin_levels": {
            options: referenceOptions
                ? mapAdminLevelOptions(referenceOptions.ref_admin_levels)
                : [],
            isLoading: referenceLoading,
            error: referenceError,
            reload: () => void loadReferenceOptions(),
        },
        streets: {
            options: streets,
            isLoading: streetsLoading,
            error: streetsError,
            reload: () => void streetsQuery.refetch(),
            // Note: first 100 streets only; dedicated search combobox TODO when street count grows.
        },
        "land-area-classes": {
            options: landAreaClasses,
            isLoading: landAreaClassesLoading,
            error: landAreaClassesError,
            reload: () => void landAreaClassesQuery.refetch(),
        },
        "water-classes": {
            options: waterClasses,
            isLoading: waterClassesLoading,
            error: waterClassesError,
            reload: () => void waterClassesQuery.refetch(),
        },
    };
}

export function collectRefSources(
    fields: { refSource?: CoreRefSourceKind }[],
): CoreRefSourceKind[] {
    const set = new Set<CoreRefSourceKind>();
    for (const field of fields) {
        if (field.refSource) {
            set.add(field.refSource);
        }
    }
    return [...set];
}
