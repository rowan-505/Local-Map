"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import MapPreviewCard from "@/src/components/map/MapPreviewCard";
import { DASHBOARD_STREET_MVT_SESSION_BUST_KEY } from "@/src/components/map/placeMapConfig";
import { useDashboardTileVersions } from "@/src/components/map/BuildingTileVersionContext";
import StreetEditorMap from "@/src/components/streets/StreetEditorMap";
import StreetGeometryValidationFeedback from "@/src/components/streets/StreetGeometryValidationFeedback";
import {
    lineStringLengthValidMinVertices,
    normalizeLineStringForEditor,
} from "@/src/features/streets/normalizeStreetLineString";
import {
    ensureRoadClassSelected,
    prepareLocalStreetGeometryForSave,
} from "@/src/features/streets/streetSaveLocalChecks";
import { isStreetSurfacePreset, STREET_SURFACE_PRESETS } from "@/src/features/streets/streetSurfaces";
import {
    deleteStreet,
    getAdminAreas,
    getRoadClasses,
    getStreet,
    splitStreet,
    updateStreet,
    validateStreetGeometry,
    type AdminArea,
    type RoadClassOption,
    type StreetDetail,
    type StreetLineStringGeoJson,
    type ValidateStreetGeometryResponse,
} from "@/src/lib/api";
import { dashDevLog } from "@/src/lib/dashDevLog";

const SAVE_WITH_TOPOLOGY_WARNINGS_CONFIRM = "This street has topology warnings. Save anyway?";

const SPLIT_STREET_CONFIRM =
    "Split this street into two segments? The original street will be soft-deactivated and two new streets will be created.";

const SPLIT_SUCCESS_FLASH_KEY = "dash:street-split-flash";

function resolveEditableLineAfterSave(
    updated: StreetDetail,
    patchGeometry: StreetLineStringGeoJson | null,
    preSaveGeometry: StreetLineStringGeoJson | null,
): StreetLineStringGeoJson | null {
    const fromApi = normalizeLineStringForEditor(updated.geometry).line;

    if (lineStringLengthValidMinVertices(fromApi)) {
        return fromApi;
    }

    if (patchGeometry && lineStringLengthValidMinVertices(patchGeometry)) {
        return patchGeometry;
    }

    if (lineStringLengthValidMinVertices(preSaveGeometry)) {
        return preSaveGeometry;
    }

    return null;
}

type SplitSuccessFlash = {
    landedPublicId: string;
    message: string;
};

const nullableStringIdSchema = z.preprocess((value) => {
    if (value === "" || value === undefined) {
        return null;
    }

    return value;
}, z.string().nullable());

const streetMetaSchema = z.object({
    myanmarName: z.string(),
    englishName: z.string(),
    road_class_id: z.string().trim().min(1, "Road class is required"),
    is_oneway: z.boolean(),
    bridge: z.boolean(),
    tunnel: z.boolean(),
    surface: z.string(),
    admin_area_id: nullableStringIdSchema,
    edit_reason: z.string(),
});

type StreetEditFormValues = z.infer<typeof streetMetaSchema>;
type StreetEditFormInput = StreetEditFormValues;

const uuidSchema = z.string().uuid("Invalid street id");

function applyStreetToForm(street: StreetDetail): StreetEditFormValues {
    return {
        myanmarName: street.myanmarName ?? "",
        englishName: street.englishName ?? "",
        road_class_id: street.road_class_id ?? "",
        is_oneway: street.is_oneway,
        bridge: street.bridge ?? false,
        tunnel: street.tunnel ?? false,
        surface: street.surface ?? "",
        admin_area_id: street.admin_area_id ?? "",
        edit_reason: "",
    };
}

