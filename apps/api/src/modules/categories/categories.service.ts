import { CategoriesRepository } from "./categories.repo.js";

type CategoryResponse = {
    id: string;
    code: string;
    name: string;
    name_mm: string | null;
    sort_order: number;
};

export class CategoriesService {
    constructor(private readonly categoriesRepo: CategoriesRepository) {}

    async listCategories() {
        const categories = await this.categoriesRepo.listCategories();

        return categories.map(
            (category): CategoryResponse => ({
                id: category.id.toString(),
                code: category.code,
                name: category.name,
                name_mm: category.name_mm,
                sort_order: category.sort_order,
            })
        );
    }
}
