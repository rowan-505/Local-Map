import type { PrismaClient } from "@prisma/client";

let cachedHasValidationControlColumns: boolean | null = null;

/** Whether migration 085 / import-review 011 columns exist on system_publish_batches. */
export async function hasPublishBatchValidationControlColumns(
    prisma: PrismaClient
): Promise<boolean> {
    if (cachedHasValidationControlColumns !== null) {
        return cachedHasValidationControlColumns;
    }
    const rows = await prisma.$queryRaw<{ present: boolean }[]>`
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'system'
              AND table_name = 'system_publish_batches'
              AND column_name = 'validation_heartbeat_at'
        ) AS present
    `;
    cachedHasValidationControlColumns = rows[0]?.present === true;
    return cachedHasValidationControlColumns;
}

/** Test-only: reset column detection cache between cases. */
export function resetPublishBatchValidationControlColumnsCache(): void {
    cachedHasValidationControlColumns = null;
}
