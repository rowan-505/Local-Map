import { poiCategoryRowToFormOption } from "../../lib/poi-category/poi-category-form-option.js";
import { PlaceFormOptionsRepository } from "./place-form-options.repo.js";

export class PlaceFormOptionsService {
    constructor(private readonly placeFormOptionsRepo: PlaceFormOptionsRepository) {}

    async getPlaceFormOptions() {
        const [categories, sourceTypes, publishStatuses] = await Promise.all([
            this.placeFormOptionsRepo.listCategories(),
            this.placeFormOptionsRepo.listSourceTypes(),
            this.placeFormOptionsRepo.listPublishStatuses(),
        ]);

        return {
            categories: categories.map((category) => poiCategoryRowToFormOption(category)),
            /** Township is inferred from map location; use POST /entity-admin-area/infer or manual override UI. */
            adminAreas: [],
            sourceTypes: sourceTypes.map((sourceType) => ({
                id: sourceType.id.toString(),
                code: sourceType.code,
                name: sourceType.name,
            })),
            publishStatuses: publishStatuses.map((publishStatus) => ({
                id: publishStatus.id.toString(),
                code: publishStatus.code,
                name: publishStatus.name,
            })),
        };
    }
}
