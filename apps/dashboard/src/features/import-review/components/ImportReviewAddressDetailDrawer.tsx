"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AddressSourceContextSection from "./AddressSourceContextSection";
import ImportReviewMapPreview from "./ImportReviewMapPreview";
import ReverseAddressSuggestionPanel from "@/src/features/addresses/ReverseAddressSuggestionPanel";
import { buildAddressPreviewFeatureCollection } from "../utils/importReviewAddressMapGeometry";
import { reverseComponentsToImportReviewRows } from "@/src/features/addresses/reverseAddressToRows";
import { useReverseAddressSuggestion } from "@/src/features/addresses/useReverseAddressSuggestion";
import CandidateReviewActionsSection from "./detail/CandidateReviewActionsSection";
import ImportReviewErrorState from "./ImportReviewErrorState";
import ImportReviewInlineSpinner from "./ImportReviewInlineSpinner";
import ImportReviewStatusBanner from "./ImportReviewStatusBanner";
import ImportReviewStatusBadge from "./ImportReviewStatusBadge";
import type { ImportReviewEntityConfig } from "../config/types";
import { isGeometryEssentialForEntity } from "../config/essentialFields";
import { IMPORT_REVIEW_LOADING } from "../utils/loadingMessages";
import { importReviewMessageTone } from "../utils/importReviewMessageTone";
import {
    collectDeleteIdsForClearedLanguages,
    collectDeleteIdsForRemovedRows,
    editorRowsToPatchBody,
    flatComponentsToEditorRows,
    type AddressComponentEditorRow,
} from "../utils/importReviewAddressComponentRows";
import { validationIssuesFromReviewJson } from "@/src/lib/importReviewValidationMessages";
import type { ImportReviewScopeQueryParams } from "@/src/lib/importReviewSnapshot";
import type {
    ImportReviewAddressOptionsResponse,
    ImportReviewBuildingListItem,
    ImportReviewDecision,
    ImportReviewGeoJson,
    ImportReviewReferenceOptionDto,
} from "@/src/lib/api";
import {
    getImportReviewAddressOptions,
    getImportReviewReferenceOptions,
    patchImportReviewAddressComponents,
    patchImportReviewAddressMatches,
    patchImportReviewAddressPlaceStatus,
    patchImportReviewFamilyOverrides,
    postImportReviewAddressCreatePlaceCandidate,
    postImportReviewAddressPromote,
    postImportReviewAddressPromoteDryRun,
    postImportReviewAddressValidate,
    postImportReviewPlaceAddressLinkPromote,
    postImportReviewPlaceAddressLinkPromoteDryRun,
    postImportReviewPlaceAddressLinkValidate,
    postImportReviewPlacePromote,
    postImportReviewPlacePromoteDryRun,
    postImportReviewPlaceValidate,
} from "@/src/lib/api";
import type { Geometry, Point } from "geojson";
import type { DataReviewGeometryKind } from "@/src/components/map/DataReviewCandidateMap";
import type { ImportReviewEntityType } from "@/src/components/map/DataReviewCandidateMap";

function dash(value: string | null | undefined): string {
    if (!value?.trim()) {
        return "—";
    }
    return value;
}

function classificationReasons(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((item) => {
            if (typeof item === "string") {
                return item.trim();
            }
            if (item && typeof item === "object") {
                const record = item as Record<string, unknown>;
                const code = typeof record.code === "string" ? record.code : null;
                const reason = typeof record.reason === "string" ? record.reason : null;
                const message = typeof record.message === "string" ? record.message : null;
                return (message ?? reason ?? code ?? JSON.stringify(record)).trim();
            }
            return "";
        })
        .filter((item) => item.length > 0);
}

