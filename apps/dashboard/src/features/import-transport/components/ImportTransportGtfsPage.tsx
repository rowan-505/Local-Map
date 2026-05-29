"use client";

import { useCallback, useEffect, useState } from "react";

import {
    formatImportTransportHistoryDate,
    ImportTransportHistoryStatusBadge,
} from "@/src/features/import-transport/components/importTransportHistoryUi";
import ImportTransportSkeletonTable from "@/src/features/import-transport/components/ImportTransportSkeletonTable";
import {
    getImportTransportGtfsExports,
    getImportTransportGtfsOtpBuilds,
    isAbortError,
    postImportTransportGtfsExportDryRun,
} from "@/src/features/import-transport/api/importTransportApiClient";
import { formatImportTransportApiError } from "@/src/features/import-transport/api/importTransportApiErrors";
import ImportTransportErrorState from "@/src/features/import-transport/components/ImportTransportErrorState";
import { ImportTransportLoadingBannerWithSpinner } from "@/src/features/import-transport/components/ImportTransportLoadingState";
import ImportTransportStatusBadge from "@/src/features/import-transport/components/ImportTransportStatusBadge";
import type {
    ImportTransportGtfsExportListItem,
    ImportTransportGtfsOtpBuildListItem,
} from "@/src/features/import-transport/config/types";
import { IMPORT_TRANSPORT_LOADING } from "@/src/features/import-transport/utils/loadingMessages";

const OTP_NOTE =
    "OpenTripPlanner consumes GTFS export files and graph artifacts — not Postgres. " +
    "Flow: core_transport → GTFS export files → OTP graph build → API transit routing endpoint.";

function snapshotLabel(item: ImportTransportGtfsExportListItem): string {
    const snap = item.core_transport_snapshot;
    if (!snap) {
        return "—";
    }
    return `${formatImportTransportHistoryDate(snap.snapshot_at)} · routes ${snap.active_routes} · stops ${snap.active_stops}`;
}

