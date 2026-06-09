"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Geometry } from "geojson";
import { Controller, type Control, type UseFormSetValue, type UseFormWatch } from "react-hook-form";

import AdminAreaCombobox from "@/src/components/admin-areas/AdminAreaCombobox";
import RoadTownshipAdminAreaCombobox from "@/src/components/admin-areas/RoadTownshipAdminAreaCombobox";
import {
    formatAdminAreaOptionLabel,
    type AdminAreaOption,
} from "@/src/components/admin-areas/adminAreaLabels";
import {
    getAdminAreaOptions,
    inferEntityAdminArea,
    searchRoadTownshipAdminAreaOptions,
    validateEntityAdminAreaManual,
    type EntityAdminAreaKind,
    type RoadAdminAreaInferStatus,
    type RoadInferCommonParentAdminArea,
    type RoadInferCurrentAdminArea,
    type RoadInferIntersectingTownship,
    type RoadInferRecommendedTownship,
    type RoadTownshipDebugReason,
    type RoadTownshipRecommendationMode,
} from "@/src/lib/api";
import { canOverrideEntityAdminAreaGeometryMismatch } from "@/src/lib/entityAdminAreaUx";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";
import {
    formatCommonParentContextLine,
    formatIntersectingTownshipLine,
    formatNearestFallbackLine,
    roadTownshipInferBannerLabel,
    shouldShowIntersectingTownshipList,
    shouldShowRoadRecommendedTownship,
} from "@/src/lib/core-review/roadTownshipInferUi";
import type { CoreEntityFormValues } from "@/src/lib/core-review/entityConfigs/types";

export type EntityTownshipAdminFieldConfig = {
    entityKind: EntityAdminAreaKind;
    adminAreaIdKey: string;
    geometryFieldKey: string;
    manualOverrideKey?: string;
};

export type EntityTownshipAdminFieldProps = {
    config: EntityTownshipAdminFieldConfig;
    control: Control<CoreEntityFormValues>;
    watch: UseFormWatch<CoreEntityFormValues>;
    setValue: UseFormSetValue<CoreEntityFormValues>;
    disabled?: boolean;
    error?: string;
    /** Stored DB admin_area_id from detail — roads/landuse; never overwritten by inference. */
    storedAdminAreaId?: string | null;
    /** Road/landuse public id for infer audit logging only. */
    entityPublicId?: string | null;
};

function pointFromGeometry(geometry: Geometry | null | undefined): { lat: number; lng: number } | null {
    if (!geometry || geometry.type !== "Point") {
        return null;
    }
    const [lng, lat] = geometry.coordinates;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        return null;
    }
    return { lat: Number(lat), lng: Number(lng) };
}

function lineOrPolygonGeometry(geometry: Geometry | null | undefined) {
    if (!geometry) {
        return null;
    }
    if (
        geometry.type === "LineString" ||
        geometry.type === "MultiLineString" ||
        geometry.type === "Polygon" ||
        geometry.type === "MultiPolygon"
    ) {
        return geometry;
    }
    return null;
}

const RECOMMEND_APPLY_INFER_DEBOUNCE_MS = 500;
const ROAD_GEOMETRY_MISSING_MESSAGE = "Road geometry missing; township cannot be inferred.";
const LANDUSE_GEOMETRY_MISSING_MESSAGE = "Landuse polygon missing; township cannot be inferred.";
const BUS_STOP_GEOMETRY_MISSING_MESSAGE = "Bus stop location missing; township cannot be inferred.";

/** Roads: LineString/MultiLineString with enough coordinates for infer API. */
function isNonEmptyRoadLineGeometry(geometry: Geometry | null | undefined): boolean {
    if (!geometry) {
        return false;
    }
    if (geometry.type === "LineString") {
        const coords = geometry.coordinates;
        return Array.isArray(coords) && coords.length >= 2;
    }
    if (geometry.type === "MultiLineString") {
        const lines = geometry.coordinates;
        return (
            Array.isArray(lines) &&
            lines.some((line) => Array.isArray(line) && line.length >= 2)
        );
    }
    return false;
}

