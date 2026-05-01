import { CategoriesRepository } from "./categories.repo.js";

type CategoryResponse = {
    id: string;
    parent_id: string | null;
    code: string;
    name: string;
    icon_key: string | null;
    is_searchable: boolean;
    is_public: boolean;
    sort_order: number;
};

export class CategoriesService {
    constructor(private readonly categoriesRepo: CategoriesRepository) {}

    async listCategories() {
        const categories = await this.categoriesRepo.listCategories();

        return categories.map(
            (category): CategoryResponse => ({
                id: category.id.toString(),
                parent_id: category.parentId ? category.parentId.toString() : null,
                code: category.code,
                name: category.name,
                icon_key: null,
                is_searchable: category.isSearchable,
                is_public: category.isPublic,
                sort_order: category.sortOrder,
            })
        );
    }
}
