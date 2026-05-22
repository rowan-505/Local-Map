import { AdminAreasRepository } from "./admin-areas.repo.js";

type AdminAreaResponse = {
    id: string;
    parent_id: string | null;
    admin_level_id: string;
    canonical_name: string;
    slug: string;
    is_active: boolean;
};

export type AdminAreaOptionResponse = {
    id: string;
    canonical_name: string;
    name_mm: string | null;
    name_en: string | null;
    admin_level_id: string;
    admin_level_code: string;
    admin_level_name: string | null;
    parent_id: string | null;
    parent_label: string | null;
    boundary_status: string | null;
    address_usage: string | null;
};

export function formatAdminAreaOptionLabel(option: Pick<AdminAreaOptionResponse, "canonical_name" | "name_mm" | "name_en">): string {
    const mm = option.name_mm?.trim();
    const en = option.name_en?.trim();
    const canonical = option.canonical_name?.trim();
    if (mm && en) {
        return `${mm} — ${en}`;
    }
    if (mm) {
        return mm;
    }
    if (en) {
        return en;
    }
    return canonical ?? "";
}

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

    async listAdminAreaOptions(args: { limit: number; q?: string | undefined }) {
        const rows = await this.adminAreasRepo.listAdminAreaOptions(args);
        return rows.map(
            (row): AdminAreaOptionResponse => ({
                id: row.id.toString(),
                canonical_name: row.canonical_name,
                name_mm: row.name_mm,
                name_en: row.name_en,
                admin_level_id: row.admin_level_id.toString(),
                admin_level_code: row.admin_level_code,
                admin_level_name: row.admin_level_name,
                parent_id: row.parent_id !== null ? row.parent_id.toString() : null,
                parent_label: row.parent_label,
                boundary_status: row.boundary_status,
                address_usage: row.address_usage,
            })
        );
    }

    async assertActiveAdminAreaId(adminAreaId: bigint | null | undefined): Promise<bigint | null> {
        if (adminAreaId === undefined || adminAreaId === null) {
            return null;
        }
        const row = await this.adminAreasRepo.getActiveAdminAreaById(adminAreaId);
        if (row === null) {
            throw new Error("ADMIN_AREA_INVALID");
        }
        return adminAreaId;
    }
}