export default function ImportTransportGtfsPage() {
    const [exports, setExports] = useState<ImportTransportGtfsExportListItem[]>([]);
    const [otpBuilds, setOtpBuilds] = useState<ImportTransportGtfsOtpBuildListItem[]>([]);
    const [exportsTotal, setExportsTotal] = useState(0);
    const [otpTotal, setOtpTotal] = useState(0);
    const [selectedExportId, setSelectedExportId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState("");
    const [actionMessage, setActionMessage] = useState("");

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError("");
        try {
            const [exportData, otpData] = await Promise.all([
                getImportTransportGtfsExports({ limit: 25, offset: 0 }, signal ? { signal } : undefined),
                getImportTransportGtfsOtpBuilds({ limit: 25, offset: 0 }, signal ? { signal } : undefined),
            ]);
            setExports(exportData.items);
            setExportsTotal(exportData.total);
            setOtpBuilds(otpData.items);
            setOtpTotal(otpData.total);
            setSelectedExportId((current) => current ?? exportData.items[0]?.id ?? null);
        } catch (err) {
            if (!isAbortError(err)) {
                setError(formatImportTransportApiError(err, "Failed to load GTFS export tracking."));
            }
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const selectedExport = exports.find((row) => row.id === selectedExportId) ?? null;
    const linkedOtpBuilds = selectedExportId
        ? otpBuilds.filter((row) => row.export_build_id === selectedExportId)
        : [];

    const handleDryRun = async () => {
        setCreating(true);
        setActionMessage("");
        setError("");
        try {
            const result = await postImportTransportGtfsExportDryRun({
                scope: "yangon_local_bus",
                dry_run: true,
            });
            setActionMessage(result.message);
            setSelectedExportId(result.export.id);
            await load();
        } catch (err) {
            setError(formatImportTransportApiError(err, "Failed to create GTFS export dry-run."));
        } finally {
            setCreating(false);
        }
    };

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="border-b border-gray-200 pb-4">
                    <h1 className="text-2xl font-bold text-gray-900">GTFS export & OTP builds</h1>
                    <p className="mt-2 text-sm text-gray-600">{OTP_NOTE}</p>
                </header>

                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        disabled={creating}
                        onClick={() => void handleDryRun()}
                        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                        {creating ? "Creating dry-run…" : "Create GTFS export dry-run"}
                    </button>
                    {actionMessage ? (
                        <p className="text-sm text-emerald-800">{actionMessage}</p>
                    ) : null}
                </div>

                <ImportTransportErrorState message={error} />

                {loading && exports.length === 0 ? (
                    <ImportTransportLoadingBannerWithSpinner message={IMPORT_TRANSPORT_LOADING.loadingHistory} />
                ) : null}

                <section className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className="text-lg font-semibold text-gray-900">GTFS export batches</h2>
                        <span className="text-sm text-gray-600">{exportsTotal.toLocaleString()} total</span>
                    </div>
                    {loading && exports.length === 0 ? (
                        <ImportTransportSkeletonTable columnCount={8} rowCount={5} />
                    ) : exports.length === 0 ? (
                        <p className="rounded-lg border border-dashed border-gray-300 bg-white px-4 py-8 text-center text-sm text-gray-600">
                            No GTFS export batches yet. Use the dry-run button to record a core_transport readiness
                            snapshot.
                        </p>
                    ) : (
                        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
                            <table className="min-w-full divide-y divide-gray-200 text-sm">
                                <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    <tr>
                                        <th className="px-4 py-3">Batch</th>
                                        <th className="px-4 py-3">Scope</th>
                                        <th className="px-4 py-3">Status</th>
                                        <th className="px-4 py-3">Validation</th>
                                        <th className="px-4 py-3">core_transport snapshot</th>
                                        <th className="px-4 py-3">Files</th>
                                        <th className="px-4 py-3">OTP build</th>
                                        <th className="px-4 py-3">Created</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {exports.map((row) => (
                                        <tr
                                            key={row.id}
                                            className={`cursor-pointer hover:bg-gray-50 ${
                                                selectedExportId === row.id ? "bg-blue-50/60" : ""
                                            }`}
                                            onClick={() => setSelectedExportId(row.id)}
                                        >
                                            <td className="px-4 py-3">
                                                <div className="font-medium text-gray-900">{row.build_code}</div>
                                                <div className="font-mono text-xs text-gray-500">#{row.id}</div>
                                                {row.dry_run ? (
                                                    <span className="text-xs text-amber-700">dry-run</span>
                                                ) : null}
                                            </td>
                                            <td className="px-4 py-3">{row.scope}</td>
                                            <td className="px-4 py-3">
                                                <ImportTransportHistoryStatusBadge status={row.status} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <ImportTransportStatusBadge value={row.validation_status} />
                                                <div className="mt-1 text-xs text-gray-500">
                                                    err {row.error_count} · warn {row.warning_count}
                                                </div>
                                            </td>
                                            <td className="px-4 py-3 max-w-xs text-xs text-gray-700">
                                                {snapshotLabel(row)}
                                            </td>
                                            <td className="px-4 py-3 tabular-nums">{row.file_count}</td>
                                            <td className="px-4 py-3">
                                                {row.latest_otp_build_status ? (
                                                    <ImportTransportHistoryStatusBadge status={row.latest_otp_build_status} />
                                                ) : (
                                                    "—"
                                                )}
                                            </td>
                                            <td className="px-4 py-3 text-gray-700">
                                                {formatImportTransportHistoryDate(row.created_at)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </section>

                {selectedExport ? (
                    <section className="grid gap-4 lg:grid-cols-2">
                        <div className="rounded-lg border border-gray-200 bg-white p-4">
                            <h3 className="text-sm font-semibold text-gray-900">Selected export detail</h3>
                            <dl className="mt-3 space-y-2 text-sm">
                                <div className="flex justify-between gap-4">
                                    <dt className="text-gray-500">Export batch id</dt>
                                    <dd className="font-mono">{selectedExport.id}</dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt className="text-gray-500">Routes / variants / stops</dt>
                                    <dd className="tabular-nums">
                                        {selectedExport.route_count} / {selectedExport.variant_count} /{" "}
                                        {selectedExport.stop_count}
                                    </dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt className="text-gray-500">Generated files</dt>
                                    <dd className="tabular-nums">{selectedExport.file_count}</dd>
                                </div>
                                <div className="flex justify-between gap-4">
                                    <dt className="text-gray-500">Output path</dt>
                                    <dd className="max-w-xs truncate">{selectedExport.output_path ?? "—"}</dd>
                                </div>
                            </dl>
                            <p className="mt-4 text-xs text-gray-600">
                                Planned GTFS files (not generated in dry-run): agency.txt, stops.txt, routes.txt,
                                trips.txt, stop_times.txt, calendar.txt, frequencies.txt, shapes.txt, feed_info.txt
                            </p>
                        </div>
                        <div className="rounded-lg border border-gray-200 bg-white p-4">
                            <h3 className="text-sm font-semibold text-gray-900">OTP build status</h3>
                            {linkedOtpBuilds.length === 0 ? (
                                <p className="mt-3 text-sm text-gray-600">
                                    No OTP graph builds linked to this export yet.
                                </p>
                            ) : (
                                <ul className="mt-3 space-y-2 text-sm">
                                    {linkedOtpBuilds.map((build) => (
                                        <li
                                            key={build.id}
                                            className="rounded-md border border-gray-200 px-3 py-2"
                                        >
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="font-medium">{build.build_code}</span>
                                                <ImportTransportHistoryStatusBadge status={build.build_status} />
                                            </div>
                                            <p className="mt-1 font-mono text-xs text-gray-500">#{build.id}</p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {otpBuilds.length > 0 ? (
                                <p className="mt-4 text-xs text-gray-500">
                                    {otpTotal.toLocaleString()} OTP build record(s) tracked globally.
                                </p>
                            ) : null}
                        </div>
                    </section>
                ) : null}
            </div>
        </main>
    );
}
