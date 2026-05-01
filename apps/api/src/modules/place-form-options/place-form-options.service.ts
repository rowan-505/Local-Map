import { PlaceFormOptionsRepository } from "./place-form-options.repo.js";

export class PlaceFormOptionsService {
    constructor(private readonly placeFormOptionsRepo: PlaceFormOptionsRepository) {}

    async getPlaceFormOptions() {
        const [categories, adminAreas, sourceTypes, publishStatuses] = await Promise.all([
            this.placeFormOptionsRepo.listCategories(),
            this.placeFormOptionsRepo.listAdminAreas(),
            this.placeFormOptionsRepo.listSourceTypes(),
            this.placeFormOptionsRepo.listPublishStatuses(),
        ]);

        return {
            categories: categories.map((category) => ({
                id: category.id.toString(),
                code: category.code,
                name: category.name,
            })),
            adminAreas: adminAreas.map((adminArea) => ({
                id: adminArea.id.toString(),
                canonical_name: adminArea.canonicalName,
                slug: adminArea.slug,
                admin_level_id: adminArea.adminLevelId.toString(),
            })),
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
