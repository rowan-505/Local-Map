export type CoreReviewDrawerMode = "view" | "edit";

export type CoreReviewDrawerSaveResult = {
    ok: true;
    detail: unknown;
} | {
    ok: false;
};
