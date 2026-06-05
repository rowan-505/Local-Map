"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";

import DataReviewMapHeaderControls from "@/src/components/map/DataReviewMapHeaderControls";
import { fitMapToReviewCandidate, type DataReviewBasemapMode } from "@/src/components/map/dataReviewBasemap";
import { MAP_PREVIEW_CARD_CLASS } from "@/src/components/map/mapPreviewUi";
import StreetEditorMap from "@/src/components/streets/StreetEditorMap";
import { prepareLocalStreetGeometryForSave } from "@/src/features/streets/streetSaveLocalChecks";
import { STREET_SURFACE_PRESETS } from "@/src/features/streets/streetSurfaces";
import {
    patchImportReviewRoadColumns,
    postImportReviewRoadValidateRouting,
    type ImportReviewBuildingListItem,
    type ImportReviewGeoJson,
    type ImportReviewRoadRoutingValidationResponse,
    type RoadDryRunItemResult,
    type StreetLineStringGeoJson,
} from "@/src/lib/api";
import ImportReviewRoadStructuredValidation from "@/src/features/import-review/components/ImportReviewRoadStructuredValidation";
import {
    bundleFromRoutingValidation,
    bundleFromRow,
    ValidationSummaryBanner,
    ValidationModeBanner,
    ApprovalGuidanceNote,
} from "@/src/lib/importReviewRoadDrawerValidation";
import { ImportReviewRoadOverridesSaveError } from "@/src/features/import-review/api/importReviewApiErrors";
import {
    resolveImportReviewRoadClassValue,
} from "@/src/features/import-review/utils/importReviewRoadClassResolver";
import {
    typedColumnFields,
    resolveRoadClassForSave,
    roadEditorSeedFromRow,
} from "@/src/lib/importReviewRoadEditorState";
import {
    deriveRoadDisplayStreetName,
} from "@/src/features/import-review/utils/importReviewRoadListDisplay";
import {
    IMPORT_REVIEW_NAME_EN_HELPER,
    IMPORT_REVIEW_NAME_MM_HELPER,
} from "@/src/features/import-review/utils/importReviewNameFields";
import { labelWithEssentialMarker } from "@/src/features/import-review/config/essentialFields";
import { buildRoadReviewOverridesPatch } from "@/src/features/import-review/utils/importReviewRoadOverridesPayload";
import {
    roadClassOptionsFromFormOptions,
    selectOptionsWithCurrentValue,
    surfacePresetOptionsFromFormOptions,
    toAdminAreaComboboxOptions,
} from "@/src/features/import-review/utils/formOptionsUtils";
import type { ImportReviewFormOptionsBundle } from "@/src/features/import-review/hooks/useImportReviewFormOptions";
import AdminAreaCombobox from "@/src/components/admin-areas/AdminAreaCombobox";

export type ImportReviewRoadMutationScope = {
    review_batch_id?: string;
    source_snapshot_version?: string;
};

type Props = {
    row: ImportReviewBuildingListItem;
    mutationScope: ImportReviewRoadMutationScope;
    canEdit: boolean;
    selectCls: string;
    onSaved: (row: ImportReviewBuildingListItem) => void;
    onValidated?: (result: ImportReviewRoadRoutingValidationResponse) => void;
    formOptions?: ImportReviewFormOptionsBundle | null;
    formOptionsLoading?: boolean;
    formOptionsError?: string;
    dryRunItem?: RoadDryRunItemResult | null;
};

function hasMutationScope(scope: ImportReviewRoadMutationScope): boolean {
    return Boolean(scope.review_batch_id?.trim() || scope.source_snapshot_version?.trim());
}

function InlineAlert({
    message,
    tone = "red",
}: {
    message: string;
    tone?: "red" | "amber";
}) {
    const cls =
        tone === "amber"
            ? "border-amber-200 bg-amber-50 text-amber-950"
            : "border-red-200 bg-red-50 text-red-900";
    return <div className={`rounded-md border px-2 py-1.5 text-xs ${cls}`}>{message}</div>;
}

