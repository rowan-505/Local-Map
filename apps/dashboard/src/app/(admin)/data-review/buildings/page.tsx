import { createImportReviewEntityRoutePage } from "@/src/features/import-review/routes/importReviewEntityRoutePage";

/** Data-review layout uses shared entity shell with sticky sidebar map. */
export default createImportReviewEntityRoutePage("buildings", { showMapPreview: true });
