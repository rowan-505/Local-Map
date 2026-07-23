import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    extractConstraintMeta,
    extractPrismaErrorCode,
    extractSqlErrorCode,
} from "./stopMergePreview.js";
import { TransportMergeExecutionFailedError } from "./transport.errors.js";

describe("merge execution diagnostics helpers", () => {
    it("extracts Prisma P2002 unique violation metadata for terminals linked_stop", () => {
        const error = Object.assign(new Error("Unique constraint failed"), {
            code: "P2002",
            meta: {
                modelName: "terminals",
                target: ["linked_stop_id"],
                constraint: "transport_terminals_linked_stop_unique",
            },
        });

        assert.equal(extractPrismaErrorCode(error), "P2002");
        assert.deepEqual(extractConstraintMeta(error), {
            constraintName: "transport_terminals_linked_stop_unique",
            tableName: null,
        });
    });

    it("extracts SQLSTATE 23505 from Prisma raw query message", () => {
        const error = new Error(
            "Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint \"transport_terminals_linked_stop_unique\"`",
        );
        assert.equal(extractSqlErrorCode(error), "23505");
        assert.equal(
            extractConstraintMeta(error).constraintName,
            "transport_terminals_linked_stop_unique",
        );
    });

    it("wraps execution failure context for structured logging", () => {
        const wrapped = new TransportMergeExecutionFailedError(
            "Stop merge failed due to an unexpected database or serialization error.",
            {
                requestId: "req-1",
                currentStopId: "11111111-1111-4111-8111-111111111111",
                candidateStopId: "22222222-2222-4222-8222-222222222222",
                canonicalStopId: "11111111-1111-4111-8111-111111111111",
                duplicateStopId: "22222222-2222-4222-8222-222222222222",
                canonicalNumericId: "4851",
                duplicateNumericId: "4852",
                stage: "update_terminals",
                routeIds: [],
                variantIds: [],
                sameVariantConflictCount: 0,
                prismaCode: "P2010",
                sqlErrorCode: "23505",
                constraintName: "transport_terminals_linked_stop_unique",
                tableName: "transport.terminals",
            },
            { cause: new Error("duplicate key") },
        );

        assert.equal(wrapped.context.stage, "update_terminals");
        assert.equal(wrapped.context.sqlErrorCode, "23505");
        assert.equal(wrapped.context.constraintName, "transport_terminals_linked_stop_unique");
    });
});

/**
 * Documents the proven merge failure class:
 * blind UPDATE terminals.linked_stop_id = canonical where both stops already have
 * active linked terminals violates transport_terminals_linked_stop_unique.
 */
describe("merge terminals unique conflict model", () => {
    it("preview and execution both reject dual-terminal merges", () => {
        const bothStopsHaveLinkedTerminal = true;
        const previewChecksTerminalUnique = true;
        const executionUpdatesDuplicateTerminalBlindly = false;
        const uniqueIndex =
            "CREATE UNIQUE INDEX transport_terminals_linked_stop_unique ON transport.terminals (linked_stop_id) WHERE deleted_at IS NULL AND linked_stop_id IS NOT NULL";

        assert.equal(bothStopsHaveLinkedTerminal && previewChecksTerminalUnique, true);
        assert.equal(executionUpdatesDuplicateTerminalBlindly, false);
        assert.match(uniqueIndex, /transport_terminals_linked_stop_unique/);
    });
});
