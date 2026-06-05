import { PrismaClient } from "@prisma/client";

import { StreetsRepository } from "../src/modules/streets/streets.repo.js";

const prisma = new PrismaClient();

async function main() {
    const repo = new StreetsRepository(prisma);
    const params = {
        limit: 51,
        offset: 0,
        sortBy: "updated_at" as const,
        sortOrder: "desc" as const,
        include_deleted: false,
        status: "active" as const,
        fast_list: true,
    };

    const started = performance.now();
    const rows = await repo.listStreetsCoreReview(params);
    const ms = Math.round((performance.now() - started) * 10) / 10;
    console.log(JSON.stringify({ rowCount: rows.length, duration_ms: ms, sample: rows[0]?.canonical_name }));
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
