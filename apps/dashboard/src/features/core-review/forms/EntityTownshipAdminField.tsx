"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { Geometry } from "geojson";
import { Controller, type Control, type UseFormSetValue, type UseFormWatch } from "react-hook-form";

import AdminAreaCombobox from "@/src/components/admin-areas/AdminAreaCombobox";
import { formatAdminAreaOptionLabel } from "@/src/components/admin-areas/adminAreaLabels";
import {
    getAdminAreaOptions,
    inferEntityAdminArea,
    validateEntityAdminAreaManual,
    type EntityAdminAreaKind,
} from "@/src/lib/api";
import { canOverrideEntityAdminAreaGeometryMismatch } from "@/src/lib/entityAdminAreaUx";
import { getFormGeometry } from "@/src/lib/core-review/geometryFieldUtils";
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
    if (geometry.type === "LineString" || geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
        return geometry;
    }
    return null;
}

export default function EntityTownshipAdminField({
    config,
    control,
    watch,
    setValue,
    disabled = false,
    error,
}: EntityTownshipAdminFieldProps) {
    const manualOverrideKey = config.manualOverrideKey ?? "admin_area_manual_override";
    const baseId = useId();

    const geometry = watch(config.geometryFieldKey as keyof CoreEntityFormValues);
    const manualOverride = Boolean(watch(manualOverrideKey as keyof CoreEntityFormValues));
    const selectedAdminId = String(watch(config.adminAreaIdKey as keyof CoreEntityFormValues) ?? "").trim();

    const [calculatedId, setCalculatedId] = useState<string | null>(null);
    const [calculatedLabel, setCalculatedLabel] = useState<string | null>(null);
    const [inferLoading, setInferLoading] = useState(false);
    const [inferError, setInferError] = useState<string | null>(null);
    const [mismatchWarning, setMismatchWarning] = useState<string | null>(null);
    const [townshipOptions, setTownshipOptions] = useState<
        Awaited<ReturnType<typeof getAdminAreaOptions>>
    >([]);
    const [optionsLoading, setOptionsLoading] = useState(false);

    const canAdminOverride = useMemo(() => canOverrideEntityAdminAreaGeometryMismatch(), []);

    const runInfer = useCallback(async () => {
        const geomValue = getFormGeometry(
            { [config.geometryFieldKey]: geometry } as CoreEntityFormValues,
            config.geometryFieldKey
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
    }, [config, geometry, manualOverride, setValue]);

    useEffect(() => {
        void runInfer();
    }, [runInfer]);

    useEffect(() => {
        if (!manualOverride) {
            setMismatchWarning(null);
            return;
        }
        const id = selectedAdminId;
        if (!id) {
            setMismatchWarning(null);
            return;
        }

        let cancelled = false;
        const geomValue = getFormGeometry(
            { [config.geometryFieldKey]: geometry } as CoreEntityFormValues,
            config.geometryFieldKey
        );

        const payload =
            config.entityKind === "place"
                ? (() => {
                      const pt = pointFromGeometry(geomValue ?? null);
                      if (!pt) {
                          return null;
                      }
                      return {
                          kind: "place" as const,
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
                result.message ??
                    "Selected township does not contain or intersect this geometry."
            );
        });

        return () => {
            cancelled = true;
        };
    }, [config, geometry, manualOverride, selectedAdminId]);

    useEffect(() => {
        if (!manualOverride) {
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
    }, [manualOverride]);

    const displayCalculated =
        calculatedLabel ??
        (calculatedId ? `Township id ${calculatedId}` : inferLoading ? "Calculating…" : "No township match");

    const saveBlocked =
        manualOverride &&
        Boolean(mismatchWarning) &&
        !canAdminOverride;

    return (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-3">
            <div>
                <span className="mb-1 block text-sm font-medium text-slate-700">Township (from geometry)</span>
                <p className="text-sm text-slate-800">{displayCalculated}</p>
                {inferError ? <p className="mt-1 text-sm text-amber-800">{inferError}</p> : null}
                <p className="mt-1 text-xs text-slate-500">
                    Assigned automatically from the map. Country, region, district, and ward cannot be used here.
                </p>
            </div>

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
                                if (!checked) {
                                    setValue(
                                        config.adminAreaIdKey as keyof CoreEntityFormValues,
                                        calculatedId ?? "",
                                        { shouldDirty: true }
                                    );
                                    setMismatchWarning(null);
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
                    render={({ field: f }) => (
                        <AdminAreaCombobox
                            id={`${baseId}-picker`}
                            value={String(f.value ?? "").trim() || null}
                            onChange={(id) => f.onChange(id ?? "")}
                            disabled={disabled}
                            placeholder="Search township…"
                            options={townshipOptions}
                            optionsLoading={optionsLoading}
                        />
                    )}
                />
            ) : null}

            {manualOverride && selectedAdminId ? (
                <p className="text-xs text-slate-600">
                    Selected:{" "}
                    {formatAdminAreaOptionLabel(
                        townshipOptions.find((o) => o.id === selectedAdminId) ?? {
                            id: selectedAdminId,
                            canonical_name: selectedAdminId,
                            name_mm: null,
                            name_en: null,
                            admin_level_id: "",
                            admin_level_code: "township",
                            parent_id: null,
                        }
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