export default function EditStreetPage() {
    const params = useParams();
    const router = useRouter();
    const { bumpStreetTileVersion, bumpRoadLabelTileVersion } = useDashboardTileVersions();
    const rawId = typeof params.id === "string" ? params.id : "";
    const parsedId = uuidSchema.safeParse(rawId);
    const fetchStreetId = parsedId.success ? parsedId.data : null;

    const [adminAreas, setAdminAreas] = useState<AdminArea[]>([]);
    const [roadClasses, setRoadClasses] = useState<RoadClassOption[]>([]);
    const [optionsLoading, setOptionsLoading] = useState(true);
    const [optionsError, setOptionsError] = useState("");

    const [streetLoading, setStreetLoading] = useState(true);
    const [streetError, setStreetError] = useState("");
    const [street, setStreet] = useState<StreetDetail | null>(null);

    const [saveError, setSaveError] = useState("");
    const [geometryError, setGeometryError] = useState("");
    const [geometryPrecheck, setGeometryPrecheck] = useState<ValidateStreetGeometryResponse | null>(null);
    const [geometryValidationBusy, setGeometryValidationBusy] = useState(false);
    const [multiLineWarning, setMultiLineWarning] = useState("");
    const [geometryLoadNotice, setGeometryLoadNotice] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const [splitPickMode, setSplitPickMode] = useState(false);
    const [splitLngLat, setSplitLngLat] = useState<{ lng: number; lat: number } | null>(null);
    const [splitReason, setSplitReason] = useState("");
    const [splitBusy, setSplitBusy] = useState(false);
    const [splitError, setSplitError] = useState("");
    const [siblingAfterSplit, setSiblingAfterSplit] = useState<string | null>(null);
    const [splitSuccessMessage, setSplitSuccessMessage] = useState<string | null>(null);

    const [editableGeometry, setEditableGeometry] = useState<StreetLineStringGeoJson | null>(null);
    /** Full map + TerraDraw re-hydrate (fitBounds, clear/redraw). Only bump on initial load / street id change / clear — never on successful save. */
    const [mapHydrateEpoch, setMapHydrateEpoch] = useState(0);
    /** Refreshes the API-backed street overlay in {@link StreetEditorMap} without resetting the editor sketch. */
    const [editableStreetsRefreshKey, setEditableStreetsRefreshKey] = useState(0);
    const initialHadGeometryRef = useRef(false);
    const editableGeometryRef = useRef<StreetLineStringGeoJson | null>(null);
    /** Sanitized coordinate key last accepted from server load or successful save (single source of truth baseline). */
    const originalGeometrySanitizedKeyRef = useRef<string>("");
    const geometryDirtyRef = useRef(false);
    const lastFetchPublicIdRef = useRef<string | null>(null);

    const lastValidatedGeometryKeyRef = useRef<string>("");
    const [geometryValidationStale, setGeometryValidationStale] = useState(false);

    const {
        register,
        handleSubmit,
        reset,
        watch,
        setValue,
        getValues,
        formState: { errors },
    } = useForm<StreetEditFormInput, unknown, StreetEditFormValues>({
        resolver: zodResolver(streetMetaSchema) as Resolver<StreetEditFormInput, unknown, StreetEditFormValues>,
        defaultValues: {
            myanmarName: "",
            englishName: "",
            road_class_id: "",
            is_oneway: false,
            bridge: false,
            tunnel: false,
            surface: "",
            admin_area_id: "",
            edit_reason: "",
        },
    });

    useEffect(() => {
        if (!fetchStreetId) {
            return;
        }

        lastFetchPublicIdRef.current = null;
    }, [fetchStreetId]);

    const surfaceField = watch("surface");

    useEffect(() => {
        editableGeometryRef.current = editableGeometry;
    }, [editableGeometry]);

    const handleLineChange = useCallback(
        (line: StreetLineStringGeoJson | null) => {
            editableGeometryRef.current = line;
            setEditableGeometry(line);
            setGeometryPrecheck(null);

            const prep = prepareLocalStreetGeometryForSave(line);
            const key = prep.ok ? JSON.stringify(prep.sanitized.coordinates) : "__invalid__";
            geometryDirtyRef.current = key !== originalGeometrySanitizedKeyRef.current;

            if (!prep.ok) {
                setGeometryError(line ? prep.message : "");
                setGeometryValidationStale(true);
            } else {
                setGeometryError("");
                setGeometryValidationStale(key !== lastValidatedGeometryKeyRef.current);
            }

            setValue("englishName", getValues("englishName"), { shouldDirty: true, shouldTouch: true });
        },
        [getValues, setValue],
    );

    const handleSplitMapClick = useCallback((lng: number, lat: number) => {
        setSplitLngLat({ lng, lat });
        setSplitPickMode(false);
        setSplitError("");
    }, []);

    async function handleValidateGeometryClick() {
        if (!fetchStreetId) {
            return;
        }

        setSaveError("");
        setGeometryError("");
        dashDevLog("street:edit:validate-geometry:click");

        const prep = prepareLocalStreetGeometryForSave(editableGeometryRef.current);
        if (!prep.ok) {
            setGeometryError(prep.message);
            setGeometryPrecheck(null);
            return;
        }
        const { sanitized } = prep;

        setGeometryValidationBusy(true);
        try {
            const check = await validateStreetGeometry({
                geometry: sanitized,
                streetId: fetchStreetId,
            });
            setGeometryPrecheck(check);
            dashDevLog("street:edit:validate-geometry:result", { isValid: check.isValid });

            if (check.isValid && prep.ok) {
                lastValidatedGeometryKeyRef.current = JSON.stringify(prep.sanitized.coordinates);
                setGeometryValidationStale(false);
            } else {
                setGeometryValidationStale(true);
            }
        } catch (error) {
            dashDevLog("street:edit:validate-geometry:error", error instanceof Error ? error.message : error);
            setGeometryPrecheck(null);
            setSaveError(error instanceof Error ? error.message : "Geometry validation failed");
        } finally {
            setGeometryValidationBusy(false);
        }
    }

    useEffect(() => {
        if (!fetchStreetId || typeof window === "undefined") {
            return;
        }

        const k = `street-split-second:${fetchStreetId}`;
        const sibling = sessionStorage.getItem(k);
        if (sibling && /^[\da-f-]{36}$/i.test(sibling)) {
            setSiblingAfterSplit(sibling);
            sessionStorage.removeItem(k);
        }
    }, [fetchStreetId]);

    useEffect(() => {
        if (!fetchStreetId || typeof window === "undefined") {
            return;
        }

        const raw = sessionStorage.getItem(SPLIT_SUCCESS_FLASH_KEY);
        if (!raw) {
            return;
        }

        try {
            const data = JSON.parse(raw) as SplitSuccessFlash;
            sessionStorage.removeItem(SPLIT_SUCCESS_FLASH_KEY);
            if (data.landedPublicId === fetchStreetId && typeof data.message === "string" && data.message.trim()) {
                setSplitSuccessMessage(data.message.trim());
            }
        } catch {
            sessionStorage.removeItem(SPLIT_SUCCESS_FLASH_KEY);
        }
    }, [fetchStreetId]);

    useEffect(() => {
        let isMounted = true;

        async function loadOptions() {
            setOptionsLoading(true);
            setOptionsError("");

            try {
                const [areasData, roadsData] = await Promise.all([getAdminAreas(), getRoadClasses()]);

                if (isMounted) {
                    setAdminAreas(areasData);
                    setRoadClasses(roadsData);
                }
            } catch (error) {
                if (isMounted) {
                    setOptionsError(error instanceof Error ? error.message : "Failed to load form options");
                }
            } finally {
                if (isMounted) {
                    setOptionsLoading(false);
                }
            }
        }

        void loadOptions();

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        if (!fetchStreetId) {
            setStreetLoading(false);
            setStreetError("Invalid street id — use a UUID from the streets list.");
            setStreet(null);
            return;
        }

        const id = fetchStreetId;
        const abort = new AbortController();
        let isMounted = true;

        async function load() {
            setStreetLoading(true);
            setStreetError("");

            try {
                const data = await getStreet(id, { signal: abort.signal });

                if (!isMounted || abort.signal.aborted) {
                    return;
                }

                const normalized = normalizeLineStringForEditor(data.geometry);
                dashDevLog("street:edit:detail", {
                    public_id: data.public_id,
                    geometryType: data.geometry?.type ?? null,
                });
                dashDevLog("street:edit:loaded-api-geometry", data.geometry);
                dashDevLog("street:edit:geometry-parsed", normalized);
                dashDevLog("street:edit:debug-original-api-geometry", data.geometry);
                dashDevLog("street:edit:editable-geometry-vertex-count", normalized.line?.coordinates.length ?? 0);

                setGeometryLoadNotice(normalized.unsupportedReason ?? normalized.parseError ?? "");
                setMultiLineWarning(normalized.multiLineWarning ?? "");
                initialHadGeometryRef.current = lineStringLengthValidMinVertices(normalized.line);

                const prepLoaded = prepareLocalStreetGeometryForSave(normalized.line);
                const loadedKey = prepLoaded.ok ? JSON.stringify(prepLoaded.sanitized.coordinates) : "";

                const sameStreetRefetch =
                    lastFetchPublicIdRef.current === data.public_id && lastFetchPublicIdRef.current !== null;

                if (geometryDirtyRef.current && sameStreetRefetch) {
                    dashDevLog("street:edit:debug-refetch-skipped-geometry", {
                        dirty: geometryDirtyRef.current,
                        originalGeometryKey: originalGeometrySanitizedKeyRef.current,
                        editableGeometry: editableGeometryRef.current,
                        refetchReplacedGeometry: false,
                    });
                    setStreet({
                        ...data,
                        geometry: (editableGeometryRef.current ?? data.geometry) as StreetDetail["geometry"],
                    });
                } else {
                    setStreet(data);
                    reset(applyStreetToForm(data));
                    dashDevLog("street:edit:debug-apply-fetch-geometry", {
                        replacedRefetch: sameStreetRefetch && !geometryDirtyRef.current,
                        normalizedLine: normalized.line,
                        refetchReplacedGeometry: true,
                    });
                    setEditableGeometry(normalized.line);
                    editableGeometryRef.current = normalized.line;
                    originalGeometrySanitizedKeyRef.current = loadedKey;
                    geometryDirtyRef.current = false;
                    lastValidatedGeometryKeyRef.current = loadedKey;
                    setGeometryValidationStale(false);
                    setMapHydrateEpoch((e) => e + 1);
                }

                lastFetchPublicIdRef.current = data.public_id;
                setEditableStreetsRefreshKey((k) => k + 1);
            } catch (error) {
                if (abort.signal.aborted) {
                    return;
                }

                if (isMounted) {
                    setStreetError(error instanceof Error ? error.message : "Failed to load street");
                    setStreet(null);
                }
            } finally {
                if (isMounted && !abort.signal.aborted) {
                    setStreetLoading(false);
                }
            }
        }

        void load();

        return () => {
            isMounted = false;
            abort.abort();
        };
    }, [fetchStreetId, reset]);

    async function onSubmit(values: StreetEditFormValues) {
        if (!fetchStreetId || !street) {
            return;
        }

        setSaveError("");
        setGeometryError("");

        const roadClassId = ensureRoadClassSelected(values.road_class_id);
        if (!roadClassId) {
            setGeometryError("Select a road class before saving.");
            return;
        }

        const hadGeom = initialHadGeometryRef.current;
        const preSaveEditable = editableGeometryRef.current;
        const editedLine = preSaveEditable;
        const geomPrep = prepareLocalStreetGeometryForSave(editedLine);
        const willPatchGeometry = geomPrep.ok;
        const coercedPatch = willPatchGeometry ? geomPrep.sanitized : null;

        dashDevLog("street:edit:debug-save-editable-geometry", editedLine);
        dashDevLog("street:edit:debug-originalGeometrySanitizedKey", originalGeometrySanitizedKeyRef.current);

        if (hadGeom && !willPatchGeometry) {
            setGeometryError(
                "This street had a centerline. Draw a new LineString on the map (or reload the page) before saving.",
            );
            return;
        }

        if (willPatchGeometry && geometryValidationStale) {
            setGeometryError("Validate geometry after editing the centerline (click Validate geometry) before saving.");
            return;
        }

        setIsSaving(true);

        try {
            if (willPatchGeometry && coercedPatch) {
                const check = await validateStreetGeometry({
                    geometry: coercedPatch,
                    streetId: fetchStreetId,
                });
                setGeometryPrecheck(check);

                if (!check.isValid) {
                    setIsSaving(false);
                    return;
                }

                if (check.warnings.length > 0) {
                    if (!window.confirm(SAVE_WITH_TOPOLOGY_WARNINGS_CONFIRM)) {
                        setIsSaving(false);
                        return;
                    }
                }
            }

            const mm = values.myanmarName.trim();
            const en = values.englishName.trim();
            const surfaceTrimmed = values.surface.trim();
            const reason = values.edit_reason.trim();

            const payload: Parameters<typeof updateStreet>[1] = {
                myanmarName: mm || undefined,
                englishName: en || undefined,
                admin_area_id: values.admin_area_id,
                road_class_id: roadClassId,
                is_oneway: values.is_oneway,
                bridge: values.bridge,
                tunnel: values.tunnel,
                surface: surfaceTrimmed.length > 0 ? surfaceTrimmed : null,
                edit_reason: reason.length > 0 ? reason : undefined,
            };

            if (willPatchGeometry && coercedPatch) {
                payload.geometry = coercedPatch;
            }

            dashDevLog("street:edit:patch-payload-geometry", payload.geometry ?? null);
            dashDevLog("street:edit:save-payload", payload);

            const updated = await updateStreet(fetchStreetId, payload);
            const streetTileVersion = bumpStreetTileVersion();
            bumpRoadLabelTileVersion();

            const resolvedGeometry = resolveEditableLineAfterSave(updated, coercedPatch, preSaveEditable);

            dashDevLog("street:edit:debug-save-api-normalized-line", normalizeLineStringForEditor(updated.geometry).line);

            dashDevLog("street:edit:debug-save-response-geometry", updated.geometry);
            dashDevLog("street:edit:debug-save-resolved-geometry", resolvedGeometry);
            dashDevLog("street:edit:save-response", {
                public_id: updated.public_id,
                routing_status: updated.routing_status,
                manual_override: updated.manual_override,
            });

            const mergedStreet: StreetDetail = {
                ...updated,
                geometry: (resolvedGeometry ?? updated.geometry) as StreetDetail["geometry"],
            };

            setStreet(mergedStreet);
            reset(applyStreetToForm(mergedStreet));
            setGeometryPrecheck(null);

            const nextNorm = normalizeLineStringForEditor(mergedStreet.geometry);
            dashDevLog("street:edit:after-save-geometry-normalized", nextNorm);
            setGeometryLoadNotice(nextNorm.unsupportedReason ?? nextNorm.parseError ?? "");
            setMultiLineWarning(nextNorm.multiLineWarning ?? "");
            initialHadGeometryRef.current = lineStringLengthValidMinVertices(nextNorm.line);

            setEditableGeometry(nextNorm.line);
            editableGeometryRef.current = nextNorm.line;

            const prepSaved = prepareLocalStreetGeometryForSave(nextNorm.line);
            const savedKey = prepSaved.ok ? JSON.stringify(prepSaved.sanitized.coordinates) : "";
            lastValidatedGeometryKeyRef.current = savedKey;
            originalGeometrySanitizedKeyRef.current = savedKey;
            geometryDirtyRef.current = false;
            setGeometryValidationStale(false);

            setEditableStreetsRefreshKey(streetTileVersion);
        } catch (error) {
            dashDevLog("street:edit:save-error", error instanceof Error ? error.message : error);
            setSaveError(error instanceof Error ? error.message : "Failed to update street");
        } finally {
            setIsSaving(false);
        }
    }

    async function handleSoftDelete() {
        if (!fetchStreetId || !street) {
            return;
        }

        if (street.deleted_at) {
            return;
        }

        const label = street.canonical_name || street.public_id;
        if (!window.confirm(`Soft-delete street “${label}”? It will be hidden from default lists.`)) {
            return;
        }

        const reason = window.prompt("Optional note for the audit log (edit reason):")?.trim() ?? "";

        setIsDeleting(true);
        setSaveError("");

        try {
            const deleted = await deleteStreet(fetchStreetId, reason.length > 0 ? { edit_reason: reason } : undefined);
            const streetTileVersion = bumpStreetTileVersion();
            bumpRoadLabelTileVersion();
            setStreet(deleted);
            editableGeometryRef.current = null;
            setEditableGeometry(null);
            originalGeometrySanitizedKeyRef.current = "";
            geometryDirtyRef.current = false;
            setMapHydrateEpoch((e) => e + 1);
            try {
                sessionStorage.setItem(DASHBOARD_STREET_MVT_SESSION_BUST_KEY, String(streetTileVersion));
            } catch {
                /* ignore */
            }
            router.push("/streets");
        } catch (error) {
            setSaveError(error instanceof Error ? error.message : "Failed to delete street");
        } finally {
            setIsDeleting(false);
        }
    }

    async function handleSplitSubmit() {
        if (!fetchStreetId || !splitLngLat || !street) {
            return;
        }

        if (!window.confirm(SPLIT_STREET_CONFIRM)) {
            return;
        }

        setSplitBusy(true);
        setSplitError("");

        try {
            const res = await splitStreet(fetchStreetId, {
                point: { lat: splitLngLat.lat, lng: splitLngLat.lng },
                editReason: splitReason.trim() || undefined,
            });

            const segments = res.newStreets.length > 0 ? res.newStreets : (res.streets ?? []);
            const first = segments[0];
            const second = segments[1];

            if (!first || !second) {
                throw new Error("Split succeeded but the API did not return two new streets.");
            }

            if (typeof window !== "undefined") {
                sessionStorage.setItem(`street-split-second:${first.public_id}`, second.public_id);
                const flash: SplitSuccessFlash = {
                    landedPublicId: first.public_id,
                    message:
                        "Street split successfully. You are editing the first new segment; the original street was soft-deactivated.",
                };
                sessionStorage.setItem(SPLIT_SUCCESS_FLASH_KEY, JSON.stringify(flash));
            }

            dashDevLog("street:edit:split:ok", {
                originalStreetId: res.originalStreetId,
                first: first.public_id,
                second: second.public_id,
            });

            setSplitPickMode(false);
            setSplitLngLat(null);
            setSplitReason("");

            router.replace(`/streets/${first.public_id}/edit`);
        } catch (error) {
            dashDevLog("street:edit:split:error", error instanceof Error ? error.message : error);
            setSplitError(error instanceof Error ? error.message : "Split failed");
        } finally {
            setSplitBusy(false);
        }
    }

    function handleSurfacePresetChange(e: React.ChangeEvent<HTMLSelectElement>) {
        const v = e.target.value;

        setValue("surface", v === "__custom__" ? "" : v, {
            shouldValidate: false,
            shouldDirty: true,
        });
    }

    const presetSelectValue =
        surfaceField && isStreetSurfacePreset(surfaceField)
            ? surfaceField
            : surfaceField !== ""
              ? "__custom__"
              : "";

    const surfaceListId = "street-surfaces-edit";
    const isDeleted = Boolean(street?.deleted_at);
    const blockForm = !fetchStreetId || optionsLoading || streetLoading || Boolean(streetError) || !street;

    const canOfferSplit =
        Boolean(street) &&
        !isDeleted &&
        !multiLineWarning &&
        !geometryLoadNotice &&
        lineStringLengthValidMinVertices(editableGeometry) &&
        !optionsLoading &&
        !streetLoading;

    const saveGeometryPrep = prepareLocalStreetGeometryForSave(editableGeometry);
    const saveAllowsGeometry = !initialHadGeometryRef.current || saveGeometryPrep.ok;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-6xl">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold text-gray-900">Edit street</h1>
                        <p className="mt-1 text-sm text-gray-700">
                            <span className="font-mono text-gray-900">{fetchStreetId ?? rawId}</span>
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Link
                            href="/streets"
                            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700"
                        >
                            Back to list
                        </Link>
                        {street && fetchStreetId && !isDeleted ? (
                            <button
                                type="button"
                                disabled={isDeleting || isSaving}
                                onClick={() => void handleSoftDelete()}
                                className="rounded border border-red-300 bg-white px-4 py-2 text-sm text-red-700 disabled:opacity-50"
                            >
                                {isDeleting ? "Deleting…" : "Soft delete"}
                            </button>
                        ) : null}
                    </div>
                </div>

                {optionsError ? (
                    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">{optionsError}</div>
                ) : null}

                {streetLoading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-700">Loading street…</div>
                ) : null}

                {!streetLoading && streetError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">{streetError}</div>
                ) : null}

                {isDeleted && street ? (
                    <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                        This street is already soft-deleted. Editing may be unavailable; return to the list if you saw
                        this by mistake.
                    </div>
                ) : null}

                {multiLineWarning ? (
                    <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                        {multiLineWarning}
                    </div>
                ) : null}

                {geometryLoadNotice ? (
                    <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                        {geometryLoadNotice}
                    </div>
                ) : null}

                {splitSuccessMessage ? (
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                        <span>{splitSuccessMessage}</span>
                        <div className="flex flex-wrap items-center gap-2">
                            <Link
                                href="/streets"
                                className="rounded border border-emerald-700 bg-white px-3 py-1.5 text-emerald-950 hover:bg-emerald-100"
                            >
                                Streets list
                            </Link>
                            <button
                                type="button"
                                onClick={() => setSplitSuccessMessage(null)}
                                className="rounded border border-emerald-700/40 bg-white px-3 py-1.5 text-emerald-950 hover:bg-emerald-100"
                            >
                                Dismiss
                            </button>
                        </div>
                    </div>
                ) : null}

                {siblingAfterSplit ? (
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                        <span>You just split a street. The other new segment is still available to edit.</span>
                        <Link
                            href={`/streets/${siblingAfterSplit}/edit`}
                            className="rounded border border-emerald-700 bg-white px-3 py-1 text-emerald-950"
                        >
                            Open other segment
                        </Link>
                    </div>
                ) : null}

                {!blockForm ? (
                    <form
                        onSubmit={handleSubmit(onSubmit)}
                        className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start"
                    >
                        <div className="min-w-0 space-y-3">
                            <h2 className="text-lg font-semibold text-gray-900">Map preview</h2>

                            {geometryValidationStale && prepareLocalStreetGeometryForSave(editableGeometry).ok ? (
                                <div
                                    className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950"
                                    role="status"
                                >
                                    Centerline changed — click <strong>Validate geometry</strong> before saving.
                                </div>
                            ) : null}

                            {(geometryError || saveError) && (
                                <div className="space-y-2">
                                    {geometryError ? (
                                        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                                            {geometryError}
                                        </div>
                                    ) : null}
                                    {saveError ? (
                                        <div className="whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                                            {saveError}
                                        </div>
                                    ) : null}
                                </div>
                            )}

                            <MapPreviewCard className="overflow-hidden p-4">
                                <StreetEditorMap
                                    toolbarExtra={
                                        <button
                                            type="button"
                                            disabled={geometryValidationBusy || isDeleted || isSaving}
                                            onClick={() => void handleValidateGeometryClick()}
                                            className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-900 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {geometryValidationBusy ? "Validating…" : "Validate geometry"}
                                        </button>
                                    }
                                    mapEpoch={mapHydrateEpoch}
                                    seedLine={editableGeometry}
                                    onLineStringChange={handleLineChange}
                                    snapExcludeStreetPublicId={street.public_id}
                                    selectedStreetPublicId={street.public_id}
                                    selectedStreetName={street.canonical_name}
                                    streetSourceRefreshKey={editableStreetsRefreshKey}
                                    streetVectorTileVersion={editableStreetsRefreshKey}
                                    splitPickActive={splitPickMode}
                                    onSplitPointClicked={splitPickMode ? handleSplitMapClick : undefined}
                                    splitPreviewLngLat={splitLngLat}
                                />
                            </MapPreviewCard>

                            <StreetGeometryValidationFeedback
                                errors={geometryPrecheck?.errors ?? []}
                                warnings={geometryPrecheck?.warnings ?? []}
                                crossings={geometryPrecheck?.crossings ?? []}
                                duplicates={geometryPrecheck?.duplicates ?? []}
                                validationSuccess={Boolean(
                                    geometryPrecheck?.isValid &&
                                        geometryPrecheck.errors.length === 0 &&
                                        geometryPrecheck.warnings.length === 0,
                                )}
                            />

                            <p className="text-xs text-gray-500">
                                Edit mode supports dragging vertices and splitting with midpoints. Clearing the shape only
                                clears the overlay here; if this street already had geometry, Save is blocked until you
                                draw a LineString again.
                            </p>

                            <div className="rounded border border-gray-200 bg-gray-50 p-4">
                                <h3 className="text-base font-semibold text-gray-900">Split road</h3>
                                <p className="mt-1 text-xs text-gray-600">
                                    Start split mode, choose a point on the centerline map (use <strong>Edit vertices</strong>{" "}
                                    first if the sketch is not selectable), then confirm. The API projects your click onto
                                    the stored LineString within 5&nbsp;m. Routing tables are not updated here.
                                </p>
                                {!canOfferSplit ? (
                                    <p className="mt-2 text-sm text-amber-900">
                                        Split requires a loaded LineString geometry (not MultiLineString / invalid) and an
                                        active, non-deleted street.
                                    </p>
                                ) : null}
                                {splitPickMode ? (
                                    <p className="mt-2 text-sm font-medium text-blue-900">
                                        Split mode: click once on the map on the street centerline to place the split point.
                                    </p>
                                ) : null}
                                {splitLngLat ? (
                                    <p className="mt-2 font-mono text-xs text-gray-800">
                                        Split point: {splitLngLat.lng.toFixed(6)}, {splitLngLat.lat.toFixed(6)}
                                    </p>
                                ) : null}
                                {splitError ? (
                                    <div className="mt-2 whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-2 text-sm font-medium text-red-900">
                                        {splitError}
                                    </div>
                                ) : null}
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <button
                                        type="button"
                                        disabled={!canOfferSplit || splitBusy || isSaving}
                                        onClick={() => {
                                            setSplitError("");
                                            setSplitSuccessMessage(null);
                                            if (splitPickMode) {
                                                setSplitPickMode(false);
                                                setSplitLngLat(null);
                                            } else {
                                                setSplitPickMode(true);
                                                setSplitLngLat(null);
                                            }
                                        }}
                                        className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50"
                                    >
                                        {splitPickMode ? "Cancel split" : "Split road"}
                                    </button>
                                    <button
                                        type="button"
                                        disabled={!canOfferSplit || !splitLngLat || splitBusy || isSaving}
                                        onClick={() => void handleSplitSubmit()}
                                        className="rounded bg-teal-800 px-3 py-1.5 text-sm text-white hover:bg-teal-900 disabled:opacity-50"
                                    >
                                        {splitBusy ? "Splitting…" : "Confirm split"}
                                    </button>
                                </div>
                                <label className="mt-3 block">
                                    <span className="mb-1 block text-sm text-gray-700">Reason (optional)</span>
                                    <textarea
                                        rows={2}
                                        value={splitReason}
                                        onChange={(event) => setSplitReason(event.target.value)}
                                        disabled={!canOfferSplit || splitBusy || isSaving}
                                        placeholder="Audit / versioning note when provided"
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                                    />
                                </label>
                            </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">Attributes</h2>

                            <div className="space-y-4">
                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">Road class</span>
                                    <select
                                        {...register("road_class_id")}
                                        disabled={isDeleted}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 disabled:bg-gray-100"
                                    >
                                        <option value="">Select road class…</option>
                                        {roadClasses.map((rc) => (
                                            <option key={rc.id} value={rc.id}>
                                                {rc.name} ({rc.code})
                                            </option>
                                        ))}
                                    </select>
                                    {errors.road_class_id?.message ? (
                                        <span className="mt-1 block text-sm text-red-600">
                                            {errors.road_class_id.message}
                                        </span>
                                    ) : null}
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">Myanmar name</span>
                                    <input
                                        {...register("myanmarName")}
                                        disabled={isDeleted}
                                        placeholder="ဥပမာ · အောင်မင်္ဂလာ"
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 disabled:bg-gray-100"
                                    />
                                    {errors.myanmarName?.message ? (
                                        <span className="mt-1 block text-sm text-red-600">{errors.myanmarName.message}</span>
                                    ) : null}
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">English name</span>
                                    <input
                                        {...register("englishName")}
                                        disabled={isDeleted}
                                        placeholder="Example — Aung Mingalar"
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 disabled:bg-gray-100"
                                    />
                                </label>

                                <p className="text-xs text-gray-500">
                                    Myanmar and English names are optional; if both are empty the server uses
                                    &quot;Unnamed Street&quot; as the canonical label.
                                </p>

                                <div className="block">
                                    <span className="mb-1 block text-sm text-gray-700">Surface</span>
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <select
                                            aria-label="Surface preset"
                                            value={presetSelectValue}
                                            disabled={isDeleted}
                                            onChange={handleSurfacePresetChange}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 sm:max-w-xs disabled:bg-gray-100"
                                        >
                                            <option value="">Preset…</option>
                                            {STREET_SURFACE_PRESETS.filter((p) => p.value !== "").map((p) => (
                                                <option key={p.value} value={p.value}>
                                                    {p.label}
                                                </option>
                                            ))}
                                            <option value="__custom__">Custom value…</option>
                                        </select>
                                        <input
                                            {...register("surface")}
                                            disabled={isDeleted}
                                            placeholder="e.g. asphalt"
                                            list={surfaceListId}
                                            className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-gray-900 disabled:bg-gray-100"
                                        />
                                        <datalist id={surfaceListId}>
                                            {STREET_SURFACE_PRESETS.filter((p) => p.value !== "").map((p) => (
                                                <option key={p.value} value={p.value} />
                                            ))}
                                        </datalist>
                                    </div>
                                </div>

                                <label className="flex items-start gap-2 pt-1">
                                    <input
                                        type="checkbox"
                                        {...register("is_oneway")}
                                        disabled={isDeleted}
                                        className="mt-1 rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700">One-way</span>
                                </label>

                                <label className="flex items-start gap-2 pt-1">
                                    <input
                                        type="checkbox"
                                        {...register("bridge")}
                                        disabled={isDeleted}
                                        className="mt-1 rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700">Bridge</span>
                                </label>

                                <label className="flex items-start gap-2 pt-1">
                                    <input
                                        type="checkbox"
                                        {...register("tunnel")}
                                        disabled={isDeleted}
                                        className="mt-1 rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700">Tunnel</span>
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">Admin area</span>
                                    <select
                                        {...register("admin_area_id")}
                                        disabled={isDeleted}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 disabled:bg-gray-100"
                                    >
                                        <option value="">No admin area</option>
                                        {adminAreas.map((adminArea) => (
                                            <option key={adminArea.id} value={adminArea.id}>
                                                {adminArea.canonical_name}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">Edit reason (optional)</span>
                                    <textarea
                                        {...register("edit_reason")}
                                        disabled={isDeleted}
                                        rows={2}
                                        placeholder="Shown in versioning / audit when provided"
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 disabled:bg-gray-100"
                                    />
                                </label>
                            </div>

                            <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 pt-4">
                                <button
                                    type="submit"
                                    disabled={isSaving || isDeleting || isDeleted || !saveAllowsGeometry}
                                    className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                                >
                                    {isSaving ? "Saving…" : "Save changes"}
                                </button>
                            </div>
                        </div>
                    </form>
                ) : null}
            </div>
        </main>
    );
}
