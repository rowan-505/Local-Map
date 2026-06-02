import { z } from "zod";

import { IMPORT_REVIEW_ENTITY_FAMILIES } from "./import-review-config.js";
import {
    importReviewReviewOverridesPatchSchema,
    type ImportReviewReviewOverridesPatch,
} from "./import-review-overrides-sanitize.js";

/**
 * Normalize `snapshot_version` query/body alias into `source_snapshot_version`
 * before scope validation (`review_batch_id` XOR snapshot).
 */
export function mergeImportReviewSnapshotAliases(input: unknown): unknown {
    if (!input || typeof input !== "object") {
        return input;
    }
    const raw = input as Record<string, unknown>;
    const out = { ...raw };

    const pick = (v: unknown): string | undefined => {
        if (typeof v !== "string") {
            return undefined;
        }
        const t = v.trim();
        return t === "" ? undefined : t;
    };

    const merged = pick(out.source_snapshot_version) ?? pick(out.snapshot_version);

    delete out.snapshot_version;

    if (merged) {
        out.source_snapshot_version = merged;
    } else if ("source_snapshot_version" in out && out.source_snapshot_version === "") {
        delete out.source_snapshot_version;
    }

    return out;
}

function parseOptionalReviewBatchId(value: unknown): bigint | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === "string") {
        const t = value.trim();
        if (t === "" || !/^\d+$/.test(t)) {
            return undefined;
        }
        return BigInt(t);
    }
    return undefined;
}

/** When both scope keys are present, prefer review_batch_id (drop snapshot/latest). */
export function preferImportReviewBatchScope(input: unknown): unknown {
    if (!input || typeof input !== "object") {
        return input;
    }

    const raw = input as Record<string, unknown>;
    if (parseOptionalReviewBatchId(raw.review_batch_id) === undefined) {
        return input;
    }

    const out = { ...raw };
    delete out.source_snapshot_version;
    delete out.latest;
    return out;
}

/** Merge snapshot alias, then prefer review_batch_id when both scope keys are sent. */
export function preprocessImportReviewScopeQuery(input: unknown): unknown {
    return preferImportReviewBatchScope(mergeImportReviewSnapshotAliases(input));
}

/** Remote import_review scope: exactly one of source_snapshot_version or review_batch_id. */
export function refineImportReviewSnapshotBatchScope<
    T extends {
        source_snapshot_version?: string | undefined;
        review_batch_id?: bigint | undefined;
    },
>(data: T, ctx: z.RefinementCtx): void {
    const hasBatch = data.review_batch_id !== undefined;
    const snap = data.source_snapshot_version?.trim();
    const hasSnap = !!(snap && snap.length > 0);

    if (hasSnap === hasBatch) {
        ctx.addIssue({
            code: "custom",
            message:
                "Provide exactly one of source_snapshot_version (alias: snapshot_version) or review_batch_id",
            path: hasSnap ? ["review_batch_id"] : ["source_snapshot_version"],
        });
    }
}

const optionalTrimmedStringSchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? undefined : trimmed;
    }
    return value;
}, z.string().min(1).optional());

const optionalReviewBatchIdSchema = z.preprocess((value): bigint | undefined => {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }
    if (typeof value === "bigint") {
        return value;
    }
    if (typeof value === "number" && Number.isInteger(value)) {
        return BigInt(value);
    }
    if (typeof value === "string") {
        const t = value.trim();
        if (t === "") {
            return undefined;
        }
        if (/^\d+$/.test(t)) {
            return BigInt(t);
        }
    }
    return undefined;
}, z.bigint().optional());

const optionalLatestQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return false;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") {
            return true;
        }
        if (normalized === "false" || normalized === "0") {
            return false;
        }
    }
    if (typeof value === "number" && value === 1) {
        return true;
    }
    return value;
}, z.boolean().optional().default(false));

