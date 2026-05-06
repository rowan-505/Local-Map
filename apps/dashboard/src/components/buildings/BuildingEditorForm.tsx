"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Map as MaplibreMap } from "maplibre-gl";

import BuildingEditorMap, {
    hasDrawableBuildingPolygon,
    type BuildingEditorMapDrawOutput,
} from "@/src/components/buildings/BuildingEditorMap";
import {
    getBuildingTypes,
    type Building,
    type BuildingGeometry,
    type CreateBuildingPayload,
    type RefBuildingType,
} from "@/src/lib/api";
import { scheduleBuildingTileRefresh } from "@/src/components/map/placeMapConfig";
import { useBuildingTileVersion } from "@/src/components/map/BuildingTileVersionContext";

function isBuildingGeometry(value: unknown): value is BuildingGeometry {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }

    const o = value as { type?: unknown; coordinates?: unknown };

    if (o.type === "Polygon" && Array.isArray(o.coordinates)) {
        return true;
    }

    if (o.type === "MultiPolygon" && Array.isArray(o.coordinates)) {
        return true;
    }

    return false;
}

/** Used only if GET /building-types fails so the form can still render. */
const EMERGENCY_REF_BUILDING_TYPES_FALLBACK: RefBuildingType[] = [];

export type BuildingEditorFormProps = {
    title: string;
    description?: string;
    cancelHref: string;
    submitLabel: string;
    initialBuilding?: Building | null;
    /** Fires after client-side validation passes, immediately before `onSubmit` is awaited. */
    onCommit?: () => void;
    onSubmit: (payload: CreateBuildingPayload) => Promise<void>;
};

