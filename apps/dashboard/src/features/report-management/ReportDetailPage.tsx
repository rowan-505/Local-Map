"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { isAbortError } from "@/src/lib/api";
import { reportsPath } from "@/src/lib/dashboardPaths";

import {
    changeReportStatus,
    getReport,
    requestReportInfo,
    rewardReportPoints,
    updateReportAdminNote,
} from "./api";
import {
    REWARD_REASON_OPTIONS,
    formatDateTime,
    reportTypeLabel,
    statusBadgeClass,
    statusLabel,
    targetTypeLabel,
} from "./constants";
import type { AdminReportDetail, ReportStatusCode, RewardReasonCode } from "./types";

const PRIMARY_BTN =
    "rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY_BTN =
    "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50";
const DANGER_BTN =
    "rounded-md border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";
const INPUT_CLASS =
    "w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-500 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
const SELECT_CLASS =
    "rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
            {children}
        </section>
    );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</span>
            <span className="text-sm text-gray-900">{value}</span>
        </div>
    );
}

export default function ReportDetailPage({ id }: { id: string }) {
    const [report, setReport] = useState<AdminReportDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [actionLoading, setActionLoading] = useState(false);
    const [actionError, setActionError] = useState("");
    const [actionMsg, setActionMsg] = useState("");

    const [requestInfoText, setRequestInfoText] = useState("");
    const [noteText, setNoteText] = useState("");
    const [rewardPoints, setRewardPoints] = useState("10");
    const [rewardReason, setRewardReason] = useState<RewardReasonCode>("valid_report");
    const [rewardNote, setRewardNote] = useState("");

    const load = useCallback(
        async (signal?: AbortSignal) => {
            setLoading(true);
            setError("");
            try {
                const res = await getReport(id, signal ? { signal } : undefined);
                setReport(res);
                setNoteText(res.admin_note ?? "");
            } catch (err) {
                if (isAbortError(err)) return;
                setError(err instanceof Error ? err.message : "Failed to load report.");
                setReport(null);
            } finally {
                setLoading(false);
            }
        },
        [id]
    );

    useEffect(() => {
        const controller = new AbortController();
        void load(controller.signal);
        return () => controller.abort();
    }, [load]);

    const runAction = useCallback(
        async (fn: () => Promise<unknown>, successMsg: string) => {
            setActionLoading(true);
            setActionError("");
            setActionMsg("");
            try {
                await fn();
                setActionMsg(successMsg);
                await load();
            } catch (err) {
                setActionError(err instanceof Error ? err.message : "Action failed.");
            } finally {
                setActionLoading(false);
            }
        },
        [load]
    );

    if (loading) {
        return <main className="p-6 text-sm text-gray-500">Loading report…</main>;
    }

    if (error || !report) {
        return (
            <main className="p-6">
                <div className="mx-auto max-w-5xl space-y-4">
                    <Link href={reportsPath()} className="text-sm text-gray-600 hover:underline">
                        ← Back to reports
                    </Link>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                        {error || "Report not found."}
                    </div>
                </div>
            </main>
        );
    }

    const status = report.status.code;
    const canMarkInReview = status === "submitted";
    const canAccept = status === "in_review";
    const canReject = status === "in_review";
    const canMarkDuplicate = status === "submitted" || status === "in_review";
    const canRequestInfo = status === "submitted" || status === "in_review";
    const canReward =
        status === "accepted" && report.eligible_for_points && report.reward_granted_at === null;

    const changeStatus = (next: ReportStatusCode, msg: string) =>
        runAction(() => changeReportStatus(report.public_id, next), msg);

    const hasGeom = report.latitude !== null && report.longitude !== null;
    const osmUrl = hasGeom
        ? `https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=17/${report.latitude}/${report.longitude}`
        : null;

    return (
        <main className="p-6">
            <div className="mx-auto max-w-6xl space-y-5">
                <div>
                    <Link href={reportsPath()} className="text-sm text-gray-600 hover:underline">
                        ← Back to reports
                    </Link>
                </div>

                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
                    <div className="flex items-center gap-3">
                        <h1 className="text-2xl font-bold text-gray-900">
                            {reportTypeLabel(report.report_type.code)}
                        </h1>
                        <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${statusBadgeClass(
                                status
                            )}`}
                        >
                            {statusLabel(status)}
                        </span>
                        {report.is_anonymous ? (
                            <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
                                Anonymous
                            </span>
                        ) : null}
                    </div>
                    <span className="font-mono text-xs text-gray-400">{report.public_id}</span>
                </header>

                {actionError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        {actionError}
                    </div>
                ) : null}
                {actionMsg ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                        {actionMsg}
                    </div>
                ) : null}

                <div className="grid gap-5 lg:grid-cols-3">
                    <div className="space-y-5 lg:col-span-2">
                        <Card title="Report">
                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Type" value={reportTypeLabel(report.report_type.code)} />
                                <Field label="Status" value={statusLabel(status)} />
                                <Field label="Priority" value={<span className="capitalize">{report.priority}</span>} />
                                <Field label="Confidence" value={`${report.confidence_score}/100`} />
                                <Field label="Reason code" value={report.reason_code ?? "—"} />
                                <Field label="Created" value={formatDateTime(report.created_at)} />
                            </div>
                            <div className="mt-4">
                                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                                    Description
                                </span>
                                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                                    {report.description}
                                </p>
                            </div>
                        </Card>

                        <Card title="Target">
                            <div className="grid grid-cols-2 gap-4">
                                <Field label="Entity type" value={targetTypeLabel(report.target_entity_type)} />
                                <Field label="Entity ID" value={report.target_entity_id ?? "—"} />
                                <Field label="Public ID" value={report.target_public_id ?? "—"} />
                                <Field label="Region (admin area)" value={report.admin_area_id ?? "—"} />
                            </div>
                            {hasGeom ? (
                                <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-sm text-gray-700">
                                            {report.latitude}, {report.longitude}
                                        </span>
                                        {osmUrl ? (
                                            <a
                                                href={osmUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-sm font-medium text-gray-900 underline-offset-2 hover:underline"
                                            >
                                                Open in map ↗
                                            </a>
                                        ) : null}
                                    </div>
                                </div>
                            ) : (
                                <p className="mt-4 text-sm text-gray-500">No coordinates attached.</p>
                            )}
                        </Card>

                        <Card title="Status history">
                            {report.status_events.length === 0 ? (
                                <p className="text-sm text-gray-500">No status changes yet.</p>
                            ) : (
                                <ol className="space-y-2">
                                    {report.status_events.map((ev, i) => (
                                        <li
                                            key={`${ev.created_at}-${i}`}
                                            className="flex flex-wrap items-center gap-2 text-sm"
                                        >
                                            <span className="text-gray-400">
                                                {formatDateTime(ev.created_at)}
                                            </span>
                                            <span className="text-gray-700">
                                                {ev.old_status_code
                                                    ? `${statusLabel(ev.old_status_code)} → ${statusLabel(
                                                          ev.new_status_code
                                                      )}`
                                                    : statusLabel(ev.new_status_code)}
                                            </span>
                                            {ev.actor_display_name ? (
                                                <span className="text-gray-500">
                                                    by {ev.actor_display_name}
                                                </span>
                                            ) : null}
                                            {ev.note ? (
                                                <span className="text-gray-500">— {ev.note}</span>
                                            ) : null}
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </Card>

                        <Card title="Follow-up messages">
                            {report.followups.length === 0 ? (
                                <p className="text-sm text-gray-500">No follow-up messages.</p>
                            ) : (
                                <ul className="space-y-3">
                                    {report.followups.map((f, i) => (
                                        <li
                                            key={`${f.created_at}-${i}`}
                                            className="rounded-md border border-gray-200 p-3"
                                        >
                                            <div className="mb-1 flex items-center gap-2 text-xs text-gray-500">
                                                <span className="font-medium capitalize text-gray-700">
                                                    {f.actor_type}
                                                </span>
                                                {f.actor_display_name ? (
                                                    <span>· {f.actor_display_name}</span>
                                                ) : null}
                                                <span>· {formatDateTime(f.created_at)}</span>
                                            </div>
                                            <p className="whitespace-pre-wrap text-sm text-gray-900">
                                                {f.message}
                                            </p>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Card>
                    </div>

                    <div className="space-y-5">
                        <Card title="Reporter">
                            {report.is_anonymous ? (
                                <div className="space-y-2">
                                    <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600 ring-1 ring-gray-200">
                                        Anonymous
                                    </span>
                                    <Field label="Anonymous ID" value={report.anonymous_id ?? "—"} />
                                    <p className="text-xs text-gray-500">
                                        Anonymous reports cannot receive points or follow-ups.
                                    </p>
                                </div>
                            ) : report.author ? (
                                <div className="space-y-3">
                                    <Field label="Name" value={report.author.display_name ?? "—"} />
                                    <Field label="Email" value={report.author.email} />
                                    <Field label="User ID" value={report.author.public_id} />
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">Reporter not available.</p>
                            )}
                        </Card>

                        <Card title="Actions">
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    disabled={actionLoading || !canMarkInReview}
                                    onClick={() => changeStatus("in_review", "Marked as in review.")}
                                    className={SECONDARY_BTN}
                                >
                                    Mark in review
                                </button>
                                <button
                                    type="button"
                                    disabled={actionLoading || !canAccept}
                                    onClick={() => changeStatus("accepted", "Report accepted.")}
                                    className={PRIMARY_BTN}
                                >
                                    Accept
                                </button>
                                <button
                                    type="button"
                                    disabled={actionLoading || !canReject}
                                    onClick={() => changeStatus("rejected", "Report rejected.")}
                                    className={DANGER_BTN}
                                >
                                    Reject
                                </button>
                                <button
                                    type="button"
                                    disabled={actionLoading || !canMarkDuplicate}
                                    onClick={() => changeStatus("duplicate", "Marked as duplicate.")}
                                    className={SECONDARY_BTN}
                                >
                                    Mark duplicate
                                </button>
                            </div>
                            {status === "needs_more_info" ? (
                                <p className="mt-3 text-xs text-gray-500">
                                    Waiting for the reporter to reply. The status returns to
                                    “Submitted” after their follow-up.
                                </p>
                            ) : null}
                        </Card>

                        {canRequestInfo ? (
                            <Card title="Request more info">
                                <textarea
                                    rows={3}
                                    value={requestInfoText}
                                    onChange={(e) => setRequestInfoText(e.target.value)}
                                    placeholder="Ask the reporter a question…"
                                    className={INPUT_CLASS}
                                />
                                <button
                                    type="button"
                                    disabled={actionLoading || requestInfoText.trim().length === 0}
                                    onClick={() =>
                                        runAction(async () => {
                                            await requestReportInfo(
                                                report.public_id,
                                                requestInfoText.trim()
                                            );
                                            setRequestInfoText("");
                                        }, "Requested more info. Status set to needs more info.")
                                    }
                                    className={`mt-2 ${PRIMARY_BTN}`}
                                >
                                    Send request
                                </button>
                            </Card>
                        ) : null}

                        <Card title="Admin note">
                            <textarea
                                rows={4}
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                placeholder="Internal note (not shown to the reporter)…"
                                className={INPUT_CLASS}
                            />
                            <button
                                type="button"
                                disabled={actionLoading}
                                onClick={() =>
                                    runAction(
                                        () =>
                                            updateReportAdminNote(
                                                report.public_id,
                                                noteText.trim() === "" ? null : noteText
                                            ),
                                        "Admin note saved."
                                    )
                                }
                                className={`mt-2 ${SECONDARY_BTN}`}
                            >
                                Save note
                            </button>
                        </Card>

                        <Card title="Reward points">
                            {report.reward_granted_at ? (
                                <p className="text-sm text-emerald-700">
                                    Reward already granted on {formatDateTime(report.reward_granted_at)}.
                                </p>
                            ) : canReward ? (
                                <div className="space-y-3">
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Points (negative to deduct)
                                        </span>
                                        <input
                                            type="number"
                                            value={rewardPoints}
                                            onChange={(e) => setRewardPoints(e.target.value)}
                                            className={INPUT_CLASS}
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1">
                                        <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                                            Reason
                                        </span>
                                        <select
                                            value={rewardReason}
                                            onChange={(e) =>
                                                setRewardReason(e.target.value as RewardReasonCode)
                                            }
                                            className={SELECT_CLASS}
                                        >
                                            {REWARD_REASON_OPTIONS.map((o) => (
                                                <option key={o.value} value={o.value}>
                                                    {o.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <input
                                        type="text"
                                        value={rewardNote}
                                        onChange={(e) => setRewardNote(e.target.value)}
                                        placeholder="Optional note"
                                        className={INPUT_CLASS}
                                    />
                                    <button
                                        type="button"
                                        disabled={
                                            actionLoading ||
                                            !Number.isInteger(Number(rewardPoints)) ||
                                            Number(rewardPoints) === 0
                                        }
                                        onClick={() =>
                                            runAction(async () => {
                                                await rewardReportPoints(report.public_id, {
                                                    pointsDelta: Number(rewardPoints),
                                                    reasonCode: rewardReason,
                                                    note: rewardNote.trim() || undefined,
                                                });
                                                setRewardNote("");
                                            }, "Points rewarded.")
                                        }
                                        className={PRIMARY_BTN}
                                    >
                                        Reward points
                                    </button>
                                </div>
                            ) : (
                                <p className="text-sm text-gray-500">
                                    {report.is_anonymous
                                        ? "Anonymous reports are not eligible for points."
                                        : !report.eligible_for_points
                                          ? "This report is not eligible for points."
                                          : "Points can be rewarded once the report is accepted."}
                                </p>
                            )}
                        </Card>
                    </div>
                </div>
            </div>
        </main>
    );
}
