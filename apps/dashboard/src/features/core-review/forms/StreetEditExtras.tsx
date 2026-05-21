"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { lineStringLengthValidMinVertices, normalizeLineStringForEditor } from "@/src/features/streets/normalizeStreetLineString";
import { splitStreet, type Street } from "@/src/lib/api";
import { getCoreEntityConfig } from "@/src/lib/core-review/entityConfigs";
import { dashDevLog } from "@/src/lib/dashDevLog";

export type StreetSplitMapProps = {
    splitPickActive: boolean;
    splitPreviewLngLat: { lng: number; lat: number } | null;
    onSplitPickModeChange: (active: boolean) => void;
    onSplitPointClicked: (lng: number, lat: number) => void;
    onClearSplitPreview: () => void;
};

export type StreetEditExtrasProps = {
    street: Street;
    streetId: string;
    isSaving: boolean;
    editReason: string;
    onSoftDelete: () => void;
    onSplitMapPropsChange: (props: StreetSplitMapProps) => void;
    onReload: () => Promise<void>;
};

export default function StreetEditExtras({
    street,
    streetId,
    isSaving,
    editReason,
    onSoftDelete,
    onSplitMapPropsChange,
    onReload,
}: StreetEditExtrasProps) {
    const router = useRouter();
    const [splitPickMode, setSplitPickMode] = useState(false);
    const [splitLngLat, setSplitLngLat] = useState<{ lng: number; lat: number } | null>(null);
    const [splitReason, setSplitReason] = useState("");
    const [splitBusy, setSplitBusy] = useState(false);
    const [splitError, setSplitError] = useState("");
    const [splitSuccessMessage, setSplitSuccessMessage] = useState<string | null>(null);

    const normalized = useMemo(() => normalizeLineStringForEditor(street.geometry), [street.geometry]);

    const canOfferSplit = useMemo(() => {
        if (street.deleted_at || !street.is_active) {
            return false;
        }
        return lineStringLengthValidMinVertices(normalized.line);
    }, [normalized.line, street.deleted_at, street.is_active]);

    const handleSplitPointClicked = useCallback((lng: number, lat: number) => {
        setSplitLngLat({ lng, lat });
        setSplitError("");
    }, []);

    const handleClearSplitPreview = useCallback(() => {
        setSplitLngLat(null);
    }, []);

    const handleSplitPickModeChange = useCallback((active: boolean) => {
        setSplitPickMode(active);
        if (!active) {
            setSplitLngLat(null);
        }
        setSplitError("");
    }, []);

    useEffect(() => {
        onSplitMapPropsChange({
            splitPickActive: splitPickMode,
            splitPreviewLngLat: splitLngLat,
            onSplitPickModeChange: handleSplitPickModeChange,
            onSplitPointClicked: handleSplitPointClicked,
            onClearSplitPreview: handleClearSplitPreview,
        });
    }, [
        handleClearSplitPreview,
        handleSplitPickModeChange,
        handleSplitPointClicked,
        onSplitMapPropsChange,
        splitLngLat,
        splitPickMode,
    ]);

    async function handleSplitSubmit() {
        if (!splitLngLat) {
            return;
        }

        setSplitBusy(true);
        setSplitError("");
        setSplitSuccessMessage(null);

        try {
            const reason = (splitReason.trim() || editReason.trim()) || undefined;
            const res = await splitStreet(streetId, {
                point: { lat: splitLngLat.lat, lng: splitLngLat.lng },
                editReason: reason,
            });
            const segments = res.newStreets.length > 0 ? res.newStreets : (res.streets ?? []);
            dashDevLog("street:edit:split-success", { segmentCount: segments.length });

            setSplitPickMode(false);
            setSplitLngLat(null);
            setSplitSuccessMessage(
                segments.length > 1
                    ? `Split into ${segments.length} segments. Opening first new segment…`
                    : "Split completed.",
            );

            if (segments[0]?.public_id) {
                const config = getCoreEntityConfig("streets");
                router.push(config.editRoute(segments[0].public_id));
                return;
            }

            await onReload();
        } catch (err) {
            setSplitError(err instanceof Error ? err.message : "Split failed");
        } finally {
            setSplitBusy(false);
        }
    }

    if (street.deleted_at) {
        return (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
                This street is soft-deleted. Restore via database/admin workflow if needed.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h3 className="text-base font-semibold text-slate-900">Split road</h3>
                <p className="mt-1 text-xs text-slate-600">
                    Start split mode, choose a point on the centerline map, then confirm. The API projects
                    your click onto the stored LineString within 5 m.
                </p>
                {!canOfferSplit ? (
                    <p className="mt-2 text-sm text-amber-900">
                        Split requires a loaded LineString geometry and an active, non-deleted street.
                    </p>
                ) : null}
                {splitPickMode ? (
                    <p className="mt-2 text-sm font-medium text-sky-900">
                        Split mode: click once on the map on the street centerline to place the split point.
                    </p>
                ) : null}
                {splitLngLat ? (
                    <p className="mt-2 font-mono text-xs text-slate-800">
                        Split point: {splitLngLat.lng.toFixed(6)}, {splitLngLat.lat.toFixed(6)}
                    </p>
                ) : null}
                {splitError ? (
                    <div className="mt-2 whitespace-pre-wrap rounded border border-red-200 bg-red-50 p-2 text-sm text-red-900">
                        {splitError}
                    </div>
                ) : null}
                {splitSuccessMessage ? (
                    <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900">
                        {splitSuccessMessage}
                    </div>
                ) : null}
                <label className="mt-3 block">
                    <span className="mb-1 block text-sm text-slate-700">Split reason (optional)</span>
                    <textarea
                        rows={2}
                        value={splitReason}
                        onChange={(event) => setSplitReason(event.target.value)}
                        disabled={!canOfferSplit || splitBusy || isSaving}
                        placeholder="Audit note for split operation"
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 disabled:bg-slate-100"
                    />
                </label>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        disabled={!canOfferSplit || splitBusy || isSaving}
                        onClick={() => {
                            setSplitError("");
                            setSplitSuccessMessage(null);
                            if (splitPickMode) {
                                handleSplitPickModeChange(false);
                            } else {
                                handleSplitPickModeChange(true);
                            }
                        }}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    >
                        {splitPickMode ? "Cancel split" : "Split road"}
                    </button>
                    <button
                        type="button"
                        disabled={!canOfferSplit || !splitLngLat || splitBusy || isSaving}
                        onClick={() => void handleSplitSubmit()}
                        className="rounded-md bg-teal-800 px-3 py-1.5 text-sm text-white hover:bg-teal-900 disabled:opacity-50"
                    >
                        {splitBusy ? "Splitting…" : "Confirm split"}
                    </button>
                </div>
            </div>

            <div className="rounded-lg border border-red-200 bg-red-50/50 p-4">
                <h3 className="text-sm font-semibold text-red-900">Danger zone</h3>
                <p className="mt-1 text-xs text-red-800/90">
                    Soft-delete hides the street from default lists. Provide an edit reason if you want it
                    recorded in the audit trail.
                </p>
                <button
                    type="button"
                    disabled={isSaving || splitBusy}
                    onClick={onSoftDelete}
                    className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
                >
                    Soft-delete street
                </button>
            </div>
        </div>
    );
}