export default function BuildingEditorForm({
    title,
    description,
    cancelHref,
    submitLabel,
    initialBuilding,
    onCommit,
    onSubmit,
}: BuildingEditorFormProps) {
    const [geometryJson, setGeometryJson] = useState("");
    const [name, setName] = useState("");
    const [buildingTypeId, setBuildingTypeId] = useState("");
    const [refTypes, setRefTypes] = useState<RefBuildingType[]>([]);
    const [refTypesLoading, setRefTypesLoading] = useState(true);
    const [refTypesError, setRefTypesError] = useState<string | null>(null);
    const [levels, setLevels] = useState("");
    const [heightM, setHeightM] = useState("");
    const [confidenceScore, setConfidenceScore] = useState("80");
    const [isVerified, setIsVerified] = useState(false);
    const [error, setError] = useState("");
    /** Shown only in BuildingEditorMap debug panel after a failed `onSubmit` (not client-side validation). */
    const [submitApiError, setSubmitApiError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const submitLockRef = useRef(false);
    const editorMapSurfaceRef = useRef<MaplibreMap | null>(null);
    const { bumpBuildingTileVersion } = useBuildingTileVersion();

    const handleDrawOutput = useCallback((output: BuildingEditorMapDrawOutput) => {
        setGeometryJson(output.geometryJson);
    }, []);

    const loadRefTypes = useCallback(async () => {
        setRefTypesLoading(true);
        setRefTypesError(null);
        try {
            const data = await getBuildingTypes();
            setRefTypes(data);
        } catch (err) {
            setRefTypes(EMERGENCY_REF_BUILDING_TYPES_FALLBACK);
            setRefTypesError(err instanceof Error ? err.message : "Could not load building types.");
        } finally {
            setRefTypesLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadRefTypes();
    }, [loadRefTypes]);

    useEffect(() => {
        if (!initialBuilding) {
            return;
        }

        setGeometryJson(
            initialBuilding.geometry
                ? JSON.stringify(initialBuilding.geometry, null, 2)
                : ""
        );
        setName(initialBuilding.name ?? "");
        const resolvedId =
            initialBuilding.building_type_id ??
            initialBuilding.building_type?.id ??
            null;
        setBuildingTypeId(
            resolvedId !== null && resolvedId !== undefined && String(resolvedId).length > 0
                ? String(resolvedId)
                : ""
        );
        setLevels(initialBuilding.levels != null ? String(initialBuilding.levels) : "");
        setHeightM(initialBuilding.height_m != null ? String(initialBuilding.height_m) : "");
        setConfidenceScore(
            initialBuilding.confidence_score != null
                ? String(initialBuilding.confidence_score)
                : "80"
        );
        setIsVerified(Boolean(initialBuilding.is_verified));
    }, [initialBuilding]);

    async function handleSubmit(event: React.FormEvent) {
        event.preventDefault();
        setError("");

        if (submitLockRef.current) {
            return;
        }

        let geometry: unknown;

        try {
            geometry = JSON.parse(geometryJson) as unknown;
        } catch {
            setError("Geometry must be valid JSON.");
            return;
        }

        if (!isBuildingGeometry(geometry)) {
            setError('Geometry JSON must be a GeoJSON Polygon or MultiPolygon with "coordinates".');
            return;
        }

        const payload: CreateBuildingPayload = {
            geometry,
            name: name.trim() === "" ? null : name.trim(),
        };

        const isEdit = initialBuilding != null;

        if (isEdit) {
            payload.building_type_id = buildingTypeId.trim() === "" ? null : buildingTypeId.trim();
        } else if (buildingTypeId.trim() !== "") {
            payload.building_type_id = buildingTypeId.trim();
        }

        const levelsTrimmed = levels.trim();

        if (levelsTrimmed !== "") {
            const parsedLevels = Number.parseInt(levelsTrimmed, 10);

            if (!Number.isFinite(parsedLevels) || parsedLevels < 0) {
                setError("Levels must be a non-negative integer.");
                return;
            }

            payload.levels = parsedLevels;
        }

        const heightTrimmed = heightM.trim();

        if (heightTrimmed !== "") {
            const parsedHeight = Number.parseFloat(heightTrimmed);

            if (!Number.isFinite(parsedHeight) || parsedHeight < 0) {
                setError("Height (m) must be a non-negative number.");
                return;
            }

            payload.height_m = parsedHeight;
        }

        const confTrimmed = confidenceScore.trim();
        let parsedConf: number;

        if (confTrimmed !== "") {
            parsedConf = Number.parseFloat(confTrimmed);

            if (!Number.isFinite(parsedConf)) {
                setError("Confidence score must be a number.");
                return;
            }
        } else {
            parsedConf = 80;
        }

        payload.confidence_score = parsedConf;
        payload.is_verified = isVerified;

        submitLockRef.current = true;
        setIsSubmitting(true);
        setSubmitApiError("");
        onCommit?.();

        try {
            await onSubmit(payload);
            setSubmitApiError("");
            const tileVersion = bumpBuildingTileVersion();
            scheduleBuildingTileRefresh(editorMapSurfaceRef.current, tileVersion);
        } catch (err) {
            const raw = err instanceof Error ? err.message : "Request failed";
            const looksTechnical =
                raw.length > 400 ||
                /\b(pg_|postgresql|prisma|P1012|syntax error at|violates(?: foreign key)?|duplicate key value|permission denied for relation|syntax error\b)/i.test(
                    raw
                );
            const safe = looksTechnical ? "Saving the building failed. Please try again." : raw;
            setError(safe);
            setSubmitApiError(safe);
        } finally {
            submitLockRef.current = false;
            setIsSubmitting(false);
        }
    }

    return (
        <div className="mx-auto max-w-5xl">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
                {description ? <p className="mt-1 text-sm text-gray-600">{description}</p> : null}
            </div>

            <form
                onSubmit={(e) => void handleSubmit(e)}
                className="space-y-5 rounded-lg border border-gray-200 bg-white p-6 shadow-sm"
            >
                {error ? (
                    <div className="whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        {error}
                    </div>
                ) : null}

                <div className="space-y-2">
                    <span className="block text-sm font-medium text-gray-700">Map preview</span>
                    <BuildingEditorMap
                        geometryJson={geometryJson}
                        onDrawOutput={handleDrawOutput}
                        editorMapSurfaceRef={editorMapSurfaceRef}
                        showDebugPanel
                        submissionError={submitApiError}
                    />
                </div>

                <div>
                    <label htmlFor="building-geometry" className="block text-sm font-medium text-gray-700">
                        Geometry (GeoJSON Polygon or MultiPolygon)
                    </label>
                    <textarea
                        id="building-geometry"
                        rows={12}
                        value={geometryJson}
                        onChange={(e) => setGeometryJson(e.target.value)}
                        className="mt-1 w-full rounded border border-gray-300 px-3 py-2 font-mono text-xs text-gray-900"
                        spellCheck={false}
                        placeholder='{"type":"Polygon","coordinates":[...]}'
                    />
                    {!hasDrawableBuildingPolygon(geometryJson) ? (
                        <p className="mt-1 text-xs text-amber-800">
                            Draw or paste a polygon with at least three exterior vertices before saving.
                        </p>
                    ) : null}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                        <label htmlFor="building-name" className="block text-sm font-medium text-gray-700">
                            Name (optional)
                        </label>
                        <input
                            id="building-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                        />
                    </div>

                    <div>
                        <label htmlFor="building-type-id" className="block text-sm font-medium text-gray-700">
                            Building type (optional)
                        </label>
                        {refTypesError ? (
                            <div className="mt-1 space-y-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                                <p>{refTypesError}</p>
                                <button
                                    type="button"
                                    onClick={() => void loadRefTypes()}
                                    className="text-sm font-medium text-amber-900 underline decoration-amber-700 hover:text-amber-950"
                                >
                                    Retry loading types
                                </button>
                            </div>
                        ) : null}
                        <select
                            id="building-type-id"
                            value={buildingTypeId}
                            onChange={(e) => setBuildingTypeId(e.target.value)}
                            disabled={refTypesLoading}
                            className="mt-1 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 disabled:cursor-not-allowed disabled:bg-gray-50"
                        >
                            <option value="">Select building type</option>
                            {refTypes.map((t) => (
                                <option key={t.id} value={t.id}>
                                    {t.parent_id ? `— ${t.name}` : t.name}
                                </option>
                            ))}
                        </select>
                        {refTypesLoading ? (
                            <p className="mt-1 text-xs text-gray-500">Loading building types…</p>
                        ) : null}
                    </div>

                    <div>
                        <label htmlFor="building-levels" className="block text-sm font-medium text-gray-700">
                            Levels (optional)
                        </label>
                        <input
                            id="building-levels"
                            type="text"
                            inputMode="numeric"
                            value={levels}
                            onChange={(e) => setLevels(e.target.value)}
                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                        />
                    </div>

                    <div>
                        <label htmlFor="building-height" className="block text-sm font-medium text-gray-700">
                            Height (m, optional)
                        </label>
                        <input
                            id="building-height"
                            type="text"
                            inputMode="decimal"
                            value={heightM}
                            onChange={(e) => setHeightM(e.target.value)}
                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                        />
                    </div>

                    <div>
                        <label htmlFor="building-confidence" className="block text-sm font-medium text-gray-700">
                            Confidence score
                        </label>
                        <input
                            id="building-confidence"
                            type="text"
                            inputMode="decimal"
                            value={confidenceScore}
                            onChange={(e) => setConfidenceScore(e.target.value)}
                            className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900"
                        />
                    </div>

                    <div className="flex items-end pb-2">
                        <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                            <input
                                type="checkbox"
                                checked={isVerified}
                                onChange={(e) => setIsVerified(e.target.checked)}
                                className="rounded border-gray-300"
                            />
                            Verified
                        </label>
                    </div>
                </div>

                <div className="flex flex-wrap gap-3 border-t border-gray-100 pt-4">
                    <button
                        type="submit"
                        disabled={
                            isSubmitting ||
                            !hasDrawableBuildingPolygon(geometryJson)
                        }
                        className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                    >
                        {isSubmitting ? "Saving..." : submitLabel}
                    </button>
                    <Link
                        href={cancelHref}
                        className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700"
                    >
                        Cancel
                    </Link>
                </div>
            </form>
        </div>
    );
}
