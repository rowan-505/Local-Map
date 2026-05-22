"use client";

import { useCallback, useEffect, useState } from "react";

import type { PlaceFormOption, RefBuildingType, RefLanduseClass, RoadClassOption, Street, ImportReviewReferenceOptionDto } from "@/src/lib/api";
import {
    getBuildingTypes,
    getCoreReviewList,
    getImportReviewReferenceOptions,
    getPlaceFormOptions,
    getRefLanduseClasses,
    getRoadClasses,
    getStreets,
    type PlaceFormOptions,
} from "@/src/lib/api";
import type { CoreReviewBusRouteRow } from "@/src/features/core-review/config/types";

import type { CoreRefSourceKind } from "@/src/lib/core-review/entityConfigs/types";

export type CoreRefOption = {
    value: string;
    label: string;
    code?: string;
};

export type CoreRefLoadState = {
    options: CoreRefOption[];
    isLoading: boolean;
    error: string | null;
    reload: () => void;
};

function mapBuildingTypes(items: RefBuildingType[]): CoreRefOption[] {
    return items.map((item) => ({
        value: item.id,
        label: item.name_mm ? `${item.name} (${item.name_mm})` : item.name,
        code: item.code,
    }));
}

function mapRoadClasses(items: RoadClassOption[]): CoreRefOption[] {
    return items.map((item) => ({
        value: item.id,
        label: `${item.name} (${item.code})`,
        code: item.code,
    }));
}

