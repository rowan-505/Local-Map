import { z } from "zod";

export const FAILED_SEARCH_RESOLUTION_TYPES = [
    "alias",
    "data_fix",
    "duplicate",
    "ignored",
    "other",
] as const;

export type FailedSearchResolutionType = (typeof FAILED_SEARCH_RESOLUTION_TYPES)[number];

export const FAILED_SEARCH_SORT_FIELDS = [
    "occurrence_count",
    "last_seen_at",
    "first_seen_at",
    "query",
] as const;

export type FailedSearchSortField = (typeof FAILED_SEARCH_SORT_FIELDS)[number];

export const listFailedSearchesQuerySchema = z.object({
    q: z.string().trim().min(1).optional(),
    lang: z.enum(["my", "en", "und"]).optional(),
    resolved: z
        .enum(["true", "false"])
        .transform((value) => value === "true")
        .optional(),
    last_seen_from: z.string().datetime({ offset: true }).optional(),
    last_seen_to: z.string().datetime({ offset: true }).optional(),
    min_occurrence: z.coerce.number().int().min(1).optional(),
    sort: z.enum(FAILED_SEARCH_SORT_FIELDS).default("occurrence_count"),
    order: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type ListFailedSearchesQuery = z.infer<typeof listFailedSearchesQuerySchema>;

export const failedSearchIdParamSchema = z.object({
    id: z.string().trim().regex(/^\d+$/, "id must be a numeric failed search log id"),
});

export const updateFailedSearchBodySchema = z.discriminatedUnion("action", [
    z.object({
        action: z.literal("resolve"),
        resolution_type: z.enum(FAILED_SEARCH_RESOLUTION_TYPES),
        linked_alias_id: z
            .string()
            .trim()
            .regex(/^\d+$/, "linked_alias_id must be numeric")
            .optional(),
    }),
    z.object({
        action: z.literal("reopen"),
    }),
]);

export type UpdateFailedSearchBody = z.infer<typeof updateFailedSearchBodySchema>;
