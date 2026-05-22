/**
 * Legacy import-review client for roads (and unused places paths).
 * `/import-review/roads` and `/data-review/roads` only — places use `ImportReviewEntityPageShell`.
 * TODO: port road routing-validation drawer to `ImportReviewDetailDrawer`, then delete this file.
 */
"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import DataReviewCandidateMap from "@/src/components/map/DataReviewCandidateMap";
import ImportReviewSelectedActionBar from "@/src/features/import-review/components/ImportReviewSelectedActionBar";
import { useClearSelectionOnListQueryChange } from "@/src/features/import-review/hooks/useClearSelectionOnListQueryChange";
import { useImportReviewBulkActions } from "@/src/features/import-review/hooks/useImportReviewBulkActions";
import { useImportReviewFormOptions } from "@/src/features/import-review/hooks/useImportReviewFormOptions";
import { roadClassOptionsFromFormOptions } from "@/src/features/import-review/utils/formOptionsUtils";
import { buildImportReviewListQueryKey } from "@/src/features/import-review/utils/entityPageUtils";
import { Card, CardContent } from "@/src/components/ui/card";
import {
    getImportReviewPlaces,
    getImportReviewRoads,
    getImportReviewSummary,
    isAbortError,
    isImportReviewBatchAmbiguousError,
    patchImportReviewPlaceDecision,
    patchImportReviewRoadDecision,
    type ImportReviewBatchChoice,
    type ImportReviewBuildingListItem,
    type ImportReviewBuildingsFilterOptionsResponse,
    type ImportReviewBuildingsListResponse,
    type ImportReviewDecision,
    type ImportReviewGeoJson,
    type ImportReviewRoadRoutingValidationResponse,
    type ImportReviewSummaryResponse,
} from "@/src/lib/api";
import {
    ApprovalGuidanceNote,
    bundleFromRoutingValidation,
    bundleFromRow,
    CollapsibleDrawerSection,
    ValidationModeBanner,
    ValidationSummaryBanner,
} from "@/src/lib/importReviewRoadDrawerValidation";
import {
    applyImportReviewScopeSearchParams,
    importReviewScopeQueryForApi,
    importReviewScopeQueryFromSearch,
    preserveImportReviewScopeInParams,
    reviewBatchIdFromImportReviewSearch,
    setImportReviewSnapshotSearchParam,
    snapshotVersionFromImportReviewSearch,
    syncImportReviewUrlToResolvedBatch,
    type ImportReviewScopeQueryParams,
} from "@/src/lib/importReviewSnapshot";
import { formatImportReviewScopeFetchError } from "@/src/lib/importReviewScopeUi";
import { IMPORT_REVIEW_PATH } from "@/src/lib/dashboardPaths";
import ImportReviewBatchPicker from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewBatchPicker";
import { validationMessagesFromReviewJson } from "@/src/lib/importReviewValidationMessages";
import ImportReviewRoadOverridesPanel from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewRoadOverridesPanel";
import {
    placeDrawerMapInput,
    roadDrawerMapInput,
} from "@/src/lib/importReviewDrawerMapGeometry";
import ImportReviewReviewActionsMenu from "@/src/app/(admin)/dashboard/import-review/_components/ImportReviewReviewActionsMenu";
import {
    IMPORT_REVIEW_TABLE_MIN_WIDTH_CLASS,
    ImportReviewTableFrame,
    importReviewRowSurface,
    importReviewStickyActionsTdClass,
    importReviewStickyActionsThClass,
    importReviewStickyCheckboxTdClass,
    importReviewStickyCheckboxThClass,
    importReviewStickyIdTdClass,
    importReviewStickyIdThClass,
} from "@/src/app/(admin)/dashboard/import-review/_components/importReviewTableUi";
import { deriveImportReviewEditorUxCanMutate } from "@/src/lib/importReviewEditorUx";
import {
    deriveRoadDrawerTitle,
    deriveRoadListAdminArea,
    deriveRoadListLengthM,
    deriveRoadListNameEn,
    deriveRoadListNameMm,
    deriveRoadListOneway,
    deriveRoadListRoadClass,
    deriveRoadListSurface,
    formatRoadListOneway,
} from "@/src/features/import-review/utils/importReviewRoadListDisplay";

const ENV_SNAPSHOT_DEFAULT = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION?.trim() ?? "";

function importReviewMutationScope(
    list: ImportReviewBuildingsListResponse | null,
    scope: ImportReviewScopeQueryParams | null
): { review_batch_id?: string; source_snapshot_version?: string } {
    if (list?.review_batch_id?.trim()) {
        return { review_batch_id: list.review_batch_id };
    }
    if (!scope) {
        return {};
    }
    if ("review_batch_id" in scope) {
        return { review_batch_id: scope.review_batch_id };
    }
    return { source_snapshot_version: scope.source_snapshot_version };
}

/** Must match API: filters NULL/empty review fields on list endpoint. */
const UNREVIEWED = "__unreviewed__";

const SORT_OPTIONS: { value: string; label: string }[] = [
    { value: "updated_at_desc", label: "Updated (newest)" },
    { value: "updated_at_asc", label: "Updated (oldest)" },
    { value: "created_at_desc", label: "Created (newest)" },
    { value: "created_at_asc", label: "Created (oldest)" },
    { value: "confidence_score_desc", label: "Confidence (high)" },
    { value: "confidence_score_asc", label: "Confidence (low)" },
    { value: "canonical_name_asc", label: "Name A–Z" },
    { value: "canonical_name_desc", label: "Name Z–A" },
    { value: "external_id_asc", label: "External ID A–Z" },
    { value: "external_id_desc", label: "External ID Z–A" },
    { value: "id_desc", label: "ID (high)" },
    { value: "id_asc", label: "ID (low)" },
];

const LIMIT_CHOICES = [25, 50, 100, 200] as const;

export type ImportReviewCandidateFamily = "places" | "roads";

function dash(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
        return "—";
    }
    if (typeof value === "boolean") {
        return value ? "yes" : "no";
    }
    if (typeof value === "string" && value.trim() === "") {
        return "—";
    }
    return String(value);
}

function formatTs(value: string | null | undefined): string {
    if (!value?.trim()) {
        return "—";
    }
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function safeJson(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function normPick(data: unknown, key: string): unknown {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return undefined;
    }
    const o = data as Record<string, unknown>;
    if (key in o) {
        return o[key];
    }
    const camel = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
    if (camel in o) {
        return o[camel];
    }
    return undefined;
}

function displayNormField(data: unknown, key: string): string {
    const v = normPick(data, key);
    if (v === null || v === undefined) {
        return "—";
    }
    if (typeof v === "object") {
        try {
            return JSON.stringify(v);
        } catch {
            return "—";
        }
    }
    return String(v);
}

function summarizePointGeom(g: ImportReviewGeoJson | null): string {
    if (!g || typeof g !== "object") {
        return "—";
    }
    const t = (g as { type?: unknown }).type;
    const coords = (g as { coordinates?: unknown }).coordinates;
    if (t !== "Point" || !Array.isArray(coords) || coords.length < 2) {
        return "—";
    }
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return "—";
    }
    return `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
}

function summarizeLineGeom(g: ImportReviewGeoJson | null): string {
    if (!g || typeof g !== "object") {
        return "—";
    }
    const type = String((g as { type?: unknown }).type ?? "");
    const coords = (g as { coordinates?: unknown }).coordinates;
    if (!type || coords === undefined) {
        return "—";
    }
    if (type === "LineString" && Array.isArray(coords)) {
        return `LineString · ${coords.length} vtx`;
    }
    if (type === "MultiLineString" && Array.isArray(coords)) {
        const lines = coords.length;
        const pts = coords.reduce((acc: number, line: unknown) => acc + (Array.isArray(line) ? line.length : 0), 0);
        return `MultiLineString · ${lines} part(s) · ~${pts} vtx`;
    }
    return `${type}`;
}

type ListFilters = {
    match_status: string;
    auto_action: string;
    review_status: string;
    review_decision: string;
};

function readListFilters(sp: URLSearchParams): ListFilters {
    return {
        match_status: sp.get("match_status")?.trim() ?? "",
        auto_action: sp.get("auto_action")?.trim() ?? "",
        review_status: sp.get("review_status")?.trim() ?? "",
        review_decision: sp.get("review_decision")?.trim() ?? "",
    };
}

function filterOptionsFromSummary(
    summary: ImportReviewSummaryResponse,
    family: ImportReviewCandidateFamily,
): ImportReviewBuildingsFilterOptionsResponse {
    const rows = summary.entity_summaries.filter((r) => r.entity_family === family);
    const uniqStrings = (pick: (row: (typeof rows)[number]) => string | null | undefined) => {
        const s = new Set<string>();
        for (const r of rows) {
            const v = pick(r);
            if (v !== null && v !== undefined && String(v).trim() !== "") {
                s.add(String(v).trim());
            }
        }
        return [...s].sort((a, b) => a.localeCompare(b));
    };
    return {
        source_snapshot_version: summary.source_snapshot_version,
        review_batch_id: summary.review_batch_id,
        source_snapshot_id_local: summary.source_snapshot_id_local,
        match_status: uniqStrings((r) => r.match_status),
        auto_action: uniqStrings((r) => r.auto_action),
        review_status: uniqStrings((r) => r.review_status),
        review_decision: uniqStrings((r) => r.review_decision),
        class_code: [],
        promotion_status: uniqStrings((r) => r.promotion_status),
    };
}

function Pill({ children, tone }: { children: React.ReactNode; tone: "slate" | "blue" | "amber" | "violet" }) {
    const cls =
        tone === "blue"
            ? "border-blue-100 bg-blue-50 text-blue-900"
            : tone === "amber"
              ? "border-amber-100 bg-amber-50 text-amber-900"
              : tone === "violet"
                ? "border-violet-100 bg-violet-50 text-violet-900"
                : "border-gray-200 bg-gray-50 text-gray-800";

    return (
        <span
            className={`inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}
        >
            {children}
        </span>
    );
}

