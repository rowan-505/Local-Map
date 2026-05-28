"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { isAbortError } from "@/src/lib/api";
import {
    getAdminRoutingBuilds,
    getAdminRoutingFeedback,
    getAdminRoutingHealth,
    getAdminRoutingValidationReports,
    patchAdminRoutingFeedbackStatus,
} from "./api";
import type {
    RoutingAdminBuildSummary,
    RoutingAdminFeedbackRow,
    RoutingAdminHealthResponse,
    RoutingAdminValidationReportRow,
    RoutingFeedbackStatus,
} from "./types";

function Section({
    title,
    subtitle,
    children,
}: {
    readonly title: string;
    readonly subtitle?: string;
    readonly children: ReactNode;
}) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4">
                <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
                {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
            </div>
            {children}
        </section>
    );
}

function StatusPill({ status }: { readonly status: string }) {
    const tone =
        status === "healthy" || status === "published" || status === "success" || status === "resolved"
            ? "bg-green-50 text-green-800 ring-green-100"
            : status === "down" || status === "failed" || status === "error"
              ? "bg-red-50 text-red-800 ring-red-100"
              : status === "degraded" || status === "warning" || status === "open"
                ? "bg-amber-50 text-amber-900 ring-amber-100"
                : "bg-gray-100 text-gray-800 ring-gray-200";

    return (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone}`}>
            {status}
        </span>
    );
}

export default function RoutingAdminPage() {
    const [health, setHealth] = useState<RoutingAdminHealthResponse | null>(null);
    const [builds, setBuilds] = useState<readonly RoutingAdminBuildSummary[]>([]);
    const [buildsTotal, setBuildsTotal] = useState(0);
    const [feedback, setFeedback] = useState<readonly RoutingAdminFeedbackRow[]>([]);
    const [feedbackTotal, setFeedbackTotal] = useState(0);
    const [reports, setReports] = useState<readonly RoutingAdminValidationReportRow[]>([]);
    const [reportsTotal, setReportsTotal] = useState(0);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [feedbackBusyId, setFeedbackBusyId] = useState<string | null>(null);

    const load = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError("");
        try {
            const [healthRes, buildsRes, feedbackRes, reportsRes] = await Promise.all([
                getAdminRoutingHealth(signal ? { signal } : undefined),
                getAdminRoutingBuilds({ limit: 50, offset: 0 }, signal ? { signal } : undefined),
                getAdminRoutingFeedback({ limit: 50, offset: 0 }, signal ? { signal } : undefined),
                getAdminRoutingValidationReports({ limit: 50, offset: 0 }, signal ? { signal } : undefined),
            ]);
            setHealth(healthRes);
            setBuilds(buildsRes.items);
            setBuildsTotal(buildsRes.total);
            setFeedback(feedbackRes.items);
            setFeedbackTotal(feedbackRes.total);
            setReports(reportsRes.items);
            setReportsTotal(reportsRes.total);
        } catch (err) {
            if (isAbortError(err)) return;
            setError(err instanceof Error ? err.message : "Failed to load routing admin data.");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const onFeedbackStatusChange = async (row: RoutingAdminFeedbackRow, status: RoutingFeedbackStatus) => {
        setFeedbackBusyId(row.publicId);
        try {
            const updated = await patchAdminRoutingFeedbackStatus(row.publicId, status);
            setFeedback((items) =>
                items.map((item) => (item.publicId === updated.publicId ? updated : item))
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update feedback status.");
        } finally {
            setFeedbackBusyId(null);
        }
    };

    if (loading) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-7xl rounded-lg border border-gray-200 bg-white p-6 text-gray-700">
                    Loading routing administration…
                </div>
            </main>
        );
    }

    return (
        <main className="p-6">
            <div className="mx-auto max-w-7xl space-y-6">
                <header className="border-b border-gray-200 pb-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                        System admin
                    </p>
                    <h1 className="text-2xl font-bold text-gray-900">Routing</h1>
                    <p className="mt-1 text-sm text-gray-600">
                        Inspect Valhalla service health, published builds, validation reports, and user
                        route feedback. Build/publish from the dashboard is not enabled yet.
                    </p>
                    <button
                        type="button"
                        className="mt-3 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50"
                        onClick={() => {
                            void load();
                        }}
                    >
                        Refresh
                    </button>
                </header>

                {error ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error}
                    </div>
                ) : null}

                {health && !health.schemaAvailable ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                        Routing metadata tables are not available. Apply migration 060 to enable build
                        history and feedback storage.
                    </div>
                ) : null}

                <Section title="Service health" subtitle="Live API probe and persisted health rows.">
                    {health ? (
                        <div className="grid gap-4 lg:grid-cols-2">
                            <div className="rounded-md border border-gray-100 bg-gray-50 p-4 text-sm">
                                <h3 className="font-semibold text-gray-900">Configuration</h3>
                                <ul className="mt-2 space-y-1 text-gray-700">
                                    <li>
                                        Routing enabled:{" "}
                                        <strong>{health.configuration.routingEnabled ? "yes" : "no"}</strong>
                                    </li>
                                    <li>
                                        Default engine: <strong>{health.configuration.defaultEngine}</strong>
                                    </li>
                                    <li>
                                        Valhalla URL:{" "}
                                        <code className="text-xs">{health.configuration.valhallaBaseUrl}</code>
                                    </li>
                                    <li>
                                        Public profiles:{" "}
                                        {health.configuration.configuredPublicProfiles.join(", ") || "—"}
                                    </li>
                                </ul>
                            </div>
                            <div className="rounded-md border border-gray-100 bg-gray-50 p-4 text-sm">
                                <h3 className="font-semibold text-gray-900">Live probe</h3>
                                {health.live.engineHealth ? (
                                    <ul className="mt-2 space-y-1 text-gray-700">
                                        <li>
                                            Engine: <strong>{health.live.engineHealth.engine}</strong>{" "}
                                            <StatusPill status={health.live.engineHealth.status} />
                                        </li>
                                        {health.live.engineHealth.latencyMs !== undefined ? (
                                            <li>Latency: {health.live.engineHealth.latencyMs} ms</li>
                                        ) : null}
                                        {health.live.engineHealth.message ? (
                                            <li>{health.live.engineHealth.message}</li>
                                        ) : null}
                                        <li className="text-xs text-gray-500">
                                            Checked {health.live.engineHealth.checkedAt}
                                        </li>
                                    </ul>
                                ) : (
                                    <p className="mt-2 text-gray-600">No engine health probe result.</p>
                                )}
                            </div>
                            {health.persistedServiceHealth.length > 0 ? (
                                <div className="lg:col-span-2 overflow-x-auto">
                                    <table className="min-w-full text-left text-sm">
                                        <thead className="border-b text-xs uppercase text-gray-500">
                                            <tr>
                                                <th className="px-2 py-2">Engine</th>
                                                <th className="px-2 py-2">Region</th>
                                                <th className="px-2 py-2">Status</th>
                                                <th className="px-2 py-2">Latency</th>
                                                <th className="px-2 py-2">Last check</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {health.persistedServiceHealth.map((row) => (
                                                <tr key={row.id} className="border-b border-gray-100">
                                                    <td className="px-2 py-2">{row.engineCode}</td>
                                                    <td className="px-2 py-2">{row.regionCode ?? "—"}</td>
                                                    <td className="px-2 py-2">
                                                        <StatusPill status={row.status} />
                                                    </td>
                                                    <td className="px-2 py-2">
                                                        {row.latencyMs ?? "—"}
                                                    </td>
                                                    <td className="px-2 py-2 text-xs text-gray-600">
                                                        {row.lastCheckAt ?? "—"}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                </Section>

                <Section
                    title="Active build"
                    subtitle="Builds marked is_active in routing.routing_builds."
                >
                    {health && health.activeBuilds.length === 0 ? (
                        <p className="text-sm text-gray-600">No active routing build registered.</p>
                    ) : (
                        <div className="space-y-3">
                            {(health?.activeBuilds ?? []).map((build) => (
                                <div
                                    key={build.publicId}
                                    className="rounded-md border border-sky-100 bg-sky-50/50 p-4 text-sm"
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <strong>{build.buildVersion}</strong>
                                        <StatusPill status={build.status} />
                                        <span className="text-gray-600">
                                            {build.engineCode}
                                            {build.regionCode ? ` · ${build.regionCode}` : ""}
                                        </span>
                                    </div>
                                    <p className="mt-1 text-gray-700">
                                        Profiles: {build.profileCodes.join(", ") || "—"}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        Public ID {build.publicId}
                                    </p>
                                </div>
                            ))}
                        </div>
                    )}
                </Section>

                <Section title="Build history" subtitle={`${buildsTotal} total builds (showing ${builds.length}).`}>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                            <thead className="border-b text-xs uppercase text-gray-500">
                                <tr>
                                    <th className="px-2 py-2">Version</th>
                                    <th className="px-2 py-2">Engine</th>
                                    <th className="px-2 py-2">Region</th>
                                    <th className="px-2 py-2">Status</th>
                                    <th className="px-2 py-2">Active</th>
                                    <th className="px-2 py-2">Warnings</th>
                                    <th className="px-2 py-2">Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {builds.map((build) => (
                                    <tr key={build.publicId} className="border-b border-gray-100">
                                        <td className="px-2 py-2 font-medium">{build.buildVersion}</td>
                                        <td className="px-2 py-2">{build.engineCode}</td>
                                        <td className="px-2 py-2">{build.regionCode ?? "—"}</td>
                                        <td className="px-2 py-2">
                                            <StatusPill status={build.status} />
                                        </td>
                                        <td className="px-2 py-2">{build.isActive ? "yes" : "no"}</td>
                                        <td className="px-2 py-2">
                                            {build.warningCount} / {build.errorCount}
                                        </td>
                                        <td className="px-2 py-2 text-xs text-gray-600">
                                            {new Date(build.createdAt).toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Section>

                <Section
                    title="Validation reports"
                    subtitle={`${reportsTotal} total (showing ${reports.length}).`}
                >
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                            <thead className="border-b text-xs uppercase text-gray-500">
                                <tr>
                                    <th className="px-2 py-2">Severity</th>
                                    <th className="px-2 py-2">Code</th>
                                    <th className="px-2 py-2">Scope</th>
                                    <th className="px-2 py-2">Build</th>
                                    <th className="px-2 py-2">Message</th>
                                </tr>
                            </thead>
                            <tbody>
                                {reports.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-2 py-4 text-gray-500">
                                            No validation reports.
                                        </td>
                                    </tr>
                                ) : (
                                    reports.map((row) => (
                                        <tr key={row.id} className="border-b border-gray-100">
                                            <td className="px-2 py-2">
                                                <StatusPill status={row.severity} />
                                            </td>
                                            <td className="px-2 py-2 font-mono text-xs">{row.code}</td>
                                            <td className="px-2 py-2">{row.reportScope}</td>
                                            <td className="px-2 py-2">{row.routingBuildId ?? row.buildJobId ?? "—"}</td>
                                            <td className="max-w-md px-2 py-2 text-gray-700">{row.message}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </Section>

                <Section
                    title="User route feedback"
                    subtitle={`${feedbackTotal} total (showing ${feedback.length}).`}
                >
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-left text-sm">
                            <thead className="border-b text-xs uppercase text-gray-500">
                                <tr>
                                    <th className="px-2 py-2">Problem</th>
                                    <th className="px-2 py-2">Status</th>
                                    <th className="px-2 py-2">Request</th>
                                    <th className="px-2 py-2">Created</th>
                                    <th className="px-2 py-2">Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {feedback.length === 0 ? (
                                    <tr>
                                        <td colSpan={5} className="px-2 py-4 text-gray-500">
                                            No feedback yet.
                                        </td>
                                    </tr>
                                ) : (
                                    feedback.map((row) => (
                                        <tr key={row.publicId} className="border-b border-gray-100 align-top">
                                            <td className="px-2 py-2">
                                                <div className="font-medium">{row.problemType}</div>
                                                {row.comment ? (
                                                    <p className="mt-1 text-xs text-gray-600">{row.comment}</p>
                                                ) : null}
                                            </td>
                                            <td className="px-2 py-2">
                                                <StatusPill status={row.status} />
                                            </td>
                                            <td className="px-2 py-2 font-mono text-xs">
                                                {row.routingRequestPublicId ?? "—"}
                                            </td>
                                            <td className="px-2 py-2 text-xs text-gray-600">
                                                {new Date(row.createdAt).toLocaleString()}
                                            </td>
                                            <td className="px-2 py-2">
                                                <select
                                                    className="rounded border border-gray-300 text-xs"
                                                    value={row.status}
                                                    disabled={feedbackBusyId === row.publicId}
                                                    onChange={(event) => {
                                                        void onFeedbackStatusChange(
                                                            row,
                                                            event.target.value as RoutingFeedbackStatus
                                                        );
                                                    }}
                                                >
                                                    <option value="open">open</option>
                                                    <option value="triaged">triaged</option>
                                                    <option value="resolved">resolved</option>
                                                    <option value="dismissed">dismissed</option>
                                                </select>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </Section>
            </div>
        </main>
    );
}
