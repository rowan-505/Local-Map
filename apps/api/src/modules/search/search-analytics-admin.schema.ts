import { z } from "zod";

export const SEARCH_ANALYTICS_PERIODS = ["today", "7d", "30d", "custom"] as const;

export type SearchAnalyticsPeriod = (typeof SEARCH_ANALYTICS_PERIODS)[number];

export const searchAnalyticsQuerySchema = z
    .object({
        period: z.enum(SEARCH_ANALYTICS_PERIODS).default("7d"),
        from: z.string().datetime({ offset: true }).optional(),
        to: z.string().datetime({ offset: true }).optional(),
    })
    .superRefine((value, ctx) => {
        if (value.period !== "custom") {
            return;
        }
        if (!value.from || !value.to) {
            ctx.addIssue({
                code: "custom",
                message: "from and to are required when period=custom",
                path: ["from"],
            });
            return;
        }
        if (new Date(value.from) >= new Date(value.to)) {
            ctx.addIssue({
                code: "custom",
                message: "from must be before to",
                path: ["from"],
            });
        }
    });

export type SearchAnalyticsQuery = z.infer<typeof searchAnalyticsQuerySchema>;

export type ResolvedSearchAnalyticsRange = {
    period: SearchAnalyticsPeriod;
    from: Date;
    to: Date;
    previousFrom: Date;
    previousTo: Date;
    timeseriesBucket: "hour" | "day";
};

export function resolveSearchAnalyticsRange(query: SearchAnalyticsQuery): ResolvedSearchAnalyticsRange {
    const now = new Date();
    let from: Date;
    let to: Date = now;

    switch (query.period) {
        case "today": {
            from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
            break;
        }
        case "30d": {
            from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        }
        case "custom": {
            from = new Date(query.from as string);
            to = new Date(query.to as string);
            break;
        }
        case "7d":
        default: {
            from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
        }
    }

    const durationMs = Math.max(to.getTime() - from.getTime(), 60_000);
    const previousTo = new Date(from.getTime());
    const previousFrom = new Date(from.getTime() - durationMs);
    const timeseriesBucket =
        query.period === "today" || durationMs <= 2 * 24 * 60 * 60 * 1000 ? "hour" : "day";

    return {
        period: query.period,
        from,
        to,
        previousFrom,
        previousTo,
        timeseriesBucket,
    };
}
