import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
    const started = performance.now();
    const rows = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT
            s.id::text AS id,
            s.public_id,
            s.canonical_name,
            s.admin_area_id::text AS admin_area_id,
            s.road_class_id::text AS road_class_id,
            s.road_class,
            s.surface,
            s.is_oneway,
            s.bridge,
            s.tunnel,
            s.routing_status,
            s.deleted_at,
            s.is_active,
            s.verification_status,
            s.is_verified,
            s.created_at,
            s.updated_at
        FROM core.core_streets AS s
        WHERE s.deleted_at IS NULL
          AND s.is_active IS TRUE
        ORDER BY s.updated_at DESC NULLS LAST, s.id DESC
        LIMIT 51
    `);
    console.log({
        rows: rows.length,
        duration_ms: Math.round((performance.now() - started) * 10) / 10,
    });

    const explain = await prisma.$queryRaw<{ "QUERY PLAN": string }[]>(Prisma.sql`
        EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
        SELECT s.id
        FROM core.core_streets AS s
        WHERE s.deleted_at IS NULL
          AND s.is_active IS TRUE
        ORDER BY s.updated_at DESC NULLS LAST, s.id DESC
        LIMIT 51
    `);
    console.log(explain.map((r) => r["QUERY PLAN"]).join("\n"));
}

main()
    .finally(() => prisma.$disconnect());
