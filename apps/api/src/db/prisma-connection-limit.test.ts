import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
    applyPrismaConnectionLimit,
    resolveEffectivePrismaConnectionLimit,
    resolvePrismaConnectionLimitValue,
} from "./prisma.js";

const ORIGINAL_LIMIT = process.env.PRISMA_CONNECTION_LIMIT;

afterEach(() => {
    if (ORIGINAL_LIMIT === undefined) {
        delete process.env.PRISMA_CONNECTION_LIMIT;
    } else {
        process.env.PRISMA_CONNECTION_LIMIT = ORIGINAL_LIMIT;
    }
});

describe("resolvePrismaConnectionLimitValue", () => {
    it("defaults to 1 when unset", () => {
        delete process.env.PRISMA_CONNECTION_LIMIT;
        assert.equal(resolvePrismaConnectionLimitValue(), "1");
    });

    it("uses PRISMA_CONNECTION_LIMIT when set", () => {
        process.env.PRISMA_CONNECTION_LIMIT = "3";
        assert.equal(resolvePrismaConnectionLimitValue(), "3");
    });

    it("treats blank env as default 1", () => {
        process.env.PRISMA_CONNECTION_LIMIT = "  ";
        assert.equal(resolvePrismaConnectionLimitValue(), "1");
    });
});

describe("applyPrismaConnectionLimit", () => {
    it("appends connection_limit from env when URL has none", () => {
        process.env.PRISMA_CONNECTION_LIMIT = "3";
        const result = applyPrismaConnectionLimit(
            "postgresql://user:pass@db.example:6543/postgres?pgbouncer=true",
        );
        assert.ok(result);
        const url = new URL(result!);
        assert.equal(url.searchParams.get("connection_limit"), "3");
        assert.equal(url.searchParams.get("pgbouncer"), "true");
    });

    it("preserves an existing connection_limit on the URL", () => {
        process.env.PRISMA_CONNECTION_LIMIT = "3";
        const result = applyPrismaConnectionLimit(
            "postgresql://user:pass@db.example:6543/postgres?connection_limit=1",
        );
        assert.ok(result);
        assert.equal(new URL(result!).searchParams.get("connection_limit"), "1");
    });

    it("returns undefined for empty input", () => {
        assert.equal(applyPrismaConnectionLimit(undefined), undefined);
        assert.equal(applyPrismaConnectionLimit("  "), undefined);
    });
});

describe("resolveEffectivePrismaConnectionLimit", () => {
    it("prefers connection_limit already on the URL", () => {
        process.env.PRISMA_CONNECTION_LIMIT = "3";
        assert.equal(
            resolveEffectivePrismaConnectionLimit(
                "postgresql://u:p@h/db?connection_limit=7",
            ),
            "7",
        );
    });

    it("falls back to env/default when URL has no limit", () => {
        process.env.PRISMA_CONNECTION_LIMIT = "3";
        assert.equal(
            resolveEffectivePrismaConnectionLimit("postgresql://u:p@h/db"),
            "3",
        );
    });
});
