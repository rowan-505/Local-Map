import type { FastifySchema } from "fastify";

import {
    Tags,
    badRequestSchema,
    bearerAuth,
    forbiddenSchema,
    messageSchema,
} from "../../lib/openapi/common.js";
import { SEARCH_ANALYTICS_PERIODS } from "./search-analytics-admin.schema.js";

const summarySchema = {
    type: "object",
    required: [
        "total_searches",
        "zero_result_count",
        "zero_result_rate",
        "searches_with_click",
        "click_through_rate",
        "no_click_rate",
        "latency_p50_ms",
        "latency_p95_ms",
    ],
    properties: {
        total_searches: { type: "integer" },
        zero_result_count: { type: "integer" },
        zero_result_rate: { type: "number" },
        searches_with_click: { type: "integer" },
        click_through_rate: { type: "number" },
        no_click_rate: { type: "number" },
        latency_p50_ms: { type: "integer", nullable: true },
        latency_p95_ms: { type: "integer", nullable: true },
    },
    additionalProperties: false,
} as const;

export const getSearchAnalyticsDashboardSchema: FastifySchema = {
    tags: [Tags.Search, Tags.Dashboard],
    summary: "Aggregated public search analytics dashboard",
    security: bearerAuth,
    querystring: {
        type: "object",
        properties: {
            period: { type: "string", enum: [...SEARCH_ANALYTICS_PERIODS], default: "7d" },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
        },
        additionalProperties: false,
    },
    response: {
        200: {
            type: "object",
            required: [
                "range",
                "summary",
                "timeseries",
                "top_searches",
                "top_failed_searches",
                "trending_queries",
                "top_clicked_entities",
                "by_language",
                "by_category",
            ],
            properties: {
                range: {
                    type: "object",
                    required: [
                        "period",
                        "from",
                        "to",
                        "previous_from",
                        "previous_to",
                        "timeseries_bucket",
                    ],
                    properties: {
                        period: { type: "string" },
                        from: { type: "string", format: "date-time" },
                        to: { type: "string", format: "date-time" },
                        previous_from: { type: "string", format: "date-time" },
                        previous_to: { type: "string", format: "date-time" },
                        timeseries_bucket: { type: "string", enum: ["hour", "day"] },
                    },
                    additionalProperties: false,
                },
                summary: summarySchema,
                timeseries: {
                    type: "array",
                    items: {
                        type: "object",
                        required: [
                            "bucket",
                            "searches",
                            "zero_result_rate",
                            "latency_p50_ms",
                            "latency_p95_ms",
                            "click_count",
                        ],
                        properties: {
                            bucket: { type: "string", format: "date-time" },
                            searches: { type: "integer" },
                            zero_result_rate: { type: "number" },
                            latency_p50_ms: { type: "integer", nullable: true },
                            latency_p95_ms: { type: "integer", nullable: true },
                            click_count: { type: "integer" },
                        },
                        additionalProperties: false,
                    },
                },
                top_searches: { type: "array", items: { type: "object" } },
                top_failed_searches: { type: "array", items: { type: "object" } },
                trending_queries: { type: "array", items: { type: "object" } },
                top_clicked_entities: { type: "array", items: { type: "object" } },
                by_language: { type: "array", items: { type: "object" } },
                by_category: { type: "array", items: { type: "object" } },
            },
            additionalProperties: false,
        },
        400: badRequestSchema,
        401: messageSchema,
        403: forbiddenSchema,
    },
};
