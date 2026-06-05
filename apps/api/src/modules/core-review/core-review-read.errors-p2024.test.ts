import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import type { FastifyReply, FastifyRequest } from "fastify";

import {
    buildCoreReviewReadErrorReply,
    isPrismaPoolTimeoutError,
    replyCoreReviewReadError,
} from "./core-review-read.errors.js";

describe("core-review read error handler P2024", () => {
    it("detects Prisma pool timeout code P2024", () => {
        const error = new Prisma.PrismaClientKnownRequestError("Timed out fetching connection", {
            code: "P2024",
            clientVersion: "test",
        });
        assert.equal(isPrismaPoolTimeoutError(error), true);
        assert.equal(isPrismaPoolTimeoutError({ code: "P2002" }), false);
    });

    it("maps pool timeout to 503 DB_POOL_TIMEOUT instead of generic 500", () => {
        const error = new Prisma.PrismaClientKnownRequestError("Timed out fetching connection", {
            code: "P2024",
            clientVersion: "test",
        });

        const mapped = buildCoreReviewReadErrorReply(error);
        assert.equal(mapped.status, 503);
        assert.equal(mapped.body.ok, false);
        if (mapped.body.ok === false) {
            assert.equal(mapped.body.error, "DB_POOL_TIMEOUT");
            assert.match(mapped.body.message, /timed out/i);
        }
    });

    it("keeps unknown errors as generic 500", () => {
        const mapped = buildCoreReviewReadErrorReply(new Error("relation does not exist"));
        assert.equal(mapped.status, 500);
        assert.deepEqual(mapped.body, { message: "Unable to load core review data." });
    });

    it("replyCoreReviewReadError sends 503 for pool timeout", () => {
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

        const logs: Array<{ level: string; payload: unknown; message: string }> = [];
        const request = {
            log: {
                warn(payload: unknown, message: string) {
                    logs.push({ level: "warn", payload, message });
                },
                error(payload: unknown, message: string) {
                    logs.push({ level: "error", payload, message });
                },
            },
        } as FastifyRequest;

        const error = new Prisma.PrismaClientKnownRequestError("Timed out fetching connection", {
            code: "P2024",
            clientVersion: "test",
        });

        replyCoreReviewReadError(request, reply, error, "core-review list failed", { entity: "streets" });

        assert.equal(status, 503);
        const payload = body as { ok?: boolean; error?: string; message?: string };
        assert.equal(payload.ok, false);
        assert.equal(payload.error, "DB_POOL_TIMEOUT");
        assert.equal(logs.length, 1);
        assert.equal(logs[0]?.level, "warn");
    });
});
