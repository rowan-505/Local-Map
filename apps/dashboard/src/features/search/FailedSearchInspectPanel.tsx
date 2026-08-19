"use client";

import Link from "next/link";

import { searchPath } from "@/src/lib/dashboardNavigation";

import {
    entityTypeLabel,
    failedSearchFilterSummary,
    formatDateTime,
    resolutionTypeLabel,
} from "./constants";
import type { FailedSearchItem, SearchDocumentItem } from "./types";
import { PRIMARY_BTN, SECONDARY_BTN, CELL_TEXT_CLASS } from "./ui";

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
    return (
        <div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-gray-100 py-2 text-sm last:border-b-0">
            <dt className="text-gray-500">{label}</dt>
            <dd className="text-gray-900">{value && value.trim() !== "" ? value : "—"}</dd>
        </div>
    );
}

export default function FailedSearchInspectPanel({
    item,
    candidateDocuments,
    candidateLoading,
    selectedAliasTargetKey,
    onClose,
    onCreateAlias,
    onMarkResolved,
    onReopen,
    onInspectDocument,
    onUseAsAliasTarget,
    actionLoading,
    canWrite,
}: {
    item: FailedSearchItem;
    candidateDocuments: SearchDocumentItem[];
    candidateLoading: boolean;
    selectedAliasTargetKey?: string | null;
    onClose: () => void;
    onCreateAlias: () => void;
    onMarkResolved: () => void;
    onReopen: () => void;
    onInspectDocument: (document: SearchDocumentItem) => void;
    onUseAsAliasTarget: (document: SearchDocumentItem) => void;
    actionLoading: boolean;
    canWrite: boolean;
}) {
    const aliasesHref = item.linked_entity
        ? `${searchPath("aliases")}?entity_type=${encodeURIComponent(item.linked_entity.entity_type)}&entity_id=${encodeURIComponent(item.linked_entity.entity_id)}`
        : searchPath("aliases");

    return (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30 p-4 sm:p-6">
            <button
                type="button"
                className="absolute inset-0 cursor-default"
                aria-label="Close inspection panel"
                onClick={onClose}
            />
            <aside className="relative z-10 flex h-full w-full max-w-xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
                <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
                    <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                            Failed search
                        </p>
                        <h2 className="mt-1 text-lg font-semibold text-gray-900 break-words [overflow-wrap:anywhere]">
                            {item.query}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                            {item.occurrence_count.toLocaleString()} occurrence
                            {item.occurrence_count === 1 ? "" : "s"} · last seen{" "}
                            {formatDateTime(item.last_seen_at)}
                        </p>
                    </div>
                    <button type="button" className={SECONDARY_BTN} onClick={onClose}>
                        Close
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                        {item.is_resolved ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100">
                                Resolved
                            </span>
                        ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900 ring-1 ring-amber-100">
                                Unresolved
                            </span>
                        )}
                        {item.resolution_type ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                                {resolutionTypeLabel(item.resolution_type)}
                            </span>
                        ) : null}
                    </div>

                    <dl>
                        <DetailRow label="Normalized" value={item.normalized_query} />
                        <DetailRow label="Language" value={item.language} />
                        <DetailRow
                            label="Filter context"
                            value={failedSearchFilterSummary(item)}
                        />
                        <DetailRow label="Result count" value={String(item.result_count)} />
                        <DetailRow
                            label="Occurrences"
                            value={String(item.occurrence_count)}
                        />
                        <DetailRow label="First seen" value={formatDateTime(item.first_seen_at)} />
                        <DetailRow label="Last seen" value={formatDateTime(item.last_seen_at)} />
                        <DetailRow label="Resolved at" value={formatDateTime(item.resolved_at)} />
                        <DetailRow
                            label="Linked alias"
                            value={item.linked_alias?.alias_text ?? null}
                        />
                        <DetailRow
                            label="Linked entity"
                            value={
                                item.linked_entity
                                    ? `${item.linked_entity.display_name} (${entityTypeLabel(item.linked_entity.entity_type)} · id ${item.linked_entity.entity_id})`
                                    : null
                            }
                        />
                    </dl>

                    {!item.is_resolved ? (
                        <section className="mt-6">
                            <h3 className="text-sm font-semibold text-gray-900">
                                Likely indexed targets
                            </h3>
                            <p className="mt-1 text-xs text-gray-500">
                                Search documents matching this query. Pick a target before creating
                                an alias — aliases are never auto-created.
                            </p>
                            {candidateLoading ? (
                                <p className="mt-3 text-sm text-gray-500">Searching documents…</p>
                            ) : candidateDocuments.length === 0 ? (
                                <p className="mt-3 text-sm text-gray-500">
                                    No indexed documents matched this query.
                                </p>
                            ) : (
                                <ul className="mt-3 space-y-2">
                                    {candidateDocuments.map((doc) => {
                                        const docKey = `${doc.entity_type}:${doc.entity_id}`;
                                        const isSelected = selectedAliasTargetKey === docKey;
                                        return (
                                        <li
                                            key={docKey}
                                            className={`rounded-md border p-3 ${
                                                isSelected
                                                    ? "border-emerald-300 bg-emerald-50"
                                                    : "border-gray-200"
                                            }`}
                                        >
                                            <div className={`font-medium text-gray-900 ${CELL_TEXT_CLASS}`}>
                                                {doc.display_name ?? "Untitled"}
                                            </div>
                                            <div className="mt-1 text-xs text-gray-500">
                                                {entityTypeLabel(doc.entity_type)} · id{" "}
                                                {doc.entity_id}
                                            </div>
                                            <div className="mt-2 flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    className={PRIMARY_BTN}
                                                    disabled={!canWrite}
                                                    title={!canWrite ? "Read-only viewers cannot select an alias target" : undefined}
                                                    onClick={() => onUseAsAliasTarget(doc)}
                                                >
                                                    {isSelected ? "Selected target" : "Use as alias target"}
                                                </button>
                                                <button
                                                    type="button"
                                                    className={SECONDARY_BTN}
                                                    onClick={() => onInspectDocument(doc)}
                                                >
                                                    Inspect document
                                                </button>
                                            </div>
                                        </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </section>
                    ) : null}
                </div>

                <div className="flex flex-wrap gap-2 border-t border-gray-200 px-5 py-4">
                    {!item.is_resolved ? (
                        <>
                            <button
                                type="button"
                                className={PRIMARY_BTN}
                                disabled={!canWrite || actionLoading || !selectedAliasTargetKey}
                                title={!canWrite ? "Read-only viewers cannot add aliases" : undefined}
                                onClick={onCreateAlias}
                            >
                                Add alias…
                            </button>
                            <button
                                type="button"
                                className={SECONDARY_BTN}
                                disabled={!canWrite || actionLoading}
                                title={!canWrite ? "Read-only viewers cannot resolve searches" : undefined}
                                onClick={onMarkResolved}
                            >
                                Mark resolved…
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            className={SECONDARY_BTN}
                            disabled={!canWrite || actionLoading}
                            title={!canWrite ? "Read-only viewers cannot reopen searches" : undefined}
                            onClick={onReopen}
                        >
                            {actionLoading ? "Reopening…" : "Reopen"}
                        </button>
                    )}
                    {item.linked_entity ? (
                        <Link href={aliasesHref} className={SECONDARY_BTN}>
                            View linked aliases
                        </Link>
                    ) : null}
                    <button type="button" className={SECONDARY_BTN} onClick={onClose}>
                        Done
                    </button>
                </div>
            </aside>
        </div>
    );
}
