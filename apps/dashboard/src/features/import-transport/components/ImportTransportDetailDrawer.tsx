"use client";

import { useState } from "react";

import type { ImportTransportDetailItem, ImportTransportEntityConfig, ImportTransportValidationIssue } from "../config/types";
import {
    importTransportDetailFields,
    resolveImportTransportDrawerSubtitle,
    resolveImportTransportDrawerTitle,
} from "../utils/entityPageUtils";
import { IMPORT_TRANSPORT_LOADING } from "../utils/loadingMessages";
import ImportTransportErrorState from "./ImportTransportErrorState";
import ImportTransportMapPreview from "./ImportTransportMapPreview";
import ImportTransportStatusBadge from "./ImportTransportStatusBadge";
import ImportTransportValidationIssuesPanel from "./ImportTransportValidationIssuesPanel";

function JsonBlock({ label, value }: { label: string; value: unknown }) {
    if (value === null || value === undefined) {
        return null;
    }
    return (
        <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</h3>
            <pre className="max-h-48 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs text-gray-800">
                {JSON.stringify(value, null, 2)}
            </pre>
        </section>
    );
}

export default function ImportTransportDetailDrawer({
    config,
    row,
    isLoadingDetail,
    detailError,
    drawerMap,
    validationIssues,
    validationIssuesLoading,
    validationIssuesError,
    isValidating,
    validateError,
    onValidate,
    onClose,
}: {
    config: ImportTransportEntityConfig;
    row: ImportTransportDetailItem;
    isLoadingDetail: boolean;
    detailError: string;
    drawerMap: { geometry: Record<string, unknown> | null; geometryKind: "point" | "line" | "polygon" } | null;
    validationIssues: ImportTransportValidationIssue[];
    validationIssuesLoading: boolean;
    validationIssuesError: string;
    isValidating: boolean;
    validateError: string;
    onValidate: (input: { confirm_warnings: boolean; review_note: string }) => void;
    onClose: () => void;
}) {
    const title = resolveImportTransportDrawerTitle(row, config.detailTitleField);
    const subtitle = resolveImportTransportDrawerSubtitle(row, config.detailSubtitleField);
    const detailFields = importTransportDetailFields(config, row);
    const [confirmWarnings, setConfirmWarnings] = useState(false);
    const [reviewNoteDraft, setReviewNoteDraft] = useState(row.review_note ?? "");
    const requiresWarningConfirmation = String(row.validation_status ?? "").toLowerCase() === "warning";
    const isPromoted = String(row.promotion_status ?? "").toLowerCase() === "promoted";
    const isReadOnly = isPromoted;

    return (
        <div
            className="fixed inset-0 z-40 flex justify-end bg-black/30"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-transport-detail-drawer-title"
            onClick={onClose}
        >
            <div
                className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-200 bg-white px-5 py-4">
                    <div className="min-w-0 pr-4">
                        <h2
                            id="import-transport-detail-drawer-title"
                            className="truncate text-lg font-semibold text-gray-900"
                        >
                            {config.label} · {title}
                        </h2>
                        <p className="truncate font-mono text-xs text-gray-500">{row.id}</p>
                        {subtitle ? <p className="truncate text-sm text-gray-600">{subtitle}</p> : null}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="shrink-0 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                        Close
                    </button>
                </div>

                <div className="space-y-5 p-5">
                    {isLoadingDetail ? (
                        <p className="text-sm text-gray-500">{IMPORT_TRANSPORT_LOADING.loadingDetail}</p>
                    ) : null}

                    <ImportTransportErrorState message={detailError} compact />
                    <ImportTransportErrorState message={validateError} compact />

                    {isReadOnly ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
                            This candidate has been promoted to core transport. Import review actions are
                            read-only.
                        </div>
                    ) : null}

                    <section className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Validation
                            </h3>
                            <button
                                type="button"
                                disabled={isValidating || isLoadingDetail || isReadOnly}
                                onClick={() =>
                                    onValidate({
                                        confirm_warnings: confirmWarnings,
                                        review_note: reviewNoteDraft.trim(),
                                    })
                                }
                                className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
                            >
                                {isValidating ? "Validating…" : "Validate"}
                            </button>
                        </div>
                        {!isReadOnly && requiresWarningConfirmation ? (
                            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                                <label className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        checked={confirmWarnings}
                                        onChange={(e) => setConfirmWarnings(e.target.checked)}
                                    />
                                    Confirm validation warnings
                                </label>
                                <label className="flex flex-col gap-1">
                                    <span className="text-xs font-semibold uppercase">Review note</span>
                                    <textarea
                                        value={reviewNoteDraft}
                                        onChange={(e) => setReviewNoteDraft(e.target.value)}
                                        rows={3}
                                        className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm"
                                        placeholder="Required when confirming warnings for promotion."
                                    />
                                </label>
                            </div>
                        ) : null}
                        <ImportTransportValidationIssuesPanel
                            issues={validationIssues}
                            isLoading={validationIssuesLoading}
                            error={validationIssuesError}
                        />
                    </section>

                    <section className="space-y-2">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Status
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            {row.validation_status ? (
                                <ImportTransportStatusBadge value={String(row.validation_status)} />
                            ) : null}
                            {row.review_status ? (
                                <ImportTransportStatusBadge value={String(row.review_status)} />
                            ) : null}
                            {row.review_decision ? (
                                <ImportTransportStatusBadge value={String(row.review_decision)} />
                            ) : null}
                            {row.promotion_status ? (
                                <ImportTransportStatusBadge value={String(row.promotion_status)} />
                            ) : null}
                        </div>
                    </section>

                    <section className="grid gap-3 sm:grid-cols-2">
                        {detailFields.map((field) => (
                            <div key={field.label}>
                                <p className="text-xs font-semibold uppercase text-gray-500">{field.label}</p>
                                <p className="text-sm text-gray-800">{field.value}</p>
                            </div>
                        ))}
                        <div>
                            <p className="text-xs font-semibold uppercase text-gray-500">External ID</p>
                            <p className="font-mono text-sm text-gray-800">{row.external_id ?? "—"}</p>
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase text-gray-500">Confidence</p>
                            <p className="text-sm text-gray-800">{row.confidence_score ?? "—"}</p>
                        </div>
                        <div>
                            <p className="text-xs font-semibold uppercase text-gray-500">Updated</p>
                            <p className="text-sm text-gray-800">{row.updated_at ?? "—"}</p>
                        </div>
                        {row.review_note ? (
                            <div className="sm:col-span-2">
                                <p className="text-xs font-semibold uppercase text-gray-500">Review note</p>
                                <p className="text-sm text-gray-800">{row.review_note}</p>
                            </div>
                        ) : null}
                    </section>

                    {config.supportsMapPreview ? (
                        <section className="space-y-2">
                            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                Map preview
                            </h3>
                            <ImportTransportMapPreview
                                enabled
                                geometry={drawerMap?.geometry ?? null}
                                geometryKind={drawerMap?.geometryKind ?? "point"}
                                externalId={row.external_id}
                                title={title}
                                subtitle={subtitle}
                                isLoading={isLoadingDetail}
                                size="drawer"
                            />
                        </section>
                    ) : null}

                    <JsonBlock label="Normalized data" value={row.normalized_data} />
                    <JsonBlock label="Source refs" value={row.source_refs} />
                </div>
            </div>
        </div>
    );
}