/** Landuse: Polygon/MultiPolygon with enough coordinates for infer API. */
function isNonEmptyLandusePolygonGeometry(geometry: Geometry | null | undefined): boolean {
    if (!geometry) {
        return false;
    }
    if (geometry.type === "Polygon") {
        const rings = geometry.coordinates;
        if (!Array.isArray(rings) || rings.length === 0) {
            return false;
        }
        const outer = rings[0];
        return Array.isArray(outer) && outer.length >= 4;
    }
    if (geometry.type === "MultiPolygon") {
        const polys = geometry.coordinates;
        return (
            Array.isArray(polys) &&
            polys.some(
                (poly) =>
                    Array.isArray(poly) &&
                    poly.length > 0 &&
                    Array.isArray(poly[0]) &&
                    poly[0].length >= 4,
            )
        );
    }
    return false;
}

function recommendApplyMissingGeometryAudit(message: string): RoadTownshipAuditState {
    return {
        status: "invalid_geometry",
        message,
        currentAdminArea: null,
        recommendedTownship: null,
        recommendationMode: null,
        intersectingTownships: [],
        commonParentAdminArea: null,
        debugReason: "invalid_geometry",
        fallbackReason: null,
        nearestTownshipDistanceM: null,
    };
}

function formatTownshipDisplayName(name: string | null | undefined, id: string | null | undefined): string {
    if (name) {
        return name;
    }
    if (id) {
        return `Township id ${id}`;
    }
    return "";
}

function formatCurrentAdminAreaLine(current: RoadInferCurrentAdminArea | null | undefined): string {
    if (!current?.id) {
        return "Not assigned";
    }

    const label = formatTownshipDisplayName(current.name, current.id);
    const parts = [label];

    if (current.level_code) {
        parts.push(`(${current.level_code})`);
    }
    if (current.is_active === true) {
        parts.push("— active");
    } else if (current.is_active === false) {
        parts.push("— inactive");
    } else {
        parts.push("— missing or invalid");
    }

    return parts.join(" ");
}

function formatRecommendedTownshipLine(
    recommended: RoadInferRecommendedTownship | null | undefined,
): string | null {
    if (!recommended) {
        return null;
    }

    return formatAdminAreaOptionLabel({
        id: recommended.id,
        canonical_name: recommended.canonical_name ?? recommended.id,
        name_mm: recommended.name_mm,
        name_en: recommended.name_en,
        admin_level_id: "",
        admin_level_code: "township",
        parent_id: null,
    });
}

const ROAD_INFER_STATUS_COPY: Record<
    Exclude<RoadAdminAreaInferStatus, never>,
    { label: string; className: string }
> = {
    valid_existing: {
        label: "Current township assignment is valid",
        className: "rounded-md border border-green-200 bg-green-50 px-2.5 py-2 text-sm font-medium text-green-900",
    },
    recommendation_found: {
        label: "Recommended township found",
        className:
            "rounded-md border border-yellow-200 bg-yellow-50 px-2.5 py-2 text-sm font-medium text-yellow-950",
    },
    no_match: {
        label: "No township match found. Review manually.",
        className:
            "rounded-md border border-yellow-200 bg-yellow-50 px-2.5 py-2 text-sm font-medium text-yellow-950",
    },
    invalid_geometry: {
        label: "Cannot infer township because geometry is invalid.",
        className:
            "rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-sm font-medium text-amber-950",
    },
};

type RoadTownshipAuditState = {
    status: RoadAdminAreaInferStatus | null;
    message: string | null;
    currentAdminArea: RoadInferCurrentAdminArea | null;
    recommendedTownship: RoadInferRecommendedTownship | null;
    recommendationMode: RoadTownshipRecommendationMode | null;
    intersectingTownships: RoadInferIntersectingTownship[];
    commonParentAdminArea: RoadInferCommonParentAdminArea | null;
    debugReason: RoadTownshipDebugReason | null;
    fallbackReason: "point_fallback" | "nearest_township" | null;
    nearestTownshipDistanceM: number | null;
};

const emptyRoadAudit: RoadTownshipAuditState = {
    status: null,
    message: null,
    currentAdminArea: null,
    recommendedTownship: null,
    recommendationMode: null,
    intersectingTownships: [],
    commonParentAdminArea: null,
    debugReason: null,
    fallbackReason: null,
    nearestTownshipDistanceM: null,
};

