import { AdminAreasRepository } from "./admin-areas.repo.js";

type AdminAreaResponse = {
    id: string;
    parent_id: string | null;
    admin_level_id: string;
    canonical_name: string;
    slug: string;
    is_active: boolean;
};

export class AdminAreasService {
    constructor(private readonly adminAreasRepo: AdminAreasRepository) {}

    async listAdminAreas(limit: number) {
        const adminAreas = await this.adminAreasRepo.listAdminAreas(limit);

        return adminAreas.map(
            (adminArea): AdminAreaResponse => ({
                id: adminArea.id.toString(),
                parent_id: adminArea.parentId ? adminArea.parentId.toString() : null,
                admin_level_id: adminArea.adminLevelId.toString(),
                canonical_name: adminArea.canonicalName,
                slug: adminArea.slug,
                is_active: adminArea.isActive,
            })
        );
    }
}
