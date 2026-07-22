"use client";

import { useMemo, useState } from "react";

import type { ImportReviewBuildingListItem, ImportReviewDecision, ImportReviewGeoJson } from "@/src/lib/api";
import type { ImportReviewFormOptionsResponse } from "@/src/lib/api";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";
import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";

import type { ImportReviewEntityConfig } from "../config/types";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";
import { resolveDrawerSubtitle, resolveDrawerTitle } from "../utils/detailDrawerUtils";
import { isGeometryEssentialForEntity } from "../config/essentialFields";
import {
    formatFieldChoicesForNote,
    type ConflictFieldChoice,
} from "../utils/conflictFieldCompare";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";
import { importReviewMessageTone } from "../utils/importReviewMessageTone";
import ImportReviewErrorState from "./ImportReviewErrorState";
import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "./ImportReviewStatusBanner";
import CandidateFieldCompareSection from "./detail/CandidateFieldCompareSection";
import CandidateMapSection from "./detail/CandidateMapSection";
import CandidatePromotionFailureSection from "./detail/CandidatePromotionFailureSection";
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
    detailTechnicalError,
    geometryError,
    geometryTechnicalError,
    onRetryGeometry,
    detailNotFound,
    isSaving,
    isSavingOverrides,
    overrideSaveMessage,
    overrideSaveTechnicalError = "",
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
    detailTechnicalError?: string;
    geometryError?: string | null;
    geometryTechnicalError?: string;
    onRetryGeometry?: () => void;
    detailNotFound: boolean;
    isSaving: boolean;
    isSavingOverrides: boolean;
    overrideSaveMessage: string | null;
    overrideSaveTechnicalError?: string | null;
    decisionSaveMessage: string | null;
    apiScope: ImportReviewScopeQueryParams | null;
    onSaveOverrides: (
        patch: Record<string, unknown>,
        reviewNote: string | null,
        saveOptions?: {
            verifyPatchKeys?: readonly string[];
            referenceFieldsDevLog?: Record<string, unknown>;
        }
    ) => Promise<ImportReviewBuildingListItem>;
    drawerNote: string;
    drawerDecision: ImportReviewDecision;
    canEdit: boolean;
    onClose: () => void;
    onNoteChange: (value: string) => void;
    onDecisionChange: (value: ImportReviewDecision) => void;
    onSave: (noteOverride?: string | null) => void;
    formOptions?: ImportReviewFormOptionsResponse | null;
    formOptionsLoading?: boolean;
    formOptionsError?: string;
}) {
    const title = resolveDrawerTitle(row, config);
    const subtitle = resolveDrawerSubtitle(row, config);
    const [fieldChoices, setFieldChoices] = useState<Record<string, ConflictFieldChoice>>({});
    const mergeEditable = drawerDecision === "merge_fields" && canEdit && !isLoadingDetail;

    const metadataWarning = Boolean(detailError && !detailNotFound);
    const showBody = !detailNotFound;
    void apiScope;

    const saveWithMergeChoices = useMemo(
        () => () => {
            let note = drawerNote;
            if (drawerDecision === "merge_fields") {
                const block = formatFieldChoicesForNote(fieldChoices);
                if (block) {
                    const base = drawerNote.trim();
                    note = base.includes("field_choices:")
                        ? base.replace(/field_choices:\{[\s\S]*\}$/, block)
                        : `${base}${base ? "\n" : ""}${block}`;
                    onNoteChange(note);
                }
            }
            onSave(note);
        },
        [drawerDecision, fieldChoices, drawerNote, onNoteChange, onSave]
    );

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
                        <h2
                            id="import-review-detail-drawer-title"
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

                <div className="space-y-3 border-b border-gray-100 bg-gray-50/80 px-5 py-3">
                    {isLoadingDetail ? (
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingCandidateDetail} size="md" />
                    ) : null}
                    {isLoadingGeometry ? (
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

                    {showBody ? (
                        <>
                            {metadataWarning ? (
                                <ImportReviewStatusBanner message={detailError} tone="warning" compact />
                            ) : null}
                            <CandidatePromotionFailureSection row={row} />
                            {detailTechnicalError?.trim() ? (
                                <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded border border-amber-100 bg-amber-50/80 p-2 text-[10px] text-amber-950">
                                    {detailTechnicalError}
                                </pre>
                            ) : null}

                            <CandidateSummarySection config={config} row={row} />

                            <CandidateFieldCompareSection
                                row={row}
                                choices={fieldChoices}
                                editable={mergeEditable}
                                onChoiceChange={(field, choice) =>
                                    setFieldChoices((prev) => ({ ...prev, [field]: choice }))
                                }
                            />

                            <CandidateMapSection
                                supportsMapPreview={config.supportsMapPreview}
                                isLoadingDetail={isLoadingDetail}
                                isLoadingGeometry={isLoadingGeometry}
                                geometryError={geometryError}
                                geometryTechnicalError={geometryTechnicalError}
                                onRetryGeometry={onRetryGeometry}
                                geometry={geometry}
                                geometryKind={geometryKind}
                                mapEntityType={mapEntityType}
                                externalId={row.external_id ?? row.id}
                                fallbackNote={fallbackNote}
                                geometryEssential={isGeometryEssentialForEntity(config)}
                            />

                            {config.supportsOverrideEditor ||
                            config.overrideEditableFields.length > 0 ||
                            config.apiFamily === "roads" ? (
                                <CandidateOverrideSection
                                    config={config}
                                    row={row}
                                    apiScope={apiScope}
                                    canEdit={canEdit}
                                    isSavingOverrides={isSavingOverrides}
                                    overrideSaveMessage={overrideSaveMessage}
                                    overrideSaveTechnicalError={overrideSaveTechnicalError}
                                    onSaveOverrides={onSaveOverrides}
                                    formOptions={formOptions}
                                    formOptionsLoading={formOptionsLoading}
                                    formOptionsError={formOptionsError}
                                />
                            ) : null}

                            <CandidateValidationSection
                                row={row}
                                isLoadingDetail={isLoadingDetail}
                                showRoadRoutingWarningBanner={config.slug === "roads"}
                            />

                            <CandidateReviewActionsSection
                                config={config}
                                row={row}
                                drawerDecision={drawerDecision}
                                drawerNote={drawerNote}
                                isSaving={isSaving}
                                canEdit={canEdit && !isLoadingDetail}
                                onDecisionChange={onDecisionChange}
                                onNoteChange={onNoteChange}
                                onSave={saveWithMergeChoices}
                            />
                        </>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
