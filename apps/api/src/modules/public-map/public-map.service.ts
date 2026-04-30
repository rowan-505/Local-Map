import {
    PublicMapRepository,
    type PublicPlaceRow,
    type PublicSearchRow,
} from "./public-map.repo.js";

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

    async search(input: { q: string; limit: number }) {
        const results = await this.publicMapRepo.search(input);
        return results.map((result) => serializeSearchResult(result));
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

function serializeSearchResult(result: PublicSearchRow) {
    const isPlace = result.result_type === "place";

    return {
        id: result.id,
        type: result.result_type,
        name: result.name,
        subtitle: result.subtitle,
        categoryName: result.category_name,
        lat: result.lat,
        lng: result.lng,
        cameraTarget: {
            type: isPlace ? "point" : "bounds",
            center: [result.lng, result.lat],
            zoom: isPlace ? 16 : 15,
            ...(isPlace
                ? {}
                : {
                      bbox: [
                          result.min_lng,
                          result.min_lat,
                          result.max_lng,
                          result.max_lat,
                      ],
                      padding: 80,
                  }),
        },
    };
}
