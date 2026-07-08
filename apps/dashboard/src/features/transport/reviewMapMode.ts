/** Review Map interaction modes — stop move is implicit when a stop is selected. */
export type ReviewMapMode = null | "edit_path";

export function isReviewMapPathEditMode(mode: ReviewMapMode): mode is "edit_path" {
    return mode === "edit_path";
}