export default function ImportReviewAddressDetailDrawer({
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
    decisionSaveMessage,
    apiScope,
    drawerNote,
    drawerDecision,
    canEdit,
    onClose,
    onNoteChange,
    onDecisionChange,
    onSave,
    onDetailRefetch,
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
    decisionSaveMessage: string | null;
    apiScope: ImportReviewScopeQueryParams | null;
    drawerNote: string;
    drawerDecision: ImportReviewDecision;
    canEdit: boolean;
    onClose: () => void;
    onNoteChange: (value: string) => void;
    onDecisionChange: (value: ImportReviewDecision) => void;
    onSave: () => void;
    onDetailRefetch: () => Promise<void>;
}) {
    const [componentRows, setComponentRows] = useState<AddressComponentEditorRow[]>([]);
    const [pendingDeleteIds, setPendingDeleteIds] = useState<string[]>([]);
    const [matchOptions, setMatchOptions] = useState<ImportReviewAddressOptionsResponse | null>(null);
    const [matchOptionsLoading, setMatchOptionsLoading] = useState(false);
    const [matchOptionsError, setMatchOptionsError] = useState("");

    const [matchedAdminAreaId, setMatchedAdminAreaId] = useState(row.matched_admin_area_id ?? "");
    const [matchedStreetId, setMatchedStreetId] = useState(row.matched_street_id ?? "");
    const [matchedBuildingId, setMatchedBuildingId] = useState(row.matched_building_id ?? "");
    const [matchedPlaceId, setMatchedPlaceId] = useState(row.matched_place_id ?? "");

    const [isSavingComponents, setIsSavingComponents] = useState(false);
    const [isSavingMatches, setIsSavingMatches] = useState(false);
    const [isValidating, setIsValidating] = useState(false);
    const [isPromoting, setIsPromoting] = useState(false);
    const [isPlaceWorkflowSaving, setIsPlaceWorkflowSaving] = useState(false);
    const [saveMessage, setSaveMessage] = useState<string | null>(null);

    const [componentTypeOptions, setComponentTypeOptions] = useState<ImportReviewReferenceOptionDto[]>([]);
    const [mapPoint, setMapPoint] = useState<Geometry | null>(null);
    const [locationSaving, setLocationSaving] = useState(false);
    const [manualMatchIds, setManualMatchIds] = useState(false);
    const reverse = useReverseAddressSuggestion(canEdit);

    const addressPreviewCollection = useMemo(() => {
        const layers = row.map_preview_layers ?? {
            candidate_point: (geometry as ImportReviewGeoJson | null) ?? null,
            entrance_point: row.entrance_geometry ?? null,
            matched_building: null,
            matched_street: null,
            matched_admin_area: null,
        };
        return buildAddressPreviewFeatureCollection(layers);
    }, [row.map_preview_layers, row.entrance_geometry, geometry]);

    useEffect(() => {
        let cancelled = false;
        void getImportReviewReferenceOptions()
            .then((bundle) => {
                if (!cancelled) {
                    setComponentTypeOptions(bundle.ref_address_component_types ?? []);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setComponentTypeOptions([]);
                }
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const syncFromRow = useCallback((detail: ImportReviewBuildingListItem) => {
        setComponentRows(flatComponentsToEditorRows(detail.address_components_flat));
        setPendingDeleteIds([]);
        setMatchedAdminAreaId(detail.matched_admin_area_id ?? "");
        setMatchedStreetId(detail.matched_street_id ?? "");
        setMatchedBuildingId(detail.matched_building_id ?? "");
        setMatchedPlaceId(detail.matched_place_id ?? "");
    }, []);

    useEffect(() => {
        syncFromRow(row);
    }, [row, syncFromRow]);

    useEffect(() => {
        if (geometry && typeof geometry === "object" && "type" in geometry) {
            setMapPoint(geometry as unknown as Geometry);
        } else {
            setMapPoint(null);
        }
    }, [geometry]);

    useEffect(() => {
        let cancelled = false;
        setMatchOptionsLoading(true);
        setMatchOptionsError("");
        void getImportReviewAddressOptions(row.id)
            .then((data) => {
                if (!cancelled) {
                    setMatchOptions(data);
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setMatchOptionsError(err instanceof Error ? err.message : "Failed to load match options");
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setMatchOptionsLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [row.id]);

    const blockers = useMemo(
        () => validationIssuesFromReviewJson(row.promotion_blockers ?? row.validation_errors, "error"),
        [row.promotion_blockers, row.validation_errors]
    );
    const warnings = useMemo(
        () => validationIssuesFromReviewJson(row.promotion_warnings ?? row.validation_warnings, "warning"),
        [row.promotion_warnings, row.validation_warnings]
    );
    const placeValidationBlockers = useMemo(
        () => validationIssuesFromReviewJson(row.linked_place_candidate?.validation_errors, "error"),
        [row.linked_place_candidate?.validation_errors]
    );
    const placeValidationWarnings = useMemo(
        () => validationIssuesFromReviewJson(row.linked_place_candidate?.validation_warnings, "warning"),
        [row.linked_place_candidate?.validation_warnings]
    );
    const linkValidationBlockers = useMemo(
        () => validationIssuesFromReviewJson(row.place_address_link?.validation_errors, "error"),
        [row.place_address_link?.validation_errors]
    );
    const linkValidationWarnings = useMemo(
        () => validationIssuesFromReviewJson(row.place_address_link?.validation_warnings, "warning"),
        [row.place_address_link?.validation_warnings]
    );

    const validationStatus = (row.validation_status ?? "").toLowerCase();
    const validationBlocked = validationStatus === "blocked" || validationStatus === "failed";
    const needsConfirmWarnings = validationStatus === "valid_with_warnings";
    const reviewApproved =
        (row.review_status ?? "").toLowerCase() === "approved" ||
        (row.review_decision ?? "").toLowerCase() === "approved";
    const validationReady = validationStatus === "valid" || validationStatus === "valid_with_warnings";
    const promoteDisabled =
        validationBlocked ||
        row.promotion_status === "promoted" ||
        !reviewApproved ||
        !validationReady ||
        blockers.length > 0;

    const handleSaveComponents = async () => {
        setIsSavingComponents(true);
        setSaveMessage(null);
        try {
            const body = editorRowsToPatchBody(componentRows, pendingDeleteIds);
            await patchImportReviewAddressComponents(row.id, body);
            await onDetailRefetch();
            setSaveMessage("Components saved.");
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Failed to save components");
        } finally {
            setIsSavingComponents(false);
        }
    };

    const handleSaveMatches = async () => {
        setIsSavingMatches(true);
        setSaveMessage(null);
        try {
            await patchImportReviewAddressMatches(row.id, {
                matched_admin_area_id: matchedAdminAreaId.trim() || null,
                matched_street_id: matchedStreetId.trim() || null,
                matched_building_id: matchedBuildingId.trim() || null,
                matched_place_id: matchedPlaceId.trim() || null,
            });
            await onDetailRefetch();
            setSaveMessage("Matches saved.");
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Failed to save matches");
        } finally {
            setIsSavingMatches(false);
        }
    };

    const handlePromote = async (dryRun: boolean) => {
        setIsPromoting(true);
        setSaveMessage(null);
        try {
            const body = {
                candidate_ids: [row.id],
                confirm_warnings: needsConfirmWarnings,
            };
            const res = dryRun
                ? await postImportReviewAddressPromoteDryRun(body)
                : await postImportReviewAddressPromote(body);
            const item = res.items.find((i) => i.address_candidate_id === row.id);
            const label = item?.outcome ?? (dryRun ? "dry_run" : "promote");
            setSaveMessage(
                dryRun
                    ? `Dry-run: ${label}${res.message ? ` — ${res.message}` : ""}`
                    : `Promotion: ${label}${item?.core_address_id ? ` → core #${item.core_address_id}` : ""}`
            );
            await onDetailRefetch();
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Promotion failed");
        } finally {
            setIsPromoting(false);
        }
    };

    const handlePromotePlace = async (dryRun: boolean) => {
        const placeId = row.linked_place_candidate?.id ?? row.linked_place_candidate_id;
        if (!placeId) {
            setSaveMessage("No linked place candidate to promote.");
            return;
        }
        setIsPromoting(true);
        setSaveMessage(null);
        try {
            const body = {
                candidate_ids: [placeId],
                confirm_warnings: row.linked_place_candidate?.validation_status === "valid_with_warnings",
            };
            const res = dryRun
                ? await postImportReviewPlacePromoteDryRun(body)
                : await postImportReviewPlacePromote(body);
            const item = res.items.find((i) => i.candidate_id === placeId);
            const label = item?.outcome ?? (dryRun ? "dry_run" : "promote");
            setSaveMessage(
                dryRun
                    ? `Place dry-run: ${label}`
                    : `Place promotion: ${label}${item?.core_id ? ` → core #${item.core_id}` : ""}`
            );
            await onDetailRefetch();
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Place promotion failed");
        } finally {
            setIsPromoting(false);
        }
    };

    const handlePromoteLink = async (dryRun: boolean) => {
        const linkId = row.place_address_link?.id;
        if (!linkId) {
            setSaveMessage("No place/address link to promote.");
            return;
        }
        setIsPromoting(true);
        setSaveMessage(null);
        try {
            const body = {
                link_ids: [linkId],
                confirm_warnings: row.place_address_link?.validation_status === "valid_with_warnings",
            };
            const res = dryRun
                ? await postImportReviewPlaceAddressLinkPromoteDryRun(body)
                : await postImportReviewPlaceAddressLinkPromote(body);
            const item = res.items.find((i) => i.candidate_id === linkId);
            const label = item?.outcome ?? (dryRun ? "dry_run" : "promote");
            setSaveMessage(
                dryRun
                    ? `Link dry-run: ${label}`
                    : `Link promotion: ${label}${item?.core_id ? ` → ${item.core_id}` : ""}`
            );
            await onDetailRefetch();
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Link promotion failed");
        } finally {
            setIsPromoting(false);
        }
    };

    const handleMapPick = async ({ lat, lng, point }: { lat: number; lng: number; point: Point }) => {
        setMapPoint(point);
        setLocationSaving(true);
        setSaveMessage(null);
        try {
            if (canEdit) {
                await patchImportReviewFamilyOverrides("addresses", row.id, {
                    review_overrides: { point_geom: point as unknown as ImportReviewGeoJson },
                });
                await onDetailRefetch();
            }
            await reverse.fetchAt(lat, lng, "en");
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Failed to save map location");
        } finally {
            setLocationSaving(false);
        }
    };

    const applySuggestedComponents = () => {
        if (!reverse.data?.components.length) {
            return;
        }
        setComponentRows(reverseComponentsToImportReviewRows(reverse.data.components));
        const m = reverse.data.matched;
        if (m.admin_area_id) {
            const hit = matchOptions?.adminAreas.find(
                (a) => a.id === m.admin_area_id || a.canonical_name === m.admin_area_id
            );
            if (hit) {
                setMatchedAdminAreaId(hit.id);
            }
        }
        if (m.street_id) {
            const hit = matchOptions?.streets.find(
                (s) => s.id === m.street_id || s.canonical_name === m.street_id
            );
            if (hit) {
                setMatchedStreetId(hit.id);
            }
        }
        if (m.building_id) {
            setMatchedBuildingId(m.building_id);
        }
        if (m.place_id) {
            setMatchedPlaceId(m.place_id);
        }
        setSaveMessage("Suggested components applied — save components and matches to persist.");
    };

    const handleValidate = async () => {
        setIsValidating(true);
        setSaveMessage(null);
        try {
            const batchId = row.review_batch_id?.trim();
            const res = await postImportReviewAddressValidate({
                ...(batchId ? { review_batch_id: batchId } : {}),
                candidate_ids: [row.id],
            });
            const item = res.results.find((r) => r.address_candidate_id === row.id);
            if (item) {
                setSaveMessage(`Validation: ${item.validation_status}`);
            }
            await onDetailRefetch();
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Validation failed");
        } finally {
            setIsValidating(false);
        }
    };

    const handleValidatePlace = async () => {
        const placeId = row.linked_place_candidate?.id ?? row.linked_place_candidate_id;
        if (!placeId) {
            setSaveMessage("No linked place candidate to validate.");
            return;
        }
        setIsValidating(true);
        setSaveMessage(null);
        try {
            const res = await postImportReviewPlaceValidate({ candidate_ids: [placeId] });
            const item = res.results.find((r) => r.place_candidate_id === placeId);
            setSaveMessage(item ? `Place validation: ${item.validation_status}` : "Place validation complete.");
            await onDetailRefetch();
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Place validation failed");
        } finally {
            setIsValidating(false);
        }
    };

    const handleValidateLink = async () => {
        const linkId = row.place_address_link?.id;
        if (!linkId) {
            setSaveMessage("No place/address link to validate.");
            return;
        }
        setIsValidating(true);
        setSaveMessage(null);
        try {
            const res = await postImportReviewPlaceAddressLinkValidate({ link_ids: [linkId] });
            const item = res.results.find((r) => r.place_address_link_id === linkId);
            setSaveMessage(item ? `Link validation: ${item.validation_status}` : "Link validation complete.");
            await onDetailRefetch();
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Link validation failed");
        } finally {
            setIsValidating(false);
        }
    };

    const handleCreatePlaceCandidate = async () => {
        setIsPlaceWorkflowSaving(true);
        setSaveMessage(null);
        try {
            const res = await postImportReviewAddressCreatePlaceCandidate(row.id);
            setSaveMessage(
                res.linked_place_candidate_id
                    ? `Linked place candidate #${res.linked_place_candidate_id}.`
                    : "Place candidate workflow updated."
            );
            await onDetailRefetch();
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Failed to create place candidate");
        } finally {
            setIsPlaceWorkflowSaving(false);
        }
    };

    const handleLinkSelectedCorePlace = async () => {
        const corePlaceId = matchedPlaceId.trim();
        if (!corePlaceId) {
            setSaveMessage("Select or enter a core place id first.");
            return;
        }
        setIsPlaceWorkflowSaving(true);
        setSaveMessage(null);
        try {
            await patchImportReviewAddressPlaceStatus(row.id, {
                matched_core_place_id: corePlaceId,
            });
            setSaveMessage(`Linked core place #${corePlaceId}.`);
            await onDetailRefetch();
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Failed to link core place");
        } finally {
            setIsPlaceWorkflowSaving(false);
        }
    };

    const handleIgnorePlaceEvidence = async () => {
        setIsPlaceWorkflowSaving(true);
        setSaveMessage(null);
        try {
            await patchImportReviewAddressPlaceStatus(row.id, {
                place_candidate_status: "ignored",
            });
            setSaveMessage("Place evidence ignored.");
            await onDetailRefetch();
        } catch (err: unknown) {
            setSaveMessage(err instanceof Error ? err.message : "Failed to ignore place evidence");
        } finally {
            setIsPlaceWorkflowSaving(false);
        }
    };

    const updateRow = (rowKey: string, patch: Partial<AddressComponentEditorRow>) => {
        setComponentRows((prev) => {
            const next = prev.map((r) => {
                if (r.rowKey !== rowKey) {
                    return r;
                }
                const merged = { ...r, ...patch };
                const cleared = collectDeleteIdsForClearedLanguages(r, merged);
                if (cleared.length > 0) {
                    setPendingDeleteIds((ids) => [...ids, ...cleared]);
                }
                return merged;
            });
            return next;
        });
    };

    const removeRow = (rowKey: string) => {
        setComponentRows((prev) => {
            const removed = prev.find((r) => r.rowKey === rowKey);
            const next = prev.filter((r) => r.rowKey !== rowKey);
            if (removed) {
                const dels = collectDeleteIdsForRemovedRows([removed], []);
                if (dels.length > 0) {
                    setPendingDeleteIds((ids) => [...ids, ...dels]);
                }
            }
            return next;
        });
    };

    const addRow = () => {
        setComponentRows((prev) => [
            ...prev,
            {
                rowKey: `new::${Date.now()}`,
                component_type_code: componentTypeOptions[0]?.code ?? "street",
                en: "",
                my: "",
                und: "",
                match_type: "",
                confidence_score: "",
                source_summary: "—",
                component_ids: {},
                is_reviewed: false,
            },
        ]);
    };

    const metadataWarning = Boolean(detailError && !detailNotFound);
    const showBody = !detailNotFound;
    const title = row.display_full_address ?? row.external_id ?? row.id;
    const reasons = classificationReasons(row.classification_reasons);
    const createPlaceDisabled =
        !canEdit || isPlaceWorkflowSaving || row.has_place_evidence !== true;

    return (
        <div
            className="fixed inset-0 z-40 flex justify-end bg-black/30"
            role="dialog"
            aria-modal="true"
            onClick={onClose}
        >
            <div
                className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-start justify-between border-b border-gray-200 bg-white px-5 py-4">
                    <div className="min-w-0 pr-4">
                        <h2 className="text-lg font-semibold text-gray-900">Address · {dash(title)}</h2>
                        <p className="font-mono text-xs text-gray-500">{row.id}</p>
                        {row.external_id ? (
                            <p className="font-mono text-xs text-gray-600">{row.external_id}</p>
                        ) : null}
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                    >
                        Close
                    </button>
                </div>

                <div className="space-y-3 border-b border-gray-100 bg-gray-50/80 px-5 py-3">
                    {isLoadingDetail ? (
                        <ImportReviewInlineSpinner label={IMPORT_REVIEW_LOADING.loadingCandidateDetail} />
                    ) : null}
                    {isSaving || isSavingComponents || isSavingMatches || isValidating || isPlaceWorkflowSaving ? (
                        <ImportReviewInlineSpinner label="Saving…" />
                    ) : null}
                    {saveMessage ? (
                        <ImportReviewStatusBanner
                            message={saveMessage}
                            tone={importReviewMessageTone(saveMessage)}
                            compact
                        />
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
                        <ImportReviewErrorState message="Candidate not found." />
                    ) : null}
                    {showBody ? (
                        <>
                            {metadataWarning ? (
                                <ImportReviewStatusBanner
                                    message={detailError}
                                    tone="warning"
                                    compact
                                />
                            ) : null}
                            {detailTechnicalError?.trim() ? (
                                <pre className="max-h-28 overflow-auto rounded border border-amber-100 bg-amber-50/80 p-2 text-[10px] text-amber-950 whitespace-pre-wrap">
                                    {detailTechnicalError}
                                </pre>
                            ) : null}

                            <AddressSourceContextSection
                                sourceContext={row.source_context}
                                sourceTags={row.source_tags}
                                externalId={row.external_id}
                                sourceEntityType={row.source_entity_type}
                            />

                            <section className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/30 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-900">
                                        Source classification
                                    </h3>
                                    <div className="flex flex-wrap gap-1.5">
                                        <ImportReviewStatusBadge value={row.source_classification ?? "unknown"} />
                                        <ImportReviewStatusBadge value={row.address_strength ?? "unknown"} />
                                    </div>
                                </div>
                                <div className="grid gap-2 text-sm sm:grid-cols-2">
                                    <div>
                                        <span className="text-gray-600">Place evidence</span>
                                        <p className="font-medium text-gray-900">
                                            {row.has_place_evidence ? "Yes" : "No"}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Address evidence</span>
                                        <p className="font-medium text-gray-900">
                                            {row.has_address_evidence ? "Yes" : "No"}
                                        </p>
                                    </div>
                                </div>
                                {reasons.length > 0 ? (
                                    <ul className="list-disc space-y-1 pl-4 text-xs text-blue-950">
                                        {reasons.map((reason, index) => (
                                            <li key={`${reason}-${index}`}>{reason}</li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-xs text-gray-500">No classification reasons recorded.</p>
                                )}
                            </section>

                            <section className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/30 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-900">
                                        Related place / POI workflow
                                    </h3>
                                    <ImportReviewStatusBadge value={row.place_candidate_status ?? "not_applicable"} />
                                </div>
                                <div className="grid gap-2 text-sm sm:grid-cols-2">
                                    <div>
                                        <span className="text-gray-600">Source name</span>
                                        <p className="font-medium text-gray-900">{dash(row.source_name)}</p>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Source type</span>
                                        <p className="font-medium text-gray-900">{dash(row.source_type_hint)}</p>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Linked place candidate</span>
                                        <p className="font-mono text-xs text-gray-900">
                                            {row.linked_place_candidate ? (
                                                <>
                                                    #{row.linked_place_candidate.id} ·{" "}
                                                    {dash(
                                                        row.linked_place_candidate.display_name ??
                                                            row.linked_place_candidate.canonical_name
                                                    )}
                                                </>
                                            ) : (
                                                dash(row.linked_place_candidate_id)
                                            )}
                                        </p>
                                    </div>
                                    <div>
                                        <span className="text-gray-600">Matched core place</span>
                                        <p className="font-mono text-xs text-gray-900">
                                            {row.matched_core_place ? (
                                                <>
                                                    #{row.matched_core_place.id} ·{" "}
                                                    {dash(
                                                        row.matched_core_place.display_name ??
                                                            row.matched_core_place.canonical_name
                                                    )}
                                                </>
                                            ) : (
                                                dash(row.matched_core_place_id)
                                            )}
                                        </p>
                                    </div>
                                </div>
                                {row.place_address_link ? (
                                    <p className="text-xs text-emerald-950">
                                        Link #{row.place_address_link.id}: {dash(row.place_address_link.relation_type)} ·{" "}
                                        {dash(row.place_address_link.validation_status)} ·{" "}
                                        {dash(row.place_address_link.promotion_status)}
                                    </p>
                                ) : (
                                    <p className="text-xs text-gray-500">No place/address link yet.</p>
                                )}
                                {canEdit ? (
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            disabled={createPlaceDisabled}
                                            onClick={() => void handleCreatePlaceCandidate()}
                                            className="rounded-lg border border-emerald-700 bg-white px-3 py-1.5 text-sm text-emerald-950 disabled:opacity-50"
                                        >
                                            Create place candidate
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isPlaceWorkflowSaving || matchedPlaceId.trim() === ""}
                                            onClick={() => void handleLinkSelectedCorePlace()}
                                            className="rounded-lg border border-gray-400 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
                                        >
                                            Link selected core place
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isPlaceWorkflowSaving}
                                            onClick={() => void handleIgnorePlaceEvidence()}
                                            className="rounded-lg border border-amber-600 bg-white px-3 py-1.5 text-sm text-amber-950 disabled:opacity-50"
                                        >
                                            Ignore place evidence
                                        </button>
                                    </div>
                                ) : null}
                                <p className="text-xs text-gray-500">
                                    The source/place name is kept as POI context and is not written into address components.
                                </p>
                            </section>

                            <section className="space-y-2 rounded-xl border border-violet-100 bg-violet-50/40 p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-900">
                                    Generated full address (readonly)
                                </h3>
                                <p className="text-xs text-violet-800">Generated from address components</p>
                                <div className="space-y-2 text-sm">
                                    <div>
                                        <span className="font-medium text-gray-600">English</span>
                                        <p className="text-gray-900">{dash(row.generated_full_address_en)}</p>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-600">Myanmar</span>
                                        <p className="text-gray-900">{dash(row.generated_full_address_my)}</p>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-600">Display</span>
                                        <p className="text-gray-900">{dash(row.display_full_address)}</p>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-3 rounded-xl border border-gray-200 p-4">
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Address components
                                    </h3>
                                    {canEdit ? (
                                        <button
                                            type="button"
                                            onClick={addRow}
                                            className="rounded border border-gray-300 px-2 py-1 text-xs"
                                        >
                                            Add row
                                        </button>
                                    ) : null}
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[640px] text-left text-xs">
                                        <thead className="border-b text-gray-500">
                                            <tr>
                                                <th className="py-1 pr-2">Type</th>
                                                <th className="py-1 pr-2">EN</th>
                                                <th className="py-1 pr-2">MY</th>
                                                <th className="py-1 pr-2">UND</th>
                                                <th className="py-1 pr-2">Match</th>
                                                <th className="py-1 pr-2">Conf.</th>
                                                <th className="py-1">Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {componentRows.length === 0 ? (
                                                <tr>
                                                    <td colSpan={7} className="py-4 text-gray-500">
                                                        No components — add rows or run admin inference.
                                                    </td>
                                                </tr>
                                            ) : (
                                                componentRows.map((r) => (
                                                    <tr key={r.rowKey} className="border-b border-gray-100">
                                                        <td className="py-2 pr-2 align-top">
                                                            <select
                                                                disabled={!canEdit}
                                                                value={r.component_type_code}
                                                                onChange={(e) =>
                                                                    updateRow(r.rowKey, {
                                                                        component_type_code: e.target.value,
                                                                    })
                                                                }
                                                                className="w-full min-w-[7rem] rounded border border-gray-300 px-1 py-0.5"
                                                            >
                                                                {componentTypeOptions.map((opt) => (
                                                                    <option key={opt.id} value={opt.code ?? ""}>
                                                                        {opt.code}
                                                                    </option>
                                                                ))}
                                                            </select>
                                                        </td>
                                                        <td className="py-2 pr-2 align-top">
                                                            <input
                                                                disabled={!canEdit}
                                                                value={r.en}
                                                                onChange={(e) =>
                                                                    updateRow(r.rowKey, { en: e.target.value })
                                                                }
                                                                className="w-full rounded border border-gray-300 px-1 py-0.5"
                                                            />
                                                        </td>
                                                        <td className="py-2 pr-2 align-top">
                                                            <input
                                                                disabled={!canEdit}
                                                                value={r.my}
                                                                onChange={(e) =>
                                                                    updateRow(r.rowKey, { my: e.target.value })
                                                                }
                                                                className="w-full rounded border border-gray-300 px-1 py-0.5"
                                                            />
                                                        </td>
                                                        <td className="py-2 pr-2 align-top">
                                                            <input
                                                                disabled={!canEdit}
                                                                value={r.und}
                                                                onChange={(e) =>
                                                                    updateRow(r.rowKey, { und: e.target.value })
                                                                }
                                                                className="w-full rounded border border-gray-300 px-1 py-0.5"
                                                            />
                                                        </td>
                                                        <td className="py-2 pr-2 align-top text-[10px] text-gray-600">
                                                            {r.source_summary}
                                                        </td>
                                                        <td className="py-2 pr-2 align-top">
                                                            <input
                                                                disabled={!canEdit}
                                                                value={r.confidence_score}
                                                                onChange={(e) =>
                                                                    updateRow(r.rowKey, {
                                                                        confidence_score: e.target.value,
                                                                    })
                                                                }
                                                                className="w-12 rounded border border-gray-300 px-1 py-0.5"
                                                            />
                                                        </td>
                                                        <td className="py-2 align-top">
                                                            {canEdit ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => removeRow(r.rowKey)}
                                                                    className="text-red-700 hover:underline"
                                                                >
                                                                    Remove
                                                                </button>
                                                            ) : null}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                                {canEdit ? (
                                    <button
                                        type="button"
                                        disabled={isSavingComponents}
                                        onClick={() => void handleSaveComponents()}
                                        className="rounded-lg bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
                                    >
                                        Save components
                                    </button>
                                ) : null}
                            </section>

                            <section className="space-y-3 rounded-xl border border-gray-200 p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Matching
                                </h3>
                                {matchOptionsLoading ? (
                                    <ImportReviewInlineSpinner label="Loading match options…" />
                                ) : null}
                                {matchOptionsError ? (
                                    <p className="text-xs text-red-700">{matchOptionsError}</p>
                                ) : null}
                                <label className="block text-sm">
                                    <span className="text-gray-600">Admin area</span>
                                    <select
                                        disabled={!canEdit}
                                        value={matchedAdminAreaId}
                                        onChange={(e) => setMatchedAdminAreaId(e.target.value)}
                                        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                                    >
                                        <option value="">—</option>
                                        {matchOptions?.adminAreas.map((a) => (
                                            <option key={a.id} value={a.id}>
                                                {a.canonical_name} ({a.admin_level_code}, score {a.match_score})
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block text-sm">
                                    <span className="text-gray-600">Street</span>
                                    <select
                                        disabled={!canEdit}
                                        value={matchedStreetId}
                                        onChange={(e) => setMatchedStreetId(e.target.value)}
                                        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                                    >
                                        <option value="">—</option>
                                        {matchOptions?.streets.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.canonical_name} ({Math.round(s.distance_m)}m, score{" "}
                                                {s.match_score})
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block text-sm">
                                    <span className="text-gray-600">Building (core)</span>
                                    <select
                                        disabled={!canEdit || manualMatchIds}
                                        value={matchedBuildingId}
                                        onChange={(e) => setMatchedBuildingId(e.target.value)}
                                        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                                    >
                                        <option value="">—</option>
                                        {(matchOptions?.buildings ?? []).map((b) => (
                                            <option key={b.id} value={b.id}>
                                                Building #{b.id}
                                                {b.building_type ? ` · ${b.building_type}` : ""} ·{" "}
                                                {Math.round(b.distance_m)}m · score {b.match_score}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="block text-sm">
                                    <span className="text-gray-600">Place (core)</span>
                                    <select
                                        disabled={!canEdit || manualMatchIds}
                                        value={matchedPlaceId}
                                        onChange={(e) => setMatchedPlaceId(e.target.value)}
                                        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                                    >
                                        <option value="">—</option>
                                        {(matchOptions?.places ?? []).map((p) => (
                                            <option key={p.id} value={p.id}>
                                                {p.display_name}
                                                {p.category ? ` · ${p.category}` : ""} ·{" "}
                                                {Math.round(p.distance_m)}m · score {p.match_score}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <details
                                    className="text-xs"
                                    onToggle={(e) =>
                                        setManualMatchIds((e.currentTarget as HTMLDetailsElement).open)
                                    }
                                >
                                    <summary className="cursor-pointer text-gray-600">
                                        Manual building / place ID
                                    </summary>
                                    <div className="mt-2 space-y-2">
                                        <label className="block text-sm">
                                            <span className="text-gray-600">Building ID</span>
                                            <input
                                                disabled={!canEdit}
                                                value={matchedBuildingId}
                                                onChange={(e) => setMatchedBuildingId(e.target.value)}
                                                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 font-mono text-sm"
                                            />
                                        </label>
                                        <label className="block text-sm">
                                            <span className="text-gray-600">Place ID</span>
                                            <input
                                                disabled={!canEdit}
                                                value={matchedPlaceId}
                                                onChange={(e) => setMatchedPlaceId(e.target.value)}
                                                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1.5 font-mono text-sm"
                                            />
                                        </label>
                                    </div>
                                </details>
                                {canEdit ? (
                                    <button
                                        type="button"
                                        disabled={isSavingMatches}
                                        onClick={() => void handleSaveMatches()}
                                        className="rounded-lg border border-gray-800 px-3 py-1.5 text-sm"
                                    >
                                        Save matches
                                    </button>
                                ) : null}
                            </section>

                            <section className="space-y-4 rounded-xl border border-gray-200 p-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Validation
                                    </h3>
                                    <div className="flex flex-wrap gap-1.5">
                                        <ImportReviewStatusBadge value={row.validation_status ?? "not_checked"} />
                                        {row.linked_place_candidate ? (
                                            <ImportReviewStatusBadge
                                                value={row.linked_place_candidate.validation_status ?? "not_checked"}
                                            />
                                        ) : null}
                                        {row.place_address_link ? (
                                            <ImportReviewStatusBadge
                                                value={row.place_address_link.validation_status ?? "not_checked"}
                                            />
                                        ) : null}
                                    </div>
                                </div>
                                {row.validated_at ? (
                                    <p className="text-xs text-gray-500">
                                        Last validated: {new Date(row.validated_at).toLocaleString()}
                                    </p>
                                ) : null}
                                <div className="space-y-3">
                                    <div>
                                        <h4 className="text-xs font-semibold text-gray-700">Address validation</h4>
                                        {blockers.length > 0 ? (
                                            <ul className="list-disc space-y-1 pl-4 text-xs text-red-800">
                                                {blockers.map((b, i) => (
                                                    <li key={`${b.code}-${i}`}>{b.message}</li>
                                                ))}
                                            </ul>
                                        ) : null}
                                        {warnings.length > 0 ? (
                                            <ul className="list-disc space-y-1 pl-4 text-xs text-amber-900">
                                                {warnings.map((w, i) => (
                                                    <li key={`${w.code}-${i}`}>{w.message}</li>
                                                ))}
                                            </ul>
                                        ) : null}
                                        {blockers.length === 0 && warnings.length === 0 ? (
                                            <p className="text-xs text-gray-500">No address validation issues.</p>
                                        ) : null}
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-semibold text-gray-700">Place validation</h4>
                                        {placeValidationBlockers.length > 0 ? (
                                            <ul className="list-disc space-y-1 pl-4 text-xs text-red-800">
                                                {placeValidationBlockers.map((b, i) => (
                                                    <li key={`${b.code}-${i}`}>{b.message}</li>
                                                ))}
                                            </ul>
                                        ) : null}
                                        {placeValidationWarnings.length > 0 ? (
                                            <ul className="list-disc space-y-1 pl-4 text-xs text-amber-900">
                                                {placeValidationWarnings.map((w, i) => (
                                                    <li key={`${w.code}-${i}`}>{w.message}</li>
                                                ))}
                                            </ul>
                                        ) : null}
                                        {!row.linked_place_candidate ? (
                                            <p className="text-xs text-gray-500">No linked place candidate.</p>
                                        ) : placeValidationBlockers.length === 0 && placeValidationWarnings.length === 0 ? (
                                            <p className="text-xs text-gray-500">No place validation issues.</p>
                                        ) : null}
                                    </div>
                                    <div>
                                        <h4 className="text-xs font-semibold text-gray-700">Link validation</h4>
                                        {linkValidationBlockers.length > 0 ? (
                                            <ul className="list-disc space-y-1 pl-4 text-xs text-red-800">
                                                {linkValidationBlockers.map((b, i) => (
                                                    <li key={`${b.code}-${i}`}>{b.message}</li>
                                                ))}
                                            </ul>
                                        ) : null}
                                        {linkValidationWarnings.length > 0 ? (
                                            <ul className="list-disc space-y-1 pl-4 text-xs text-amber-900">
                                                {linkValidationWarnings.map((w, i) => (
                                                    <li key={`${w.code}-${i}`}>{w.message}</li>
                                                ))}
                                            </ul>
                                        ) : null}
                                        {!row.place_address_link ? (
                                            <p className="text-xs text-gray-500">No place/address link.</p>
                                        ) : linkValidationBlockers.length === 0 && linkValidationWarnings.length === 0 ? (
                                            <p className="text-xs text-gray-500">No link validation issues.</p>
                                        ) : null}
                                    </div>
                                </div>
                                {canEdit ? (
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            disabled={isValidating}
                                            onClick={() => void handleValidate()}
                                            className="rounded-lg border border-amber-600 px-3 py-1.5 text-sm text-amber-950 disabled:opacity-50"
                                        >
                                            Validate address
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isValidating || !row.linked_place_candidate}
                                            onClick={() => void handleValidatePlace()}
                                            className="rounded-lg border border-blue-600 px-3 py-1.5 text-sm text-blue-950 disabled:opacity-50"
                                        >
                                            Validate place
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isValidating || !row.place_address_link}
                                            onClick={() => void handleValidateLink()}
                                            className="rounded-lg border border-emerald-600 px-3 py-1.5 text-sm text-emerald-950 disabled:opacity-50"
                                        >
                                            Validate link
                                        </button>
                                    </div>
                                ) : null}
                            </section>

                            <section className="space-y-2 rounded-xl border border-gray-200 p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Promotion
                                </h3>
                                <p className="text-sm text-gray-700">
                                    Status: <strong>{dash(row.promotion_status)}</strong>
                                    {promoteDisabled ? (
                                        <span className="text-red-700">
                                            {" "}
                                            — promotion blocked until validation passes.
                                        </span>
                                    ) : (
                                        <span className="text-gray-500">
                                            {" "}
                                            — ready for promotion workflow when approved.
                                        </span>
                                    )}
                                </p>
                                {row.promoted_core_id ? (
                                    <p className="text-xs text-gray-600">
                                        Core address id:{" "}
                                        <span className="font-mono">{row.promoted_core_id}</span>
                                    </p>
                                ) : null}
                                {canEdit ? (
                                    <div className="flex flex-wrap gap-2">
                                        <button
                                            type="button"
                                            disabled={isPromoting}
                                            onClick={() => void handlePromote(true)}
                                            className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm"
                                        >
                                            Dry-run address
                                        </button>
                                        <button
                                            type="button"
                                            disabled={promoteDisabled || isPromoting}
                                            onClick={() => void handlePromote(false)}
                                            className="rounded-lg border border-emerald-700 bg-emerald-50 px-3 py-1.5 text-sm text-emerald-950 disabled:opacity-50"
                                        >
                                            Promote address
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isPromoting || !row.linked_place_candidate}
                                            onClick={() => void handlePromotePlace(true)}
                                            className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm disabled:opacity-50"
                                        >
                                            Dry-run place
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isPromoting || !row.linked_place_candidate}
                                            onClick={() => void handlePromotePlace(false)}
                                            className="rounded-lg border border-blue-700 bg-blue-50 px-3 py-1.5 text-sm text-blue-950 disabled:opacity-50"
                                        >
                                            Promote place
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isPromoting || !row.place_address_link}
                                            onClick={() => void handlePromoteLink(true)}
                                            className="rounded-lg border border-gray-400 px-3 py-1.5 text-sm disabled:opacity-50"
                                        >
                                            Dry-run link
                                        </button>
                                        <button
                                            type="button"
                                            disabled={isPromoting || !row.place_address_link}
                                            onClick={() => void handlePromoteLink(false)}
                                            className="rounded-lg border border-violet-700 bg-violet-50 px-3 py-1.5 text-sm text-violet-950 disabled:opacity-50"
                                        >
                                            Promote link
                                        </button>
                                    </div>
                                ) : null}
                                {needsConfirmWarnings && canEdit ? (
                                    <p className="text-xs text-amber-800">
                                        Promote sends confirm_warnings because validation has warnings.
                                    </p>
                                ) : null}
                            </section>

                            <section className="space-y-3 rounded-xl border border-violet-100 bg-violet-50/30 p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-900">
                                    Location & possible address
                                    {isGeometryEssentialForEntity(config) ? " *" : ""}
                                </h3>
                                {fallbackNote ? (
                                    <p className="text-xs text-amber-800">{fallbackNote}</p>
                                ) : null}
                                {locationSaving ? (
                                    <ImportReviewInlineSpinner label="Saving location…" />
                                ) : null}
                                {config.supportsMapPreview ? (
                                    <>
                                        <p className="text-xs text-violet-800">
                                            {canEdit
                                                ? "Click the map to set the candidate point. Use Fit and basemap controls like other import-review previews."
                                                : "Read-only location preview."}
                                        </p>
                                        <ImportReviewMapPreview
                                            enabled
                                            geometry={geometry}
                                            geometryKind={geometryKind}
                                            entityType={mapEntityType}
                                            externalId={row.external_id}
                                            title="Location"
                                            previewFeatureCollection={addressPreviewCollection}
                                            isLoadingDetail={isLoadingDetail}
                                            isLoadingGeometry={isLoadingGeometry}
                                            geometryError={geometryError}
                                            geometryTechnicalError={geometryTechnicalError}
                                            onRetryGeometry={onRetryGeometry}
                                            fitButtonLabel="Fit to location"
                                            onPointPick={
                                                canEdit
                                                    ? (coords) => {
                                                          const point: Point = {
                                                              type: "Point",
                                                              coordinates: [coords.lng, coords.lat],
                                                          };
                                                          void handleMapPick({
                                                              lat: coords.lat,
                                                              lng: coords.lng,
                                                              point,
                                                          });
                                                      }
                                                    : undefined
                                            }
                                            pointPickDisabled={!canEdit || locationSaving}
                                            size="drawer"
                                        />
                                    </>
                                ) : (
                                    <p className="text-xs text-gray-600">Map preview disabled.</p>
                                )}
                                <ReverseAddressSuggestionPanel
                                    data={reverse.data}
                                    loading={reverse.loading}
                                    error={reverse.error}
                                    canApply={canEdit && Boolean(reverse.data?.components.length)}
                                    onApplySuggested={applySuggestedComponents}
                                />
                            </section>

                            <CandidateReviewActionsSection
                                config={config}
                                drawerDecision={drawerDecision}
                                drawerNote={drawerNote}
                                isSaving={isSaving}
                                canEdit={canEdit && !isLoadingDetail && !validationBlocked}
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