function importReviewCandidateTitle(family: ImportReviewCandidateFamily): string {
    return family === "places" ? "places" : "roads";
}

export function ImportReviewCandidatesClient({
    family,
    showMapPreview = false,
}: {
    family: ImportReviewCandidateFamily;
    showMapPreview?: boolean;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const snapshotUrl = snapshotVersionFromImportReviewSearch(searchParams);
    const batchUrl = reviewBatchIdFromImportReviewSearch(searchParams);

    const [snapshotInput, setSnapshotInput] = useState(
        () => (batchUrl ? "" : snapshotUrl || ENV_SNAPSHOT_DEFAULT)
    );
    const [batchInput, setBatchInput] = useState(() => batchUrl || "");
    const [filters, setFilters] = useState<ListFilters>(() => readListFilters(searchParams));
    const [qDraft, setQDraft] = useState(searchParams.get("q")?.trim() ?? "");
    const [qApplied, setQApplied] = useState(searchParams.get("q")?.trim() ?? "");
    const [sort, setSort] = useState(searchParams.get("sort")?.trim() || "updated_at_desc");
    const [limit, setLimit] = useState(() => {
        const raw = Number(searchParams.get("limit"));
        return LIMIT_CHOICES.includes(raw as (typeof LIMIT_CHOICES)[number]) ? raw : 50;
    });
    const [offset, setOffset] = useState(() => {
        const raw = Number(searchParams.get("offset"));
        return Number.isFinite(raw) && raw >= 0 ? raw : 0;
    });

    const [filterOptions, setFilterOptions] = useState<ImportReviewBuildingsFilterOptionsResponse | null>(null);
    const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);

    const [list, setList] = useState<ImportReviewBuildingsListResponse | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [ambiguousBatches, setAmbiguousBatches] = useState<ImportReviewBatchChoice[] | null>(null);
    const [ambiguousSnapshot, setAmbiguousSnapshot] = useState("");

    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [rowActionBusyId, setRowActionBusyId] = useState<string | null>(null);
    const [canEditImportReview, setCanEditImportReview] = useState(false);

    const [drawerRow, setDrawerRow] = useState<ImportReviewBuildingListItem | null>(null);
    const [drawerRoutingValidation, setDrawerRoutingValidation] =
        useState<ImportReviewRoadRoutingValidationResponse | null>(null);
    const [drawerNote, setDrawerNote] = useState("");
    const [drawerDecision, setDrawerDecision] = useState<ImportReviewDecision>("needs_more_review");
    const [drawerSaving, setDrawerSaving] = useState(false);

    const needsFormOptions = family === "roads";
    const {
        formOptions,
        isLoading: formOptionsLoading,
        error: formOptionsError,
    } = useImportReviewFormOptions(needsFormOptions);

    const roadClassOptions = useMemo(
        () => roadClassOptionsFromFormOptions(formOptions),
        [formOptions]
    );

    const roadClassLabelById = useMemo(() => {
        const map = new Map<string, string>();
        for (const option of roadClassOptions) {
            const label = option.name?.trim() || option.code?.trim() || option.id;
            map.set(option.id, label);
        }
        return map;
    }, [roadClassOptions]);

    useEffect(() => {
        setCanEditImportReview(deriveImportReviewEditorUxCanMutate());
    }, []);

    const replaceQuery = useCallback(
        (mutate: (p: URLSearchParams) => void) => {
            const p = new URLSearchParams(searchParams.toString());
            mutate(p);
            const qs = p.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        },
        [router, pathname, searchParams],
    );

    useEffect(() => {
        if (batchUrl.trim()) {
            setBatchInput(batchUrl);
            setSnapshotInput("");
        } else {
            setBatchInput("");
            setSnapshotInput(snapshotUrl || ENV_SNAPSHOT_DEFAULT);
        }
    }, [batchUrl, snapshotUrl]);

    const scopeQuery = useMemo((): ImportReviewScopeQueryParams | null => {
        return importReviewScopeQueryFromSearch(searchParams, ENV_SNAPSHOT_DEFAULT, {
            useEnvDefault: false,
        });
    }, [searchParams]);

    const apiScopeQuery = useMemo(() => importReviewScopeQueryForApi(scopeQuery), [scopeQuery]);

    const listQueryKey = useMemo(
        () =>
            buildImportReviewListQueryKey({
                apiScopeQuery,
                limit,
                offset,
                sort,
                filters,
                qApplied,
                apiFamily: family,
            }),
        [apiScopeQuery, limit, offset, sort, filters, qApplied, family]
    );

    useClearSelectionOnListQueryChange(listQueryKey, setSelectedIds);

    const hasValidScope = apiScopeQuery !== null;

    useEffect(() => {
        setFilters(readListFilters(searchParams));
        const q = searchParams.get("q")?.trim() ?? "";
        setQDraft(q);
        setQApplied(q);
        setSort(searchParams.get("sort")?.trim() || "updated_at_desc");
        const lim = Number(searchParams.get("limit"));
        setLimit(LIMIT_CHOICES.includes(lim as (typeof LIMIT_CHOICES)[number]) ? lim : 50);
        const off = Number(searchParams.get("offset"));
        setOffset(Number.isFinite(off) && off >= 0 ? off : 0);
    }, [searchParams]);

    useEffect(() => {
        if (!hasValidScope || !apiScopeQuery) {
            setFilterOptions(null);
            return;
        }
        const c = new AbortController();
        setFilterOptionsLoading(true);
        getImportReviewSummary({ ...apiScopeQuery }, { signal: c.signal })
            .then((s) => setFilterOptions(filterOptionsFromSummary(s, family)))
            .catch((err) => {
                if (isAbortError(err)) {
                    return;
                }
                if (isImportReviewBatchAmbiguousError(err)) {
                    setAmbiguousBatches(err.batches);
                    setAmbiguousSnapshot(err.sourceSnapshotVersion);
                    setFilterOptions(null);
                    setError("");
                    return;
                }
                setFilterOptions(null);
            })
            .finally(() => {
                if (!c.signal.aborted) {
                    setFilterOptionsLoading(false);
                }
            });
        return () => c.abort();
    }, [hasValidScope, apiScopeQuery, family]);

    const fetchList = useCallback(
        async (signal?: AbortSignal) => {
            if (!hasValidScope || !apiScopeQuery) {
                setList(null);
                setError("");
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError("");
            setAmbiguousBatches(null);
            setAmbiguousSnapshot("");

            try {
                const params = {
                    ...apiScopeQuery,
                    limit,
                    offset,
                    sort,
                    include_geometry: true,
                };
                const rest: typeof params & {
                    match_status?: string;
                    auto_action?: string;
                    review_status?: string;
                    review_decision?: string;
                    q?: string;
                } = { ...params };
                if (filters.match_status) {
                    rest.match_status = filters.match_status;
                }
                if (filters.auto_action) {
                    rest.auto_action = filters.auto_action;
                }
                if (filters.review_status) {
                    rest.review_status = filters.review_status;
                }
                if (filters.review_decision) {
                    rest.review_decision = filters.review_decision;
                }
                if (qApplied) {
                    rest.q = qApplied;
                }

                const res =
                    family === "places"
                        ? await getImportReviewPlaces(rest, signal ? { signal } : undefined)
                        : await getImportReviewRoads(rest, signal ? { signal } : undefined);
                setList(res);
                if (res.review_batch_id && !batchUrl.trim()) {
                    replaceQuery((p) => {
                        syncImportReviewUrlToResolvedBatch(p, res.review_batch_id);
                    });
                }
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                if (isImportReviewBatchAmbiguousError(err)) {
                    setAmbiguousBatches(err.batches);
                    setAmbiguousSnapshot(err.sourceSnapshotVersion);
                    setList(null);
                    setError("");
                    return;
                }
                setList(null);
                setError(
                    formatImportReviewScopeFetchError(
                        err,
                        `Failed to load ${importReviewCandidateTitle(family)}.`
                    )
                );
            } finally {
                setIsLoading(false);
            }
        },
        [hasValidScope, apiScopeQuery, limit, offset, sort, filters, qApplied, family, batchUrl, replaceQuery],
    );

    useEffect(() => {
        if (!hasValidScope) {
            setList(null);
            return;
        }
        const c = new AbortController();
        void fetchList(c.signal);
        return () => c.abort();
    }, [fetchList, hasValidScope]);

    const bulk = useImportReviewBulkActions({
        items: list?.items ?? [],
        selectedIds,
        setSelectedIds,
        list,
        apiScopeQuery,
        apiFamily: family,
        supportsBulkActions: family === "places",
        canEdit: canEditImportReview,
        onListRefresh: () => {
            void fetchList();
        },
    });

    useEffect(() => {
        if (!drawerRow) {
            setDrawerNote("");
            return;
        }
        setDrawerNote(drawerRow.review_note ?? "");
        const d = drawerRow.review_decision;
        if (
            d === "approved" ||
            d === "rejected" ||
            d === "needs_more_review" ||
            d === "ignored" ||
            d === "merged"
        ) {
            setDrawerDecision(d);
        } else {
            setDrawerDecision("needs_more_review");
        }
    }, [drawerRow]);

    const applyFiltersToUrl = () => {
        replaceQuery((p) => {
            applyImportReviewScopeSearchParams(p, snapshotInput.trim(), batchInput.trim());
            for (const [key, val] of Object.entries(filters)) {
                if (val.trim()) {
                    p.set(key, val.trim());
                } else {
                    p.delete(key);
                }
            }
            if (qDraft.trim()) {
                p.set("q", qDraft.trim());
            } else {
                p.delete("q");
            }
            p.set("sort", sort);
            p.set("limit", String(limit));
            p.set("offset", "0");
        });
        setQApplied(qDraft.trim());
    };

    const clearFilters = () => {
        setFilters({
            match_status: "",
            auto_action: "",
            review_status: "",
            review_decision: "",
        });
        setQDraft("");
        replaceQuery((p) => {
            for (const key of ["match_status", "auto_action", "review_status", "review_decision", "q"]) {
                p.delete(key);
            }
            p.set("offset", "0");
        });
        setQApplied("");
    };

    const goPage = (nextOffset: number) => {
        replaceQuery((p) => {
            preserveImportReviewScopeInParams(p, searchParams);
            p.set("offset", String(Math.max(0, nextOffset)));
        });
    };

    const toggleSelect = (id: string, on: boolean) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (on) {
                next.add(id);
            } else {
                next.delete(id);
            }
            return next;
        });
    };

    const toggleSelectAllPage = (on: boolean) => {
        if (!list) {
            return;
        }
        setSelectedIds((prev) => {
            const next = new Set(prev);
            for (const row of list.items) {
                if (on) {
                    next.add(row.id);
                } else {
                    next.delete(row.id);
                }
            }
            return next;
        });
    };

    const mergeRow = (row: ImportReviewBuildingListItem) => {
        setList((prev) => {
            if (!prev) {
                return prev;
            }
            return {
                ...prev,
                items: prev.items.map((r) => (r.id === row.id ? row : r)),
            };
        });
        setDrawerRow((d) => (d?.id === row.id ? row : d));
    };

    const handleRoadOverridesSaved = (row: ImportReviewBuildingListItem) => {
        mergeRow(row);
        void fetchList();
    };

    const patchDecision = async (
        row: ImportReviewBuildingListItem,
        decision: ImportReviewDecision,
        opts?: {
            force?: boolean;
            confirmDuplicate?: boolean;
            confirmMatchedAutoUpdate?: boolean;
            confirmRoutingWarnings?: boolean;
            note?: string | null;
        },
    ) => {
        const scopeBody = importReviewMutationScope(list, apiScopeQuery);
        if (!scopeBody.review_batch_id && !scopeBody.source_snapshot_version) {
            return;
        }

        let confirmRoutingWarnings = opts?.confirmRoutingWarnings ?? false;

        if (family === "roads" && decision === "approved") {
            const blocking = validationMessagesFromReviewJson(row.validation_errors);
            if (blocking.length > 0) {
                window.alert(
                    `Cannot approve while validation_errors persist on this candidate — fix overrides first:\n\n${blocking
                        .slice(0, 20)
                        .map((line) => `• ${line}`)
                        .join("\n")}${blocking.length > 20 ? `\n(+${blocking.length - 20} more)` : ""}`,
                );
                return;
            }

            const warns = validationMessagesFromReviewJson(row.validation_warnings);
            if (warns.length > 0 && !opts?.force && !confirmRoutingWarnings) {
                const ok = window.confirm(
                    `Routing validation warnings (${warns.length}):\n\n${warns
                        .slice(0, 12)
                        .map((line) => `• ${line}`)
                        .join("\n")}${warns.length > 12 ? `\n(+${warns.length - 12} more)` : ""}\n\nApprove and send confirm_routing_warnings=true?`,
                );
                if (!ok) {
                    return;
                }
                confirmRoutingWarnings = true;
            }
        }

        const note = opts?.note !== undefined ? opts.note : row.review_note;
        const body = {
            ...scopeBody,
            review_decision: decision,
            review_note: note ?? null,
            force: opts?.force ?? false,
            confirm_duplicate_reviewed: opts?.confirmDuplicate ?? false,
            confirm_matched_auto_update: opts?.confirmMatchedAutoUpdate ?? false,
            ...(family === "roads" ? { confirm_routing_warnings: confirmRoutingWarnings } : {}),
        };

        const updated =
            family === "places"
                ? await patchImportReviewPlaceDecision(row.id, body)
                : await patchImportReviewRoadDecision(row.id, body);
        mergeRow(updated);
    };

    const handleRowAction = async (row: ImportReviewBuildingListItem, decision: ImportReviewDecision) => {
        if (!canEditImportReview) {
            return;
        }
        const ms = row.match_status ?? "";
        setRowActionBusyId(row.id);

        try {
            if (decision === "approved" && ms === "manual_protected") {
                const ok = window.confirm(
                    "This row is manual_protected. Approve anyway? (sends force=true to the API)",
                );
                if (!ok) {
                    return;
                }
                await patchDecision(row, decision, { force: true });
                return;
            }

            if (decision === "approved" && ms === "duplicate_candidate") {
                const ok = window.confirm(
                    "This duplicate_candidate row requires explicit confirmation. Approve with confirm_duplicate_reviewed=true?",
                );
                if (!ok) {
                    return;
                }
                await patchDecision(row, decision, { confirmDuplicate: true });
                return;
            }

            if (family === "roads" && decision === "approved" && ms === "matched_auto_update") {
                const ok = window.confirm(
                    "This road is matched_auto_update. Approve with explicit confirm_matched_auto_update=true?",
                );
                if (!ok) {
                    return;
                }
                await patchDecision(row, decision, { confirmMatchedAutoUpdate: true });
                return;
            }

            await patchDecision(row, decision);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Update failed";

            if (msg.includes("manual_protected") && decision === "approved") {
                const ok = window.confirm(`${msg}\n\nRetry with force=true?`);
                if (ok) {
                    await patchDecision(row, decision, { force: true });
                }
                return;
            }

            if (msg.includes("duplicate_candidate") && decision === "approved") {
                const ok = window.confirm(`${msg}\n\nRetry with confirm_duplicate_reviewed=true?`);
                if (ok) {
                    await patchDecision(row, decision, { confirmDuplicate: true });
                }
                return;
            }

            if (family === "roads" && msg.includes("matched_auto_update") && decision === "approved") {
                const ok = window.confirm(`${msg}\n\nRetry with confirm_matched_auto_update=true?`);
                if (ok) {
                    await patchDecision(row, decision, { confirmMatchedAutoUpdate: true });
                }
                return;
            }

            if (family === "roads" && decision === "approved" && msg.includes("confirm_routing_warnings")) {
                await patchDecision(row, decision, { confirmRoutingWarnings: true });
                return;
            }

            window.alert(msg);
        } finally {
            setRowActionBusyId(null);
        }
    };

    const handleDrawerSave = async () => {
        if (!drawerRow) {
            return;
        }
        if (!canEditImportReview) {
            return;
        }
        const scopeBody = importReviewMutationScope(list, apiScopeQuery);
        if (!scopeBody.review_batch_id && !scopeBody.source_snapshot_version) {
            return;
        }

        let drawerRoutingAck = false;
        if (family === "roads" && drawerDecision === "approved") {
            const blocking = validationMessagesFromReviewJson(drawerRow.validation_errors);
            if (blocking.length > 0) {
                window.alert(
                    `Cannot approve while validation_errors persist — fix overrides first:\n\n${blocking
                        .slice(0, 20)
                        .map((line) => `• ${line}`)
                        .join("\n")}${blocking.length > 20 ? `\n(+${blocking.length - 20} more)` : ""}`,
                );
                return;
            }
            const warns = validationMessagesFromReviewJson(drawerRow.validation_warnings);
            if (warns.length > 0) {
                const ok = window.confirm(
                    `Routing validation warnings (${warns.length}):\n\n${warns
                        .slice(0, 12)
                        .map((line) => `• ${line}`)
                        .join("\n")}${warns.length > 12 ? `\n(+${warns.length - 12} more)` : ""}\n\nApprove and send confirm_routing_warnings=true?`,
                );
                if (!ok) {
                    return;
                }
                drawerRoutingAck = true;
            }
        }

        setDrawerSaving(true);
        try {
            const updated =
                family === "places"
                    ? await patchImportReviewPlaceDecision(drawerRow.id, {
                          ...scopeBody,
                          review_decision: drawerDecision,
                          review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                      })
                    : await patchImportReviewRoadDecision(drawerRow.id, {
                          ...scopeBody,
                          review_decision: drawerDecision,
                          review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                          confirm_routing_warnings: drawerRoutingAck,
                      });
            mergeRow(updated);
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Save failed";
            if (msg.includes("manual_protected") && drawerDecision === "approved") {
                const ok = window.confirm(`${msg}\n\nRetry with force=true?`);
                if (ok) {
                    const updated =
                        family === "places"
                            ? await patchImportReviewPlaceDecision(drawerRow.id, {
                                  ...scopeBody,
                                  review_decision: drawerDecision,
                                  review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                                  force: true,
                              })
                            : await patchImportReviewRoadDecision(drawerRow.id, {
                                  ...scopeBody,
                                  review_decision: drawerDecision,
                                  review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                                  force: true,
                                  confirm_routing_warnings: drawerRoutingAck,
                              });
                    mergeRow(updated);
                }
            } else if (msg.includes("duplicate_candidate") && drawerDecision === "approved") {
                const ok = window.confirm(`${msg}\n\nRetry with confirm_duplicate_reviewed=true?`);
                if (ok) {
                    const updated =
                        family === "places"
                            ? await patchImportReviewPlaceDecision(drawerRow.id, {
                                  ...scopeBody,
                                  review_decision: drawerDecision,
                                  review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                                  confirm_duplicate_reviewed: true,
                              })
                            : await patchImportReviewRoadDecision(drawerRow.id, {
                                  ...scopeBody,
                                  review_decision: drawerDecision,
                                  review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                                  confirm_duplicate_reviewed: true,
                                  confirm_routing_warnings: drawerRoutingAck,
                              });
                    mergeRow(updated);
                }
            } else if (
                family === "roads" &&
                msg.includes("matched_auto_update") &&
                drawerDecision === "approved"
            ) {
                const ok = window.confirm(`${msg}\n\nRetry with confirm_matched_auto_update=true?`);
                if (ok) {
                    const updated = await patchImportReviewRoadDecision(drawerRow.id, {
                        ...scopeBody,
                        review_decision: drawerDecision,
                        review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                        confirm_matched_auto_update: true,
                        confirm_routing_warnings: drawerRoutingAck,
                    });
                    mergeRow(updated);
                }
            } else if (
                family === "roads" &&
                drawerDecision === "approved" &&
                msg.includes("confirm_routing_warnings")
            ) {
                const updated = await patchImportReviewRoadDecision(drawerRow.id, {
                    ...scopeBody,
                    review_decision: drawerDecision,
                    review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                    confirm_routing_warnings: true,
                });
                mergeRow(updated);
            } else {
                window.alert(msg);
            }
        } finally {
            setDrawerSaving(false);
        }
    };

    const total = list?.total ?? 0;
    const pageStart = total === 0 ? 0 : offset + 1;
    const pageEnd = Math.min(offset + (list?.items.length ?? 0), total);
    const allPageSelected = Boolean(
        list && list.items.length > 0 && list.items.every((r) => selectedIds.has(r.id)),
    );

    const mapSourceRow = useMemo(() => {
        if (drawerRow) {
            return drawerRow;
        }
        if (!list || selectedIds.size !== 1) {
            return null;
        }
        const onlyId = [...selectedIds][0];
        return list.items.find((r) => r.id === onlyId) ?? null;
    }, [drawerRow, list, selectedIds]);

    const drawerMapInput = useMemo(() => {
        if (!drawerRow) {
            return null;
        }
        return family === "places" ? placeDrawerMapInput(drawerRow) : roadDrawerMapInput(drawerRow);
    }, [drawerRow, family]);

    useEffect(() => {
        setDrawerRoutingValidation(null);
    }, [drawerRow?.id]);

    const mapPreviewInput = useMemo(() => {
        if (!mapSourceRow) {
            return null;
        }
        return family === "places" ? placeDrawerMapInput(mapSourceRow) : roadDrawerMapInput(mapSourceRow);
    }, [mapSourceRow, family]);

    const roadDrawerValidationBundle = useMemo(() => {
        if (family !== "roads" || !drawerRow) {
            return null;
        }
        if (drawerRoutingValidation) {
            return bundleFromRoutingValidation(drawerRoutingValidation);
        }
        return bundleFromRow(drawerRow);
    }, [family, drawerRow, drawerRoutingValidation]);

    const roadsDrawerHasValidationRun = useMemo(() => {
        if (family !== "roads" || !drawerRow) {
            return false;
        }
        if (drawerRoutingValidation) {
            return true;
        }
        return (
            drawerRow.validation_errors != null ||
            drawerRow.validation_warnings != null
        );
    }, [family, drawerRow, drawerRoutingValidation]);

    const activeChips = useMemo(() => {
        const chips: { key: string; label: string; value: string }[] = [];
        const sp = searchParams;
        const snap = snapshotVersionFromImportReviewSearch(sp);
        const rb = reviewBatchIdFromImportReviewSearch(sp);
        if (rb) {
            chips.push({ key: "review_batch", label: "Review batch", value: rb });
        } else if (snap) {
            chips.push({ key: "snapshot", label: "Source snapshot", value: snap });
        }
        const ms = sp.get("match_status")?.trim();
        if (ms) {
            chips.push({ key: "match_status", label: "Match", value: ms });
        }
        const aa = sp.get("auto_action")?.trim();
        if (aa) {
            chips.push({ key: "auto_action", label: "Auto", value: aa });
        }
        const rs = sp.get("review_status")?.trim();
        if (rs) {
            chips.push({
                key: "review_status",
                label: "Review status",
                value: rs === UNREVIEWED ? "Unreviewed" : rs,
            });
        }
        const rd = sp.get("review_decision")?.trim();
        if (rd) {
            chips.push({
                key: "review_decision",
                label: "Decision",
                value: rd === UNREVIEWED ? "Unreviewed" : rd,
            });
        }
        const q = sp.get("q")?.trim();
        if (q) {
            chips.push({ key: "q", label: "Search", value: q });
        }
        return chips;
    }, [searchParams]);

    const selectCls =
        "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-800";

    const titleLabel = family === "places" ? "places" : "roads";
    const drawerKind = family === "places" ? "Place" : "Road";

    const emptyColSpan = family === "places" ? 14 : 15;

    return (
        <main className="min-h-screen overflow-x-hidden bg-gray-50/80 p-6">
            <div
                className={
                    showMapPreview
                        ? "mx-auto flex max-w-[1920px] flex-col gap-6 xl:flex-row xl:items-start"
                        : "mx-auto max-w-[1680px] space-y-6"
                }
            >
                <div className={showMapPreview ? "min-w-0 flex-1 space-y-6" : "contents"}>
                <header className="flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                        <h1 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">
                            {showMapPreview ? "Data review" : "Import review"} — {titleLabel}
                        </h1>
                        <p className="max-w-2xl text-sm leading-relaxed text-gray-600">
                            Candidate review via API against Supabase{" "}
                            <code className="rounded bg-gray-100 px-1 text-xs">import_review</code> (
                            <code className="rounded bg-gray-100 px-1 text-xs">review_decision</code> /{" "}
                            <code className="rounded bg-gray-100 px-1 text-xs">review_status</code>). Does not
                            promote to core.{" "}
                            <span className="font-medium text-violet-900">manual_protected</span> approvals may
                            require <span className="font-medium">force</span>;{" "}
                            <span className="font-medium text-orange-900">duplicate_candidate</span> needs
                            confirmation for Approve.
                            {family === "roads" ? (
                                <>
                                    {" "}
                                    <span className="font-medium text-sky-900">matched_auto_update</span> road
                                    approvals require{" "}
                                    <code className="rounded bg-gray-100 px-1 text-xs">
                                        confirm_matched_auto_update
                                    </code>{" "}
                                    or <span className="font-medium">force</span>.
                                </>
                            ) : null}
                        </p>
                    </div>
                    <Link
                        href={(() => {
                            const base = showMapPreview ? "/data-review" : IMPORT_REVIEW_PATH;
                            if (!apiScopeQuery) {
                                return base;
                            }
                            const p = new URLSearchParams();
                            if ("review_batch_id" in apiScopeQuery) {
                                p.set("review_batch_id", apiScopeQuery.review_batch_id);
                            } else {
                                setImportReviewSnapshotSearchParam(p, apiScopeQuery.source_snapshot_version);
                            }
                            const qs = p.toString();
                            return qs ? `${base}?${qs}` : base;
                        })()}
                        className="inline-flex shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
                    >
                        Back to summary
                    </Link>
                </header>

                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="space-y-5 p-5">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                            <div className="min-w-0 flex-1 grid gap-3 sm:grid-cols-2">
                                <label className="block">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Source snapshot version
                                    </span>
                                    <input
                                        value={snapshotInput}
                                        onChange={(e) => setSnapshotInput(e.target.value)}
                                        disabled={Boolean(batchInput.trim())}
                                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 shadow-sm focus:border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-800 disabled:bg-gray-100"
                                        placeholder="Xor with review_batch_id"
                                        autoComplete="off"
                                    />
                                </label>
                                <label className="block">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Review batch ID
                                    </span>
                                    <input
                                        value={batchInput}
                                        onChange={(e) => setBatchInput(e.target.value)}
                                        disabled={Boolean(snapshotInput.trim())}
                                        inputMode="numeric"
                                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 font-mono text-sm font-medium text-gray-900 shadow-sm focus:border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-800 disabled:bg-gray-100"
                                        placeholder="Xor with snapshot"
                                        autoComplete="off"
                                    />
                                </label>
                                <p className="text-xs text-gray-500 sm:col-span-2">
                                    Applied to the URL when you click &quot;Apply filters&quot;. Prefer{" "}
                                    <code className="rounded bg-gray-100 px-1 text-[11px]">review_batch_id</code> when
                                    multiple batches share a snapshot.
                                </p>
                            </div>
                            {filterOptionsLoading ? (
                                <span className="text-xs text-gray-500">Loading filter options…</span>
                            ) : filterOptions ? (
                                <span className="text-xs text-gray-500">
                                    Scope{" "}
                                    {filterOptions.review_batch_id ? (
                                        <>
                                            batch{" "}
                                            <span className="font-mono text-gray-700">{filterOptions.review_batch_id}</span>
                                        </>
                                    ) : (
                                        <>
                                            snapshot{" "}
                                            <span className="font-mono text-gray-700">{filterOptions.source_snapshot_version}</span>
                                        </>
                                    )}
                                    {filterOptions.selected_by ? (
                                        <> · {filterOptions.selected_by}</>
                                    ) : null}
                                </span>
                            ) : null}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-600">Match status</span>
                                <select
                                    value={filters.match_status}
                                    onChange={(e) =>
                                        setFilters((f) => ({ ...f, match_status: e.target.value }))
                                    }
                                    className={selectCls}
                                >
                                    <option value="">All</option>
                                    {(filterOptions?.match_status ?? []).map((v) => (
                                        <option key={v} value={v}>
                                            {v}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-600">Auto action</span>
                                <select
                                    value={filters.auto_action}
                                    onChange={(e) =>
                                        setFilters((f) => ({ ...f, auto_action: e.target.value }))
                                    }
                                    className={selectCls}
                                >
                                    <option value="">All</option>
                                    {(filterOptions?.auto_action ?? []).map((v) => (
                                        <option key={v} value={v}>
                                            {v}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-600">Review status</span>
                                <select
                                    value={filters.review_status}
                                    onChange={(e) =>
                                        setFilters((f) => ({ ...f, review_status: e.target.value }))
                                    }
                                    className={selectCls}
                                >
                                    <option value="">All</option>
                                    <option value={UNREVIEWED}>Unreviewed (null / empty)</option>
                                    {(filterOptions?.review_status ?? []).map((v) => (
                                        <option key={v} value={v}>
                                            {v}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-600">Review decision</span>
                                <select
                                    value={filters.review_decision}
                                    onChange={(e) =>
                                        setFilters((f) => ({ ...f, review_decision: e.target.value }))
                                    }
                                    className={selectCls}
                                >
                                    <option value="">All</option>
                                    <option value={UNREVIEWED}>Unreviewed (null / empty)</option>
                                    {(filterOptions?.review_decision ?? []).map((v) => (
                                        <option key={v} value={v}>
                                            {v}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-600">Search (q)</span>
                                <input
                                    value={qDraft}
                                    onChange={(e) => setQDraft(e.target.value)}
                                    className={selectCls}
                                    placeholder="External ID or name…"
                                    autoComplete="off"
                                />
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-600">Sort</span>
                                <select
                                    value={sort}
                                    onChange={(e) => setSort(e.target.value)}
                                    className={selectCls}
                                >
                                    {SORT_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-600">Page size</span>
                                <select
                                    value={limit}
                                    onChange={(e) => setLimit(Number(e.target.value))}
                                    className={selectCls}
                                >
                                    {LIMIT_CHOICES.map((n) => (
                                        <option key={n} value={n}>
                                            {n} / page
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                            <button
                                type="button"
                                onClick={applyFiltersToUrl}
                                className="rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-gray-800"
                            >
                                Apply filters
                            </button>
                            <button
                                type="button"
                                onClick={clearFilters}
                                className="rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
                            >
                                Clear filters
                            </button>
                            <span className="text-sm text-gray-600">
                                {hasValidScope ? (
                                    <>
                                        <strong className="text-gray-900">{total.toLocaleString()}</strong>{" "}
                                        candidates
                                        {isLoading ? " · Loading…" : null}
                                    </>
                                ) : (
                                    "Set snapshot version and apply."
                                )}
                            </span>
                        </div>
                    </CardContent>
                </Card>

                {ambiguousBatches && ambiguousBatches.length > 0 ? (
                    <ImportReviewBatchPicker
                        sourceSnapshotVersion={ambiguousSnapshot}
                        batches={ambiguousBatches}
                        onUseLatest={() => {
                            replaceQuery((p) => {
                                const snap =
                                    ambiguousSnapshot ||
                                    snapshotVersionFromImportReviewSearch(p) ||
                                    snapshotInput.trim();
                                applyImportReviewScopeSearchParams(p, snap, "");
                                p.set("latest", "true");
                            });
                        }}
                    />
                ) : null}

                {error ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm whitespace-pre-wrap text-red-900">
                        {error}
                    </div>
                ) : null}

                {activeChips.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Active
                        </span>
                        {activeChips.map((c) => (
                            <span
                                key={c.key}
                                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs text-gray-800"
                            >
                                <span className="text-gray-500">{c.label}:</span>
                                <span className="max-w-[200px] truncate font-medium" title={c.value}>
                                    {c.value}
                                </span>
                            </span>
                        ))}
                    </div>
                ) : null}

                {family === "places" ? (
                    <ImportReviewSelectedActionBar
                        selectedCount={selectedIds.size}
                        analysis={bulk.analysis}
                        bulkNote={bulk.bulkNote}
                        bulkBusy={bulk.isBulkActionRunning}
                        bulkPhase={bulk.bulkPhase}
                        bulkMessage={bulk.bulkMessage}
                        canEdit={canEditImportReview}
                        hasValidScope={hasValidScope}
                        approveBlockedReason={bulk.approveBlockedReason}
                        bulkPreview={bulk.bulkPreview}
                        dangerForce={bulk.dangerForce}
                        overrideManualProtected={bulk.overrideManualProtected}
                        overrideDuplicate={bulk.overrideDuplicate}
                        onBulkNoteChange={bulk.setBulkNote}
                        onDangerForceChange={bulk.setDangerForce}
                        onOverrideManualProtectedChange={bulk.setOverrideManualProtected}
                        onOverrideDuplicateChange={bulk.setOverrideDuplicate}
                        onClearSelection={bulk.clearSelection}
                        onPreviewApprove={() => void bulk.bulkPreviewApprove()}
                        onApproveSelected={() => void bulk.bulkApproveSelected()}
                        onRejectSelected={() => void bulk.bulkRejectSelected()}
                        onNeedsMoreReviewSelected={() => void bulk.bulkNeedsMoreReviewSelected()}
                        onIgnoreSelected={() => void bulk.bulkIgnoreSelected()}
                    />
                ) : null}

                <ImportReviewTableFrame>
                    <table className={`${IMPORT_REVIEW_TABLE_MIN_WIDTH_CLASS} divide-y divide-gray-200 text-left text-sm`}>
                        <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className={importReviewStickyCheckboxThClass()}>
                                    <input
                                        type="checkbox"
                                        checked={allPageSelected}
                                        onChange={(e) => toggleSelectAllPage(e.target.checked)}
                                        disabled={!canEditImportReview || !list || list.items.length === 0}
                                        aria-label="Select all on page"
                                    />
                                </th>
                                <th className={importReviewStickyIdThClass()}>ID</th>
                                <th className="px-3 py-3">External ID</th>
                                {family === "roads" ? (
                                    <>
                                        <th className="px-3 py-3">Name MM</th>
                                        <th className="px-3 py-3">Name EN</th>
                                        <th className="px-3 py-3">Admin area</th>
                                    </>
                                ) : (
                                    <th className="px-3 py-3">Name</th>
                                )}
                                {family === "places" ? (
                                    <>
                                        <th className="px-3 py-3">POI category</th>
                                        <th className="px-3 py-3">Place class</th>
                                        <th className="px-3 py-3">Point</th>
                                    </>
                                ) : (
                                    <>
                                        <th className="px-3 py-3">Road class</th>
                                        <th className="px-3 py-3">Surface</th>
                                        <th className="px-3 py-3">Oneway</th>
                                        <th className="px-3 py-3">Length (m)</th>
                                    </>
                                )}
                                <th className="px-3 py-3">Confidence</th>
                                <th className="px-3 py-3">Match status</th>
                                <th className="px-3 py-3">Auto action</th>
                                <th className="px-3 py-3">Review status</th>
                                {family !== "roads" ? (
                                    <>
                                        <th className="px-3 py-3">Decision</th>
                                        <th className="px-3 py-3">Updated</th>
                                    </>
                                ) : null}
                                <th className={importReviewStickyActionsThClass()}>Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {!hasValidScope ? (
                                <tr>
                                    <td colSpan={emptyColSpan} className="px-4 py-10 text-center text-gray-500">
                                        Set snapshot version to load rows.
                                    </td>
                                </tr>
                            ) : isLoading && !list ? (
                                <tr>
                                    <td colSpan={emptyColSpan} className="px-4 py-10 text-center text-gray-500">
                                        Loading…
                                    </td>
                                </tr>
                            ) : list && list.items.length === 0 ? (
                                <tr>
                                    <td colSpan={emptyColSpan} className="px-4 py-10 text-center text-gray-500">
                                        No rows for this query.
                                    </td>
                                </tr>
                            ) : (
                                list?.items.map((row) => {
                                    const rowSurface = importReviewRowSurface(row, {
                                        selected: selectedIds.has(row.id),
                                    });
                                    const roadNameMm =
                                        family === "roads" ? deriveRoadListNameMm(row) : null;
                                    const roadNameEn =
                                        family === "roads" ? deriveRoadListNameEn(row) : null;
                                    const roadAdminArea =
                                        family === "roads" ? deriveRoadListAdminArea(row) : null;
                                    const roadClassLabel =
                                        family === "roads"
                                            ? deriveRoadListRoadClass(row, roadClassLabelById)
                                            : null;
                                    const roadSurface =
                                        family === "roads" ? deriveRoadListSurface(row) : null;
                                    const roadOneway =
                                        family === "roads" ? deriveRoadListOneway(row) : null;
                                    const roadLengthM =
                                        family === "roads" ? deriveRoadListLengthM(row) : null;
                                    return (
                                        <tr key={row.id} className={rowSurface.rowClass}>
                                            <td className={importReviewStickyCheckboxTdClass(rowSurface.stickyCellClass)}>
                                                <input
                                                    type="checkbox"
                                                    checked={selectedIds.has(row.id)}
                                                    disabled={!canEditImportReview || !hasValidScope}
                                                    onChange={(e) => toggleSelect(row.id, e.target.checked)}
                                                />
                                            </td>
                                            <td className={importReviewStickyIdTdClass(rowSurface.stickyCellClass)}>
                                                <button
                                                    type="button"
                                                    onClick={() => setDrawerRow(row)}
                                                    className="text-left font-medium text-blue-700 underline decoration-blue-300 underline-offset-2 hover:text-blue-900"
                                                >
                                                    {row.id}
                                                </button>
                                            </td>
                                            <td className="max-w-[120px] truncate px-3 py-3 align-top font-mono text-xs">
                                                {dash(row.external_id)}
                                            </td>
                                            {family === "roads" ? (
                                                <>
                                                    <td
                                                        className="max-w-[180px] truncate px-3 py-3 align-top text-gray-900"
                                                        title={roadNameMm ?? ""}
                                                    >
                                                        {dash(roadNameMm)}
                                                    </td>
                                                    <td
                                                        className="max-w-[180px] truncate px-3 py-3 align-top text-gray-900"
                                                        title={roadNameEn ?? ""}
                                                    >
                                                        {dash(roadNameEn)}
                                                    </td>
                                                    <td
                                                        className="max-w-[140px] truncate px-3 py-3 align-top text-xs text-gray-900"
                                                        title={roadAdminArea ?? ""}
                                                    >
                                                        {dash(roadAdminArea)}
                                                    </td>
                                                </>
                                            ) : (
                                                <td
                                                    className="max-w-[180px] truncate px-3 py-3 align-top text-gray-900"
                                                    title={row.canonical_name ?? ""}
                                                >
                                                    {dash(row.canonical_name)}
                                                </td>
                                            )}
                                            {family === "places" ? (
                                                <>
                                                    <td className="max-w-[100px] truncate px-3 py-3 align-top font-mono text-xs">
                                                        {displayNormField(row.normalized_data, "poi_category_id")}
                                                    </td>
                                                    <td className="max-w-[100px] truncate px-3 py-3 align-top font-mono text-xs">
                                                        {displayNormField(
                                                            row.normalized_data,
                                                            "place_class_id",
                                                        )}
                                                    </td>
                                                    <td
                                                        className="max-w-[140px] truncate px-3 py-3 align-top font-mono text-xs text-gray-700"
                                                        title={summarizePointGeom(row.geometry)}
                                                    >
                                                        {summarizePointGeom(row.geometry)}
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td
                                                        className="max-w-[120px] truncate px-3 py-3 align-top text-xs text-gray-900"
                                                        title={roadClassLabel ?? ""}
                                                    >
                                                        {dash(roadClassLabel)}
                                                    </td>
                                                    <td
                                                        className="max-w-[100px] truncate px-3 py-3 align-top text-xs text-gray-900"
                                                        title={roadSurface ?? ""}
                                                    >
                                                        {dash(roadSurface)}
                                                    </td>
                                                    <td className="px-3 py-3 align-top text-xs">
                                                        {formatRoadListOneway(roadOneway)}
                                                    </td>
                                                    <td className="px-3 py-3 align-top tabular-nums text-xs">
                                                        {dash(roadLengthM)}
                                                    </td>
                                                </>
                                            )}
                                            <td className="px-3 py-3 align-top tabular-nums text-gray-800">
                                                {dash(row.confidence_score)}
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-3 align-top">
                                                <Pill
                                                    tone={
                                                        (row.match_status ?? "").includes("duplicate")
                                                            ? "amber"
                                                            : "blue"
                                                    }
                                                >
                                                    {dash(row.match_status)}
                                                </Pill>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-3 align-top">
                                                <Pill tone="slate">{dash(row.auto_action)}</Pill>
                                            </td>
                                            <td className="whitespace-nowrap px-3 py-3 align-top">
                                                <Pill tone="violet">{dash(row.review_status)}</Pill>
                                            </td>
                                            {family !== "roads" ? (
                                                <>
                                                    <td className="whitespace-nowrap px-3 py-3 align-top">
                                                        <Pill tone="blue">{dash(row.review_decision)}</Pill>
                                                    </td>
                                                    <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-gray-600">
                                                        {formatTs(row.updated_at)}
                                                    </td>
                                                </>
                                            ) : null}
                                            <td className={importReviewStickyActionsTdClass(rowSurface.stickyCellClass)}>
                                                <ImportReviewReviewActionsMenu
                                                    disabled={!canEditImportReview}
                                                    busy={rowActionBusyId === row.id}
                                                    onDecision={(d) => void handleRowAction(row, d)}
                                                    onEditOverrides={() => setDrawerRow(row)}
                                                    onViewDetails={() => setDrawerRow(row)}
                                                />
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </ImportReviewTableFrame>

                {list && total > 0 ? (
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-gray-600">
                            Rows <span className="font-medium text-gray-900">{pageStart}</span>–
                            <span className="font-medium text-gray-900">{pageEnd}</span> of{" "}
                            <span className="font-medium text-gray-900">{total.toLocaleString()}</span>
                            {selectedIds.size > 0 ? (
                                <span className="mt-1 block text-xs text-gray-500">
                                    Selection is cleared when you change pages.
                                </span>
                            ) : null}
                        </p>
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                disabled={offset <= 0 || isLoading}
                                onClick={() => goPage(offset - limit)}
                                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                            >
                                Previous
                            </button>
                            <button
                                type="button"
                                disabled={offset + limit >= total || isLoading}
                                onClick={() => goPage(offset + limit)}
                                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                ) : null}
                </div>

                {showMapPreview ? (
                    <aside className="w-full shrink-0 xl:sticky xl:top-4 xl:w-[min(420px,40vw)]">
                        <DataReviewCandidateMap
                            geometry={mapPreviewInput?.geometry ?? null}
                            geometryKind={mapPreviewInput?.geometryKind ?? (family === "places" ? "point" : "line")}
                            entityType={family === "places" ? "place" : "road"}
                            externalId={mapSourceRow?.external_id ?? null}
                            title={family === "places" ? "Place location" : "Road geometry"}
                        />
                        {mapPreviewInput?.fallbackNote ? (
                            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                                {mapPreviewInput.fallbackNote}
                            </p>
                        ) : null}
                        {!mapSourceRow ? (
                            <p className="mt-2 text-center text-xs text-gray-500">
                                Open a row or select exactly one candidate to preview on the map.
                            </p>
                        ) : null}
                    </aside>
                ) : null}
            </div>

            {drawerRow ? (
                <div className="fixed inset-0 z-50 flex justify-end">
                    <button
                        type="button"
                        className="absolute inset-0 bg-black/35"
                        aria-label="Close detail"
                        onClick={() => setDrawerRow(null)}
                    />
                    <div className="relative flex h-full w-full max-w-2xl flex-col border-l border-gray-200 bg-white shadow-2xl">
                        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
                            <h2 className="truncate text-base font-semibold text-gray-900">
                                {family === "roads" && drawerRow
                                    ? deriveRoadDrawerTitle(drawerRow)
                                    : `${drawerKind} candidate`}
                            </h2>
                            <button
                                type="button"
                                onClick={() => setDrawerRow(null)}
                                className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                            >
                                Close
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-8 text-sm">
                            {family === "roads" &&
                            (drawerRow.match_status === "duplicate_candidate" ||
                                drawerRow.match_status === "manual_protected") ? (
                                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                                    <strong>Review warning:</strong> This road is{" "}
                                    <code className="rounded bg-white/80 px-1">{drawerRow.match_status}</code>.
                                    Approvals may require extra confirmation or force (see API rules).
                                </div>
                            ) : null}
                            {family === "roads" && drawerRow.match_status === "matched_auto_update" ? (
                                <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-950">
                                    <strong>Auto-update match:</strong> Approving this row requires{" "}
                                    <code className="rounded bg-white/80 px-1">
                                        confirm_matched_auto_update=true
                                    </code>{" "}
                                    or <code className="rounded bg-white/80 px-1">force=true</code>.
                                </div>
                            ) : null}
                            {family === "roads" && roadDrawerValidationBundle && roadsDrawerHasValidationRun ? (
                                <div className="space-y-2">
                                    <ValidationSummaryBanner
                                        errors={roadDrawerValidationBundle.errors}
                                        warnings={roadDrawerValidationBundle.warnings}
                                    />
                                    {roadDrawerValidationBundle.validationMode ? (
                                        <ValidationModeBanner mode={roadDrawerValidationBundle.validationMode} />
                                    ) : null}
                                    <ApprovalGuidanceNote
                                        canApprove={roadDrawerValidationBundle.canApprove}
                                        errors={roadDrawerValidationBundle.errors}
                                        warnings={roadDrawerValidationBundle.warnings}
                                    />
                                </div>
                            ) : null}

                            {family === "roads" && drawerRow ? (
                                <CollapsibleDrawerSection title="Record details">
                                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-gray-600">
                                        <div>
                                            <span className="font-medium text-gray-500">ID</span>
                                            <div className="font-mono text-gray-900">{drawerRow.id}</div>
                                        </div>
                                        <div>
                                            <span className="font-medium text-gray-500">external_id</span>
                                            <div className="break-all font-mono text-gray-900">
                                                {dash(drawerRow.external_id)}
                                            </div>
                                        </div>
                                        <div className="col-span-2">
                                            <span className="font-medium text-gray-500">source_snapshot_id</span>
                                            <div className="font-mono text-gray-900">
                                                {drawerRow.source_snapshot_id_local}
                                            </div>
                                        </div>
                                        <div className="sm:col-span-2">
                                            <span className="font-medium text-gray-500">Myanmar name</span>
                                            <div className="text-gray-900">{dash(deriveRoadListNameMm(drawerRow))}</div>
                                        </div>
                                        <div>
                                            <span className="font-medium text-gray-500">English name</span>
                                            <div className="text-gray-900">{dash(deriveRoadListNameEn(drawerRow))}</div>
                                        </div>
                                        <div>
                                            <span className="font-medium text-gray-500">match_status</span>
                                            <div>{dash(drawerRow.match_status)}</div>
                                        </div>
                                        <div>
                                            <span className="font-medium text-gray-500">auto_action</span>
                                            <div>{dash(drawerRow.auto_action)}</div>
                                        </div>
                                        <div>
                                            <span className="font-medium text-gray-500">created_at</span>
                                            <div>{formatTs(drawerRow.created_at)}</div>
                                        </div>
                                        <div>
                                            <span className="font-medium text-gray-500">updated_at</span>
                                            <div>{formatTs(drawerRow.updated_at)}</div>
                                        </div>
                                        <div className="col-span-2">
                                            <span className="font-medium text-gray-500">Line summary</span>
                                            <div className="font-mono text-gray-900">
                                                {summarizeLineGeom(drawerRow.geometry)}
                                            </div>
                                        </div>
                                    </div>
                                </CollapsibleDrawerSection>
                            ) : null}

                            {family !== "roads" ? (
                            <section>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Record
                                </h3>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-gray-600 sm:grid-cols-3">
                                    <div>
                                        <span className="font-medium text-gray-500">ID</span>
                                        <div className="font-mono text-gray-900">{drawerRow.id}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">source_snapshot_id (local lineage)</span>
                                        <div className="font-mono text-gray-900">{drawerRow.source_snapshot_id_local}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">external_id</span>
                                        <div className="break-all font-mono text-gray-900">
                                            {dash(drawerRow.external_id)}
                                        </div>
                                    </div>
                                    <div className="sm:col-span-2">
                                        <span className="font-medium text-gray-500">Myanmar name</span>
                                        <div className="text-gray-900">{dash(drawerRow.effective_name_mm)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">English name</span>
                                        <div className="text-gray-900">{dash(drawerRow.effective_name_en)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">class_code</span>
                                        <div className="font-mono text-gray-900">{dash(drawerRow.class_code)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">confidence_score</span>
                                        <div className="tabular-nums text-gray-900">
                                            {dash(drawerRow.confidence_score)}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">match_status</span>
                                        <div>{dash(drawerRow.match_status)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">auto_action</span>
                                        <div>{dash(drawerRow.auto_action)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">review_status</span>
                                        <div>{dash(drawerRow.review_status)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">review_decision</span>
                                        <div>{dash(drawerRow.review_decision)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">reviewed_by</span>
                                        <div>{dash(drawerRow.reviewed_by)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">reviewed_at</span>
                                        <div>{formatTs(drawerRow.reviewed_at)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">created_at</span>
                                        <div>{formatTs(drawerRow.created_at)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">updated_at</span>
                                        <div>{formatTs(drawerRow.updated_at)}</div>
                                    </div>
                                    {family === "places" ? (
                                        <>
                                            <div>
                                                <span className="font-medium text-gray-500">poi_category_id</span>
                                                <div className="font-mono text-gray-900">
                                                    {displayNormField(drawerRow.normalized_data, "poi_category_id")}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="font-medium text-gray-500">place_class_id</span>
                                                <div className="font-mono text-gray-900">
                                                    {displayNormField(drawerRow.normalized_data, "place_class_id")}
                                                </div>
                                            </div>
                                            <div className="col-span-full">
                                                <span className="font-medium text-gray-500">Point (from row)</span>
                                                <div className="font-mono text-gray-900">
                                                    {summarizePointGeom(drawerRow.geometry)}
                                                </div>
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div>
                                                <span className="font-medium text-gray-500">road_class_id</span>
                                                <div className="font-mono text-gray-900">
                                                    {displayNormField(drawerRow.normalized_data, "road_class_id")}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="font-medium text-gray-500">length_m</span>
                                                <div className="font-mono text-gray-900">
                                                    {dash(
                                                        normPick(drawerRow.normalized_data, "length_m") as
                                                            | string
                                                            | number
                                                            | null
                                                            | undefined,
                                                    )}
                                                </div>
                                            </div>
                                            <div>
                                                <span className="font-medium text-gray-500">is_oneway</span>
                                                <div className="font-mono text-gray-900">
                                                    {dash(
                                                        normPick(drawerRow.normalized_data, "is_oneway") as
                                                            | boolean
                                                            | null
                                                            | undefined,
                                                    )}
                                                </div>
                                            </div>
                                            <div className="col-span-full">
                                                <span className="font-medium text-gray-500">Line summary</span>
                                                <div className="font-mono text-gray-900">
                                                    {summarizeLineGeom(drawerRow.geometry)}
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </div>
                            </section>
                            ) : null}

                            {family === "places" ? (
                                <>
                                    {drawerMapInput?.fallbackNote ? (
                                        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                                            {drawerMapInput.fallbackNote}
                                        </p>
                                    ) : null}
                                    <DataReviewCandidateMap
                                        key={drawerRow.id}
                                        geometry={drawerMapInput?.geometry ?? null}
                                        geometryKind="point"
                                        entityType="place"
                                        externalId={drawerRow.external_id ?? null}
                                        title="Place location"
                                        size="drawer"
                                        className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                                    />
                                </>
                            ) : (
                                <>
                                    {drawerMapInput?.fallbackNote ? (
                                        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                                            {drawerMapInput.fallbackNote}
                                        </p>
                                    ) : null}
                                    {hasValidScope ? (
                                        <ImportReviewRoadOverridesPanel
                                            row={drawerRow}
                                            mutationScope={importReviewMutationScope(list, apiScopeQuery)}
                                            canEdit={canEditImportReview}
                                            selectCls={selectCls}
                                            onSaved={handleRoadOverridesSaved}
                                            formOptions={formOptions}
                                            formOptionsLoading={formOptionsLoading}
                                            formOptionsError={formOptionsError}
                                            onValidated={(result) => {
                                                setDrawerRoutingValidation(result);
                                                const patch = {
                                                    validation_errors: result.errors,
                                                    validation_warnings: [
                                                        ...result.warnings,
                                                        ...(result.info ?? []),
                                                    ],
                                                    review_status:
                                                        result.errors.length > 0 ||
                                                        result.warnings.length > 0
                                                            ? "needs_review"
                                                            : drawerRow.review_status,
                                                };
                                                mergeRow({ ...drawerRow, ...patch });
                                            }}
                                        />
                                    ) : (
                                        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                                            Apply filters with review_batch_id or source snapshot version to edit road overrides.
                                        </p>
                                    )}
                                </>
                            )}

                            <div>
                                <h3 className="text-xs font-semibold uppercase text-gray-500">normalized_data</h3>
                                <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-2 text-xs">
                                    {safeJson(drawerRow.normalized_data)}
                                </pre>
                            </div>
                            <div>
                                <h3 className="text-xs font-semibold uppercase text-gray-500">source_refs</h3>
                                <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-2 text-xs">
                                    {safeJson(drawerRow.source_refs)}
                                </pre>
                            </div>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-gray-600">Decision</span>
                                <select
                                    value={drawerDecision}
                                    disabled={!canEditImportReview}
                                    onChange={(e) =>
                                        setDrawerDecision(e.target.value as ImportReviewDecision)
                                    }
                                    className={selectCls}
                                >
                                    <option value="approved">approved</option>
                                    <option value="rejected">rejected</option>
                                    <option value="needs_more_review">needs_more_review</option>
                                    <option value="ignored">ignored</option>
                                    <option value="merged">merged</option>
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-medium text-gray-600">review_note</span>
                                <textarea
                                    value={drawerNote}
                                    disabled={!canEditImportReview}
                                    onChange={(e) => setDrawerNote(e.target.value)}
                                    rows={5}
                                    className={selectCls}
                                />
                            </label>
                            <button
                                type="button"
                                disabled={drawerSaving || !canEditImportReview}
                                onClick={() => void handleDrawerSave()}
                                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
                            >
                                {drawerSaving ? "Saving…" : "Save decision & note"}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </main>
    );
}

export function ImportReviewCandidatesPageShell({
    family,
    showMapPreview = false,
}: {
    family: ImportReviewCandidateFamily;
    showMapPreview?: boolean;
}) {
    return (
        <Suspense
            fallback={
                <main className="min-h-screen bg-gray-50 p-6">
                    <div className="text-gray-600">Loading…</div>
                </main>
            }
        >
            <ImportReviewCandidatesClient family={family} showMapPreview={showMapPreview} />
        </Suspense>
    );
}
