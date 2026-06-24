import { Prisma } from "@prisma/client";

/**
 * Minimal audit logging for Transport dashboard write actions.
 *
 * Design goals (see migration 106_transport_audit_logs.sql):
 *   - record only the fields that actually changed + their old/new values
 *   - point moves capture only old/new lat/lng (never full geometry)
 *   - never persist full source_refs / normalized_data
 *   - write the audit row inside the same transaction as the mutation, so a
 *     failed/rolled-back mutation never leaves a successful-change audit row
 */

/** Actor + correlation context resolved from the authenticated request. */
export type TransportAuditContext = {
    actorUserId: bigint | null;
    requestId: string | null;
};

export type TransportAuditEntry = {
    action: string;
    entityType: string;
    entityId: bigint;
    entityPublicId: string | null;
    changedFields: string[];
    oldValues: Record<string, unknown> | null;
    newValues: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    context?: TransportAuditContext;
};

export type FieldDiff = {
    changedFields: string[];
    oldValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
};

/** Equality for scalar audit values (bigint-safe; treats null/undefined alike). */
function scalarsEqual(a: unknown, b: unknown): boolean {
    if (a === b) {
        return true;
    }
    if (a === null || a === undefined) {
        return b === null || b === undefined;
    }
    if (b === null || b === undefined) {
        return false;
    }
    if (typeof a === "bigint" || typeof b === "bigint") {
        return String(a) === String(b);
    }
    return false;
}

/**
 * Diffs the provided `fields` present in `input` against `before`, returning only
 * the fields that actually changed with their old/new values. `before` must be
 * keyed by the same field names, with FK ids pre-cast to numbers so comparisons
 * line up with the request payload.
 */
export function diffScalarFields(
    before: Record<string, unknown>,
    input: Record<string, unknown>,
    fields: readonly string[]
): FieldDiff {
    const changedFields: string[] = [];
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    for (const field of fields) {
        const next = input[field];
        if (next === undefined) {
            continue;
        }
        const prev = before[field] ?? null;
        const nextNormalized = next ?? null;
        if (scalarsEqual(prev, nextNormalized)) {
            continue;
        }
        changedFields.push(field);
        oldValues[field] = prev;
        newValues[field] = nextNormalized;
    }

    return { changedFields, oldValues, newValues };
}

/** Appends a `point` change (old/new lat/lng only) to a diff when it moved. Mutates `diff`. */
export function appendPointDiff(
    diff: FieldDiff,
    before: { lat: number | null; lng: number | null },
    next: { latitude: number; longitude: number } | undefined
): void {
    if (!next) {
        return;
    }
    if (scalarsEqual(before.lat, next.latitude) && scalarsEqual(before.lng, next.longitude)) {
        return;
    }
    diff.changedFields.push("point");
    diff.oldValues.point = { lat: before.lat, lng: before.lng };
    diff.newValues.point = { lat: next.latitude, lng: next.longitude };
}

/**
 * Picks the point-move action when the only changed field is `point`, else the
 * generic update action (mixed updates keep the point change in changed_fields).
 */
export function resolvePointAwareAction(
    updateAction: string,
    pointMoveAction: string,
    changedFields: string[]
): string {
    return changedFields.length === 1 && changedFields[0] === "point"
        ? pointMoveAction
        : updateAction;
}

/**
 * Inserts a single audit row. The caller passes a transaction client so the audit
 * row commits atomically with the mutation it describes.
 */
export async function insertTransportAuditLog(
    tx: Prisma.TransactionClient,
    entry: TransportAuditEntry
): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
        INSERT INTO transport.transport_audit_logs (
            action, entity_type, entity_id, entity_public_id,
            changed_fields, old_values, new_values,
            actor_user_id, request_id, metadata
        )
        VALUES (
            ${entry.action},
            ${entry.entityType},
            ${entry.entityId},
            ${entry.entityPublicId}::uuid,
            ${JSON.stringify(entry.changedFields)}::jsonb,
            ${entry.oldValues === null ? null : JSON.stringify(entry.oldValues)}::jsonb,
            ${entry.newValues === null ? null : JSON.stringify(entry.newValues)}::jsonb,
            ${entry.context?.actorUserId ?? null},
            ${entry.context?.requestId ?? null},
            ${entry.metadata === null ? null : JSON.stringify(entry.metadata)}::jsonb
        )
    `);
}
