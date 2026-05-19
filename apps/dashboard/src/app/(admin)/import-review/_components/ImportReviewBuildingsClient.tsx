"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import DataReviewCandidateMap from "@/src/components/map/DataReviewCandidateMap";
import { Card, CardContent } from "@/src/components/ui/card";
import {
    getImportReviewBuildings,
    getImportReviewBuildingsFilterOptions,
    isAbortError,
    patchImportReviewBuildingDecision,
    patchImportReviewBuildingOverrides,
    postImportReviewBuildingsBulkDecision,
    type ImportReviewBuildingListItem,
    type ImportReviewBuildingsFilterOptionsResponse,
    type ImportReviewBuildingsListResponse,
    type ImportReviewBulkDecisionResponse,
    type ImportReviewDecision,
    type PostImportReviewBuildingsBulkBody,
} from "@/src/lib/api";
import {
    applyImportReviewScopeSearchParams,
    reviewBatchIdFromImportReviewSearch,
    setImportReviewSnapshotSearchParam,
    snapshotVersionFromImportReviewSearch,
} from "@/src/lib/importReviewSnapshot";
import { buildingDrawerMapInput } from "@/src/lib/importReviewDrawerMapGeometry";
import ImportReviewReviewActionsMenu from "@/src/app/(admin)/import-review/_components/ImportReviewReviewActionsMenu";
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
} from "@/src/app/(admin)/import-review/_components/importReviewTableUi";
import { deriveImportReviewEditorUxCanMutate } from "@/src/lib/importReviewEditorUx";

const ENV_SNAPSHOT_DEFAULT = process.env.NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION?.trim() ?? "";

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

