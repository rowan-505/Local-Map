import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { FastifyReply } from "fastify";

import { sendImportReviewError } from "./import-review-error-handler.js";

describe("import-review error handler P2024", () => {
    it("maps pool timeout to 503 DB_POOL_TIMEOUT instead of candidate validation 400", () => {
        let status = 0;
        let body: unknown;
        const reply = {
            code(code: number) {
                status = code;
                return {
                    send(payload: unknown) {
                        body = payload;
                    },
                };
            },
        } as FastifyReply;

        const error = new Prisma.PrismaClientKnownRequestError("Timed out fetching connection", {
            code: "P2024",
            clientVersion: "test",
        });

        const sent = sendImportReviewError(reply, error);
        assert.equal(sent, true);
        assert.equal(status, 503);
        const payload = body as { error?: string; message?: string };
        assert.equal(payload.error, "DB_POOL_TIMEOUT");
        assert.match(payload.message ?? "", /timed out/i);
    });
});
