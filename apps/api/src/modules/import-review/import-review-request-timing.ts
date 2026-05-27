import type { FastifyInstance, FastifyRequest } from "fastify";

type ImportReviewRequestMeta = {
    startedAt: number;
};

type TimedRequest = FastifyRequest & {
    importReviewRequestMeta?: ImportReviewRequestMeta;
};

function pathWithoutQuery(url: string): string {
    return url.split("?")[0] ?? url;
}

function isImportReviewPluginRequest(url: string): boolean {
    return pathWithoutQuery(url).length > 0;
}

function sanitizeQuery(query: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...query };
    delete out["x-import-review-admin-token"];
    return out;
}

function parseFamilyFromPath(path: string): string | undefined {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) {
        return undefined;
    }
    const first = parts[0];
    if (first === "options" || first === "summary" || first === "promotion") {
        return undefined;
    }
    return first;
}

function parseListMetrics(payload: string): { itemCount?: number; total?: number; hasMore?: boolean } {
    try {
        const body = JSON.parse(payload) as Record<string, unknown>;
        const metrics: { itemCount?: number; total?: number; hasMore?: boolean } = {};
        if (Array.isArray(body.items)) {
            metrics.itemCount = body.items.length;
        }
        if (typeof body.total === "number") {
            metrics.total = body.total;
        }
        if (typeof body.has_more === "boolean") {
            metrics.hasMore = body.has_more;
        }
        if (body.id !== undefined && body.items === undefined) {
            metrics.itemCount = 1;
        }
        return metrics;
    } catch {
        return {};
    }
}

export function registerImportReviewRequestLogging(app: FastifyInstance): void {
    if (process.env.NODE_ENV === "production") {
        return;
    }

    app.addHook("onRequest", async (request) => {
        if (!isImportReviewPluginRequest(request.url)) {
            return;
        }
        (request as TimedRequest).importReviewRequestMeta = { startedAt: Date.now() };
    });

    app.addHook("onSend", async (request, reply, payload) => {
        if (!isImportReviewPluginRequest(request.url)) {
            return payload;
        }

        const meta = (request as TimedRequest).importReviewRequestMeta;
        const durationMs = meta ? Date.now() - meta.startedAt : null;
        const path = pathWithoutQuery(request.url);
        const query = sanitizeQuery((request.query ?? {}) as Record<string, unknown>);

        let itemCount: number | undefined;
        let total: number | undefined;
        let hasMore: boolean | undefined;

        const contentType = reply.getHeader("content-type");
        if (typeof payload === "string" && String(contentType).includes("application/json")) {
            const metrics = parseListMetrics(payload);
            itemCount = metrics.itemCount;
            total = metrics.total;
            hasMore = metrics.hasMore;
        }

        request.log.info(
            {
                endpoint: path,
                family: parseFamilyFromPath(path),
                review_batch_id: query.review_batch_id,
                method: request.method,
                statusCode: reply.statusCode,
                durationMs,
                itemCount,
                total,
                hasMore,
                include_geometry: query.include_geometry,
                include_total: query.include_total,
            },
            "[import-review] request"
        );

        return payload;
    });
}