function dash(value: string | number | null | undefined): string {
    if (value === null || value === undefined) {
        return "—";
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

function jsonishSignalsPresent(value: unknown): boolean {
    if (value === null || value === undefined) {
        return false;
    }
    if (Array.isArray(value)) {
        return value.length > 0;
    }
    if (typeof value === "object") {
        return Object.keys(value).length > 0;
    }
    if (typeof value === "string") {
        return value.trim().length > 0;
    }
    return true;
}

/** TODO(import-review-ui-rbac): Persist roles from login or use a verified /me endpoint — JWT decode is UX-only. */
/** Summary hub link preserving snapshot xor batch scope (canonical snapshot query keys). */
function importReviewSummaryHref(
    basePath: "/import-review" | "/data-review",
    scopeQuery: { source_snapshot_version: string } | { review_batch_id: string },
): string {
    const p = new URLSearchParams();
    if ("review_batch_id" in scopeQuery && scopeQuery.review_batch_id.trim()) {
        p.set("review_batch_id", scopeQuery.review_batch_id.trim());
    } else if ("source_snapshot_version" in scopeQuery && scopeQuery.source_snapshot_version.trim()) {
        setImportReviewSnapshotSearchParam(p, scopeQuery.source_snapshot_version);
    }
    const qs = p.toString();
    return qs ? `${basePath}?${qs}` : basePath;
}

function formatImportReviewApiError(err: unknown): string {
    if (!(err instanceof Error)) {
        return "Unknown error";
    }
    const m = err.message;
    if (m.includes("401") || m.toLowerCase().includes("authentication")) {
        return "Unauthorized — sign in with an admin-capable account (API enforces access).";
    }
    if (m.includes("403") || m.toLowerCase().includes("admin")) {
        return "Forbidden — import review endpoints require admin.";
    }
    return m;
}

function asOverrideRecord(review_overrides: unknown): Record<string, unknown> {
    if (review_overrides && typeof review_overrides === "object" && !Array.isArray(review_overrides)) {
        return review_overrides as Record<string, unknown>;
    }
    return {};
}

function strFromUnknown(v: unknown): string {
    if (v === null || v === undefined) {
        return "";
    }
    return String(v);
}

type ListFilters = {
    match_status: string;
    auto_action: string;
    review_status: string;
    review_decision: string;
    promotion_status: string;
    class_code: string;
};

function readListFilters(sp: URLSearchParams): ListFilters {
    return {
        match_status: sp.get("match_status")?.trim() ?? "",
        auto_action: sp.get("auto_action")?.trim() ?? "",
        review_status: sp.get("review_status")?.trim() ?? "",
        review_decision: sp.get("review_decision")?.trim() ?? "",
        promotion_status: sp.get("promotion_status")?.trim() ?? "",
        class_code: sp.get("class_code")?.trim() ?? "",
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
        <span className={`inline-flex max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
            {children}
        </span>
    );
}

export function ImportReviewBuildingsClient({ showMapPreview = false }: { showMapPreview?: boolean }) {
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

    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
    const [bulkNote, setBulkNote] = useState("");
    const [bulkForce, setBulkForce] = useState(false);
    const [bulkBusy, setBulkBusy] = useState(false);
    const [bulkPreview, setBulkPreview] = useState<ImportReviewBulkDecisionResponse | null>(null);
    const [rowActionBusyId, setRowActionBusyId] = useState<string | null>(null);

    const [drawerRow, setDrawerRow] = useState<ImportReviewBuildingListItem | null>(null);
    const [drawerNote, setDrawerNote] = useState("");
    const [drawerDecision, setDrawerDecision] = useState<ImportReviewDecision>("needs_more_review");
    const [drawerSaving, setDrawerSaving] = useState(false);
    const [drawerOverridesSaving, setDrawerOverridesSaving] = useState(false);
    const [ovName, setOvName] = useState("");
    const [ovCanonicalName, setOvCanonicalName] = useState("");
    const [ovClassCode, setOvClassCode] = useState("");
    const [ovBuildingType, setOvBuildingType] = useState("");
    const [ovBuildingTypeCode, setOvBuildingTypeCode] = useState("");
    const [ovLevels, setOvLevels] = useState("");
    const [ovHeightM, setOvHeightM] = useState("");
    const [ovReviewNote, setOvReviewNote] = useState("");

    const [canEditImportReview, setCanEditImportReview] = useState(true);

    const replaceQuery = useCallback(
        (mutate: (p: URLSearchParams) => void) => {
            const p = new URLSearchParams(searchParams.toString());
            mutate(p);
            const qs = p.toString();
            router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
        },
        [router, pathname, searchParams]
    );

    useEffect(() => {
        setCanEditImportReview(deriveImportReviewEditorUxCanMutate());
    }, []);

    const scopeQuery = useMemo(() => {
        const b = (batchInput.trim() || batchUrl.trim()).trim();
        const snap = (snapshotInput.trim() || snapshotUrl.trim() || ENV_SNAPSHOT_DEFAULT).trim();
        if (b) {
            return { review_batch_id: b } as const;
        }
        if (snap) {
            return { source_snapshot_version: snap } as const;
        }
        return null;
    }, [batchInput, batchUrl, snapshotInput, snapshotUrl]);

    const hasValidScope = scopeQuery !== null;

    useEffect(() => {
        if (batchUrl.trim()) {
            setBatchInput(batchUrl);
            setSnapshotInput("");
        } else {
            setBatchInput("");
            setSnapshotInput(snapshotUrl || ENV_SNAPSHOT_DEFAULT);
        }
    }, [batchUrl, snapshotUrl]);

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
        if (!hasValidScope || !scopeQuery) {
            setFilterOptions(null);
            return;
        }
        const c = new AbortController();
        setFilterOptionsLoading(true);
        getImportReviewBuildingsFilterOptions({ ...scopeQuery }, { signal: c.signal })
            .then((o) => setFilterOptions(o))
            .catch((err) => {
                if (!isAbortError(err)) {
                    setFilterOptions(null);
                }
            })
            .finally(() => {
                if (!c.signal.aborted) {
                    setFilterOptionsLoading(false);
                }
            });
        return () => c.abort();
    }, [hasValidScope, scopeQuery]);

    const fetchList = useCallback(
        async (signal?: AbortSignal) => {
            if (!hasValidScope || !scopeQuery) {
                setList(null);
                setError("");
                setIsLoading(false);
                return;
            }

            setIsLoading(true);
            setError("");

            try {
                const params: Parameters<typeof getImportReviewBuildings>[0] = {
                    ...scopeQuery,
                    limit,
                    offset,
                    sort,
                    include_geometry: true,
                };
                if (filters.match_status) {
                    params.match_status = filters.match_status;
                }
                if (filters.auto_action) {
                    params.auto_action = filters.auto_action;
                }
                if (filters.review_status) {
                    params.review_status = filters.review_status;
                }
                if (filters.review_decision) {
                    params.review_decision = filters.review_decision;
                }
                if (filters.promotion_status) {
                    params.promotion_status = filters.promotion_status;
                }
                if (filters.class_code) {
                    params.class_code = filters.class_code;
                }
                if (qApplied) {
                    params.q = qApplied;
                }

                const res = await getImportReviewBuildings(params, signal ? { signal } : undefined);
                setList(res);
                setSelectedIds(new Set());
            } catch (err) {
                if (isAbortError(err)) {
                    return;
                }
                setList(null);
                setError(formatImportReviewApiError(err));
            } finally {
                setIsLoading(false);
            }
        },
        [hasValidScope, scopeQuery, limit, offset, sort, filters, qApplied]
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

    useEffect(() => {
        if (!drawerRow) {
            setDrawerNote("");
            setOvName("");
            setOvCanonicalName("");
            setOvClassCode("");
            setOvBuildingType("");
            setOvBuildingTypeCode("");
            setOvLevels("");
            setOvHeightM("");
            setOvReviewNote("");
            return;
        }
        setDrawerNote(drawerRow.review_note ?? "");
        const ov = asOverrideRecord(drawerRow.review_overrides);
        setOvName(strFromUnknown(ov.name) || (drawerRow.name ?? ""));
        setOvCanonicalName(strFromUnknown(ov.canonical_name) || (drawerRow.canonical_name ?? ""));
        setOvClassCode(strFromUnknown(ov.class_code) || (drawerRow.class_code ?? ""));
        setOvBuildingType(strFromUnknown(ov.building_type) || (drawerRow.building_type ?? ""));
        setOvBuildingTypeCode(strFromUnknown(ov.building_type_code));
        setOvLevels(
            ov.levels !== undefined && ov.levels !== null && String(ov.levels).trim() !== ""
                ? String(ov.levels)
                : drawerRow.levels !== null && drawerRow.levels !== undefined
                  ? String(drawerRow.levels)
                  : ""
        );
        setOvHeightM(
            ov.height_m !== undefined && ov.height_m !== null && String(ov.height_m).trim() !== ""
                ? String(ov.height_m)
                : drawerRow.height_m !== null && drawerRow.height_m !== undefined
                  ? String(drawerRow.height_m)
                  : ""
        );
        setOvReviewNote(
            (strFromUnknown(ov.review_note).trim() || drawerRow.review_note?.trim() || "").trim()
        );

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
            promotion_status: "",
            class_code: "",
        });
        setQDraft("");
        replaceQuery((p) => {
            for (const key of [
                "match_status",
                "auto_action",
                "review_status",
                "review_decision",
                "promotion_status",
                "class_code",
                "q",
            ]) {
                p.delete(key);
            }
            p.set("offset", "0");
        });
        setQApplied("");
    };

    const goPage = (nextOffset: number) => {
        replaceQuery((p) => {
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

    const patchDecision = async (
        row: ImportReviewBuildingListItem,
        decision: ImportReviewDecision,
        opts?: { force?: boolean; confirmDuplicate?: boolean; note?: string | null }
    ) => {
        if (!scopeQuery) {
            return;
        }

        const note = opts?.note !== undefined ? opts.note : row.review_note;
        const updated = await patchImportReviewBuildingDecision(row.id, {
            ...scopeQuery,
            review_decision: decision,
            review_note: note ?? null,
            force: opts?.force ?? false,
            confirm_duplicate_reviewed: opts?.confirmDuplicate ?? false,
        });
        mergeRow(updated);
    };

    const handleRowAction = async (row: ImportReviewBuildingListItem, decision: ImportReviewDecision) => {
        if (!canEditImportReview) {
            return;
        }
        const ms = row.match_status ?? "";
        setRowActionBusyId(row.id);

        try {
            const isProtected = ms === "manual_protected" || row.auto_action === "protect_manual";
            if (decision === "approved" && isProtected) {
                const ok = window.confirm(
                    "This candidate is manual_protected or protect_manual. Approve anyway? (sends force=true to the API)"
                );
                if (!ok) {
                    return;
                }
                await patchDecision(row, decision, { force: true });
                return;
            }

            if (decision === "approved" && ms === "duplicate_candidate") {
                const ok = window.confirm(
                    "This duplicate_candidate row requires explicit confirmation. Approve with confirm_duplicate_reviewed=true?"
                );
                if (!ok) {
                    return;
                }
                await patchDecision(row, decision, { confirmDuplicate: true });
                return;
            }

            await patchDecision(row, decision);
        } catch (err) {
            const msg = formatImportReviewApiError(err);

            if ((msg.includes("manual_protected") || msg.includes("protect_manual")) && decision === "approved") {
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

            window.alert(msg);
        } finally {
            setRowActionBusyId(null);
        }
    };

    const handleDrawerSave = async () => {
        if (!drawerRow) {
            return;
        }
        if (!scopeQuery) {
            return;
        }
        if (!canEditImportReview) {
            return;
        }

        setDrawerSaving(true);
        try {
            const updated = await patchImportReviewBuildingDecision(drawerRow.id, {
                ...scopeQuery,
                review_decision: drawerDecision,
                review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
            });
            mergeRow(updated);
        } catch (err) {
            const msg = formatImportReviewApiError(err);
            if (
                (msg.includes("manual_protected") || msg.includes("protect_manual")) &&
                drawerDecision === "approved"
            ) {
                const ok = window.confirm(`${msg}\n\nRetry with force=true?`);
                if (ok) {
                    const updated = await patchImportReviewBuildingDecision(drawerRow.id, {
                        ...scopeQuery,
                        review_decision: drawerDecision,
                        review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                        force: true,
                    });
                    mergeRow(updated);
                }
            } else if (msg.includes("duplicate_candidate") && drawerDecision === "approved") {
                const ok = window.confirm(`${msg}\n\nRetry with confirm_duplicate_reviewed=true?`);
                if (ok) {
                    const updated = await patchImportReviewBuildingDecision(drawerRow.id, {
                        ...scopeQuery,
                        review_decision: drawerDecision,
                        review_note: drawerNote.trim() === "" ? null : drawerNote.trim(),
                        confirm_duplicate_reviewed: true,
                    });
                    mergeRow(updated);
                }
            } else {
                window.alert(msg);
            }
        } finally {
            setDrawerSaving(false);
        }
    };

    const handleDrawerOverridesSave = async () => {
        if (!drawerRow || !scopeQuery) {
            return;
        }
        if (!canEditImportReview) {
            return;
        }
        if ((drawerRow.promotion_status ?? "").toLowerCase() === "promoted") {
            window.alert("Cannot edit review_overrides after promotion_status is promoted.");
            return;
        }
        setDrawerOverridesSaving(true);
        try {
            const review_overrides: Record<string, unknown> = {};
            if (ovName.trim()) {
                review_overrides.name = ovName.trim();
            }
            if (ovCanonicalName.trim()) {
                review_overrides.canonical_name = ovCanonicalName.trim();
            }
            if (ovClassCode.trim()) {
                review_overrides.class_code = ovClassCode.trim();
            }
            if (ovBuildingType.trim()) {
                review_overrides.building_type = ovBuildingType.trim();
            }
            if (ovBuildingTypeCode.trim()) {
                review_overrides.building_type_code = ovBuildingTypeCode.trim();
            }
            if (ovLevels.trim()) {
                const n = Number(ovLevels);
                review_overrides.levels = Number.isFinite(n) ? n : ovLevels.trim();
            }
            if (ovHeightM.trim()) {
                const n = Number(ovHeightM);
                review_overrides.height_m = Number.isFinite(n) ? n : ovHeightM.trim();
            }

            const updated = await patchImportReviewBuildingOverrides(drawerRow.id, {
                ...scopeQuery,
                review_overrides,
                review_note: ovReviewNote.trim() === "" ? null : ovReviewNote.trim(),
            });
            mergeRow(updated);
        } catch (err) {
            window.alert(formatImportReviewApiError(err));
        } finally {
            setDrawerOverridesSaving(false);
        }
    };

    const selectedHasDuplicate = useMemo(() => {
        if (!list) {
            return false;
        }
        const map = new Map(list.items.map((r) => [r.id, r]));
        for (const id of selectedIds) {
            if (map.get(id)?.match_status === "duplicate_candidate") {
                return true;
            }
        }
        return false;
    }, [list, selectedIds]);

    const selectedNeedsForceForApprove = useMemo(() => {
        if (!list) {
            return false;
        }
        const map = new Map(list.items.map((r) => [r.id, r]));
        for (const id of selectedIds) {
            const r = map.get(id);
            if (!r) {
                continue;
            }
            if (r.match_status === "manual_protected" || r.auto_action === "protect_manual") {
                return true;
            }
        }
        return false;
    }, [list, selectedIds]);

    const selectedHasPromoted = useMemo(() => {
        if (!list) {
            return false;
        }
        const map = new Map(list.items.map((r) => [r.id, r]));
        for (const id of selectedIds) {
            if ((map.get(id)?.promotion_status ?? "").toLowerCase() === "promoted") {
                return true;
            }
        }
        return false;
    }, [list, selectedIds]);

    const runBulk = async (
        body: Omit<PostImportReviewBuildingsBulkBody, "source_snapshot_version" | "review_batch_id" | "snapshot_version">,
    ) => {
        if (!scopeQuery) {
            return;
        }

        setBulkBusy(true);
        setBulkPreview(null);
        try {
            const res = await postImportReviewBuildingsBulkDecision({
                ...body,
                ...scopeQuery,
            });
            setBulkPreview(res);
            if (!body.dry_run) {
                void fetchList();
            }
        } catch (err) {
            window.alert(formatImportReviewApiError(err));
        } finally {
            setBulkBusy(false);
        }
    };

    const bulkApproveSelected = async () => {
        if (selectedIds.size === 0) {
            return;
        }
        if (selectedHasPromoted) {
            window.alert(
                "Selection includes promoted rows. The API will not bulk-update them; remove promoted rows from the selection first."
            );
            return;
        }
        if (selectedNeedsForceForApprove && !bulkForce) {
            window.alert(
                "Selection includes manual_protected or protect_manual candidates. Enable “Danger: force bulk override” and confirm to bulk approve — or shrink the selection."
            );
            return;
        }
        if (selectedNeedsForceForApprove && bulkForce) {
            const cf = window.confirm(
                `${selectedIds.size} selected row(s) include manual_protected / protect_manual. Bulk approve sends force=true. Continue?`
            );
            if (!cf) {
                return;
            }
        }
        if (selectedHasDuplicate && !bulkForce) {
            window.alert(
                "Selection includes duplicate_candidate rows. Enable “Danger: force bulk override” to include them, or clear those rows from the selection."
            );
            return;
        }

        const ids = [...selectedIds];
        const note = bulkNote.trim() === "" ? undefined : bulkNote.trim();
        const ok = window.confirm(
            `Approve ${ids.length} selected review candidate(s)?${bulkForce ? " (force=true)" : ""} This updates Supabase import_review only (future publish batch / core promotion is separate).`
        );
        if (!ok) {
            return;
        }

        await runBulk({
            review_decision: "approved",
            dry_run: false,
            ids,
            force: bulkForce,
            review_note: note ?? null,
        });
    };

    const bulkDecisionSelected = async (decision: ImportReviewDecision, label: string) => {
        if (selectedIds.size === 0) {
            return;
        }
        if (selectedHasPromoted) {
            window.alert(
                "Selection includes promoted rows. Clear promoted rows from the selection — bulk updates skip promoted candidates."
            );
            return;
        }
        if (
            decision === "approved" &&
            selectedHasDuplicate &&
            !bulkForce
        ) {
            window.alert(
                "Approve on duplicate_candidate rows requires force or per-row confirmation. Enable force override or shrink the selection.",
            );
            return;
        }
        const ids = [...selectedIds];
        const ok = window.confirm(
            `${label} for ${ids.length} selected row(s)? This updates import_review candidates only.`,
        );
        if (!ok) {
            return;
        }
        await runBulk({
            review_decision: decision,
            dry_run: false,
            ids,
            force: bulkForce,
            review_note: bulkNote.trim() === "" ? null : bulkNote.trim(),
        });
    };

    const bulkNewAutoDryRun = async () => {
        await runBulk({
            review_decision: "approved",
            dry_run: true,
            filters: { match_status: "new_auto", auto_action: "insert_candidate" },
            force: false,
        });
    };

    const bulkNewAutoReal = async () => {
        const ok = window.confirm(
            "Run real bulk APPROVED for all rows with match_status=new_auto and auto_action=insert_candidate? This updates Supabase import_review only (no core promotion)."
        );
        if (!ok) {
            return;
        }
        await runBulk({
            review_decision: "approved",
            dry_run: false,
            filters: { match_status: "new_auto", auto_action: "insert_candidate" },
            force: bulkForce,
            review_note: bulkNote.trim() === "" ? null : bulkNote.trim(),
        });
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

    const sidebarMapInput = useMemo(() => {
        if (!mapSourceRow || !showMapPreview) {
            return {
                geometry: null,
                geometryKind: "polygon" as const,
                fallbackNote: null as string | null,
            };
        }
        return buildingDrawerMapInput(mapSourceRow);
    }, [mapSourceRow, showMapPreview]);

    const drawerMapInput = useMemo(
        () => (drawerRow ? buildingDrawerMapInput(drawerRow) : null),
        [drawerRow],
    );

    const activeChips = useMemo(() => {
        const chips: { key: string; label: string; value: string }[] = [];
        const sp = searchParams;
        const rb = reviewBatchIdFromImportReviewSearch(sp);
        if (rb) {
            chips.push({ key: "review_batch", label: "Review batch", value: rb });
        }
        const snap = snapshotVersionFromImportReviewSearch(sp);
        if (snap) {
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
        const pst = sp.get("promotion_status")?.trim();
        if (pst) {
            chips.push({
                key: "promotion_status",
                label: "Promotion",
                value: pst === UNREVIEWED ? "Unreviewed / empty" : pst,
            });
        }
        const cc = sp.get("class_code")?.trim();
        if (cc) {
            chips.push({ key: "class_code", label: "Class", value: cc });
        }
        const q = sp.get("q")?.trim();
        if (q) {
            chips.push({ key: "q", label: "Search", value: q });
        }
        return chips;
    }, [searchParams]);

    const selectCls =
        "rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-800";

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
                            {showMapPreview ? "Data review — buildings" : "Import review — buildings"}
                        </h1>
                        <p className="max-w-2xl text-sm leading-relaxed text-gray-600">
                            Review package candidates through the API against Supabase{" "}
                            <code className="rounded bg-gray-100 px-1 text-xs">import_review</code> only —
                            approve/edit updates review candidates for a{" "}
                            <span className="font-medium">future publish batch</span>.{" "}
                            <span className="font-medium">Core promotion</span> is separate. Rows marked{" "}
                            <span className="font-medium text-violet-900">manual_protected</span> or{" "}
                            <span className="font-medium text-violet-900">protect_manual</span> need{" "}
                            <span className="font-medium">force</span> when approving in bulk or when the API blocks approval;{" "}
                            <span className="font-medium text-orange-900">duplicate_candidate</span> approvals need confirmation.
                        </p>
                    </div>
                    <Link
                        href={
                            hasValidScope && scopeQuery
                                ? importReviewSummaryHref(
                                      showMapPreview ? "/data-review" : "/import-review",
                                      scopeQuery,
                                  )
                                : showMapPreview
                                  ? "/data-review"
                                  : "/import-review"
                        }
                        className="inline-flex shrink-0 items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50"
                    >
                        Back to summary
                    </Link>
                </header>

                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="space-y-5 p-5">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <label className="block">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                        Source snapshot version
                                    </span>
                                    <input
                                        value={snapshotInput}
                                        onChange={(e) => setSnapshotInput(e.target.value)}
                                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 shadow-sm focus:border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-800"
                                        placeholder="Primary filter — e.g. snapshot string from review package manifest"
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
                                        className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 shadow-sm focus:border-gray-800 focus:outline-none focus:ring-1 focus:ring-gray-800"
                                        placeholder="Optional — narrow listing to one review_batch_id only"
                                        autoComplete="off"
                                    />
                            </label>
                        </div>
                        <p className="text-xs text-gray-500">
                            Apply writes one scope: if review batch is non-empty it wins; otherwise snapshot is saved as{" "}
                            <code className="text-[11px]">source_snapshot_version</code>. Legacy{" "}
                            <code className="text-[11px]">snapshot_version</code> URLs are rewritten on Apply.
                        </p>
                        <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3 text-xs text-gray-500">
                            {filterOptionsLoading ? <span>Loading filter options…</span> : null}
                            {!filterOptionsLoading && filterOptions ? (
                                <span>
                                    Filter-option distinct values loaded for snapshot{" "}
                                    <span className="font-mono text-gray-700">
                                        {filterOptions.source_snapshot_version || "(empty)"}
                                    </span>
                                    {filterOptions.review_batch_id ? (
                                        <>
                                            {" "}
                                            · batch{" "}
                                            <span className="font-mono text-gray-700">{filterOptions.review_batch_id}</span>
                                        </>
                                    ) : null}
                                </span>
                            ) : null}
                            {!filterOptionsLoading && !filterOptions && hasValidScope ? (
                                <span>No filter-option values loaded (scope may have no candidates yet).</span>
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
                                <span className="text-xs font-semibold text-gray-600">Promotion status</span>
                                <select
                                    value={filters.promotion_status}
                                    onChange={(e) =>
                                        setFilters((f) => ({ ...f, promotion_status: e.target.value }))
                                    }
                                    className={selectCls}
                                >
                                    <option value="">All</option>
                                    <option value={UNREVIEWED}>Unreviewed (null / empty)</option>
                                    {(filterOptions?.promotion_status ?? []).map((v) => (
                                        <option key={v} value={v}>
                                            {v}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className="flex flex-col gap-1">
                                <span className="text-xs font-semibold text-gray-600">Class code</span>
                                <select
                                    value={filters.class_code}
                                    onChange={(e) =>
                                        setFilters((f) => ({ ...f, class_code: e.target.value }))
                                    }
                                    className={selectCls}
                                >
                                    <option value="">All</option>
                                    {(filterOptions?.class_code ?? []).map((v) => (
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
                                        <strong className="text-gray-900">{total.toLocaleString()}</strong> candidates
                                        {isLoading ? " · Loading…" : null}
                                    </>
                                ) : (
                                    "Set snapshot version or review batch ID (or NEXT_PUBLIC_IMPORT_REVIEW_SNAPSHOT_VERSION), then Apply."
                                )}
                            </span>
                        </div>
                    </CardContent>
                </Card>

                {error ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 whitespace-pre-wrap">
                        {error}
                    </div>
                ) : null}

                {activeChips.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-sm">
                        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Active</span>
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

                <Card className="border-gray-200 shadow-sm">
                    <CardContent className="space-y-4 p-5">
                        <div className="flex flex-col gap-1 border-b border-gray-100 pb-3">
                            <h2 className="text-sm font-semibold text-gray-900">Bulk actions</h2>
                            <p className="text-xs text-gray-600">
                                Applies <code className="rounded bg-gray-100 px-1">review_decision</code> patches to Supabase{" "}
                                <code className="rounded bg-gray-100 px-1">import_review.building_candidates</code> via the
                                bulk API — not core. Rows that are{" "}
                                <span className="font-medium text-violet-900">already promoted</span> are skipped or blocked;
                                approving <span className="font-medium text-violet-900">manual_protected</span> /{" "}
                                <span className="font-medium text-violet-900">protect_manual</span> or{" "}
                                <span className="font-medium text-orange-900">duplicate_candidate</span> in bulk typically
                                needs the hazard checkbox below plus confirmation prompts.
                            </p>
                            {!canEditImportReview ? (
                                <p className="text-[11px] font-medium text-amber-900">
                                    Read-only: no admin roles detected in the stored token — controls stay disabled here; the API
                                    is the enforcement layer.
                                </p>
                            ) : null}
                        </div>
                        <div className="text-sm font-medium text-gray-800">
                            Selected:{" "}
                            <strong>{selectedIds.size}</strong> row{selectedIds.size === 1 ? "" : "s"}
                        </div>
                        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
                            <button
                                type="button"
                                disabled={
                                    bulkBusy ||
                                    selectedIds.size === 0 ||
                                    !hasValidScope ||
                                    !canEditImportReview
                                }
                                onClick={() => void bulkApproveSelected()}
                                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Approve selected
                            </button>
                            <button
                                type="button"
                                disabled={
                                    bulkBusy ||
                                    selectedIds.size === 0 ||
                                    !hasValidScope ||
                                    !canEditImportReview
                                }
                                onClick={() => void bulkDecisionSelected("rejected", "Reject")}
                                className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-950 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Reject selected
                            </button>
                            <button
                                type="button"
                                disabled={
                                    bulkBusy ||
                                    selectedIds.size === 0 ||
                                    !hasValidScope ||
                                    !canEditImportReview
                                }
                                onClick={() => void bulkDecisionSelected("needs_more_review", "Needs more review")}
                                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Needs more review (selected)
                            </button>
                            <button
                                type="button"
                                disabled={
                                    bulkBusy ||
                                    selectedIds.size === 0 ||
                                    !hasValidScope ||
                                    !canEditImportReview
                                }
                                onClick={() => void bulkDecisionSelected("ignored", "Ignore")}
                                className="rounded-lg border border-gray-300 bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-900 hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                                Ignore selected
                            </button>
                            <button
                                type="button"
                                disabled={bulkBusy || !hasValidScope || !canEditImportReview}
                                onClick={() => void bulkNewAutoDryRun()}
                                className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100/80 disabled:opacity-50"
                            >
                                Dry-run safe bulk approve
                            </button>
                            <button
                                type="button"
                                disabled={bulkBusy || !hasValidScope || !canEditImportReview}
                                onClick={() => void bulkNewAutoReal()}
                                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-950 hover:bg-amber-100 disabled:opacity-50"
                            >
                                Real safe bulk approve
                            </button>
                        </div>
                        <div className="rounded-lg border border-red-200 bg-red-50/50 p-3">
                            <label className="flex cursor-pointer items-start gap-2 text-sm text-red-950">
                                <input
                                    type="checkbox"
                                    checked={bulkForce}
                                    disabled={!canEditImportReview}
                                    onChange={(e) => setBulkForce(e.target.checked)}
                                    className="mt-0.5"
                                />
                                <span>
                                    <span className="font-semibold">Danger — admin force override</span>
                                    <span className="block text-xs font-normal text-red-900/90">
                                        Sends <code className="rounded bg-white/70 px-1">force=true</code> on bulk and selected
                                        approve. Bypasses safe eligibility (manual_protected, duplicate_candidate, etc.).
                                    </span>
                                </span>
                            </label>
                        </div>
                        <label className="flex flex-col gap-1">
                            <span className="text-xs font-semibold text-gray-600">Optional note (bulk)</span>
                            <input
                                value={bulkNote}
                                onChange={(e) => setBulkNote(e.target.value)}
                                disabled={!canEditImportReview}
                                className={selectCls}
                            />
                        </label>
                        {bulkPreview ? (
                            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                                <div className="font-semibold text-gray-900">
                                    Bulk result {bulkPreview.dry_run ? "(dry run)" : ""}
                                </div>
                                <div className="mt-1 text-gray-700">
                                    Updated: {bulkPreview.updated_count} · Skipped: {bulkPreview.skipped_count}
                                </div>
                                {bulkPreview.skipped_reasons.length > 0 ? (
                                    <ul className="mt-2 list-inside list-disc text-gray-600">
                                        {bulkPreview.skipped_reasons.map((r) => (
                                            <li key={r.reason}>
                                                {r.reason}: {r.count}
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        ) : null}
                    </CardContent>
                </Card>

                <ImportReviewTableFrame>
                    <table className={`${IMPORT_REVIEW_TABLE_MIN_WIDTH_CLASS} divide-y divide-gray-200 text-left text-sm`}>
                        <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                            <tr>
                                <th className={importReviewStickyCheckboxThClass()}>
                                    <input
                                        type="checkbox"
                                        checked={allPageSelected}
                                        onChange={(e) => toggleSelectAllPage(e.target.checked)}
                                        disabled={
                                            !canEditImportReview || !list || list.items.length === 0 || !hasValidScope
                                        }
                                        aria-label="Select all on page"
                                    />
                                </th>
                                <th className={importReviewStickyIdThClass()}>ID</th>
                                <th className="px-3 py-3">External ID</th>
                                <th className="px-3 py-3">Name</th>
                                <th className="px-3 py-3">Class</th>
                                <th className="px-3 py-3">Building type</th>
                                <th className="px-3 py-3">Confidence</th>
                                <th className="px-3 py-3">Match status</th>
                                <th className="px-3 py-3">Auto action</th>
                                <th className="px-3 py-3">Review status</th>
                                <th className="px-3 py-3">Decision</th>
                                <th className="px-3 py-3">Promotion</th>
                                <th className="px-3 py-3">Updated</th>
                                <th className={importReviewStickyActionsThClass()}>Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {!hasValidScope ? (
                                <tr>
                                    <td colSpan={14} className="px-4 py-10 text-center text-gray-500">
                                        Add a snapshot version or review batch scope, then Apply filters — need a valid envelope
                                        for GET /buildings / filter-options.
                                    </td>
                                </tr>
                            ) : isLoading && !list ? (
                                <tr>
                                    <td colSpan={14} className="px-4 py-10 text-center text-gray-500">
                                        Loading candidates from Supabase import_review cache…
                                    </td>
                                </tr>
                            ) : list && list.items.length === 0 ? (
                                <tr>
                                    <td colSpan={14} className="px-4 py-10 text-center text-gray-500">
                                        No matching review candidates — adjust filters or change scope inputs.
                                    </td>
                                </tr>
                            ) : (
                                list?.items.map((row) => {
                                    const nm =
                                        row.canonical_name?.trim() ||
                                        row.name?.trim() ||
                                        null;
                                    const nt = [row.canonical_name, row.name].filter(Boolean).join(" • ");
                                    const rowSurface = importReviewRowSurface(row);
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
                                        <td className="max-w-[200px] truncate px-3 py-3 align-top text-gray-900" title={nt}>
                                            {dash(nm)}
                                        </td>
                                        <td className="px-3 py-3 align-top">
                                            <Pill tone="slate">{dash(row.class_code)}</Pill>
                                        </td>
                                        <td className="max-w-[140px] truncate px-3 py-3 align-top">
                                            <Pill tone="slate">{dash(row.building_type)}</Pill>
                                        </td>
                                        <td className="px-3 py-3 align-top tabular-nums text-gray-800">
                                            {dash(row.confidence_score)}
                                        </td>
                                        <td className="px-3 py-3 align-top">
                                            <Pill tone={(row.match_status ?? "").includes("duplicate") ? "amber" : "blue"}>
                                                {dash(row.match_status)}
                                            </Pill>
                                        </td>
                                        <td className="px-3 py-3 align-top">
                                            <Pill tone="slate">{dash(row.auto_action)}</Pill>
                                        </td>
                                        <td className="px-3 py-3 align-top">
                                            <Pill tone="violet">{dash(row.review_status)}</Pill>
                                        </td>
                                        <td className="px-3 py-3 align-top">
                                            <Pill tone="blue">{dash(row.review_decision)}</Pill>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-3 align-top">
                                            <Pill
                                                tone={
                                                    (row.promotion_status ?? "").toLowerCase() === "promoted"
                                                        ? "violet"
                                                        : "slate"
                                                }
                                            >
                                                {dash(row.promotion_status)}
                                            </Pill>
                                        </td>
                                        <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-gray-600">
                                            {formatTs(row.updated_at)}
                                        </td>
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
                            geometry={sidebarMapInput.geometry}
                            geometryKind={sidebarMapInput.geometryKind}
                            entityType="building"
                            externalId={mapSourceRow?.external_id ?? null}
                            title="Building footprint"
                        />
                        {sidebarMapInput.fallbackNote ? (
                            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50/80 px-2 py-1.5 text-center text-[11px] text-amber-950">
                                {sidebarMapInput.fallbackNote}
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
                        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-4 py-3">
                            <h2 className="text-base font-semibold text-gray-900">Building candidate</h2>
                            <button
                                type="button"
                                onClick={() => setDrawerRow(null)}
                                className="rounded-md px-2 py-1 text-sm text-gray-600 hover:bg-gray-100"
                            >
                                Close
                            </button>
                        </div>
                        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 text-sm">
                            <section>
                                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                                    Review candidate
                                </h3>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-gray-600 sm:grid-cols-3">
                                    <div>
                                        <span className="font-medium text-gray-500">ID</span>
                                        <div className="font-mono text-gray-900">{drawerRow.id}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">external_id</span>
                                        <div className="break-all font-mono text-gray-900">{dash(drawerRow.external_id)}</div>
                                    </div>
                                    <div className="sm:col-span-2">
                                        <span className="font-medium text-gray-500">name / canonical_name</span>
                                        <div className="text-gray-900">{dash(drawerRow.name)}</div>
                                        <div className="font-medium text-gray-800">{dash(drawerRow.canonical_name)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">building_type</span>
                                        <div>{dash(drawerRow.building_type)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">class_code</span>
                                        <div className="font-mono text-gray-900">{dash(drawerRow.class_code)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">confidence_score</span>
                                        <div className="tabular-nums text-gray-900">{dash(drawerRow.confidence_score)}</div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">local_staging_id</span>
                                        <div className="break-all font-mono text-[11px] text-gray-900">
                                            {dash(drawerRow.local_staging_id)}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">source_snapshot_version</span>
                                        <div className="break-all font-mono text-[11px] text-gray-900">
                                            {dash(drawerRow.source_snapshot_version)}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">review_batch_id</span>
                                        <div className="break-all font-mono text-[11px] text-gray-900">
                                            {dash(drawerRow.review_batch_id)}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">source_snapshot lineage</span>
                                        <div className="break-all font-mono text-[11px] text-gray-900">
                                            {dash(drawerRow.source_snapshot_id_local)}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">promoted_core_id</span>
                                        <div className="break-all font-mono text-[11px] text-gray-900">
                                            {dash(drawerRow.promoted_core_id)}
                                        </div>
                                    </div>
                                    <div>
                                        <span className="font-medium text-gray-500">matched_core_id</span>
                                        <div className="break-all font-mono text-[11px] text-gray-900">
                                            {dash(drawerRow.matched_core_id)}
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
                                        <span className="font-medium text-gray-500">promotion_status</span>
                                        <div>{dash(drawerRow.promotion_status)}</div>
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
                                </div>
                            </section>

                            {jsonishSignalsPresent(drawerRow.validation_warnings) ? (
                                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950">
                                    <span className="uppercase tracking-wide">Validation warnings</span>
                                    <pre className="mt-1 whitespace-pre-wrap font-normal text-amber-950">
                                        {safeJson(drawerRow.validation_warnings)}
                                    </pre>
                                </div>
                            ) : null}
                            {jsonishSignalsPresent(drawerRow.validation_errors) ? (
                                <div className="rounded-lg border border-red-400 bg-red-50 px-3 py-2 text-xs font-semibold text-red-950">
                                    <span className="uppercase tracking-wide">Validation errors</span>
                                    <pre className="mt-1 whitespace-pre-wrap font-normal text-red-950">
                                        {safeJson(drawerRow.validation_errors)}
                                    </pre>
                                </div>
                            ) : null}

                            {drawerMapInput?.fallbackNote ? (
                                <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950">
                                    {drawerMapInput.fallbackNote}
                                </p>
                            ) : null}

                            <DataReviewCandidateMap
                                key={drawerRow.id}
                                geometry={drawerMapInput?.geometry ?? null}
                                geometryKind={drawerMapInput?.geometryKind ?? "polygon"}
                                entityType="building"
                                externalId={drawerRow.external_id ?? null}
                                title="Location / footprint"
                                size="drawer"
                                className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
                            />

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

                            <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50/30 p-4">
                                <div>
                                    <h3 className="text-xs font-semibold uppercase text-violet-900">review_overrides edit</h3>
                                    <p className="mt-1 text-[11px] leading-relaxed text-violet-950/85">
                                        Sends PATCH <span className="font-mono">/overrides</span> — merges these fields into{" "}
                                        <span className="font-mono">review_overrides</span> JSON only (does not replace{" "}
                                        <span className="font-mono">normalized_data</span> /{" "}
                                        <span className="font-mono">source_refs</span>). Optional note is stored alongside the
                                        review row.
                                    </p>
                                    {(drawerRow.promotion_status ?? "").toLowerCase() === "promoted" ? (
                                        <p className="mt-1 text-[11px] font-semibold text-red-800">
                                            promotion_status=promoted — overrides are blocked by the dashboard (API may also
                                            reject).
                                        </p>
                                    ) : null}
                                </div>
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                    <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                        name
                                        <input
                                            value={ovName}
                                            disabled={
                                                !canEditImportReview ||
                                                (drawerRow.promotion_status ?? "").toLowerCase() === "promoted"
                                            }
                                            onChange={(e) => setOvName(e.target.value)}
                                            className={selectCls}
                                            autoComplete="off"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                        canonical_name
                                        <input
                                            value={ovCanonicalName}
                                            disabled={
                                                !canEditImportReview ||
                                                (drawerRow.promotion_status ?? "").toLowerCase() === "promoted"
                                            }
                                            onChange={(e) => setOvCanonicalName(e.target.value)}
                                            className={selectCls}
                                            autoComplete="off"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                        class_code
                                        <input
                                            value={ovClassCode}
                                            disabled={
                                                !canEditImportReview ||
                                                (drawerRow.promotion_status ?? "").toLowerCase() === "promoted"
                                            }
                                            onChange={(e) => setOvClassCode(e.target.value)}
                                            className={selectCls}
                                            autoComplete="off"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                        building_type
                                        <input
                                            value={ovBuildingType}
                                            disabled={
                                                !canEditImportReview ||
                                                (drawerRow.promotion_status ?? "").toLowerCase() === "promoted"
                                            }
                                            onChange={(e) => setOvBuildingType(e.target.value)}
                                            className={selectCls}
                                            autoComplete="off"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                        building_type_code
                                        <input
                                            value={ovBuildingTypeCode}
                                            disabled={
                                                !canEditImportReview ||
                                                (drawerRow.promotion_status ?? "").toLowerCase() === "promoted"
                                            }
                                            onChange={(e) => setOvBuildingTypeCode(e.target.value)}
                                            className={selectCls}
                                            autoComplete="off"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                        levels
                                        <input
                                            value={ovLevels}
                                            disabled={
                                                !canEditImportReview ||
                                                (drawerRow.promotion_status ?? "").toLowerCase() === "promoted"
                                            }
                                            onChange={(e) => setOvLevels(e.target.value)}
                                            className={selectCls}
                                            autoComplete="off"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-medium text-gray-700">
                                        height_m
                                        <input
                                            value={ovHeightM}
                                            disabled={
                                                !canEditImportReview ||
                                                (drawerRow.promotion_status ?? "").toLowerCase() === "promoted"
                                            }
                                            onChange={(e) => setOvHeightM(e.target.value)}
                                            className={selectCls}
                                            autoComplete="off"
                                        />
                                    </label>
                                    <label className="flex flex-col gap-1 text-xs font-medium text-gray-700 sm:col-span-2">
                                        review_note (with overrides save)
                                        <textarea
                                            value={ovReviewNote}
                                            disabled={
                                                !canEditImportReview ||
                                                (drawerRow.promotion_status ?? "").toLowerCase() === "promoted"
                                            }
                                            onChange={(e) => setOvReviewNote(e.target.value)}
                                            rows={3}
                                            className={selectCls}
                                        />
                                    </label>
                                </div>
                                <button
                                    type="button"
                                    disabled={
                                        drawerOverridesSaving ||
                                        !canEditImportReview ||
                                        (drawerRow.promotion_status ?? "").toLowerCase() === "promoted"
                                    }
                                    onClick={() => void handleDrawerOverridesSave()}
                                    className="rounded-lg bg-violet-900 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                                >
                                    {drawerOverridesSaving ? "Saving overrides…" : "Save overrides"}
                                </button>
                                <div>
                                    <h4 className="text-[11px] font-semibold uppercase text-gray-500">
                                        Stored review_overrides (server JSON)
                                    </h4>
                                    <pre className="mt-1 max-h-40 overflow-auto rounded-lg border border-gray-100 bg-white p-2 text-[11px]">
                                        {safeJson(drawerRow.review_overrides)}
                                    </pre>
                                </div>
                            </section>

                            <div>
                                <h3 className="text-xs font-semibold uppercase text-gray-500">matched_core_data</h3>
                                <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-2 text-xs">
                                    {safeJson(drawerRow.matched_core_data)}
                                </pre>
                            </div>
                            <div>
                                <h3 className="text-xs font-semibold uppercase text-gray-500">f2_comparison</h3>
                                <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-2 text-xs">
                                    {safeJson(drawerRow.f2_comparison)}
                                </pre>
                            </div>

                            <section className="space-y-3 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
                                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-600">
                                    Review decision
                                </h3>
                                {!canEditImportReview ? (
                                    <p className="text-[11px] font-medium text-amber-950">
                                        Read-only — JWT roles did not include <span className="font-mono">admin</span> (verify
                                        with your auth provider). The API guards writes.
                                    </p>
                                ) : null}
                                <p className="text-[11px] leading-relaxed text-gray-700">
                                    <strong>Approve</strong> marks this candidate ready for a <strong>future publish batch</strong>.
                                    It updates <span className="font-mono">import_review.building_candidates</span> only —{" "}
                                    <strong>core promotion happens later</strong> in a separate flow.
                                </p>
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
                            </section>
                        </div>
                    </div>
                </div>
            ) : null}
        </main>
    );
}
