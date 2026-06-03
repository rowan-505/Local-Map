export const PLACE_CATEGORY_NOT_FOUND_MESSAGE =
    "category_id does not exist in ref.ref_poi_categories";

export function placeCategoryValidationError(categoryId?: bigint | string | null): string {
    if (categoryId == null) {
        return PLACE_CATEGORY_NOT_FOUND_MESSAGE;
    }
    return `${PLACE_CATEGORY_NOT_FOUND_MESSAGE} (id=${categoryId.toString()})`;
}
