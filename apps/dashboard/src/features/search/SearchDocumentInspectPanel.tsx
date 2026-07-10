"use client";

import Link from "next/link";

import { searchPath } from "@/src/lib/dashboardNavigation";

import { entityTypeLabel, formatDateTime, syncStateLabel } from "./constants";
import type { SearchDocumentItem } from "./types";
import { PRIMARY_BTN, SECONDARY_BTN, SyncStateBadge } from "./ui";

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
    return (
        <div className="grid grid-cols-[9rem_1fr] gap-3 border-b border-gray-100 py-2 text-sm last:border-b-0">
            <dt className="text-gray-500">{label}</dt>
            <dd className="break-words text-gray-900 [overflow-wrap:anywhere]">{value && value.trim() !== "" ? value : "—"}</dd>
        </div>
    );
}

export default function SearchDocumentInspectPanel({
    item,
    onClose,
}: {
    item: SearchDocumentItem;
    onClose: () => void;
}) {
    const aliasHref = `${searchPath("aliases")}?entity_type=${encodeURIComponent(item.entity_type)}&entity_id=${encodeURIComponent(item.entity_id)}`;

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
                            Search document
                        </p>
                        <h2 className="mt-1 text-lg font-semibold text-gray-900 break-words [overflow-wrap:anywhere]">
                            {item.display_name ?? "Untitled document"}
                        </h2>
                        <p className="mt-1 text-sm text-gray-600">
                            {entityTypeLabel(item.entity_type)} · id {item.entity_id}
                        </p>
                    </div>
                    <button type="button" className={SECONDARY_BTN} onClick={onClose}>
                        Close
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                    <div className="mb-4 flex flex-wrap items-center gap-2">
                        <SyncStateBadge
                            state={item.sync_state}
                            label={syncStateLabel(item.sync_state)}
                        />
                        {item.is_verified ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-100">
                                Verified
                            </span>
                        ) : null}
                        {item.is_public ? (
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-blue-100">
                                Public
                            </span>
                        ) : null}
                        {item.is_active ? (
                            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-gray-200">
                                Active index row
                            </span>
                        ) : null}
                    </div>

                    <dl>
                        <DetailRow label="Public id" value={item.public_id} />
                        <DetailRow label="Primary (Myanmar)" value={item.primary_name_my} />
                        <DetailRow label="Primary (English)" value={item.primary_name_en} />
                        <DetailRow label="Primary (und)" value={item.primary_name_und} />
                        <DetailRow label="Transport mode" value={item.transport_mode} />
                        <DetailRow label="Review status" value={item.review_status} />
                        <DetailRow label="Importance" value={String(item.importance_score)} />
                        <DetailRow label="Confidence" value={String(item.confidence_score)} />
                        <DetailRow label="Alias count" value={String(item.alias_count)} />
                        <DetailRow label="Indexed at" value={formatDateTime(item.indexed_at)} />
                        <DetailRow
                            label="Index source updated"
                            value={formatDateTime(item.source_updated_at)}
                        />
                        <DetailRow
                            label="Canonical source updated"
                            value={formatDateTime(item.canonical_source_updated_at)}
                        />
                        <DetailRow
                            label="Search document id"
                            value={item.search_document_id}
                        />
                    </dl>

                    <p className="mt-4 text-xs text-gray-500">
                        Canonical names are read-only here. Use aliases to improve search matching
                        without changing official entity names.
                    </p>
                </div>

                <div className="flex flex-wrap gap-2 border-t border-gray-200 px-5 py-4">
                    <Link href={aliasHref} className={PRIMARY_BTN}>
                        Add / view aliases
                    </Link>
                    <button type="button" className={SECONDARY_BTN} onClick={onClose}>
                        Done
                    </button>
                </div>
            </aside>
        </div>
    );
}
