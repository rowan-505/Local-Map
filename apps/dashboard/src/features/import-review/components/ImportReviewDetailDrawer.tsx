"use client";

import type { ImportReviewBuildingListItem, ImportReviewDecision, ImportReviewGeoJson } from "@/src/lib/api";
import type { ImportReviewFormOptionsResponse } from "@/src/lib/api";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";

import type { ImportReviewEntityConfig } from "../config/types";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";
import { jsonishSignalsPresent, resolveDrawerSubtitle, resolveDrawerTitle } from "../utils/detailDrawerUtils";
import { isGeometryEssentialForEntity } from "../config/essentialFields";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";
import { importReviewMessageTone } from "../utils/importReviewMessageTone";
import ImportReviewErrorState from "./ImportReviewErrorState";
import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "./ImportReviewStatusBanner";
import CandidateJsonSection from "./detail/CandidateJsonSection";
import CandidateMapSection from "./detail/CandidateMapSection";
import CandidateOverrideSection from "./detail/CandidateOverrideSection";
import CandidateReviewActionsSection from "./detail/CandidateReviewActionsSection";
import CandidateSummarySection from "./detail/CandidateSummarySection";
import CandidateValidationSection from "./detail/CandidateValidationSection";

export default function ImportReviewDetailDrawer({
    config,
    row,
    mapEntityType,
    geometryKind,
    geometry,
    fallbackNote,
    isLoadingDetail,
    isLoadingGeometry,
    detailError,
    detailNotFound,
    isSaving,
    isSavingOverrides,
    overrideSaveMessage,
    decisionSaveMessage,
    apiScope,
    onSaveOverrides,
    drawerNote,
    drawerDecision,
    canEdit,
    onClose,
    onNoteChange,
    onDecisionChange,
    onSave,
    formOptions = null,
    formOptionsLoading = false,
    formOptionsError = "",
}: {
    config: ImportReviewEntityConfig;
    row: ImportReviewBuildingListItem;
    mapEntityType: ImportReviewEntityType;
    geometryKind: DataReviewGeometryKind;
    geometry: ImportReviewGeoJson | null;
    fallbackNote?: string | null;
    isLoadingDetail: boolean;
    isLoadingGeometry: boolean;
    detailError: string;
    detailNotFound: boolean;
    isSaving: boolean;
    isSavingOverrides: boolean;
    overrideSaveMessage: string | null;
    decisionSaveMessage: string | null;
    apiScope: ImportReviewScopeQueryParams | null;
    onSaveOverrides: (patch: Record<string, unknown>, reviewNote: string | null) => Promise<void>;
    drawerNote: string;
    drawerDecision: ImportReviewDecision;
    canEdit: boolean;
    onClose: () => void;
    onNoteChange: (value: string) => void;
    onDecisionChange: (value: ImportReviewDecision) => void;
    onSave: () => void;
    formOptions?: ImportReviewFormOptionsResponse | null;
    formOptionsLoading?: boolean;
    formOptionsError?: string;
}) {
    const title = resolveDrawerTitle(row, config);
    const subtitle = resolveDrawerSubtitle(row, config);
    const showMatchedCore =
        jsonishSignalsPresent(row.matched_core_data) || Boolean(row.matched_core_id?.trim());

    const detailFailed = Boolean(detailError && !detailNotFound);
    const showBody = !detailNotFound && !detailFailed;

    return (
        <div
            className="fixed inset-0 z-40 flex justify-end bg-black/30"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-review-detail-drawer-title"
            onClick={onClose}
        >
            <div
                className="flex h-full w-full max-w-xl flex-col overflow-y-auto bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-200 bg-white px-5 py-4">
                    <div className="min-w-0 pr-4">
                        <h2 id="import-review-detail-drawer-title" className="truncate text-lg font-semibold text-gray-900">
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

                <div className="space-y-3 border-b border-gray-100 bg-gray-50/80 px-5 py-3">
                    {isLoadingDetail ? (
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingCandidateDetail} size="md" />
                    ) : null}
                    {isLoadingGeometry && !isLoadingDetail ? (
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingGeometry} />
                    ) : null}
                    {isSaving ? (
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.applyingDecision} />
                    ) : null}
                    {isSavingOverrides ? (
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.savingOverrides} />
                    ) : null}
                    {decisionSaveMessage ? (
                        <ImportReviewStatusBanner
                            message={decisionSaveMessage}
                            tone={importReviewMessageTone(decisionSaveMessage)}
                            compact
                        />
                    ) : null}
                </div>

                <div className="space-y-4 p-5">
                    {detailNotFound ? (
                        <ImportReviewErrorState message="Candidate not found — it may have been removed from this batch." />
                    ) : null}

                    {detailFailed ? (
                        <ImportReviewErrorState
                            message={detailError || IMPORT_REVIEW_LOADING.failedToLoadDetail}
                        />
                    ) : null}

                    {showBody ? (
                        <>
                            <CandidateSummarySection config={config} row={row} />

                            <CandidateMapSection
                                supportsMapPreview={config.supportsMapPreview}
                                isLoadingDetail={isLoadingDetail}
                                isLoadingGeometry={isLoadingGeometry}
                                geometry={geometry}
                                geometryKind={geometryKind}
                                mapEntityType={mapEntityType}
                                externalId={row.external_id ?? row.id}
                                fallbackNote={fallbackNote}
                                geometryEssential={isGeometryEssentialForEntity(config)}
                            />

                            {config.supportsOverrideEditor || config.overrideEditableFields.length > 0 ? (
                                <CandidateOverrideSection
                                    config={config}
                                    row={row}
                                    apiScope={apiScope}
                                    canEdit={canEdit}
                                    isSavingOverrides={isSavingOverrides}
                                    overrideSaveMessage={overrideSaveMessage}
                                    onSaveOverrides={onSaveOverrides}
                                    formOptions={formOptions}
                                    formOptionsLoading={formOptionsLoading}
                                    formOptionsError={formOptionsError}
                                />
                            ) : null}

                            <CandidateValidationSection row={row} isLoadingDetail={isLoadingDetail} />

                            <CandidateJsonSection title="normalized_data" data={row.normalized_data} />
                            <CandidateJsonSection title="source_refs" data={row.source_refs} />
                            {showMatchedCore ? (
                                <CandidateJsonSection title="matched_core_data" data={row.matched_core_data} />
                            ) : null}

                            <CandidateReviewActionsSection
                                config={config}
                                drawerDecision={drawerDecision}
                                drawerNote={drawerNote}
                                isSaving={isSaving}
                                canEdit={canEdit && !isLoadingDetail}
                                onDecisionChange={onDecisionChange}
                                onNoteChange={onNoteChange}
                                onSave={onSave}
                            />
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