export default function ImportReviewRoadOverridesPanel({
    row,
    mutationScope,
    canEdit,
    selectCls,
    onSaved,
    onValidated,
    formOptions = null,
    formOptionsLoading = false,
    formOptionsError = "",
    dryRunItem = null,
}: Props) {
    const promoted = (row.promotion_status ?? "").toLowerCase() === "promoted";
    const disabled = !canEdit || promoted;

    const roadClasses = useMemo(
        () => roadClassOptionsFromFormOptions(formOptions),
        [formOptions]
    );
    const adminAreaOptions = useMemo(() => toAdminAreaComboboxOptions(formOptions), [formOptions]);
    const surfacePresets = useMemo(() => {
        const fromApi = surfacePresetOptionsFromFormOptions(formOptions);
        if (fromApi.length > 0) {
            return fromApi;
        }
        return STREET_SURFACE_PRESETS.filter((p) => p.value !== "");
    }, [formOptions]);
    const surfacePresetValues = useMemo(
        () => new Set(surfacePresets.map((p) => p.value)),
        [surfacePresets]
    );

    const optionsLoading = formOptionsLoading;
    const optionsError = formOptionsError;

    const [nameMm, setNameMm] = useState("");
    const [nameEn, setNameEn] = useState("");
    const [roadClassId, setRoadClassId] = useState("");
    const [adminAreaId, setAdminAreaId] = useState<string | null>(null);
    const [isOneway, setIsOneway] = useState(false);
    const [surface, setSurface] = useState("");
    const [bridge, setBridge] = useState(false);
    const [tunnel, setTunnel] = useState(false);
    const [layer, setLayer] = useState("");
    const [access, setAccess] = useState("");
    const [speedKph, setSpeedKph] = useState("");
    const [showVertices, setShowVertices] = useState(false);
    const [overridesReviewNote, setOverridesReviewNote] = useState("");
    const [editableGeometry, setEditableGeometry] = useState<StreetLineStringGeoJson | null>(null);
    const [multiLineWarning, setMultiLineWarning] = useState<string | null>(null);
    const [geometryLoadNotice, setGeometryLoadNotice] = useState<string | null>(null);
    const [mapHydrateEpoch, setMapHydrateEpoch] = useState(0);
    const [streetMapRefreshKey, setStreetMapRefreshKey] = useState(0);
    const [basemapMode, setBasemapMode] = useState<DataReviewBasemapMode>("map");
    const mapInstanceRef = useRef<maplibregl.Map | null>(null);

    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState("");
    const [saveSuccessMessage, setSaveSuccessMessage] = useState("");
    const [roadClassError, setRoadClassError] = useState("");
    const [pendingRoutingWarnings, setPendingRoutingWarnings] = useState<string[]>([]);
    const [geometryError, setGeometryError] = useState("");
    const [validating, setValidating] = useState(false);
    const [validateError, setValidateError] = useState("");
    const [lastValidation, setLastValidation] = useState<ImportReviewRoadRoutingValidationResponse | null>(
        null,
    );

    const [geometryDirty, setGeometryDirty] = useState(false);
    const geometryDirtyRef = useRef(false);
    const initialHadGeometryRef = useRef(false);
    const baselineOnewayRef = useRef(false);

    const roadClassSelectOptions = useMemo(() => {
        const base = roadClasses.map((rc) => ({
            value: rc.id,
            label: `${rc.code} — ${rc.name}`,
        }));
        const resolved = resolveImportReviewRoadClassValue(row, roadClasses);
        const currentLabel =
            roadClasses.find((rc) => rc.id === roadClassId)?.code ??
            resolved.displayLabel ??
            null;
        return selectOptionsWithCurrentValue(base, roadClassId, currentLabel);
    }, [roadClasses, roadClassId, row]);

    const hydrateFromRow = useCallback(
        (target: ImportReviewBuildingListItem) => {
            const seed = roadEditorSeedFromRow(target, roadClasses);
            setNameMm(seed.nameMm);
            setNameEn(seed.nameEn);
            setRoadClassId(seed.roadClassId);
            setAdminAreaId(seed.adminAreaId);
            setIsOneway(seed.isOneway);
            baselineOnewayRef.current = seed.isOneway;
            setSurface(seed.surface);
            setBridge(seed.bridge);
            setTunnel(seed.tunnel);
            setLayer(seed.layer);
            setAccess(seed.access);
            setSpeedKph(seed.speedKph);
            setOverridesReviewNote(seed.overridesReviewNote);
            setEditableGeometry(seed.line);
            setMultiLineWarning(seed.multiLineWarning);
            setGeometryLoadNotice(seed.geometryLoadNotice);
            initialHadGeometryRef.current = Boolean(seed.line);
            geometryDirtyRef.current = false;
            setGeometryDirty(false);
            setMapHydrateEpoch((e) => e + 1);
            setGeometryError("");
            setSaveError("");
            setSaveSuccessMessage("");
        },
        [roadClasses],
    );

    useEffect(() => {
        if (optionsLoading) {
            return;
        }
        hydrateFromRow(row);
    }, [row, roadClasses, optionsLoading, hydrateFromRow]);

    useEffect(() => {
        if (optionsLoading || roadClassId.trim() !== "" || roadClasses.length === 0) {
            return;
        }
        const resolved = resolveImportReviewRoadClassValue(row, roadClasses);
        if (resolved.roadClassId) {
            setRoadClassId(resolved.roadClassId);
        }
        if (
            process.env.NODE_ENV === "development" &&
            row.external_id === "osm:W:1361455046"
        ) {
            console.debug("[import-review/roads] road class seed", {
                external_id: row.external_id,
                listLabel: resolved.displayLabel,
                dropdownId: resolved.roadClassId,
                roadClassCode: resolved.roadClassCode,
                source: resolved.resolutionSource,
            });
        }
    }, [optionsLoading, roadClasses, row, roadClassId]);

    useEffect(() => {
        setLastValidation(null);
        setPendingRoutingWarnings([]);
        setRoadClassError("");
    }, [row.id]);

    const rowValidationBundle = useMemo(() => bundleFromRow(row), [row]);
    const displayValidationBundle = useMemo(
        () => (lastValidation ? bundleFromRoutingValidation(lastValidation) : rowValidationBundle),
        [lastValidation, rowValidationBundle],
    );
    const displayStreetName = useMemo(() => deriveRoadDisplayStreetName(row), [row]);

    const handleLineChange = useCallback((line: StreetLineStringGeoJson | null) => {
        geometryDirtyRef.current = true;
        setGeometryDirty(true);
        setEditableGeometry(line);
        setGeometryError("");
    }, []);

    const surfaceListId = `import-review-road-surface-${row.id}`;
    const presetSelectValue =
        surface && surfacePresetValues.has(surface) ? surface : surface !== "" ? "__custom__" : "";

    const snapExcludePublicId =
        (row.matched_core_table ?? "").toLowerCase().includes("street") && row.matched_core_id
            ? row.matched_core_id
            : null;

    const hasRenderableLine = Boolean(
        editableGeometry &&
            editableGeometry.type === "LineString" &&
            editableGeometry.coordinates.length >= 2,
    );

    const handleFitGeometry = useCallback(() => {
        const map = mapInstanceRef.current;
        if (!map || !map.isStyleLoaded()) {
            return;
        }
        const line = editableGeometry;
        if (!line || line.coordinates.length < 2) {
            return;
        }
        fitMapToReviewCandidate(map, line, "line", { duration: 550 });
    }, [editableGeometry]);

    const handleMapInstance = useCallback((map: maplibregl.Map | null) => {
        mapInstanceRef.current = map;
        if (map && map.isStyleLoaded() && hasRenderableLine && editableGeometry) {
            fitMapToReviewCandidate(map, editableGeometry, "line", { duration: 0 });
        }
    }, [editableGeometry, hasRenderableLine]);

    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map || !map.isStyleLoaded() || !hasRenderableLine || !editableGeometry) {
            return;
        }
        fitMapToReviewCandidate(map, editableGeometry, "line", { duration: 650 });
    }, [mapHydrateEpoch, hasRenderableLine, editableGeometry]);

    useEffect(() => {
        const map = mapInstanceRef.current;
        if (!map || !editableGeometry || editableGeometry.coordinates.length < 2) {
            return;
        }
        const start = editableGeometry.coordinates[0];
        const end = editableGeometry.coordinates[editableGeometry.coordinates.length - 1];
        if (!start || !end) {
            return;
        }
        const sourceId = "import-review-road-endpoints";
        const startLayerId = "import-review-road-endpoint-start";
        const endLayerId = "import-review-road-endpoint-end";
        const fc: GeoJSON.FeatureCollection = {
            type: "FeatureCollection",
            features: [
                {
                    type: "Feature",
                    properties: { role: "start" },
                    geometry: { type: "Point", coordinates: start },
                },
                {
                    type: "Feature",
                    properties: { role: "end" },
                    geometry: { type: "Point", coordinates: end },
                },
            ],
        };
        const apply = () => {
            if (map.getSource(sourceId)) {
                (map.getSource(sourceId) as maplibregl.GeoJSONSource).setData(fc);
            } else {
                map.addSource(sourceId, { type: "geojson", data: fc });
                map.addLayer({
                    id: startLayerId,
                    type: "circle",
                    source: sourceId,
                    filter: ["==", ["get", "role"], "start"],
                    paint: { "circle-radius": 6, "circle-color": "#059669", "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
                });
                map.addLayer({
                    id: endLayerId,
                    type: "circle",
                    source: sourceId,
                    filter: ["==", ["get", "role"], "end"],
                    paint: { "circle-radius": 6, "circle-color": "#dc2626", "circle-stroke-width": 2, "circle-stroke-color": "#fff" },
                });
            }
        };
        if (map.isStyleLoaded()) {
            apply();
        } else {
            map.once("load", apply);
        }
    }, [editableGeometry, mapHydrateEpoch]);

    async function runValidateRouting(confirmWarnings: boolean) {
        if (!hasMutationScope(mutationScope)) {
            setValidateError("Apply filters with review_batch_id or source snapshot version first.");
            return;
        }
        setValidating(true);
        setValidateError("");
        try {
            const result = await postImportReviewRoadValidateRouting(row.id, {
                ...mutationScope,
                use_fields: true,
                connectivity_threshold_m: 10,
                duplicate_threshold_m: 5,
                confirm_warnings: confirmWarnings,
            });
            setLastValidation(result);
            onValidated?.(result);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Validation failed";
            if (!confirmWarnings && msg.toLowerCase().includes("confirm")) {
                if (window.confirm(`${msg}\n\nRun validation acknowledging warnings?`)) {
                    setValidating(false);
                    await runValidateRouting(true);
                    return;
                }
            }
            setValidateError(msg);
        } finally {
            setValidating(false);
        }
    }

    async function submitOverrides() {
        if (!hasMutationScope(mutationScope)) {
            setSaveError("Apply filters with review_batch_id or source snapshot version first.");
            return;
        }

        const hasRenderableGeometry =
            Boolean(
                editableGeometry &&
                    editableGeometry.type === "LineString" &&
                    editableGeometry.coordinates.length >= 2
            ) || initialHadGeometryRef.current;

        const resolvedClass = resolveRoadClassForSave({
            roadClassId,
            row,
            roadClassOptions: roadClasses,
            hasGeometry: hasRenderableGeometry,
        });
        if (!resolvedClass.ok) {
            setRoadClassError(resolvedClass.message);
            setSaveError("");
            return;
        }
        setRoadClassError("");

        let fieldsPatch: Record<string, unknown>;
        let includeGeom = false;
        let geomPayload: ImportReviewGeoJson | null = null;

        try {
            if (geometryDirtyRef.current) {
                const prep = prepareLocalStreetGeometryForSave(editableGeometry);
                if (!prep.ok) {
                    setGeometryError(prep.message);
                    return;
                }
                includeGeom = true;
                geomPayload = prep.sanitized as ImportReviewGeoJson;
            } else if (!initialHadGeometryRef.current) {
                const prep = prepareLocalStreetGeometryForSave(editableGeometry);
                if (!prep.ok) {
                    setGeometryError("Draw a centerline on the map before saving.");
                    return;
                }
                includeGeom = true;
                geomPayload = prep.sanitized as ImportReviewGeoJson;
            }

            fieldsPatch = buildRoadReviewOverridesPatch({
                nameMm,
                nameEn,
                roadClassId: resolvedClass.roadClassId,
                roadClassCode: resolvedClass.roadClassCode,
                adminAreaId,
                surface,
                isOneway,
                bridge,
                tunnel,
                layer,
                access,
                speedKph,
                confidenceScore: row.confidence_score,
                geom: geomPayload,
                includeGeom,
            });
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Invalid direct-edit values.");
            return;
        }

        const noteTrimmed = overridesReviewNote.trim();
        const onewayChanged = isOneway !== baselineOnewayRef.current;
        const review_note =
            noteTrimmed.length > 0
                ? noteTrimmed
                : onewayChanged
                  ? "Reviewed one-way change during import-review direct edit."
                  : null;

        setSaving(true);
        setSaveError("");
        setSaveSuccessMessage("");
        setGeometryError("");

        try {
            const updated = await patchImportReviewRoadColumns(row.id, {
                ...mutationScope,
                fields: fieldsPatch,
                review_note,
            });
            onSaved(updated);
            hydrateFromRow(updated);
            setStreetMapRefreshKey((k) => k + 1);
            setPendingRoutingWarnings([]);
            setSaveSuccessMessage("Saved changes.");
        } catch (err) {
            if (err instanceof ImportReviewRoadOverridesSaveError) {
                if (err.issues.errors.length > 0) {
                    setPendingRoutingWarnings([]);
                    setSaveError(
                        err.issues.errors.length === 1
                            ? err.issues.errors[0]!
                            : err.issues.errors.map((e) => `• ${e}`).join("\n")
                    );
                    return;
                }
                if (err.issues.warnings.length > 0) {
                    setPendingRoutingWarnings(err.issues.warnings);
                    setSaveError("");
                    return;
                }
            }

            const msg = err instanceof Error ? err.message : "Failed to save road candidate";
            setSaveError(msg);
        } finally {
            setSaving(false);
        }
    }

    function handleSaveOverrides() {
        void submitOverrides();
    }

    return (
        <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/30 p-4">
            <div>
                <h3 className="text-xs font-semibold uppercase text-violet-900">Edit candidate</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-violet-950/85">
                    Saves name, road class, surface, one-way, and centerline to typed road candidate columns with
                    routing-safe validation. Does not promote to core.
                </p>
                {promoted ? (
                    <p className="mt-1 text-[11px] font-semibold text-red-800">
                        promotion_status=promoted — edits are blocked.
                    </p>
                ) : null}
                {rowValidationBundle.errors.length > 0 ? (
                    <p className="mt-2 text-[11px] text-red-900/90">
                        Current validation has {rowValidationBundle.errors.length} blocking error
                        {rowValidationBundle.errors.length === 1 ? "" : "s"}. See Routing Validation section.
                    </p>
                ) : rowValidationBundle.warnings.length > 0 ? (
                    <p className="mt-2 text-[11px] text-amber-900/90">
                        Current validation has {rowValidationBundle.warnings.length} warning
                        {rowValidationBundle.warnings.length === 1 ? "" : "s"}. See Routing Validation section.
                    </p>
                ) : null}
            </div>

            {optionsError ? <InlineAlert message={optionsError} /> : null}
            {multiLineWarning ? <InlineAlert message={multiLineWarning} tone="amber" /> : null}
            {geometryLoadNotice ? <InlineAlert message={geometryLoadNotice} tone="amber" /> : null}

            {pendingRoutingWarnings.length > 0 ? (
                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-950">Routing continuity warnings</p>
                    <p className="text-xs text-amber-950/90">
                        Routing warning only — does not block save, approval, or promotion.
                    </p>
                    <ul className="list-inside list-disc space-y-1 text-xs text-amber-950/90">
                        {pendingRoutingWarnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {(geometryError || saveError || saveSuccessMessage || roadClassError) && (
                <div className="space-y-2">
                    {roadClassError ? <InlineAlert message={roadClassError} tone="red" /> : null}
                    {geometryError ? <InlineAlert message={geometryError} tone="amber" /> : null}
                    {saveSuccessMessage ? (
                        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-950">
                            {saveSuccessMessage}
                        </div>
                    ) : null}
                    {saveError ? (
                        <div className="whitespace-pre-wrap rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-900">
                            {saveError}
                        </div>
                    ) : null}
                </div>
            )}

            <section className="space-y-2 rounded-lg border border-teal-200 bg-teal-50/40 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-teal-900">
                        Road validation
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={saving || disabled || optionsLoading}
                            onClick={handleSaveOverrides}
                            className="rounded-lg border border-violet-700 bg-violet-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-900 disabled:opacity-50"
                        >
                            {saving ? "Saving…" : "Save Changes"}
                        </button>
                        <button
                            type="button"
                            disabled={validating || disabled || optionsLoading}
                            onClick={() => void runValidateRouting(false)}
                            className="rounded-lg border border-teal-700 bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
                        >
                            {validating ? "Revalidating road…" : "Re-run road validation"}
                        </button>
                    </div>
                </div>
                {validateError ? <InlineAlert message={validateError} /> : null}
                <ImportReviewRoadStructuredValidation
                    errors={displayValidationBundle.errors}
                    warnings={displayValidationBundle.warnings}
                    info={displayValidationBundle.info}
                    stats={lastValidation?.stats ?? displayValidationBundle.stats}
                    canApprove={lastValidation?.can_approve ?? displayValidationBundle.canApprove}
                    dryRunItem={dryRunItem}
                />
            </section>

            <section className="space-y-2 rounded-lg border border-teal-100 bg-white/90 p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-800">Names</h4>
                <p className="text-[11px] text-gray-600">
                    Saved to candidate <span className="font-mono">name_mm</span> /{" "}
                    <span className="font-mono">name_en</span> columns — separate from road class and surface.
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                    Myanmar name
                    <span className="text-[10px] font-normal text-gray-500">{IMPORT_REVIEW_NAME_MM_HELPER}</span>
                    <input
                        value={nameMm}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => setNameMm(e.target.value)}
                        className={selectCls}
                        placeholder="Myanmar street / road label (optional)"
                        autoComplete="off"
                    />
                </label>

                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                    English name
                    <span className="text-[10px] font-normal text-gray-500">{IMPORT_REVIEW_NAME_EN_HELPER}</span>
                    <input
                        value={nameEn}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => setNameEn(e.target.value)}
                        className={selectCls}
                        placeholder="English street / road label (optional)"
                        autoComplete="off"
                    />
                </label>
                </div>
            </section>

            <section className="space-y-2 rounded-lg border border-gray-200 bg-white/90 p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-800">
                    Classification & routing attributes
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                    {labelWithEssentialMarker("Road class", true)}
                    <select
                        value={roadClassId}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => {
                            setRoadClassId(e.target.value);
                            if (e.target.value.trim()) {
                                setRoadClassError("");
                            }
                        }}
                        className={selectCls}
                        aria-invalid={roadClassError ? true : undefined}
                    >
                        <option value="">Select road class…</option>
                        {roadClassSelectOptions.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    {roadClassError ? (
                        <span className="text-[11px] font-medium text-red-800">{roadClassError}</span>
                    ) : null}
                </label>

                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                    {labelWithEssentialMarker("Admin area", true)}
                    <AdminAreaCombobox
                        value={adminAreaId}
                        disabled={disabled || optionsLoading}
                        placeholder="Search admin area…"
                        onChange={setAdminAreaId}
                        options={adminAreaOptions}
                        optionsLoading={optionsLoading}
                    />
                </label>

                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                    Surface
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <select
                            aria-label="Surface preset"
                            value={presetSelectValue}
                            disabled={disabled || optionsLoading}
                            onChange={(e) => {
                                const v = e.target.value;
                                setSurface(v === "__custom__" ? "" : v);
                            }}
                            className={`${selectCls} sm:max-w-[11rem]`}
                        >
                            <option value="">Preset…</option>
                            {surfacePresets.map((p) => (
                                <option key={p.value} value={p.value}>
                                    {p.label}
                                </option>
                            ))}
                            <option value="__custom__">Custom…</option>
                        </select>
                        <input
                            value={surface}
                            disabled={disabled || optionsLoading}
                            onChange={(e) => setSurface(e.target.value)}
                            placeholder="e.g. asphalt"
                            list={surfaceListId}
                            className={`${selectCls} min-w-0 flex-1`}
                        />
                        <datalist id={surfaceListId}>
                            {surfacePresets.map((p) => (
                                <option key={p.value} value={p.value} />
                            ))}
                        </datalist>
                    </div>
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-gray-700 sm:col-span-2">
                    <input
                        type="checkbox"
                        checked={isOneway}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => setIsOneway(e.target.checked)}
                        className="rounded border-gray-300"
                    />
                    One-way
                </label>

                <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                    <input
                        type="checkbox"
                        checked={bridge}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => setBridge(e.target.checked)}
                        className="rounded border-gray-300"
                    />
                    Bridge
                </label>
                <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                    <input
                        type="checkbox"
                        checked={tunnel}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => setTunnel(e.target.checked)}
                        className="rounded border-gray-300"
                    />
                    Tunnel
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                    Layer
                    <input
                        value={layer}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => setLayer(e.target.value)}
                        className={selectCls}
                        inputMode="numeric"
                        placeholder="e.g. 1"
                    />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                    Access
                    <input
                        value={access}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => setAccess(e.target.value)}
                        className={selectCls}
                        placeholder="e.g. public"
                    />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                    Speed (kph)
                    <input
                        value={speedKph}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => setSpeedKph(e.target.value)}
                        className={selectCls}
                        inputMode="numeric"
                        placeholder="Optional"
                    />
                </label>

                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                    review_note (saved with direct edit)
                    <textarea
                        value={overridesReviewNote}
                        disabled={disabled || optionsLoading}
                        onChange={(e) => setOverridesReviewNote(e.target.value)}
                        rows={2}
                        className={selectCls}
                        placeholder="Note when changing one-way or acknowledging routing warnings"
                    />
                </label>
                </div>
            </section>

            <div className={MAP_PREVIEW_CARD_CLASS}>
                <DataReviewMapHeaderControls
                    title="Road geometry *"
                    externalId={row.external_id}
                    hasRenderable={hasRenderableLine}
                    onFit={handleFitGeometry}
                    basemapMode={basemapMode}
                    onBasemapModeChange={setBasemapMode}
                    showVerticesToggle
                    showVertices={showVertices}
                    onShowVerticesChange={setShowVertices}
                />
                <div className="p-2">
                    <StreetEditorMap
                        mapEpoch={mapHydrateEpoch}
                        seedLine={editableGeometry}
                        onLineStringChange={handleLineChange}
                        snapExcludeStreetPublicId={snapExcludePublicId}
                        selectedStreetPublicId={row.external_id}
                        selectedStreetName={displayStreetName}
                        streetSourceRefreshKey={streetMapRefreshKey}
                        streetVectorTileVersion={streetMapRefreshKey}
                        dataReviewBasemapMode={basemapMode}
                        onMapInstance={handleMapInstance}
                        mapViewportClassName="h-[280px] min-h-[260px] w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-100"
                    />
                </div>
                {!hasRenderableLine ? (
                    <p className="px-3 pb-1 text-xs text-amber-800">
                        No centerline loaded — use Draw line / Edit vertices, or open a row with geometry.
                    </p>
                ) : null}
                <p className="border-t border-gray-100 px-3 py-2 text-[11px] leading-relaxed text-gray-600">
                    Vertex drag and snap match <span className="font-medium">Streets</span>. Use{" "}
                    <span className="font-medium">Fit</span> and Map / Sat / Hyb. Green/red markers show start/end
                    endpoints. Nearby core roads render from the streets tile layer.
                </p>
            </div>

            {saveSuccessMessage ? (
                <p className="text-xs font-medium text-emerald-800">{saveSuccessMessage}</p>
            ) : null}

            <details className="rounded-lg border border-gray-200 bg-white/80">
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold uppercase text-gray-500">
                    Original source data
                </summary>
                <div className="space-y-2 border-t border-gray-100 p-3">
                    <p className="text-[10px] font-semibold uppercase text-gray-500">normalized_data</p>
                    <pre className="max-h-32 overflow-auto text-[11px]">
                        {JSON.stringify(row.normalized_data ?? null, null, 2)}
                    </pre>
                    <p className="text-[10px] font-semibold uppercase text-gray-500">source_refs</p>
                    <pre className="max-h-32 overflow-auto text-[11px]">
                        {JSON.stringify(row.source_refs ?? null, null, 2)}
                    </pre>
                </div>
            </details>
        </section>
    );
}
