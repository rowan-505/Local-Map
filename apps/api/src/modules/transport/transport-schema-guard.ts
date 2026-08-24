import type { PrismaClient } from "@prisma/client";

import { TransportSchemaUnavailableError } from "./transport.errors.js";

type SchemaState =
    | { readonly kind: "available" }
    | { readonly kind: "pending"; readonly promise: Promise<void> }
    | { readonly kind: "unavailable"; readonly retryAt: number };

const states = new WeakMap<object, SchemaState>();
const MISSING_SCHEMA_RETRY_MS = 5_000;

function isMissingTransportSchemaError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return (
        message.includes('schema "transport" does not exist') ||
        (message.includes("relation") && message.includes("does not exist"))
    );
}

/** Single-flight schema capability check shared by admin and public repositories. */
export async function assertTransportSchemaAvailable(prisma: PrismaClient): Promise<void> {
    const key = prisma as object;
    const current = states.get(key);
    if (current?.kind === "available") return;
    if (current?.kind === "pending") return current.promise;
    if (current?.kind === "unavailable" && current.retryAt > Date.now()) {
        throw new TransportSchemaUnavailableError();
    }

    const promise = (async () => {
        try {
            await prisma.$queryRaw`SELECT 1 FROM transport.routes LIMIT 1`;
            states.set(key, { kind: "available" });
        } catch (error) {
            if (isMissingTransportSchemaError(error)) {
                states.set(key, {
                    kind: "unavailable",
                    retryAt: Date.now() + MISSING_SCHEMA_RETRY_MS,
                });
                throw new TransportSchemaUnavailableError();
            }
            states.delete(key);
            throw error;
        }
    })();

    states.set(key, { kind: "pending", promise });
    return promise;
}

/** Test-only reset for one mock Prisma client. */
export function resetTransportSchemaGuardForTests(prisma: PrismaClient): void {
    states.delete(prisma as object);
}
