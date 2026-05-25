"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import CoreReviewHeaderCard from "@/src/components/core-review/CoreReviewHeaderCard";
import CoreReviewPageShell from "@/src/components/core-review/CoreReviewPageShell";
import {
    getCoreVerificationDetail,
    getCoreVerificationList,
    patchCoreVerificationEdit,
    patchCoreVerificationStatus,
    type CoreVerificationDetailResponse,
    type CoreVerificationListResponse,
    type CoreVerificationStatus,
} from "@/src/lib/api";

const STATUSES: CoreVerificationStatus[] = [
    "unverified",
    "verified",
    "needs_fix",
    "questionable",
    "rejected_after_core_review",
];

function JsonPanel({ title, value }: { title: string; value: unknown }) {
    return (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-700">
                {JSON.stringify(value ?? null, null, 2)}
            </pre>
        </section>
    );
}

function StatusBadge({ value }: { value: string | null }) {
    const tone =
        value === "verified"
            ? "bg-emerald-100 text-emerald-800"
            : value === "needs_fix" || value === "rejected_after_core_review"
              ? "bg-red-100 text-red-800"
              : value === "questionable"
                ? "bg-amber-100 text-amber-800"
                : "bg-slate-100 text-slate-700";
    return <span className={`rounded-full px-2 py-1 text-xs font-medium ${tone}`}>{value ?? "unsupported"}</span>;
}

