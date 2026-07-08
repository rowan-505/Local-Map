"use client";

import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { getTransportStopNearby, mergeTransportStops } from "./api";
import type { TransportNearbyStop, TransportStopDetail } from "./types";

const SELECT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

const MERGE_RADIUS_M = 50;

export default function TransportStopMergePanel({
    stop,
    onMerged,
}: {
    readonly stop: TransportStopDetail;
    readonly onMerged: (targetPublicId: string) => void;
}) {
    const [nearby, setNearby] = useState<readonly TransportNearbyStop[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [targetId, setTargetId] = useState("");
    const [reason, setReason] = useState("");
    const [merging, setMerging] = useState(false);
    const [mergeError, setMergeError] = useState("");

    const loadNearby = useCallback(async (signal?: AbortSignal) => {
        if (stop.longitude === null || stop.latitude === null) {
            setNearby([]);
            return;
        }
        setLoading(true);
        setLoadError("");
        try {
            const hits = await getTransportStopNearby(
                stop.public_id,
                { lng: stop.longitude, lat: stop.latitude, radius_m: MERGE_RADIUS_M },
                { signal }
            );
            setNearby(hits.filter((h) => h.stop_public_id !== stop.public_id));
            setTargetId((prev) => {
                if (prev && hits.some((h) => h.stop_public_id === prev)) return prev;
                return hits.find((h) => h.stop_public_id !== stop.public_id)?.stop_public_id ?? "";
            });
        } catch (err) {
            if (isAbortError(err)) return;
            setLoadError(err instanceof Error ? err.message : "Failed to load nearby stops.");
        } finally {
            setLoading(false);
        }
    }, [stop.public_id, stop.longitude, stop.latitude]);

    useEffect(() => {
        const controller = new AbortController();
        void loadNearby(controller.signal);
        return () => controller.abort();
    }, [loadNearby]);

    const handleMerge = async () => {
        if (!targetId) {
            setMergeError("Select a target stop to merge into.");
            return;
        }
        setMergeError("");
        setMerging(true);
        try {
            await mergeTransportStops(stop.public_id, targetId, reason.trim() || undefined);
            onMerged(targetId);
        } catch (err) {
            if (isAbortError(err)) return;
            setMergeError(err instanceof Error ? err.message : "Merge failed.");
        } finally {
            setMerging(false);
        }
    };

    if (stop.longitude === null || stop.latitude === null) {
        return (
            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Merge duplicates
                </h2>
                <p className="text-sm text-gray-500">Set a stop location before merging duplicates.</p>
            </section>
        );
    }

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                Merge duplicates
            </h2>
            <p className="mb-3 text-xs text-gray-600">
                Nearby stops within {MERGE_RADIUS_M} m. Merging moves route memberships to the
                target and rejects this stop.
            </p>

            {loading ? (
                <p className="text-sm text-gray-500">Loading nearby stops…</p>
            ) : loadError ? (
                <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                    {loadError}
                </p>
            ) : nearby.length === 0 ? (
                <p className="text-sm text-gray-500">No nearby duplicates within {MERGE_RADIUS_M} m.</p>
            ) : (
                <div className="space-y-3">
                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Merge into target stop
                        </span>
                        <select
                            className={SELECT_CLASS}
                            value={targetId}
                            onChange={(e) => setTargetId(e.target.value)}
                        >
                            <option value="">Select target…</option>
                            {nearby.map((h) => (
                                <option key={h.stop_public_id} value={h.stop_public_id}>
                                    {h.name} · {Math.round(h.distance_m)} m · {h.stop_type}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className="flex flex-col gap-1">
                        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Reason (optional)
                        </span>
                        <input
                            type="text"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Why merge these stops?"
                            className={SELECT_CLASS}
                        />
                    </label>

                    {mergeError ? (
                        <p className="rounded-md border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs text-red-800">
                            {mergeError}
                        </p>
                    ) : null}

                    <div className="flex justify-end">
                        <button
                            type="button"
                            disabled={merging || !targetId}
                            onClick={() => void handleMerge()}
                            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
                        >
                            {merging ? "Merging…" : "Merge into target"}
                        </button>
                    </div>
                </div>
            )}
        </section>
    );
}
