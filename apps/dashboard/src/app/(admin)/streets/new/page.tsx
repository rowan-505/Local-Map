"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";

import MapPreviewCard from "@/src/components/map/MapPreviewCard";
import StreetEditorMap from "@/src/components/streets/StreetEditorMap";
import StreetGeometryValidationFeedback from "@/src/components/streets/StreetGeometryValidationFeedback";
import {
    ensureRoadClassSelected,
    prepareLocalStreetGeometryForSave,
} from "@/src/features/streets/streetSaveLocalChecks";
import { isStreetSurfacePreset, STREET_SURFACE_PRESETS } from "@/src/features/streets/streetSurfaces";
import {
    createStreet,
    getAdminAreas,
    getRoadClasses,
    validateStreetGeometry,
    type AdminArea,
    type RoadClassOption,
    type StreetLineStringGeoJson,
    type ValidateStreetGeometryResponse,
} from "@/src/lib/api";
import { dashDevLog } from "@/src/lib/dashDevLog";

const SAVE_WITH_TOPOLOGY_WARNINGS_CONFIRM = "This street has topology warnings. Save anyway?";

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
});

type StreetCreateFormValues = z.infer<typeof streetMetaSchema>;
type StreetCreateFormInput = StreetCreateFormValues;

export default function NewStreetPage() {
    const router = useRouter();
    const [adminAreas, setAdminAreas] = useState<AdminArea[]>([]);
    const [roadClasses, setRoadClasses] = useState<RoadClassOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [saveError, setSaveError] = useState("");
    const [geometryError, setGeometryError] = useState("");
    const [geometryPrecheck, setGeometryPrecheck] = useState<ValidateStreetGeometryResponse | null>(null);
    const [geometryValidationBusy, setGeometryValidationBusy] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [drawnLine, setDrawnLine] = useState<StreetLineStringGeoJson | null>(null);
    const [seedLine] = useState<StreetLineStringGeoJson | null>(null);
    /** Bump after mount so StreetEditorMap recenters once layout has measured the map container. */
    const [mapEpoch, setMapEpoch] = useState(0);

    useEffect(() => {
        setMapEpoch(1);
    }, []);

    const {
        register,
        handleSubmit,
        watch,
        setValue,
        formState: { errors },
    } = useForm<StreetCreateFormInput, unknown, StreetCreateFormValues>({
        resolver: zodResolver(streetMetaSchema) as Resolver<StreetCreateFormInput, unknown, StreetCreateFormValues>,
        defaultValues: {
            myanmarName: "",
            englishName: "",
            road_class_id: "",
            is_oneway: false,
            bridge: false,
            tunnel: false,
            surface: "",
            admin_area_id: "",
        },
    });

    const surfaceField = watch("surface");

    const handleLineChange = useCallback((line: StreetLineStringGeoJson | null) => {
        setDrawnLine(line);
        setGeometryError("");
        setGeometryPrecheck(null);
    }, []);

    useEffect(() => {
        let isMounted = true;

        async function loadOptions() {
            setIsLoading(true);
            setLoadError("");

            try {
                const [areasData, roadsData] = await Promise.all([getAdminAreas(), getRoadClasses()]);

                if (isMounted) {
                    setAdminAreas(areasData);
                    setRoadClasses(roadsData);
                }
            } catch (error) {
                if (isMounted) {
                    setLoadError(error instanceof Error ? error.message : "Failed to load form options");
                }
            } finally {
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        }

        void loadOptions();

        return () => {
            isMounted = false;
        };
    }, []);

    async function handleValidateGeometryClick() {
        setSaveError("");
        setGeometryError("");
        dashDevLog("street:create:validate-geometry:click");

        const prep = prepareLocalStreetGeometryForSave(drawnLine);
        if (!prep.ok) {
            setGeometryError(prep.message);
            setGeometryPrecheck(null);
            return;
        }
        const { sanitized } = prep;

        setGeometryValidationBusy(true);
        try {
            const check = await validateStreetGeometry({ geometry: sanitized });
            setGeometryPrecheck(check);
            dashDevLog("street:create:validate-geometry:result", { isValid: check.isValid });
        } catch (error) {
            dashDevLog("street:create:validate-geometry:error", error instanceof Error ? error.message : error);
            setGeometryPrecheck(null);
            setSaveError(error instanceof Error ? error.message : "Geometry validation failed");
        } finally {
            setGeometryValidationBusy(false);
        }
    }

    async function onSubmit(values: StreetCreateFormValues) {
        setSaveError("");
        setGeometryError("");

        const roadClassId = ensureRoadClassSelected(values.road_class_id);
        if (!roadClassId) {
            setGeometryError("Select a road class before saving.");
            return;
        }

        const prep = prepareLocalStreetGeometryForSave(drawnLine);
        if (!prep.ok) {
            setGeometryError(prep.message);
            return;
        }
        const { sanitized } = prep;

        setIsSaving(true);

        try {
            const check = await validateStreetGeometry({ geometry: sanitized });
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

            const mm = values.myanmarName.trim();
            const en = values.englishName.trim();
            const surfaceTrimmed = values.surface.trim();

            const body = {
                myanmarName: mm || undefined,
                englishName: en || undefined,
                admin_area_id: values.admin_area_id,
                road_class_id: roadClassId,
                is_oneway: values.is_oneway,
                bridge: values.bridge,
                tunnel: values.tunnel,
                surface: surfaceTrimmed.length > 0 ? surfaceTrimmed : undefined,
                geometry: sanitized,
            };

            dashDevLog("street:create:payload", body);

            const created = await createStreet(body);
            dashDevLog("street:create:response", {
                public_id: created.public_id,
                canonical_name: created.canonical_name,
                routing_status: created.routing_status,
                manual_override: created.manual_override,
            });

            router.push(`/streets/${created.public_id}/edit`);
        } catch (error) {
            dashDevLog("street:create:error", error instanceof Error ? error.message : error);
            setSaveError(error instanceof Error ? error.message : "Failed to create street");
        } finally {
            setIsSaving(false);
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

    const surfaceListId = "street-surfaces-create";

    return (
        <main className="p-6">
            <div className="mx-auto max-w-6xl">
                <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h1 className="text-2xl font-bold text-gray-900">Create Street</h1>
                        <p className="mt-1 text-sm text-gray-600">
                            Draw the centerline on the map, then save. Kyauktan is the default view. All changes go
                            through the API.
                        </p>
                    </div>
                    <Link
                        href="/streets"
                        className="shrink-0 rounded border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700"
                    >
                        Back to Streets
                    </Link>
                </div>

                {isLoading ? (
                    <div className="rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
                        Loading create form...
                    </div>
                ) : null}

                {!isLoading && loadError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-red-700">{loadError}</div>
                ) : null}

                {!isLoading && !loadError ? (
                    <form
                        onSubmit={handleSubmit(onSubmit)}
                        className="grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-start"
                    >
                        <div className="min-w-0 space-y-3">
                            <h2 className="text-lg font-semibold text-gray-900">Map preview</h2>

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
                                    className=""
                                    toolbarExtra={
                                        <button
                                            type="button"
                                            disabled={geometryValidationBusy || isSaving}
                                            onClick={() => void handleValidateGeometryClick()}
                                            className="rounded border border-emerald-300 bg-white px-3 py-1.5 text-sm text-emerald-900 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {geometryValidationBusy ? "Validating…" : "Validate geometry"}
                                        </button>
                                    }
                                    mapEpoch={mapEpoch}
                                    seedLine={seedLine}
                                    onLineStringChange={handleLineChange}
                                    submissionError={undefined}
                                    streetSourceRefreshKey={mapEpoch}
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
                                Use Draw line / Edit vertices, then save. API accepts WGS 84 LineString only (length
                                rules enforced server-side).
                            </p>
                        </div>

                        <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                            <h2 className="mb-4 text-lg font-semibold text-gray-900">Attributes</h2>

                            <div className="space-y-4">
                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">Road class</span>
                                    <select
                                        {...register("road_class_id")}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
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
                                        placeholder="ဥပမာ · အောင်မင်္ဂလာ"
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    />
                                    {errors.myanmarName?.message ? (
                                        <span className="mt-1 block text-sm text-red-600">{errors.myanmarName.message}</span>
                                    ) : null}
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">English name</span>
                                    <input
                                        {...register("englishName")}
                                        placeholder="Example — Aung Mingalar"
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
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
                                            onChange={handleSurfacePresetChange}
                                            className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900 sm:max-w-xs"
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
                                            placeholder="e.g. asphalt, chipseal"
                                            list={surfaceListId}
                                            className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-gray-900"
                                        />
                                        <datalist id={surfaceListId}>
                                            {STREET_SURFACE_PRESETS.filter((p) => p.value !== "").map((p) => (
                                                <option key={p.value} value={p.value} />
                                            ))}
                                        </datalist>
                                    </div>
                                    <span className="mt-1 block text-xs text-gray-500">
                                        Choose a preset or type any surface value supported by editors.
                                    </span>
                                </div>

                                <label className="flex items-start gap-2 pt-1">
                                    <input
                                        type="checkbox"
                                        {...register("is_oneway")}
                                        className="mt-1 rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700">One-way</span>
                                </label>

                                <label className="flex items-start gap-2 pt-1">
                                    <input
                                        type="checkbox"
                                        {...register("bridge")}
                                        className="mt-1 rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700">Bridge</span>
                                </label>

                                <label className="flex items-start gap-2 pt-1">
                                    <input
                                        type="checkbox"
                                        {...register("tunnel")}
                                        className="mt-1 rounded border-gray-300"
                                    />
                                    <span className="text-sm text-gray-700">Tunnel</span>
                                </label>

                                <label className="block">
                                    <span className="mb-1 block text-sm text-gray-700">Admin area</span>
                                    <select
                                        {...register("admin_area_id")}
                                        className="w-full rounded border border-gray-300 px-3 py-2 text-gray-900"
                                    >
                                        <option value="">No admin area</option>
                                        {adminAreas.map((adminArea) => (
                                            <option key={adminArea.id} value={adminArea.id}>
                                                {adminArea.canonical_name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>

                            <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 pt-4">
                                <Link
                                    href="/streets"
                                    className="rounded border border-gray-300 px-4 py-2 text-sm text-gray-700"
                                >
                                    Cancel
                                </Link>
                                <button
                                    type="submit"
                                    disabled={isSaving}
                                    className="rounded bg-gray-900 px-4 py-2 text-sm text-white disabled:opacity-60"
                                >
                                    {isSaving ? "Saving…" : "Save street"}
                                </button>
                            </div>
                        </div>
                    </form>
                ) : null}
            </div>
        </main>
    );
}
