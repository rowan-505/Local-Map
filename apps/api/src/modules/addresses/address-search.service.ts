import { AddressIndexRepository } from "./address-index.repo.js";
import type { AddressSearchQuery } from "./address-search.schema.js";

export type AddressSearchResultItem = {
    address_id: string;
    language_code: string;
    search_text: string;
    display_address: string;
    house_number: string | null;
    street_text: string | null;
    admin_text: string | null;
    postcode: string | null;
    rank_score: number;
    match_priority: number;
    point_geom: unknown;
};

export class AddressSearchService {
    constructor(private readonly repo: AddressIndexRepository) {}

    async search(query: AddressSearchQuery): Promise<AddressSearchResultItem[]> {
        let adminAreaId: bigint | null = null;
        if (query.admin_area_id?.trim()) {
            try {
                adminAreaId = BigInt(query.admin_area_id.trim());
            } catch {
                adminAreaId = null;
            }
        }

        const rows = await this.repo.search({
            q: query.q,
            lang: query.lang,
            limit: query.limit,
            adminAreaId,
        });

        return rows.map((row) => ({
            address_id: row.public_id,
            language_code: row.language_code,
            search_text: row.search_text,
            display_address: row.display_address,
            house_number: row.house_number,
            street_text: row.street_text,
            admin_text: row.admin_text,
            postcode: row.postcode,
            rank_score: row.rank_score,
            match_priority: row.match_priority,
            point_geom: row.point_geom,
        }));
    }
}
