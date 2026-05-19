import type { PrismaClient } from "@prisma/client";

import type { ImportReviewDataRepository } from "./import-review-data-repository.js";
import { RemoteImportReviewDataAdapter } from "./import-review-remote.adapter.js";
import { RemoteImportReviewRepositoryCore } from "./import-review-remote.repo.js";

/** Import-review always targets Supabase-style `import_review.*` tables. */
export function createImportReviewDataRepository(prisma: PrismaClient): ImportReviewDataRepository {
    return new RemoteImportReviewDataAdapter(new RemoteImportReviewRepositoryCore(prisma));
}