const importReviewScopeObjectSchema = z.object({
    source_snapshot_version: optionalTrimmedStringSchema,
    review_batch_id: optionalReviewBatchIdSchema,
    latest: optionalLatestQuerySchema,
});

export const importReviewScopeNormalizedSchema =
    importReviewScopeObjectSchema.superRefine(refineImportReviewSnapshotBatchScope);

/** Query string for GET /api/import-review/summary */
export const importReviewSummaryQuerySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    importReviewScopeNormalizedSchema
);

export type ImportReviewSummaryQuery = z.infer<typeof importReviewSummaryQuerySchema>;

/** Query string for GET /api/import-review/batches */
export const importReviewBatchesListQuerySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
    z.object({
        source_snapshot_version: z.preprocess((value) => {
            if (typeof value !== "string") {
                return value;
            }
            const trimmed = value.trim();
            return trimmed === "" ? undefined : trimmed;
        }, z.string().min(1)),
    })
);

export type ImportReviewBatchesListQuery = z.infer<typeof importReviewBatchesListQuerySchema>;

export type ImportReviewScopeNormalized = z.infer<typeof importReviewScopeNormalizedSchema>;

export const importReviewBuildingSortSchema = z.enum([
    "updated_at_desc",
    "updated_at_asc",
    "created_at_desc",
    "created_at_asc",
    "id_desc",
    "id_asc",
    "confidence_score_desc",
    "confidence_score_asc",
    "canonical_name_asc",
    "canonical_name_desc",
    "external_id_asc",
    "external_id_desc",
]);

const includeGeometryDetailQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return true;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") {
            return true;
        }
        if (normalized === "false" || normalized === "0") {
            return false;
        }
    }
    return value;
}, z.boolean());

const includeGeometryListQuerySchema = z.preprocess((value) => {
    if (value === undefined || value === null || value === "") {
        return false;
    }
    if (typeof value === "boolean") {
        return value;
    }
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        if (normalized === "true" || normalized === "1") {
            return true;
        }
        if (normalized === "false" || normalized === "0") {
            return false;
        }
    }
    return value;
}, z.boolean());

/** @deprecated use includeGeometryListQuerySchema or includeGeometryDetailQuerySchema */
const includeGeometryQuerySchema = includeGeometryListQuerySchema;

/** When false, list skips COUNT(*) — use `has_more` and cache `total` from the first page. */
const includeTotalListQuerySchema = z
    .preprocess((v) => {
        if (v === undefined) {
            return false;
        }
        return !(v === false || v === "false" || v === "0" || v === 0);
    }, z.boolean())
    .default(false);

export const importReviewEntityFamilyParamSchema = z.enum(IMPORT_REVIEW_ENTITY_FAMILIES);

export type ImportReviewEntityFamilyParam = z.infer<typeof importReviewEntityFamilyParamSchema>;

const importReviewCandidatesListQueryBaseInner = importReviewScopeObjectSchema
    .extend({
        match_status: optionalTrimmedStringSchema,
        auto_action: optionalTrimmedStringSchema,
        review_status: optionalTrimmedStringSchema,
        review_decision: optionalTrimmedStringSchema,
        class_code: optionalTrimmedStringSchema,
        promotion_status: optionalTrimmedStringSchema,
        include_promoted: z
            .preprocess((v) => v === true || v === "true" || v === "1" || v === 1, z.boolean())
            .optional()
            .default(false),
        q: optionalTrimmedStringSchema,
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort: importReviewBuildingSortSchema.default("updated_at_desc"),
        include_geometry: includeGeometryListQuerySchema.default(false),
        include_total: includeTotalListQuerySchema,
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const importReviewCandidatesListQuerySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    importReviewCandidatesListQueryBaseInner
);

export type ImportReviewCandidatesListQuery = z.infer<typeof importReviewCandidatesListQuerySchema>;

const importReviewBuildingsQueryBaseInner = importReviewScopeObjectSchema.extend({
    match_status: optionalTrimmedStringSchema,
    auto_action: optionalTrimmedStringSchema,
    /** Use literal `__unreviewed__` for rows with NULL/empty review_status (see GET /buildings/filter-options). */
    review_status: optionalTrimmedStringSchema,
    /** Use literal `__unreviewed__` for rows with NULL/empty review_decision. */
    review_decision: optionalTrimmedStringSchema,
    class_code: optionalTrimmedStringSchema,
    /** Distinct via filter-options; literal `__unreviewed__` for NULL/empty promotion_status rows. */
    promotion_status: optionalTrimmedStringSchema,
    include_promoted: z
        .preprocess((v) => v === true || v === "true" || v === "1" || v === 1, z.boolean())
        .optional()
        .default(false),
    q: optionalTrimmedStringSchema,
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    sort: importReviewBuildingSortSchema.default("updated_at_desc"),
    include_geometry: includeGeometryListQuerySchema.default(false),
    include_total: includeTotalListQuerySchema,
}).superRefine(refineImportReviewSnapshotBatchScope);

export const importReviewBuildingsQuerySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    importReviewBuildingsQueryBaseInner
);