function RoadTownshipAuditDetails({
    audit,
    storedAdminAreaId,
    selectedAdminAreaId,
}: {
    audit: RoadTownshipAuditState;
    storedAdminAreaId: string;
    selectedAdminAreaId: string;
}) {
    const recommendedLine = formatRecommendedTownshipLine(audit.recommendedTownship);
    const showCurrent = audit.currentAdminArea !== null;
    const showRecommended =
        Boolean(recommendedLine) &&
        shouldShowRoadRecommendedTownship(audit.status, audit.recommendedTownship);
    const showSelected =
        Boolean(selectedAdminAreaId) && selectedAdminAreaId !== (storedAdminAreaId || "").trim();
    const showIntersectingList = shouldShowIntersectingTownshipList(
        audit.status,
        audit.intersectingTownships,
    );
    const commonParentLine = formatCommonParentContextLine(audit.commonParentAdminArea);
    const nearestLine =
        audit.fallbackReason === "nearest_township"
            ? formatNearestFallbackLine(audit.nearestTownshipDistanceM)
            : null;

    if (
        !showCurrent &&
        !showRecommended &&
        !showSelected &&
        !showIntersectingList &&
        !commonParentLine &&
        !nearestLine
    ) {
        return null;
    }

    return (
        <dl className="mt-2 space-y-1.5 text-xs text-slate-700">
            {showCurrent ? (
                <div>
                    <dt className="font-medium text-slate-600">Current admin area</dt>
                    <dd>{formatCurrentAdminAreaLine(audit.currentAdminArea)}</dd>
                </div>
            ) : null}
            {showRecommended ? (
                <div>
                    <dt className="font-medium text-slate-600">Recommended township</dt>
                    <dd>{recommendedLine}</dd>
                </div>
            ) : null}
            {showIntersectingList ? (
                <div>
                    <dt className="font-medium text-slate-600">Intersecting townships</dt>
                    <dd>
                        <ul className="mt-0.5 list-inside list-disc space-y-0.5">
                            {audit.intersectingTownships.map((match) => (
                                <li key={match.id}>{formatIntersectingTownshipLine(match)}</li>
                            ))}
                        </ul>
                    </dd>
                </div>
            ) : null}
            {commonParentLine ? (
                <div>
                    <dt className="font-medium text-slate-600">Broader area</dt>
                    <dd className="text-slate-500">{commonParentLine}</dd>
                </div>
            ) : null}
            {nearestLine ? (
                <div>
                    <dt className="font-medium text-slate-600">Fallback</dt>
                    <dd>{nearestLine}</dd>
                </div>
            ) : null}
            {showSelected ? (
                <div>
                    <dt className="font-medium text-slate-600">Form township</dt>
                    <dd>{formatTownshipDisplayName(null, selectedAdminAreaId)}</dd>
                </div>
            ) : null}
        </dl>
    );
}

function RoadTownshipAuditPanel({
    loading,
    error,
    audit,
    storedAdminAreaId,
    selectedAdminAreaId,
}: {
    loading: boolean;
    error: string | null;
    audit: RoadTownshipAuditState;
    storedAdminAreaId: string;
    selectedAdminAreaId: string;
}) {
    if (loading) {
        return <p className="text-sm text-slate-600">Finding township from road geometry...</p>;
    }

    if (error) {
        return <p className="text-sm text-amber-800">{error}</p>;
    }

    if (!audit.status) {
        return null;
    }

    const statusCopy = ROAD_INFER_STATUS_COPY[audit.status];
    const bannerLabel =
        roadTownshipInferBannerLabel({
            status: audit.status,
            currentAdminArea: audit.currentAdminArea,
            recommendationMode: audit.recommendationMode,
            debugReason: audit.debugReason,
            message: audit.message,
        }) ?? statusCopy.label;

    return (
        <div className="space-y-0">
            <p className={statusCopy.className}>{bannerLabel}</p>
            {audit.message && audit.status !== "valid_existing" ? (
                <p className="mt-1 text-xs text-slate-600">{audit.message}</p>
            ) : null}
            <RoadTownshipAuditDetails
                audit={audit}
                storedAdminAreaId={storedAdminAreaId}
                selectedAdminAreaId={selectedAdminAreaId}
            />
        </div>
    );
}

