/**
 * Activate non-rejected YBS bus routes for unified search (is_active = true).
 *
 * Does not change review_status. Public map/Martin overlay stays reviewed+verified.
 * Writes one transport.transport_audit_logs row per activated route.
 *
 * Usage (from repo root):
 *   npm --prefix apps/api run search:activate-ybs
 *   npm --prefix apps/api run search:activate-ybs -- --apply
 */

import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(apiRoot, "../..");
config({ path: resolve(repoRoot, ".env") });
config({ path: resolve(apiRoot, ".env"), override: true });

import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";

const APPLY = process.argv.includes("--apply");

type YbsRouteRow = {
    id: bigint;
    public_id: string;
    route_code: string;
    is_active: boolean;
    review_status: string;
};

async function main(): Promise<void> {
    const rows = await prisma.$queryRaw<YbsRouteRow[]>(Prisma.sql`
        SELECT
            r.id,
            r.public_id::text AS public_id,
            r.route_code,
            r.is_active,
            r.review_status
        FROM transport.routes r
        WHERE r.deleted_at IS NULL
          AND r.mode = 'bus'
          AND r.route_code LIKE 'YBS-%'
          AND r.review_status IS DISTINCT FROM 'rejected'
          AND r.is_active = false
        ORDER BY r.route_code, r.id
    `);

    console.log(`[activate-ybs-search-routes] ${APPLY ? "APPLY" : "DRY-RUN"}`);
    console.log(`[activate-ybs-search-routes] Inactive non-rejected YBS routes: ${rows.length}`);
    for (const row of rows.slice(0, 8)) {
        console.log(`  ${row.route_code} id=${row.id.toString()} status=${row.review_status}`);
    }
    if (rows.length > 8) {
        console.log(`  ... ${rows.length - 8} more`);
    }

    if (!APPLY) {
        console.log("[activate-ybs-search-routes] Re-run with --apply to write.");
        return;
    }

    if (rows.length === 0) {
        console.log("[activate-ybs-search-routes] Nothing to activate.");
        return;
    }

    // One statement: UPDATE + audit INSERT. Avoid Prisma interactive transactions
    // (pgbouncer drops them during a 140-row audit loop).
    const updated = await prisma.$queryRaw<Array<{ id: bigint; route_code: string }>>(Prisma.sql`
        WITH activated AS (
            UPDATE transport.routes
            SET is_active = true
            WHERE deleted_at IS NULL
              AND mode = 'bus'
              AND route_code LIKE 'YBS-%'
              AND review_status IS DISTINCT FROM 'rejected'
              AND is_active = false
            RETURNING id, public_id, route_code, review_status
        ),
        audited AS (
            INSERT INTO transport.transport_audit_logs (
                action, entity_type, entity_id, entity_public_id,
                changed_fields, old_values, new_values,
                actor_user_id, request_id, metadata
            )
            SELECT
                'route.search_activate',
                'route',
                a.id,
                a.public_id,
                '["is_active"]'::jsonb,
                '{"is_active":false}'::jsonb,
                '{"is_active":true}'::jsonb,
                NULL,
                NULL,
                jsonb_build_object(
                    'reason', 'search_index_ybs',
                    'route_code', a.route_code,
                    'review_status', a.review_status
                )
            FROM activated a
            RETURNING entity_id
        )
        SELECT a.id, a.route_code
        FROM activated a
        INNER JOIN audited x ON x.entity_id = a.id
        ORDER BY a.route_code, a.id
    `);

    console.log(`[activate-ybs-search-routes] Activated ${updated.length} YBS routes.`);
}

main()
    .catch((err) => {
        console.error("[activate-ybs-search-routes] Failed", err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
