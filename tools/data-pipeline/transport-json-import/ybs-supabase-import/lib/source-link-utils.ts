/**
 * Source link helpers for Phase 9 YBS Supabase import.
 *
 * Checks existing source_links before insert so we never create duplicates.
 * The unique key is (entity_type, source_name, source_kind, external_id).
 */

import type pg from "pg";

export const YBS_SOURCE_NAME = "external_ybs_app";
export const YBS_SOURCE_KIND = "visible_app_extraction";

export type SourceLinkEntityType =
    | "operator"
    | "stop"
    | "route"
    | "route_variant"
    | "route_path"
    | "route_stop"
    | "fare";

export type SourceLinkInput = {
    entityType: SourceLinkEntityType;
    entityId: number;
    externalId: string;
    importBatchId: number | null;
    confidenceScore: number | null;
    isPrimary: boolean;
    sourcePayload: Record<string, unknown>;
    sourceUrl?: string | null;
};

export type SourceLinkResult = {
    entity_type: SourceLinkEntityType;
    external_id: string;
    entity_id: number;
    source_link_id: number;
    status: "inserted" | "reused" | "realigned";
};

/**
 * Insert a source_link only when no row already exists for the unique key.
 * Returns whether the row was inserted or reused, plus the source_link id.
 */
export async function ensureSourceLink(
    client: pg.PoolClient,
    input: SourceLinkInput,
): Promise<SourceLinkResult> {
    const existing = await client.query<{ id: string; entity_id: string }>(
        `
        SELECT id::text, entity_id::text
        FROM transport.source_links
        WHERE entity_type = $1
          AND source_name = $2
          AND source_kind = $3
          AND external_id = $4
        LIMIT 1
        `,
        [input.entityType, YBS_SOURCE_NAME, YBS_SOURCE_KIND, input.externalId],
    );

    if (existing.rows[0]) {
        const existingEntityId = Number(existing.rows[0].entity_id);
        if (existingEntityId !== input.entityId) {
            await client.query(
                `
                UPDATE transport.source_links
                SET entity_id = $2
                WHERE id = $1
                `,
                [Number(existing.rows[0].id), input.entityId],
            );
            return {
                entity_type: input.entityType,
                external_id: input.externalId,
                entity_id: input.entityId,
                source_link_id: Number(existing.rows[0].id),
                status: "realigned",
            };
        }

        return {
            entity_type: input.entityType,
            external_id: input.externalId,
            entity_id: existingEntityId,
            source_link_id: Number(existing.rows[0].id),
            status: "reused",
        };
    }

    const inserted = await client.query<{ id: string }>(
        `
        INSERT INTO transport.source_links (
            entity_type, entity_id, source_name, source_kind, external_id,
            source_url, source_payload, import_batch_id, confidence_score, is_primary
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)
        RETURNING id::text
        `,
        [
            input.entityType,
            input.entityId,
            YBS_SOURCE_NAME,
            YBS_SOURCE_KIND,
            input.externalId,
            input.sourceUrl ?? null,
            JSON.stringify(input.sourcePayload ?? {}),
            input.importBatchId,
            input.confidenceScore,
            input.isPrimary,
        ],
    );

    return {
        entity_type: input.entityType,
        external_id: input.externalId,
        entity_id: input.entityId,
        source_link_id: Number(inserted.rows[0].id),
        status: "inserted",
    };
}

/**
 * Look up an entity id that a prior YBS import already linked, so a re-run can
 * reuse the same row instead of inserting a duplicate.
 */
export type SourceLinkConflictInput = {
    entityType: SourceLinkEntityType;
    externalId: string;
    plannedEntityId: number | null;
};

/**
 * Return a violation message when an existing source_link would point to a
 * different entity than the import plan expects.
 */
export async function sourceLinkConflict(
    client: pg.PoolClient,
    input: SourceLinkConflictInput,
): Promise<string | null> {
    const existing = await client.query<{ id: string; entity_id: string }>(
        `
        SELECT id::text, entity_id::text
        FROM transport.source_links
        WHERE entity_type = $1
          AND source_name = $2
          AND source_kind = $3
          AND external_id = $4
        LIMIT 1
        `,
        [input.entityType, YBS_SOURCE_NAME, YBS_SOURCE_KIND, input.externalId],
    );

    if (!existing.rows[0]) {
        return null;
    }

    const existingEntityId = Number(existing.rows[0].entity_id);
    if (input.plannedEntityId !== null && input.plannedEntityId !== existingEntityId) {
        return `source_link ${input.externalId} already maps to entity_id=${existingEntityId}, not planned ${input.plannedEntityId}.`;
    }

    return null;
}

/**
 * Return true when ensureSourceLink will reuse an existing row (idempotent).
 */
export async function sourceLinkExists(
    client: pg.PoolClient,
    entityType: SourceLinkEntityType,
    externalId: string,
): Promise<boolean> {
    const result = await client.query<{ id: string }>(
        `
        SELECT id::text
        FROM transport.source_links
        WHERE entity_type = $1
          AND source_name = $2
          AND source_kind = $3
          AND external_id = $4
        LIMIT 1
        `,
        [entityType, YBS_SOURCE_NAME, YBS_SOURCE_KIND, externalId],
    );
    return Boolean(result.rows[0]);
}

/**
 * Look up an entity id that a prior YBS import already linked, so a re-run can
 * reuse the same row instead of inserting a duplicate.
 */
export async function findLinkedEntityId(
    client: pg.PoolClient,
    entityType: SourceLinkEntityType,
    externalId: string,
): Promise<number | null> {
    const result = await client.query<{ entity_id: string }>(
        `
        SELECT entity_id::text
        FROM transport.source_links
        WHERE entity_type = $1
          AND source_name = $2
          AND source_kind = $3
          AND external_id = $4
        LIMIT 1
        `,
        [entityType, YBS_SOURCE_NAME, YBS_SOURCE_KIND, externalId],
    );

    return result.rows[0] ? Number(result.rows[0].entity_id) : null;
}