export default function EntityTownshipAdminField({
    config,
    control,
    watch,
    setValue,
    disabled = false,
    error,
    storedAdminAreaId = null,
    entityPublicId = null,
}: EntityTownshipAdminFieldProps) {
    const manualOverrideKey = config.manualOverrideKey ?? "admin_area_manual_override";
    const explicitClearKey = "admin_area_explicit_clear";
    const baseId = useId();
    const usesRecommendApplyInfer =
        config.entityKind === "street" ||
        config.entityKind === "landuse" ||
        config.entityKind === "bus_stop";

    const geometry = watch(config.geometryFieldKey as keyof CoreEntityFormValues);
    const manualOverride = Boolean(watch(manualOverrideKey as keyof CoreEntityFormValues));
    const selectedAdminAreaId = String(watch(config.adminAreaIdKey as keyof CoreEntityFormValues) ?? "").trim();

    const [calculatedId, setCalculatedId] = useState<string | null>(null);
    const [calculatedLabel, setCalculatedLabel] = useState<string | null>(null);
    const [inferLoading, setInferLoading] = useState(false);
    const [inferError, setInferError] = useState<string | null>(null);
    const [roadAudit, setRoadAudit] = useState<RoadTownshipAuditState>(emptyRoadAudit);
    const [recommendationApplied, setRecommendationApplied] = useState(false);
    const [mismatchWarning, setMismatchWarning] = useState<string | null>(null);
    const [townshipOptions, setTownshipOptions] = useState<
        Awaited<ReturnType<typeof getAdminAreaOptions>>
    >([]);
    const [selectedRoadTownship, setSelectedRoadTownship] = useState<AdminAreaOption | null>(null);
    const [optionsLoading, setOptionsLoading] = useState(false);

    /** DB value from detail — never updated by infer or form edits. */
    const storedCurrentAdminAreaIdRef = useRef(storedAdminAreaId ?? "");
    const selectedAdminAreaIdRef = useRef(selectedAdminAreaId);
    const appliedRecommendationIdRef = useRef<string | null>(null);
    /** Invalidates in-flight road infer when geometry, road, or debounce timer changes. */
    const roadInferRequestIdRef = useRef(0);

    useEffect(() => {
        storedCurrentAdminAreaIdRef.current = storedAdminAreaId ?? "";
        appliedRecommendationIdRef.current = null;
        setRecommendationApplied(false);
    }, [storedAdminAreaId]);

    useEffect(() => {
        selectedAdminAreaIdRef.current = selectedAdminAreaId;
    }, [selectedAdminAreaId]);

    const canAdminOverride = useMemo(() => canOverrideEntityAdminAreaGeometryMismatch(), []);

    const syncRecommendationAppliedState = useCallback(
        (recommendedId: string | null, selectedId: string) => {
            const appliedId = appliedRecommendationIdRef.current;
            setRecommendationApplied(
                appliedId !== null &&
                    recommendedId === appliedId &&
                    selectedId === appliedId,
            );
        },
        [],
    );

    const runInfer = useCallback(async () => {
        if (usesRecommendApplyInfer) {
            return;
        }

        const geomValue = getFormGeometry(
            { [config.geometryFieldKey]: geometry } as CoreEntityFormValues,
            config.geometryFieldKey,
        );

        if (config.entityKind === "place") {
            const pt = pointFromGeometry(geomValue ?? null);
            if (!pt) {
                setCalculatedId(null);
                setCalculatedLabel(null);
                return;
            }
            setInferLoading(true);
            setInferError(null);
            try {
                const result = await inferEntityAdminArea({
                    kind: "place",
                    lat: pt.lat,
                    lng: pt.lng,
                });
                setCalculatedId(result.admin_area_id);
                setCalculatedLabel(result.canonical_name);
                if (!manualOverride) {
                    setValue(config.adminAreaIdKey as keyof CoreEntityFormValues, result.admin_area_id ?? "", {
                        shouldDirty: true,
                    });
                }
            } catch (err) {
                setInferError(err instanceof Error ? err.message : "Could not infer township");
                setCalculatedId(null);
                setCalculatedLabel(null);
            } finally {
                setInferLoading(false);
            }
            return;
        }

        const g = lineOrPolygonGeometry(geomValue ?? null);
        if (!g) {
            setCalculatedId(null);
            setCalculatedLabel(null);
            return;
        }

        setInferLoading(true);
        setInferError(null);
        try {
            const result = await inferEntityAdminArea({
                kind: config.entityKind,
                geometry: g,
            });

            setCalculatedId(result.admin_area_id);
            setCalculatedLabel(result.canonical_name);
            if (!manualOverride && result.admin_area_id) {
                setValue(config.adminAreaIdKey as keyof CoreEntityFormValues, result.admin_area_id, {
                    shouldDirty: true,
                });
            }
        } catch (err) {
            setInferError(err instanceof Error ? err.message : "Could not infer township");
            setCalculatedId(null);
            setCalculatedLabel(null);
        } finally {
            setInferLoading(false);
        }
    }, [config, geometry, usesRecommendApplyInfer, manualOverride, setValue]);

    useEffect(() => {
        if (usesRecommendApplyInfer) {
            return;
        }
        void runInfer();
    }, [usesRecommendApplyInfer, runInfer]);

    useEffect(() => {
        if (!usesRecommendApplyInfer) {
            return;
        }

        const geomValue = getFormGeometry(
            { [config.geometryFieldKey]: geometry } as CoreEntityFormValues,
            config.geometryFieldKey,
        );

        const geometryMissingMessage =
            config.entityKind === "landuse"
                ? LANDUSE_GEOMETRY_MISSING_MESSAGE
                : config.entityKind === "bus_stop"
                  ? BUS_STOP_GEOMETRY_MISSING_MESSAGE
                  : ROAD_GEOMETRY_MISSING_MESSAGE;

        const busStopPoint =
            config.entityKind === "bus_stop" ? pointFromGeometry(geomValue ?? null) : null;
        const geometryValid =
            config.entityKind === "bus_stop"
                ? busStopPoint !== null
                : config.entityKind === "landuse"
                  ? isNonEmptyLandusePolygonGeometry(geomValue)
                  : isNonEmptyRoadLineGeometry(geomValue);

        if (!geometryValid) {
            roadInferRequestIdRef.current += 1;
            setInferLoading(false);
            setInferError(null);
            setRoadAudit(recommendApplyMissingGeometryAudit(geometryMissingMessage));
            syncRecommendationAppliedState(null, selectedAdminAreaIdRef.current);
            return;
        }

        const lineOrPoly = lineOrPolygonGeometry(geomValue);
        if (config.entityKind !== "bus_stop" && !lineOrPoly) {
            roadInferRequestIdRef.current += 1;
            setInferLoading(false);
            setInferError(null);
            setRoadAudit(recommendApplyMissingGeometryAudit(geometryMissingMessage));
            syncRecommendationAppliedState(null, selectedAdminAreaIdRef.current);
            return;
        }

        const requestId = ++roadInferRequestIdRef.current;
        setInferLoading(true);
        setInferError(null);

        const timer = window.setTimeout(() => {
            void (async () => {
                if (requestId !== roadInferRequestIdRef.current) {
                    return;
                }

                try {
                    const result = await inferEntityAdminArea(
                        config.entityKind === "bus_stop" && busStopPoint
                            ? {
                                  kind: "bus_stop",
                                  lat: busStopPoint.lat,
                                  lng: busStopPoint.lng,
                                  current_admin_area_id: storedCurrentAdminAreaIdRef.current,
                                  entity_public_id: entityPublicId?.trim() || undefined,
                              }
                            : {
                                  kind: config.entityKind,
                                  geometry: lineOrPoly!,
                                  current_admin_area_id: storedCurrentAdminAreaIdRef.current,
                                  entity_public_id: entityPublicId?.trim() || undefined,
                              },
                    );

                    if (requestId !== roadInferRequestIdRef.current) {
                        return;
                    }

                    const recommendedId = result.recommendedTownship?.id ?? null;
                    setRoadAudit({
                        status: result.status ?? null,
                        message: result.message ?? null,
                        currentAdminArea: result.currentAdminArea ?? null,
                        recommendedTownship: result.recommendedTownship ?? null,
                        recommendationMode: result.recommendationMode ?? null,
                        intersectingTownships: result.intersectingTownships ?? [],
                        commonParentAdminArea: result.commonParentAdminArea ?? null,
                        debugReason: result.debugReason ?? null,
                        fallbackReason: result.fallbackReason ?? null,
                        nearestTownshipDistanceM: result.nearestTownshipDistanceM ?? null,
                    });
                    syncRecommendationAppliedState(recommendedId, selectedAdminAreaIdRef.current);
                } catch (err) {
                    if (requestId !== roadInferRequestIdRef.current) {
                        return;
                    }
                    setInferError(err instanceof Error ? err.message : "Could not infer township");
                    setRoadAudit(emptyRoadAudit);
                    syncRecommendationAppliedState(null, selectedAdminAreaIdRef.current);
                } finally {
                    if (requestId === roadInferRequestIdRef.current) {
                        setInferLoading(false);
                    }
                }
            })();
        }, RECOMMEND_APPLY_INFER_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timer);
            roadInferRequestIdRef.current += 1;
        };
    }, [
        config.entityKind,
        config.geometryFieldKey,
        entityPublicId,
        geometry,
        usesRecommendApplyInfer,
        storedAdminAreaId,
        syncRecommendationAppliedState,
    ]);

    useEffect(() => {
        if (!manualOverride) {
            setMismatchWarning(null);
            return;
        }
        const id = selectedAdminAreaId;
        if (!id) {
            setMismatchWarning(null);
            return;
        }

        let cancelled = false;
        const geomValue = getFormGeometry(
            { [config.geometryFieldKey]: geometry } as CoreEntityFormValues,
            config.geometryFieldKey,
        );

        const payload =
            config.entityKind === "place" || config.entityKind === "bus_stop"
                ? (() => {
                      const pt = pointFromGeometry(geomValue ?? null);
                      if (!pt) {
                          return null;
                      }
                      return {
                          kind: config.entityKind,
                          admin_area_id: id,
                          lat: pt.lat,
                          lng: pt.lng,
                      };
                  })()
                : (() => {
                      const g = lineOrPolygonGeometry(geomValue ?? null);
                      if (!g) {
                          return null;
                      }
                      return {
                          kind: config.entityKind,
                          admin_area_id: id,
                          geometry: g,
                      };
                  })();

        if (!payload) {
            setMismatchWarning("Set geometry on the map before choosing a township override.");
            return;
        }

        void validateEntityAdminAreaManual(payload).then((result) => {
            if (cancelled) {
                return;
            }
            if (result.valid) {
                setMismatchWarning(null);
                return;
            }
            setMismatchWarning(
                result.message ?? "Selected township does not contain or intersect this geometry.",
            );
        });

        return () => {
            cancelled = true;
        };
    }, [config, geometry, manualOverride, selectedAdminAreaId]);

    useEffect(() => {
        if (!manualOverride || usesRecommendApplyInfer) {
            return;
        }
        let cancelled = false;
        setOptionsLoading(true);
        void getAdminAreaOptions({ limit: 2000, townshipOnly: true })
            .then((rows) => {
                if (!cancelled) {
                    setTownshipOptions(rows);
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setOptionsLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [manualOverride, usesRecommendApplyInfer]);

    useEffect(() => {
        if (!usesRecommendApplyInfer || !manualOverride || !selectedAdminAreaId) {
            setSelectedRoadTownship(null);
            return;
        }
        let cancelled = false;
        void searchRoadTownshipAdminAreaOptions({ q: selectedAdminAreaId, limit: 1 }).then((rows) => {
            if (!cancelled) {
                setSelectedRoadTownship(rows[0] ?? null);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [usesRecommendApplyInfer, manualOverride, selectedAdminAreaId]);

    const displayCalculated =
        calculatedLabel ??
        (calculatedId ? `Township id ${calculatedId}` : inferLoading ? "Calculating…" : "No township match");

    const saveBlocked = manualOverride && Boolean(mismatchWarning) && !canAdminOverride;

    const restoreStoredAdminAreaId = useCallback(() => {
        setValue(
            config.adminAreaIdKey as keyof CoreEntityFormValues,
            storedCurrentAdminAreaIdRef.current,
            { shouldDirty: false },
        );
        setValue(manualOverrideKey as keyof CoreEntityFormValues, false, { shouldDirty: false });
        setValue(explicitClearKey as keyof CoreEntityFormValues, false, { shouldDirty: false });
        setMismatchWarning(null);
        appliedRecommendationIdRef.current = null;
        setRecommendationApplied(false);
    }, [config.adminAreaIdKey, explicitClearKey, manualOverrideKey, setValue]);

    const recommendedTownshipId = roadAudit.recommendedTownship?.id ?? null;
    const showApplyRecommendation =
        usesRecommendApplyInfer &&
        !inferLoading &&
        !inferError &&
        roadAudit.status === "recommendation_found" &&
        Boolean(recommendedTownshipId) &&
        !recommendationApplied;

    const handleApplyRecommendation = useCallback(() => {
        if (!recommendedTownshipId) {
            return;
        }
        appliedRecommendationIdRef.current = recommendedTownshipId;
        setValue(config.adminAreaIdKey as keyof CoreEntityFormValues, recommendedTownshipId, {
            shouldDirty: true,
        });
        setValue(manualOverrideKey as keyof CoreEntityFormValues, true, { shouldDirty: true });
        setValue(explicitClearKey as keyof CoreEntityFormValues, false, { shouldDirty: true });
        setRecommendationApplied(true);
    }, [config.adminAreaIdKey, explicitClearKey, manualOverrideKey, recommendedTownshipId, setValue]);

    useEffect(() => {
        if (!usesRecommendApplyInfer) {
            return;
        }
        syncRecommendationAppliedState(recommendedTownshipId, selectedAdminAreaId);
    }, [
        usesRecommendApplyInfer,
        recommendedTownshipId,
        selectedAdminAreaId,
        syncRecommendationAppliedState,
    ]);

    const inferGeometryLabel =
        config.entityKind === "landuse"
            ? "landuse footprint"
            : config.entityKind === "bus_stop"
              ? "bus stop location"
              : "road centerline";
    const entitySaveNoun =
        config.entityKind === "landuse"
            ? "landuse"
            : config.entityKind === "bus_stop"
              ? "bus stop"
              : "road";

    return (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-3">
            {usesRecommendApplyInfer ? (
                <div>
                    <span className="mb-1 block text-sm font-medium text-slate-700">Township</span>
                    <RoadTownshipAuditPanel
                        loading={inferLoading}
                        error={inferError}
                        audit={roadAudit}
                        storedAdminAreaId={storedAdminAreaId ?? ""}
                        selectedAdminAreaId={selectedAdminAreaId}
                    />
                    {showApplyRecommendation ? (
                        <button
                            type="button"
                            disabled={disabled}
                            onClick={handleApplyRecommendation}
                            className="mt-2 inline-flex rounded-md border border-yellow-300 bg-white px-3 py-1.5 text-sm font-medium text-yellow-950 shadow-sm hover:bg-yellow-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                            Apply recommendation
                        </button>
                    ) : null}
                    {recommendationApplied ? (
                        <p className="mt-2 text-xs font-medium text-green-800">
                            Recommendation applied to form. Save the {entitySaveNoun} to persist, or override
                            manually below.
                        </p>
                    ) : null}
                    <p className="mt-1 text-xs text-slate-500">
                        Township is checked in the background from the {inferGeometryLabel}. Use Apply
                        recommendation to copy the suggested township into the form without saving.
                    </p>
                </div>
            ) : (
                <div>
                    <span className="mb-1 block text-sm font-medium text-slate-700">Township (from geometry)</span>
                    <p className="text-sm text-slate-800">{displayCalculated}</p>
                    {inferError ? <p className="mt-1 text-sm text-amber-800">{inferError}</p> : null}
                    <p className="mt-1 text-xs text-slate-500">
                        Assigned automatically from the map. Country, region, district, and ward cannot be used
                        here.
                    </p>
                </div>
            )}

            <Controller
                name={manualOverrideKey}
                control={control}
                render={({ field }) => (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                        <input
                            id={`${baseId}-override`}
                            type="checkbox"
                            checked={Boolean(field.value)}
                            disabled={disabled}
                            onChange={(e) => {
                                const checked = e.target.checked;
                                field.onChange(checked);
                                if (checked && usesRecommendApplyInfer) {
                                    setValue(explicitClearKey as keyof CoreEntityFormValues, false, {
                                        shouldDirty: true,
                                    });
                                }
                                if (!checked) {
                                    if (usesRecommendApplyInfer) {
                                        restoreStoredAdminAreaId();
                                    } else {
                                        setValue(
                                            config.adminAreaIdKey as keyof CoreEntityFormValues,
                                            calculatedId ?? "",
                                            { shouldDirty: true },
                                        );
                                        setMismatchWarning(null);
                                    }
                                }
                            }}
                            className="h-4 w-4 rounded border-slate-300"
                        />
                        <span>Override township manually</span>
                    </label>
                )}
            />

            {manualOverride ? (
                <Controller
                    name={config.adminAreaIdKey}
                    control={control}
                    render={({ field: f }) =>
                        usesRecommendApplyInfer ? (
                            <RoadTownshipAdminAreaCombobox
                                id={`${baseId}-picker`}
                                value={String(f.value ?? "").trim() || null}
                                onChange={(id) => {
                                    f.onChange(id ?? "");
                                    setValue(
                                        explicitClearKey as keyof CoreEntityFormValues,
                                        !id || !String(id).trim(),
                                        { shouldDirty: true },
                                    );
                                }}
                                disabled={disabled}
                                placeholder="Search township…"
                            />
                        ) : (
                            <AdminAreaCombobox
                                id={`${baseId}-picker`}
                                value={String(f.value ?? "").trim() || null}
                                onChange={(id) => f.onChange(id ?? "")}
                                disabled={disabled}
                                placeholder="Search township…"
                                options={townshipOptions}
                                optionsLoading={optionsLoading}
                            />
                        )
                    }
                />
            ) : null}

            {manualOverride && selectedAdminAreaId ? (
                <p className="text-xs text-slate-600">
                    Selected:{" "}
                    {formatAdminAreaOptionLabel(
                        usesRecommendApplyInfer
                            ? (selectedRoadTownship ?? {
                                  id: selectedAdminAreaId,
                                  canonical_name: selectedAdminAreaId,
                                  name_mm: null,
                                  name_en: null,
                                  admin_level_id: "",
                                  admin_level_code: "township",
                                  parent_id: null,
                              })
                            : (townshipOptions.find((o) => o.id === selectedAdminAreaId) ?? {
                                  id: selectedAdminAreaId,
                                  canonical_name: selectedAdminAreaId,
                                  name_mm: null,
                                  name_en: null,
                                  admin_level_id: "",
                                  admin_level_code: "township",
                                  parent_id: null,
                              }),
                    )}
                </p>
            ) : null}

            {mismatchWarning ? (
                <p className="text-sm text-amber-900" role="alert">
                    {mismatchWarning}
                    {!canAdminOverride
                        ? " Saving is blocked until you pick a matching township or use the calculated value."
                        : " You have admin override permission and may save anyway."}
                </p>
            ) : null}

            {saveBlocked ? (
                <p className="text-sm font-medium text-red-600" data-township-save-blocked="true">
                    Save blocked: township does not match geometry.
                </p>
            ) : null}

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>
    );
}

/** Returns an error message when save must be blocked, or null when OK. */
export function townshipAdminSaveBlockMessage(values: CoreEntityFormValues): string | null {
    if (!values.admin_area_manual_override) {
        return null;
    }
    if (typeof document === "undefined") {
        return null;
    }
    if (document.querySelector("[data-township-save-blocked]")) {
        return "Selected township does not match geometry. Admin override is required.";
    }
    return null;
}
