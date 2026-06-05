import type { QueryClient } from "@tanstack/react-query";

import type {
    ImportReviewBuildingListItem,
    ImportReviewBuildingsListResponse,
} from "@/src/lib/api";

import type { ImportReviewOverrideFieldDef } from "../config/overrideFieldDefs";
import {
    enrichImportReviewRoadListRowAfterSave,
    type ImportReviewRoadClassOptionInput,
} from "./importReviewRoadClassDisplay";
import { readColumnDraftValue } from "./overrideEditorUtils";

export class DirectEditSaveError extends Error {
    override readonly name = "DirectEditSaveError";

    constructor(
        message: string,
        readonly technicalDetail?: string
    ) {
        super(message);
    }
}

/** PATCH must return a candidate row for the requested id. */
export function assertValidDirectEditPatchResponse(
    row: unknown,
    candidateId: string
): asserts row is ImportReviewBuildingListItem {
    if (row === null || row === undefined || typeof row !== "object" || Array.isArray(row)) {
        throw new DirectEditSaveError(
            "Save failed: API response did not include an updated candidate row.",
            `expected object body for candidate id=${candidateId}`
        );
    }
    const item = row as ImportReviewBuildingListItem;
    const responseId = item.id;
    if (responseId === null || responseId === undefined || String(responseId).trim() === "") {
        throw new DirectEditSaveError(
            "Save failed: API response did not include an updated candidate row.",
            "missing id on response"
        );
    }
    if (String(responseId) !== String(candidateId)) {
        throw new DirectEditSaveError(
            "Save failed: API response candidate id does not match the edited row.",
            `expected id=${candidateId}, got id=${String(responseId)}`
        );
    }
}

function normalizeComparable(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    const text = String(value).trim();
    return text.length > 0 ? text : null;
}

function readPersistedPatchValue(
    row: ImportReviewBuildingListItem,
    patchKey: string,
    apiFamily: string,
    defs: readonly ImportReviewOverrideFieldDef[]
): string {
    const def = defs.find((d) => d.patchKey === patchKey);
    if (def) {
        return readColumnDraftValue(row, def, apiFamily).trim();
    }
    const raw = (row as Record<string, unknown>)[patchKey];
    if (raw === null || raw === undefined) {
        return "";
    }
    if (typeof raw === "boolean") {
        return raw ? "true" : "false";
    }
    return String(raw).trim();
}

/**
 * After PATCH + detail refetch, ensure typed columns match what we sent.
 * Returns a human message when verification fails, else null.
 */
export function verifyDirectEditPersisted(
    fieldsPatch: Record<string, unknown>,
    refetched: ImportReviewBuildingListItem,
    apiFamily: string,
    defs: readonly ImportReviewOverrideFieldDef[],
    verifyPatchKeys?: readonly string[]
): string | null {
    const mismatches: string[] = [];
    const keysToVerify =
        verifyPatchKeys && verifyPatchKeys.length > 0
            ? verifyPatchKeys
            : Object.keys(fieldsPatch);

    for (const patchKey of keysToVerify) {
        if (!Object.prototype.hasOwnProperty.call(fieldsPatch, patchKey)) {
            continue;
        }
        const sent = fieldsPatch[patchKey];
        const persistedRaw = readPersistedPatchValue(refetched, patchKey, apiFamily, defs);
        const sentNorm = normalizeComparable(sent);
        const persistedNorm =
            persistedRaw === "" ? null : normalizeComparable(persistedRaw);

        if (sent === null) {
            if (persistedNorm !== null) {
                mismatches.push(`${patchKey}: expected cleared, got ${JSON.stringify(persistedRaw)}`);
            }
            continue;
        }

        if (sentNorm !== persistedNorm) {
            mismatches.push(
                `${patchKey}: sent ${JSON.stringify(sentNorm)} but database has ${JSON.stringify(persistedNorm)}`
            );
        }
    }

    if (mismatches.length === 0) {
        return null;
    }
    return mismatches.join("; ");
}

/**
 * Detail drawer state after save: full GET row with PATCH-typed columns authoritative.
 */
export function mergeDirectEditSaveDetailRow(
    patchResponse: ImportReviewBuildingListItem,
    refetched: ImportReviewBuildingListItem,
    fieldsPatch: Record<string, unknown>,
    options?: {
        apiFamily?: string;
        roadClassOptions?: readonly ImportReviewRoadClassOptionInput[];
    }
): ImportReviewBuildingListItem {
    const merged: ImportReviewBuildingListItem = { ...refetched, ...patchResponse };
    for (const patchKey of Object.keys(fieldsPatch)) {
        if (!Object.prototype.hasOwnProperty.call(fieldsPatch, patchKey)) {
            continue;
        }
        const fromPatch = (patchResponse as Record<string, unknown>)[patchKey];
        if (fromPatch !== undefined) {
            (merged as Record<string, unknown>)[patchKey] = fromPatch;
        }
    }
    if (options?.apiFamily === "roads") {
        return enrichImportReviewRoadListRowAfterSave(
            merged,
            options.roadClassOptions ?? []
        );
    }
    return merged;
}

