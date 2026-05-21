import type { Geometry } from "geojson";

import type { CoreEntityFormValues } from "./entityConfigs/types";

/** Read the active geometry field from form values (supports `geom`, `point_geom`, legacy `geometry`). */
export function getFormGeometry(values: CoreEntityFormValues, fieldKey: string): Geometry | null {
    const raw = values[fieldKey];
    if (!raw || typeof raw !== "object") {
        return null;
    }
    return raw as Geometry;
}

export function setFormGeometryFieldKey(values: CoreEntityFormValues, fieldKey: string, geometry: Geometry | null) {
    return { ...values, [fieldKey]: geometry };
}
