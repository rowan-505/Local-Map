import type { FastifyInstance, FastifyRequest } from "fastify";

type RoadsRequestMeta = {
    startedAt: number;
};

type RoadsRequest = FastifyRequest & {
    roadsRequestMeta?: RoadsRequestMeta;
};

function roadsPath(url: string): string {
    return url.split("?")[0] ?? url;
}

/** Matches `/roads` and `/roads/*` within the import-review plugin. */
function isImportReviewRoadsRequest(url: string): boolean {
    const path = roadsPath(url);
    return path === "/roads" || path.startsWith("/roads/");
}

function sanitizeQuery(query: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = { ...query };
    delete out["x-import-review-admin-token"];
    return out;
}

function parseListMetrics(payload: string): { itemCount?: number; total?: number } {
    try {
        const body = JSON.parse(payload) as Record<string, unknown>;
        const metrics: { itemCount?: number; total?: number } = {};

        if (Array.isArray(body.items)) {
            metrics.itemCount = body.items.length;
        }
        if (typeof body.total === "number") {
            metrics.total = body.total;
        } else if (body.id !== undefined && body.items === undefined) {
            metrics.itemCount = 1;
        }

        return metrics;
    } catch {
        return {};
    }
}

export function registerImportReviewRoadsRequestLogging(app: FastifyInstance): void {
    app.addHook("onRequest", async (request) => {
        if (!isImportReviewRoadsRequest(request.url)) {
            return;
        }
        (request as RoadsRequest).roadsRequestMeta = { startedAt: Date.now() };
    });

    app.addHook("onSend", async (request, reply, payload) => {
        if (!isImportReviewRoadsRequest(request.url)) {
            return payload;
        }

        const meta = (request as RoadsRequest).roadsRequestMeta;
        const durationMs = meta ? Date.now() - meta.startedAt : null;

        let itemCount: number | undefined;
        let total: number | undefined;

        const contentType = reply.getHeader("content-type");
        if (typeof payload === "string" && String(contentType).includes("application/json")) {
            const metrics = parseListMetrics(payload);
            itemCount = metrics.itemCount;
            total = metrics.total;
        }

        request.log.info(
            {
                method: request.method,
                url: roadsPath(request.url),
                query: sanitizeQuery((request.query ?? {}) as Record<string, unknown>),
                statusCode: reply.statusCode,
                durationMs,
                itemCount,
                total,
            },
            "import-review roads request"
        );

        return payload;
    });
}