function listRowFieldMismatchesAfterRefetch(
    listItem: ImportReviewBuildingListItem,
    savedRow: ImportReviewBuildingListItem,
    fieldsPatch: Record<string, unknown>,
    verifyPatchKeys: readonly string[] | undefined,
    apiFamily: string,
    defs: readonly ImportReviewOverrideFieldDef[]
): string[] {
    const keysToVerify =
        verifyPatchKeys && verifyPatchKeys.length > 0
            ? verifyPatchKeys
            : Object.keys(fieldsPatch);
    const mismatches: string[] = [];

    for (const patchKey of keysToVerify) {
        if (!Object.prototype.hasOwnProperty.call(fieldsPatch, patchKey)) {
            continue;
        }
        const expected = readPersistedPatchValue(savedRow, patchKey, apiFamily, defs);
        const actual = readPersistedPatchValue(listItem, patchKey, apiFamily, defs);
        const expectedNorm = expected === "" ? null : normalizeComparable(expected);
        const actualNorm = actual === "" ? null : normalizeComparable(actual);
        if (expectedNorm !== actualNorm) {
            mismatches.push(
                `${patchKey}: list=${JSON.stringify(actualNorm)} saved=${JSON.stringify(expectedNorm)}`
            );
        }
    }

    return mismatches;
}

export type SyncImportReviewListCacheAfterDirectEditSaveArgs = {
    queryClient: QueryClient;
    candidatesQueryKey: readonly unknown[];
    candidateId: string;
    savedRow: ImportReviewBuildingListItem;
    fieldsPatch: Record<string, unknown>;
    verifyPatchKeys?: readonly string[];
    apiFamily: string;
    fieldDefs: readonly ImportReviewOverrideFieldDef[];
    patchListItem: (
        updatedId: string,
        patch: (
            item: ImportReviewBuildingsListResponse["items"][number]
        ) => ImportReviewBuildingsListResponse["items"][number]
    ) => void;
    patchListItemEverywhere: (
        updatedId: string,
        patch: (
            item: ImportReviewBuildingsListResponse["items"][number]
        ) => ImportReviewBuildingsListResponse["items"][number]
    ) => void;
};

/**
 * After a successful direct-edit PATCH: patch the current list cache, refetch the scoped list
 * query (family / batch|snapshot / filters / pagination / include_promoted), then in dev warn
 * if the refetched row still disagrees with the saved row and re-apply the saved row locally.
 */
export async function syncImportReviewListCacheAfterDirectEditSave(
    args: SyncImportReviewListCacheAfterDirectEditSaveArgs
): Promise<void> {
    const applySavedToListCaches = () => {
        args.patchListItemEverywhere(args.candidateId, () => args.savedRow);
        args.patchListItem(args.candidateId, () => args.savedRow);
    };

    applySavedToListCaches();

    await args.queryClient.refetchQueries({
        queryKey: args.candidatesQueryKey,
        exact: true,
    });

    const listData = args.queryClient.getQueryData<ImportReviewBuildingsListResponse>(
        args.candidatesQueryKey
    );
    const listItem = listData?.items.find((item) => item.id === args.candidateId);
    if (!listItem) {
        return;
    }

    const mismatches = listRowFieldMismatchesAfterRefetch(
        listItem,
        args.savedRow,
        args.fieldsPatch,
        args.verifyPatchKeys,
        args.apiFamily,
        args.fieldDefs
    );
    if (mismatches.length === 0) {
        return;
    }

    if (process.env.NODE_ENV === "development") {
        console.warn("[import-review list cache stale after refetch]", {
            candidateId: args.candidateId,
            candidatesQueryKey: args.candidatesQueryKey,
            mismatches,
        });
    }

    applySavedToListCaches();
}

export function logDirectEditSaveDev(payload: {
    family: string;
    candidateId: string;
    request: Record<string, unknown>;
    patchResponse: ImportReviewBuildingListItem | null;
    refetched: ImportReviewBuildingListItem | null;
    verificationError?: string | null;
    referenceFields?: Record<string, unknown>;
}): void {
    if (process.env.NODE_ENV !== "development") {
        return;
    }
    console.log("[import-review direct-edit save]", {
        family: payload.family,
        candidateId: payload.candidateId,
        request: payload.request,
        patchResponse: payload.patchResponse,
        refetched: payload.refetched,
        verificationError: payload.verificationError ?? null,
        ...(payload.referenceFields ? { referenceFields: payload.referenceFields } : {}),
    });
}
