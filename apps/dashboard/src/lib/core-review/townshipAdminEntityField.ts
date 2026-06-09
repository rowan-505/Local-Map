import { townshipAdminEntityInferKind, type TownshipAdminEntitySlug } from "@/src/lib/core-review/townshipAdminPolicy";

import type { CoreEntityFieldDef } from "./entityConfigs/types";

/**
 * Shared township-admin field definition for township-default core-review entities.
 *
 * Do **not** use for `addresses`. Addresses must keep `type: "ref"` + `refSource: "admin-areas"`
 * (generic AdminAreaCombobox) so editors can assign ward, township, district, etc.
 */
export function townshipAdminEntityField(args: {
    slug: TownshipAdminEntitySlug;
    geometryFieldKey: string;
    adminAreaIdKey: string;
    label?: string;
}): CoreEntityFieldDef {
    return {
        key: "township_admin",
        label: args.label ?? "Township",
        type: "township-admin",
        townshipAdmin: {
            entityKind: townshipAdminEntityInferKind(args.slug),
            geometryFieldKey: args.geometryFieldKey,
            adminAreaIdKey: args.adminAreaIdKey,
        },
    };
}
