"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type maplibregl from "maplibre-gl";

import DataReviewMapHeaderControls from "@/src/components/map/DataReviewMapHeaderControls";
import { fitMapToReviewCandidate, type DataReviewBasemapMode } from "@/src/components/map/dataReviewBasemap";
import { MAP_PREVIEW_CARD_CLASS } from "@/src/components/map/mapPreviewUi";
import StreetEditorMap from "@/src/components/streets/StreetEditorMap";
import {
    ensureRoadClassSelected,
    prepareLocalStreetGeometryForSave,
} from "@/src/features/streets/streetSaveLocalChecks";
import { STREET_SURFACE_PRESETS } from "@/src/features/streets/streetSurfaces";
import {
    patchImportReviewRoadOverrides,
    postImportReviewRoadValidateRouting,
    type ImportReviewBuildingListItem,
    type ImportReviewGeoJson,
    type ImportReviewRoadRoutingValidationResponse,
    type StreetLineStringGeoJson,
} from "@/src/lib/api";
import {
    bundleFromRoutingValidation,
    bundleFromRow,
    ValidationIssuesSection,
    ValidationStatsGrid,
} from "@/src/lib/importReviewRoadDrawerValidation";
import {
    asOverrideRecord,
    parseValidationBulletsFromApiErrorMessage,
    roadEditorSeedFromRow,
    SAVE_IMPORT_REVIEW_ROAD_ROUTING_WARNINGS_CONFIRM,
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

    const roadClassIdByCode = useMemo(() => {
        const m = new Map<string, string>();
        for (const rc of roadClasses) {
            m.set(rc.code.toLowerCase(), rc.id);
        }
        return m;
    }, [roadClasses]);

    const hydrateFromRow = useCallback(
        (target: ImportReviewBuildingListItem) => {
            const seed = roadEditorSeedFromRow(target, roadClassIdByCode);
            setNameMm(seed.nameMm);
            setNameEn(seed.nameEn);
            setRoadClassId(seed.roadClassId);
            setAdminAreaId(seed.adminAreaId);
            setIsOneway(seed.isOneway);
            baselineOnewayRef.current = seed.isOneway;
            setSurface(seed.surface);
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
        [roadClassIdByCode],
    );

    useEffect(() => {
        if (optionsLoading) {
            return;
        }
        hydrateFromRow(row);
    }, [row, roadClasses, optionsLoading, hydrateFromRow]);

    useEffect(() => {
        setLastValidation(null);
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
                use_review_overrides: true,
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

    async function submitOverrides(confirmRoutingWarnings: boolean) {
        if (!hasMutationScope(mutationScope)) {
            setSaveError("Apply filters with review_batch_id or source snapshot version first.");
            return;
        }

        const rcId = roadClassId.trim() === "" ? null : ensureRoadClassSelected(roadClassId);

        let review_overrides: Record<string, unknown>;
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

            review_overrides = buildRoadReviewOverridesPatch({
                nameMm,
                nameEn,
                roadClassId: rcId ?? roadClassId,
                adminAreaId,
                surface,
                isOneway,
                confidenceScore: row.confidence_score,
                geom: geomPayload,
                includeGeom,
            });
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : "Invalid override values.");
            return;
        }

        const noteTrimmed = overridesReviewNote.trim();
        const onewayChanged = isOneway !== baselineOnewayRef.current;
        const review_note =
            noteTrimmed.length > 0
                ? noteTrimmed
                : onewayChanged
                  ? "Reviewed one-way change during import-review road override."
                  : null;

        setSaving(true);
        setSaveError("");
        setSaveSuccessMessage("");
        setGeometryError("");

        try {
            const updated = await patchImportReviewRoadOverrides(row.id, {
                ...mutationScope,
                review_overrides,
                review_note,
                confirm_acknowledge_routing_warnings: confirmRoutingWarnings,
            });
            onSaved(updated);
            hydrateFromRow(updated);
            setStreetMapRefreshKey((k) => k + 1);
            setSaveSuccessMessage("Overrides saved.");
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Failed to save road overrides";

            if (!confirmRoutingWarnings && msg.includes("confirm_acknowledge_routing_warnings")) {
                const parsed = parseValidationBulletsFromApiErrorMessage(msg);
                const warnText =
                    parsed.warnings.length > 0
                        ? parsed.warnings.join("\n• ")
                        : msg;
                if (window.confirm(`${SAVE_IMPORT_REVIEW_ROAD_ROUTING_WARNINGS_CONFIRM}\n\n• ${warnText}`)) {
                    setSaving(false);
                    await submitOverrides(true);
                    return;
                }
                setSaveError(msg);
                return;
            }

            setSaveError(msg);
        } finally {
            setSaving(false);
        }
    }

    return (
        <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/30 p-4">
            <div>
                <h3 className="text-xs font-semibold uppercase text-violet-900">review_overrides edit</h3>
                <p className="mt-1 text-[11px] leading-relaxed text-violet-950/85">
                    PATCH <span className="font-mono">/api/import-review/roads/:id/overrides</span> — merges name,
                    road class, surface, one-way, and centerline into{" "}
                    <span className="font-mono">review_overrides</span> with routing-safe validation. Does not promote
                    to core.
                </p>
                {promoted ? (
                    <p className="mt-1 text-[11px] font-semibold text-red-800">
                        promotion_status=promoted — overrides are blocked.
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
                        <span className="mt-0.5 block text-gray-600">
                            Saving overrides may require acknowledging routing warnings.
                        </span>
                    </p>
                ) : null}
            </div>

            {optionsError ? <InlineAlert message={optionsError} /> : null}
            {multiLineWarning ? <InlineAlert message={multiLineWarning} tone="amber" /> : null}
            {geometryLoadNotice ? <InlineAlert message={geometryLoadNotice} tone="amber" /> : null}

            {(geometryError || saveError || saveSuccessMessage) && (
                <div className="space-y-2">
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
                        Routing validation
                    </h4>
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            disabled={validating || disabled || optionsLoading}
                            onClick={() => void runValidateRouting(false)}
                            className="rounded-lg border border-teal-700 bg-teal-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-900 disabled:opacity-50"
                        >
                            {validating ? "Validating…" : "Validate for Routing"}
                        </button>
                        {lastValidation ? (
                            <button
                                type="button"
                                disabled={validating || disabled}
                                onClick={() => void runValidateRouting(false)}
                                className="rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-xs font-semibold text-teal-900 hover:bg-teal-50 disabled:opacity-50"
                            >
                                Revalidate
                            </button>
                        ) : null}
                    </div>
                </div>
                {validateError ? <InlineAlert message={validateError} /> : null}
                {lastValidation?.stats ? (
                    <ValidationStatsGrid
                        stats={lastValidation.stats}
                        canApprove={lastValidation.can_approve}
                    />
                ) : null}
                {lastValidation ||
                displayValidationBundle.errors.length > 0 ||
                displayValidationBundle.warnings.length > 0 ||
                displayValidationBundle.info.length > 0 ? (
                    <ValidationIssuesSection
                        errors={displayValidationBundle.errors}
                        warnings={displayValidationBundle.warnings}
                        info={displayValidationBundle.info}
                    />
                ) : (
                    <p className="text-[11px] text-gray-600">
                        Runs full geometry, connectivity, duplicate, and promotion-readiness checks. Results are
                        saved on the candidate row (no core promotion).
                    </p>
                )}
            </section>

            <section className="space-y-2 rounded-lg border border-teal-100 bg-white/90 p-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-800">Names</h4>
                <p className="text-[11px] text-gray-600">
                    Stored as <span className="font-mono">review_overrides.name_mm</span> /{" "}
                    <span className="font-mono">name_en</span> — not road class or surface.
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
                        onChange={(e) => setRoadClassId(e.target.value)}
                        className={selectCls}
                    >
                        <option value="">Select road class…</option>
                        {roadClasses.map((rc) => (
                            <option key={rc.id} value={rc.id}>
                                {rc.name} ({rc.code})
                            </option>
                        ))}
                    </select>
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

                <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                    review_note (saved with overrides)
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
                    <span className="font-medium">Fit</span> and Map / Sat / Hyb like place & building previews.
                </p>
            </div>

            <button
                type="button"
                disabled={saving || disabled || optionsLoading}
                onClick={() => void submitOverrides(false)}
                className="rounded-lg bg-violet-900 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
            >
                {saving ? "Saving overrides…" : "Save overrides"}
            </button>

            <div>
                <h4 className="text-[11px] font-semibold uppercase text-gray-500">Stored review_overrides</h4>
                <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-gray-100 bg-white p-2 text-[11px]">
                    {JSON.stringify(asOverrideRecord(row.review_overrides), null, 2)}
                </pre>
            </div>
        </section>
    );
}