/** Same field set as buildings list except no `class_code` on place candidates. */
const importReviewPlacesQueryBaseInner = importReviewScopeObjectSchema
    .extend({
        match_status: optionalTrimmedStringSchema,
        auto_action: optionalTrimmedStringSchema,
        review_status: optionalTrimmedStringSchema,
        review_decision: optionalTrimmedStringSchema,
        promotion_status: optionalTrimmedStringSchema,
        include_promoted: z
            .preprocess((v) => v === true || v === "true" || v === "1" || v === 1, z.boolean())
            .optional()
            .default(false),
        q: optionalTrimmedStringSchema,
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort: importReviewBuildingSortSchema.default("updated_at_desc"),
        include_geometry: includeGeometryListQuerySchema.default(false),
        include_total: includeTotalListQuerySchema,
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

/** Roads list adds optional `class_code` (road class filter). */
const importReviewRoadsQueryBaseInner = importReviewPlacesQueryBaseInner.extend({
    class_code: optionalTrimmedStringSchema,
});

/** Same as buildings list filters except no `class_code` (not on place candidates). */
export const importReviewPlacesQuerySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    importReviewPlacesQueryBaseInner
);

export const importReviewRoadsQuerySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    importReviewRoadsQueryBaseInner
);

export type ImportReviewBuildingsQuery = z.infer<typeof importReviewBuildingsQuerySchema>;
export type ImportReviewPlacesQuery = z.infer<typeof importReviewPlacesQuerySchema>;
export type ImportReviewRoadsQuery = z.infer<typeof importReviewRoadsQuerySchema>;

export const importReviewRoadDryRunSummaryQuerySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    importReviewScopeObjectSchema.superRefine(refineImportReviewSnapshotBatchScope)
);

export type ImportReviewRoadDryRunSummaryQuery = z.infer<
    typeof importReviewRoadDryRunSummaryQuerySchema
>;

export type ImportReviewBuildingSort = z.infer<typeof importReviewBuildingSortSchema>;