export default function CoreVerificationFamilyClient({
    family,
    label,
}: {
    family: string;
    label: string;
}) {
    const [list, setList] = useState<CoreVerificationListResponse | null>(null);
    const [detail, setDetail] = useState<CoreVerificationDetailResponse | null>(null);
    const [q, setQ] = useState("");
    const [status, setStatus] = useState<CoreVerificationStatus | "">("unverified");
    const [note, setNote] = useState("");
    const [editText, setEditText] = useState("{}");
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const loadList = useCallback((signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        getCoreVerificationList(
            family,
            { q: q || undefined, verification_status: status || undefined, limit: 50 },
            signal ? { signal } : undefined
        )
            .then(setList)
            .catch((err) => {
                if (err instanceof Error && err.name !== "AbortError") setError(err.message);
            })
            .finally(() => setLoading(false));
    }, [family, q, status]);

    useEffect(() => {
        const controller = new AbortController();
        void Promise.resolve().then(() => loadList(controller.signal));
        return () => controller.abort();
    }, [loadList]);

    const selectedTitle = useMemo(
        () => detail?.display_name ?? (detail ? `${label} ${detail.id}` : "No row selected"),
        [detail, label]
    );

    async function openDetail(id: string) {
        setError(null);
        const next = await getCoreVerificationDetail(family, id);
        setDetail(next);
        setEditText("{}");
    }

    async function submitStatus(nextStatus: CoreVerificationStatus) {
        if (!detail) return;
        try {
            const next = await patchCoreVerificationStatus(family, detail.id, {
                verification_status: nextStatus,
                verification_note: note || undefined,
            });
            setDetail(next);
            loadList();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Status update failed.");
        }
    }

    async function submitEdit() {
        if (!detail) return;
        try {
            const changes = JSON.parse(editText) as Record<string, unknown>;
            const next = await patchCoreVerificationEdit(family, detail.id, changes);
            setDetail(next);
            loadList();
        } catch (err) {
            setError(err instanceof Error ? err.message : "Edit failed.");
        }
    }

    return (
        <CoreReviewPageShell>
            <CoreReviewHeaderCard
                title={`Core verification: ${label}`}
                description="Server-side paginated core rows. Geometry and JSON payloads load only after selecting a row."
            />
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap gap-3">
                    <input
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Search"
                        value={q}
                        onChange={(event) => setQ(event.target.value)}
                    />
                    <select
                        className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                        value={status}
                        onChange={(event) => setStatus(event.target.value as CoreVerificationStatus | "")}
                    >
                        <option value="">All statuses</option>
                        {STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <button className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={() => loadList()}>
                        Refresh
                    </button>
                </div>
                {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
                {list?.support.unsupported_reason ? (
                    <p className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-800">{list.support.unsupported_reason}</p>
                ) : null}
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="px-4 py-3">Name</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3">Geometry</th>
                                <th className="px-4 py-3">Lineage</th>
                                <th className="px-4 py-3">Updated</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {(list?.items ?? []).map((item) => (
                                <tr key={item.id} className="hover:bg-slate-50">
                                    <td className="px-4 py-3">
                                        <button className="text-left font-medium text-sky-800 hover:underline" onClick={() => void openDetail(item.id)}>
                                            {item.display_name ?? item.id}
                                        </button>
                                        <p className="text-xs text-slate-500">{item.id}</p>
                                    </td>
                                    <td className="px-4 py-3"><StatusBadge value={item.verification_status} /></td>
                                    <td className="px-4 py-3">{item.has_geometry ? item.geometry_label : "No geometry"}</td>
                                    <td className="px-4 py-3 text-xs text-slate-600">
                                        {item.source_lineage?.publish_batch_id ? `publish ${item.source_lineage.publish_batch_id}` : "No lineage"}
                                    </td>
                                    <td className="px-4 py-3 text-xs text-slate-500">{item.updated_at ?? item.created_at ?? "n/a"}</td>
                                </tr>
                            ))}
                            {!loading && (list?.items.length ?? 0) === 0 ? (
                                <tr><td className="px-4 py-6 text-center text-slate-500" colSpan={5}>No rows found.</td></tr>
                            ) : null}
                        </tbody>
                    </table>
                </div>

                <aside className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div>
                        <h2 className="text-lg font-semibold text-slate-900">{selectedTitle}</h2>
                        {detail ? <StatusBadge value={detail.verification_status} /> : null}
                    </div>
                    {detail ? (
                        <>
                            <section className="rounded-lg border border-slate-200 p-3">
                                <h3 className="text-sm font-semibold text-slate-900">Verification actions</h3>
                                <textarea
                                    className="mt-2 min-h-20 w-full rounded-md border border-slate-300 p-2 text-sm"
                                    placeholder="Verification note"
                                    value={note}
                                    onChange={(event) => setNote(event.target.value)}
                                />
                                <div className="mt-2 flex flex-wrap gap-2">
                                    {STATUSES.map((item) => (
                                        <button key={item} className="rounded-md border border-slate-300 px-2 py-1 text-xs" onClick={() => void submitStatus(item)}>
                                            Mark {item}
                                        </button>
                                    ))}
                                </div>
                            </section>
                            <section className="rounded-lg border border-slate-200 p-3">
                                <h3 className="text-sm font-semibold text-slate-900">Safe edit</h3>
                                <p className="mt-1 text-xs text-slate-500">
                                    Supported fields: {detail.safe_editable_fields.length > 0 ? detail.safe_editable_fields.join(", ") : "none"}
                                </p>
                                <textarea
                                    className="mt-2 min-h-24 w-full rounded-md border border-slate-300 p-2 font-mono text-xs"
                                    value={editText}
                                    onChange={(event) => setEditText(event.target.value)}
                                />
                                <button className="mt-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={() => void submitEdit()}>
                                    Save safe edits
                                </button>
                            </section>
                            <JsonPanel title={detail.geometry ? "Map preview geometry" : "Map preview"} value={detail.geometry ?? "No geometry"} />
                            <JsonPanel title="Source lineage" value={detail.source_lineage} />
                            <JsonPanel title="source_refs" value={detail.source_refs} />
                            <JsonPanel title="normalized_data" value={detail.normalized_data} />
                            <JsonPanel title="Core properties" value={detail.properties} />
                        </>
                    ) : (
                        <p className="text-sm text-slate-500">Select a row to view geometry, lineage, JSON payloads, verification actions, and safe edits.</p>
                    )}
                </aside>
            </div>
        </CoreReviewPageShell>
    );
}