function mapPlaceFormOptions(items: PlaceFormOption[]): CoreRefOption[] {
    return items.map((item) => ({
        value: item.id,
        label: item.label,
        code: item.code,
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

function mapBusRoutes(items: CoreReviewBusRouteRow[]): CoreRefOption[] {
    return items.map((item) => ({
        value: item.id,
        label: item.publicName
            ? `${item.publicName}${item.routeCode ? ` (${item.routeCode})` : ""}`
            : item.routeCode ?? item.id,
        code: item.routeCode ?? undefined,
    }));
}

function mapLanduseClasses(items: RefLanduseClass[]): CoreRefOption[] {
    return items
        .filter((item) => item.is_active)
        .map((item) => ({
            value: item.id,
            label: item.name_mm ? `${item.name_en} — ${item.name_mm}` : item.name_en,
            code: item.code,
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
    return mapPlaceFormOptions(data[key]);
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

    const [busRoutes, setBusRoutes] = useState<CoreRefOption[]>([]);
    const [busRoutesLoading, setBusRoutesLoading] = useState(false);
    const [busRoutesError, setBusRoutesError] = useState<string | null>(null);

    const [streets, setStreets] = useState<CoreRefOption[]>([]);
    const [streetsLoading, setStreetsLoading] = useState(false);
    const [streetsError, setStreetsError] = useState<string | null>(null);

    const [landuseClasses, setLanduseClasses] = useState<CoreRefOption[]>([]);
    const [landuseClassesLoading, setLanduseClassesLoading] = useState(false);
    const [landuseClassesError, setLanduseClassesError] = useState<string | null>(null);

    const needsBuildingTypes = sources.includes("building-types");
    const needsRoadClasses = sources.includes("road-classes");
    const needsPlaceForm = sources.some((s) => s.startsWith("place-form-options:"));
    const needsReferenceOptions = sources.some((s) => s.startsWith("reference-options:"));
    const needsBusRoutes = sources.includes("core-review:bus-routes");
    const needsStreets = sources.includes("streets");
    const needsLanduseClasses = sources.includes("landuse-classes");

    const loadBuildingTypes = useCallback(async () => {
        if (!needsBuildingTypes) return;
        setBuildingTypesLoading(true);
        setBuildingTypesError(null);
        try {
            const data = await getBuildingTypes();
            setBuildingTypes(mapBuildingTypes(data));
        } catch (err) {
            setBuildingTypes([]);
            setBuildingTypesError(err instanceof Error ? err.message : "Could not load building types.");
        } finally {
            setBuildingTypesLoading(false);
        }
    }, [needsBuildingTypes]);

    const loadRoadClasses = useCallback(async () => {
        if (!needsRoadClasses) return;
        setRoadClassesLoading(true);
        setRoadClassesError(null);
        try {
            const data = await getRoadClasses();
            setRoadClasses(mapRoadClasses(data));
        } catch (err) {
            setRoadClasses([]);
            setRoadClassesError(err instanceof Error ? err.message : "Could not load road classes.");
        } finally {
            setRoadClassesLoading(false);
        }
    }, [needsRoadClasses]);

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

    const loadBusRoutes = useCallback(async () => {
        if (!needsBusRoutes) return;
        setBusRoutesLoading(true);
        setBusRoutesError(null);
        try {
            const response = await getCoreReviewList<CoreReviewBusRouteRow>("bus-routes", {
                page: 1,
                pageSize: 200,
            });
            setBusRoutes(mapBusRoutes(response.data));
        } catch (err) {
            setBusRoutes([]);
            setBusRoutesError(err instanceof Error ? err.message : "Could not load bus routes.");
        } finally {
            setBusRoutesLoading(false);
        }
    }, [needsBusRoutes]);

    const loadStreets = useCallback(async () => {
        if (!needsStreets) return;
        setStreetsLoading(true);
        setStreetsError(null);
        try {
            const data = await getStreets({ limit: 100 });
            setStreets(mapStreets(data));
        } catch (err) {
            setStreets([]);
            setStreetsError(err instanceof Error ? err.message : "Could not load streets.");
        } finally {
            setStreetsLoading(false);
        }
    }, [needsStreets]);

    const loadLanduseClasses = useCallback(async () => {
        if (!needsLanduseClasses) return;
        setLanduseClassesLoading(true);
        setLanduseClassesError(null);
        try {
            const data = await getRefLanduseClasses();
            setLanduseClasses(mapLanduseClasses(data));
        } catch (err) {
            setLanduseClasses([]);
            setLanduseClassesError(err instanceof Error ? err.message : "Could not load landuse classes.");
        } finally {
            setLanduseClassesLoading(false);
        }
    }, [needsLanduseClasses]);

    useEffect(() => {
        void loadBuildingTypes();
    }, [loadBuildingTypes]);

    useEffect(() => {
        void loadRoadClasses();
    }, [loadRoadClasses]);

    useEffect(() => {
        void loadPlaceFormOptions();
    }, [loadPlaceFormOptions]);

    useEffect(() => {
        void loadReferenceOptions();
    }, [loadReferenceOptions]);

    useEffect(() => {
        void loadBusRoutes();
    }, [loadBusRoutes]);

    useEffect(() => {
        void loadStreets();
    }, [loadStreets]);

    useEffect(() => {
        void loadLanduseClasses();
    }, [loadLanduseClasses]);

    const adminAreasState = emptyRefState();

    return {
        "building-types": {
            options: buildingTypes,
            isLoading: buildingTypesLoading,
            error: buildingTypesError,
            reload: () => void loadBuildingTypes(),
        },
        "road-classes": {
            options: roadClasses,
            isLoading: roadClassesLoading,
            error: roadClassesError,
            reload: () => void loadRoadClasses(),
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
        "core-review:bus-routes": {
            options: busRoutes,
            isLoading: busRoutesLoading,
            error: busRoutesError,
            reload: () => void loadBusRoutes(),
        },
        streets: {
            options: streets,
            isLoading: streetsLoading,
            error: streetsError,
            reload: () => void loadStreets(),
            // Note: first 100 streets only; dedicated search combobox TODO when street count grows.
        },
        "landuse-classes": {
            options: landuseClasses,
            isLoading: landuseClassesLoading,
            error: landuseClassesError,
            reload: () => void loadLanduseClasses(),
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