const importReviewScopedIncludeGeometryInner = importReviewScopeObjectSchema
    .extend({
        include_geometry: includeGeometryDetailQuerySchema.default(true),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

/** GET/PATCH helpers: scope + geometry flag for `/buildings/:id` */
export const importReviewScopedIncludeGeometryQuerySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    importReviewScopedIncludeGeometryInner
);

export type ImportReviewScopedIncludeGeometryQuery = z.infer<typeof importReviewScopedIncludeGeometryQuerySchema>;

export const importReviewDecisionValues = [
    "approved",
    "rejected",
    "needs_more_review",
    "ignored",
    "merged",
] as const;

export type ImportReviewDecisionValue = (typeof importReviewDecisionValues)[number];

const patchDecisionBodyInner = importReviewScopeObjectSchema
    .extend({
        review_decision: z.enum(importReviewDecisionValues),
        review_note: z.preprocess((value) => {
            if (value === undefined) {
                return undefined;
            }
            if (value === null) {
                return null;
            }
            if (typeof value === "string") {
                const trimmed = value.trim();
                return trimmed === "" ? null : trimmed;
            }
            return value;
        }, z.union([z.string().max(20_000), z.null()]).optional()),
        force: z.boolean().optional().default(false),
        confirm_duplicate_reviewed: z.boolean().optional().default(false),
        /** Roads only: `match_status=matched_auto_update` approve requires this or `force`. */
        confirm_matched_auto_update: z.boolean().optional().default(false),
        /**
         * Roads only: when approving, require this or `force` if persisted `validation_warnings` is non-empty from the last routing check.
         */
        confirm_routing_warnings: z.boolean().optional().default(false),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const patchImportReviewBuildingDecisionBodySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    patchDecisionBodyInner
);

export type PatchImportReviewBuildingDecisionBody = z.infer<typeof patchImportReviewBuildingDecisionBodySchema>;

/** Alias: same body for place/road PATCH decision endpoints. */
export type PatchImportReviewCandidateDecisionBody = PatchImportReviewBuildingDecisionBody;

export type { ImportReviewReviewOverridesPatch };

/** @deprecated Use ImportReviewReviewOverridesPatch. */
export type ImportReviewBuildingOverridesLeaf = ImportReviewReviewOverridesPatch;

/** @deprecated Use ImportReviewReviewOverridesPatch. */
export type ImportReviewCandidateOverridesLeaf = ImportReviewReviewOverridesPatch;

const importReviewOverrideReviewNoteSchema = z.preprocess((value) => {
    if (value === undefined) {
        return undefined;
    }
    if (value === null) {
        return null;
    }
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed === "" ? null : trimmed;
    }
    return value;
}, z.union([z.string().max(20_000), z.null()]).optional());

/** PATCH `/buildings/:id/overrides` — deprecated shim; writes typed columns via `fields`. */
const patchOverridesBodyInner = importReviewScopeObjectSchema
    .extend({
        /** Shallow field patch; null removes a column value; {} is a no-op field patch. */
        fields: importReviewReviewOverridesPatchSchema,
        review_note: importReviewOverrideReviewNoteSchema,
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const patchImportReviewBuildingOverridesBodySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    patchOverridesBodyInner
);

export type PatchImportReviewBuildingOverridesBody = z.infer<typeof patchImportReviewBuildingOverridesBodySchema>;

const patchCandidateOverridesBodyInner = importReviewScopeObjectSchema
    .extend({
        fields: importReviewReviewOverridesPatchSchema,
        review_note: importReviewOverrideReviewNoteSchema,
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const patchImportReviewCandidateOverridesBodySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    patchCandidateOverridesBodyInner
);

export type PatchImportReviewCandidateOverridesBody = z.infer<typeof patchImportReviewCandidateOverridesBodySchema>;

const patchCandidateColumnsBodyInner = importReviewScopeObjectSchema
    .extend({
        fields: importReviewReviewOverridesPatchSchema,
        review_note: importReviewOverrideReviewNoteSchema,
        routing_validation_tolerance_meters: z.coerce.number().finite().min(5).max(250).optional(),
        confirm_acknowledge_routing_warnings: z.boolean().optional(),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const patchImportReviewCandidateColumnsBodySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    patchCandidateColumnsBodyInner
);

export type PatchImportReviewCandidateColumnsBody = z.infer<typeof patchImportReviewCandidateColumnsBodySchema>;

const patchRoadOverridesRoutingBodyInner = importReviewScopeObjectSchema
    .extend({
        fields: importReviewReviewOverridesPatchSchema,
        review_note: importReviewOverrideReviewNoteSchema,
        routing_validation_tolerance_meters: z.coerce.number().finite().min(5).max(250).default(35),
        confirm_acknowledge_routing_warnings: z.boolean().optional().default(false),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const patchImportReviewRoadOverridesBodySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    patchRoadOverridesRoutingBodyInner
);

export type PatchImportReviewRoadOverridesBody = z.infer<typeof patchImportReviewRoadOverridesBodySchema>;

const postImportReviewRoadValidateRoutingBodyInner = importReviewScopeObjectSchema
    .extend({
        connectivity_threshold_m: z.coerce.number().finite().min(1).max(250).default(10),
        duplicate_threshold_m: z.coerce.number().finite().min(1).max(100).default(5),
        confirm_warnings: z.boolean().optional().default(false),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const postImportReviewRoadValidateRoutingBodySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    postImportReviewRoadValidateRoutingBodyInner
);

export type PostImportReviewRoadValidateRoutingBody = z.infer<typeof postImportReviewRoadValidateRoutingBodySchema>;

export const importReviewBuildingIdParamsSchema = z.object({
    id: z
        .string({ message: "id is required" })
        .regex(/^\d+$/, { message: "id must be a non-negative integer string" })
        .transform((s) => BigInt(s)),
});

export const importReviewFamilyCandidateParamsSchema = z.object({
    family: importReviewEntityFamilyParamSchema,
    id: z
        .string({ message: "id is required" })
        .regex(/^\d+$/, { message: "id must be a non-negative integer string" })
        .transform((s) => BigInt(s)),
});

export type ImportReviewFamilyCandidateParams = z.infer<typeof importReviewFamilyCandidateParamsSchema>;

export const importReviewBulkFiltersSchema = z
    .object({
        match_status: z.string().min(1).optional(),
        auto_action: z.string().min(1).optional(),
        review_decision: z.union([z.string().min(1), z.null()]).optional(),
    })
    .strict();

export type ImportReviewBulkFilters = z.infer<typeof importReviewBulkFiltersSchema>;

const bulkDecisionBodyCoreInner = importReviewScopeObjectSchema
    .extend({
        review_decision: z.enum(importReviewDecisionValues),
        review_note: z.preprocess((value) => {
            if (value === undefined) {
                return undefined;
            }
            if (value === null) {
                return null;
            }
            if (typeof value === "string") {
                const trimmed = value.trim();
                return trimmed === "" ? null : trimmed;
            }
            return value;
        }, z.union([z.string().max(20_000), z.null()]).optional()),
        force: z.boolean().optional().default(false),
        dry_run: z.boolean().optional().default(false),
        ids: z.array(z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])).max(10_000).optional(),
        filters: importReviewBulkFiltersSchema.optional(),
    })
    .superRefine(refineImportReviewSnapshotBatchScope)
    .superRefine((data, ctx) => {
        if (data.ids !== undefined && data.ids.length === 0) {
            ctx.addIssue({
                code: "custom",
                message: "ids must be non-empty when provided",
                path: ["ids"],
            });
        }

        const hasIds = data.ids !== undefined && data.ids.length > 0;
        const f = data.filters;
        const hasFilters =
            f !== undefined &&
            (f.match_status !== undefined || f.auto_action !== undefined || f.review_decision !== undefined);

        if (hasIds === hasFilters) {
            ctx.addIssue({
                code: "custom",
                message: "Provide exactly one of ids or filters (with at least one filter field)",
                path: hasIds ? ["filters"] : ["ids"],
            });
        }
    })
    .transform((data) => {
        const ids =
            data.ids === undefined
                ? undefined
                : [...new Set(data.ids.map((x) => (typeof x === "string" ? BigInt(x) : BigInt(x))))];
        return {
            ...data,
            ids,
        };
    });

export const bulkImportReviewBuildingDecisionBodySchema = z.preprocess(
    preprocessImportReviewScopeQuery,
    bulkDecisionBodyCoreInner
);

export type BulkImportReviewBuildingDecisionBody = z.infer<typeof bulkImportReviewBuildingDecisionBodySchema>;
