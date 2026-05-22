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
    mergeImportReviewSnapshotAliases,
    importReviewScopeNormalizedSchema
);

export type ImportReviewSummaryQuery = z.infer<typeof importReviewSummaryQuerySchema>;

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
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const importReviewCandidatesListQuerySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
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
}).superRefine(refineImportReviewSnapshotBatchScope);

export const importReviewBuildingsQuerySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
    importReviewBuildingsQueryBaseInner
);

/** Same field set as buildings list except no `class_code` (not on place/road candidates). */
const importReviewPlacesRoadsQueryBaseInner = importReviewScopeObjectSchema
    .extend({
        match_status: optionalTrimmedStringSchema,
        auto_action: optionalTrimmedStringSchema,
        review_status: optionalTrimmedStringSchema,
        review_decision: optionalTrimmedStringSchema,
        q: optionalTrimmedStringSchema,
        limit: z.coerce.number().int().min(1).max(200).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort: importReviewBuildingSortSchema.default("updated_at_desc"),
        include_geometry: includeGeometryListQuerySchema.default(false),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

/** Same as buildings list filters except no `class_code` (not on place/road candidates). */
export const importReviewPlacesQuerySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
    importReviewPlacesRoadsQueryBaseInner
);

export const importReviewRoadsQuerySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
    importReviewPlacesRoadsQueryBaseInner
);

export type ImportReviewBuildingsQuery = z.infer<typeof importReviewBuildingsQuerySchema>;
export type ImportReviewPlacesQuery = z.infer<typeof importReviewPlacesQuerySchema>;
export type ImportReviewRoadsQuery = z.infer<typeof importReviewRoadsQuerySchema>;

export type ImportReviewBuildingSort = z.infer<typeof importReviewBuildingSortSchema>;

const importReviewScopedIncludeGeometryInner = importReviewScopeObjectSchema
    .extend({
        include_geometry: includeGeometryDetailQuerySchema.default(true),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

/** GET/PATCH helpers: scope + geometry flag for `/buildings/:id` */
export const importReviewScopedIncludeGeometryQuerySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
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
    mergeImportReviewSnapshotAliases,
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

/** PATCH `/buildings/:id/overrides` merges into `review_overrides`; optional audit row into `review_candidate_edits`. */
const patchOverridesBodyInner = importReviewScopeObjectSchema
    .extend({
        /** Shallow-merge patch; `{}` clears all stored overrides; null removes individual keys. */
        review_overrides: importReviewReviewOverridesPatchSchema,
        review_note: importReviewOverrideReviewNoteSchema,
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const patchImportReviewBuildingOverridesBodySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
    patchOverridesBodyInner
);

export type PatchImportReviewBuildingOverridesBody = z.infer<typeof patchImportReviewBuildingOverridesBodySchema>;

const patchCandidateOverridesBodyInner = importReviewScopeObjectSchema
    .extend({
        review_overrides: importReviewReviewOverridesPatchSchema,
        review_note: importReviewOverrideReviewNoteSchema,
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const patchImportReviewCandidateOverridesBodySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
    patchCandidateOverridesBodyInner
);

export type PatchImportReviewCandidateOverridesBody = z.infer<typeof patchImportReviewCandidateOverridesBodySchema>;

const patchRoadOverridesRoutingBodyInner = importReviewScopeObjectSchema
    .extend({
        review_overrides: importReviewReviewOverridesPatchSchema,
        review_note: importReviewOverrideReviewNoteSchema,
        routing_validation_tolerance_meters: z.coerce.number().finite().min(5).max(250).default(35),
        confirm_acknowledge_routing_warnings: z.boolean().optional().default(false),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const patchImportReviewRoadOverridesBodySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
    patchRoadOverridesRoutingBodyInner
);

export type PatchImportReviewRoadOverridesBody = z.infer<typeof patchImportReviewRoadOverridesBodySchema>;

const postImportReviewRoadValidateRoutingBodyInner = importReviewScopeObjectSchema
    .extend({
        use_review_overrides: z.boolean().optional().default(true),
        connectivity_threshold_m: z.coerce.number().finite().min(1).max(250).default(10),
        duplicate_threshold_m: z.coerce.number().finite().min(1).max(100).default(5),
        confirm_warnings: z.boolean().optional().default(false),
    })
    .superRefine(refineImportReviewSnapshotBatchScope);

export const postImportReviewRoadValidateRoutingBodySchema = z.preprocess(
    mergeImportReviewSnapshotAliases,
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
    mergeImportReviewSnapshotAliases,
    bulkDecisionBodyCoreInner
);

export type BulkImportReviewBuildingDecisionBody = z.infer<typeof bulkImportReviewBuildingDecisionBodySchema>;
