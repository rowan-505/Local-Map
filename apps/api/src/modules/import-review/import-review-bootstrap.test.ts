import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { withTimeout } from "./import-review-bootstrap.js";

const delay = <T>(ms: number, value: T): Promise<T> =>
    new Promise((resolve) => setTimeout(() => resolve(value), ms));

describe("withTimeout", () => {
    it("resolves when the promise settles before the timeout", async () => {
        const result = await withTimeout(delay(10, "ok"), 200, "test");
        assert.equal(result, "ok");
    });

    it("rejects with a labelled timeout error when the promise is too slow", async () => {
        await assert.rejects(
            withTimeout(delay(200, "late"), 20, "[api] import-review DB bootstrap"),
            (error: unknown) => {
                assert.ok(error instanceof Error);
                assert.match(error.message, /import-review DB bootstrap timed out after 20ms/);
                return true;
            }
        );
    });

    it("propagates the underlying rejection (not a timeout) when it fails fast", async () => {
        const boom = Promise.reject(new Error("connection refused"));
        await assert.rejects(withTimeout(boom, 200, "test"), /connection refused/);
    });
});
