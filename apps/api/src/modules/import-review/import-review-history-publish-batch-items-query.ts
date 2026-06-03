import { z } from "zod";

/** Accepted `publish_status` / `status` filter tokens for history publish-batch items. */
export const PUBLISH_BATCH_ITEM_FILTER_VALUES = [
    "failed",
    "pending",
    "skipped",
    "promoted",
    "blocked",
    "skipped_blocked",
] as const;

export type PublishBatchItemFilterToken = (typeof PUBLISH_BATCH_ITEM_FILTER_VALUES)[number];

const KNOWN_PUBLISH_STATUS_VALUES = new Set([
    "failed",
    "pending",
    "skipped",
    "success",
    "rolled_back",
]);

export type ResolvedPublishBatchItemsQuery = {
    entity_family?: string;
    publish_status?: string;
    validation_status?: string;
    limit: number;
    offset: number;
};

export type ParsePublishBatchItemsQueryResult =
    | { success: true; data: ResolvedPublishBatchItemsQuery }
    | { success: false; error: z.ZodError };

export const PUBLISH_BATCH_ITEMS_MAX_LIMIT = 200;

const paginationSchema = {
    limit: z.coerce
        .number()
        .int()
        .min(1)
        .max(PUBLISH_BATCH_ITEMS_MAX_LIMIT)
        .optional()
        .default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
};

const rawPublishBatchItemsQuerySchema = z
    .object({
        publish_status: z.string().trim().min(1).optional(),
        /** Alias for `publish_status` (dashboard/history convenience). */
        status: z.string().trim().min(1).optional(),
        entity_family: z.string().trim().min(1).optional(),
        ...paginationSchema,
    })
    .superRefine((value, ctx) => {
        if (value.publish_status && value.status) {
            ctx.addIssue({
                code: "custom",
                message: "Use either publish_status or status, not both.",
                path: ["status"],
            });
        }
    });

export type ImportReviewHistoryPublishBatchItemsQuery = ResolvedPublishBatchItemsQuery;

export function resolvePublishBatchItemFilter(
    token: string
): Pick<ResolvedPublishBatchItemsQuery, "publish_status" | "validation_status"> | null {
    const normalized = token.trim().toLowerCase();
    switch (normalized) {
        case "failed":
            return { publish_status: "failed" };
        case "pending":
            return { publish_status: "pending" };
        case "skipped":
            return { publish_status: "skipped" };
        case "promoted":
            return { publish_status: "success" };
        case "blocked":
            return { validation_status: "blocked" };
        case "skipped_blocked":
            return { publish_status: "pending", validation_status: "blocked" };
        default:
            return null;
    }
}

export function parsePublishBatchItemsQuery(input: unknown): ParsePublishBatchItemsQueryResult {
    const parsed = rawPublishBatchItemsQuerySchema.safeParse(input);
    if (!parsed.success) {
        return parsed;
    }

    const filterToken = parsed.data.publish_status ?? parsed.data.status;
    if (!filterToken) {
        return {
            success: true,
            data: {
                entity_family: parsed.data.entity_family,
                limit: parsed.data.limit ?? 50,
                offset: parsed.data.offset ?? 0,
            },
        };
    }

    const resolved = resolvePublishBatchItemFilter(filterToken);
    if (resolved) {
        return {
            success: true,
            data: {
                ...resolved,
                entity_family: parsed.data.entity_family,
                limit: parsed.data.limit ?? 50,
                offset: parsed.data.offset ?? 0,
            },
        };
    }

    const direct = filterToken.trim().toLowerCase();
    if (KNOWN_PUBLISH_STATUS_VALUES.has(direct)) {
        return {
            success: true,
            data: {
                publish_status: direct,
                entity_family: parsed.data.entity_family,
                limit: parsed.data.limit ?? 50,
                offset: parsed.data.offset ?? 0,
            },
        };
    }

    return {
        success: false,
        error: new z.ZodError([
            {
                code: "custom",
                message: `Invalid publish item filter. Accepted: ${PUBLISH_BATCH_ITEM_FILTER_VALUES.join(", ")}.`,
                path: ["publish_status"],
            },
        ]),
    };
}

/** Zod schema used by Fastify route (coerces query then resolves filter aliases). */
export const importReviewHistoryPublishBatchItemsQuerySchema = z.preprocess(
    (input) => {
        const result = parsePublishBatchItemsQuery(input);
        if (!result.success) {
            throw result.error;
        }
        return result.data;
    },
    z.object({
        entity_family: z.string().trim().min(1).optional(),
        publish_status: z.string().trim().min(1).optional(),
        validation_status: z.string().trim().min(1).optional(),
        limit: z.number().int().min(1).max(PUBLISH_BATCH_ITEMS_MAX_LIMIT),
        offset: z.number().int().min(0),
    })
);
