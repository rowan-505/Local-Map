import { PublicMapRepository, type PublicPlaceRow } from "./public-map.repo.js";

export class PublicPlaceNotFoundError extends Error {
    constructor(message = "Public place not found") {
        super(message);
        this.name = "PublicPlaceNotFoundError";
    }
}

export class PublicMapService {
    constructor(private readonly publicMapRepo: PublicMapRepository) {}

    async listPlaces(input: { q?: string; categoryId?: bigint; limit: number }) {
        const places = await this.publicMapRepo.listPlaces(input);
        return places.map((place) => serializePlace(place));
    }

    async getPlaceByPublicId(publicId: string) {
        const place = await this.publicMapRepo.getPlaceByPublicId(publicId);

        if (!place) {
            throw new PublicPlaceNotFoundError();
        }

        return serializePlace(place);
    }

    async listCategories() {
        const categories = await this.publicMapRepo.listCategories();

        return categories.map((category) => ({
            id: category.id.toString(),
            code: category.code,
            name: category.name,
            nameLocal: null,
            iconKey: null,
            sortOrder: category.sortOrder,
        }));
    }
}

function serializePlace(place: PublicPlaceRow) {
    return {
        id: place.id.toString(),
        publicId: place.public_id,
        name: place.display_name || place.primary_name,
        categoryId: place.category_id.toString(),
        categoryCode: place.category_code,
        categoryName: place.category_name,
        lat: place.lat,
        lng: place.lng,
        importanceScore: place.importance_score,
        isVerified: place.is_verified,
    };
}
