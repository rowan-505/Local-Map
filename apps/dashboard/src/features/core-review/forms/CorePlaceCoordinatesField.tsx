"use client";

import type { Geometry } from "geojson";
import { useWatch, type Control } from "react-hook-form";

import { pointGeometryToLatLng } from "@/src/components/core-review/geometry/coreGeometryUtils";

export type CorePlaceCoordinatesFieldProps = {
    control: Control<Record<string, unknown>>;
    fieldKey?: string;
};

export default function CorePlaceCoordinatesField({
    control,
    fieldKey = "point_geom",
}: CorePlaceCoordinatesFieldProps) {
    const geometry = useWatch({ control, name: fieldKey }) as Geometry | null | undefined;
    const coords = pointGeometryToLatLng(geometry ?? null);

    return (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <span className="font-medium text-slate-900">Coordinates</span>
            {coords ? (
                <p className="mt-1 font-mono text-xs">
                    Lat {coords.lat.toFixed(7)}, Lng {coords.lng.toFixed(7)}
                </p>
            ) : (
                <p className="mt-1 text-xs text-slate-500">Click the map to set a location.</p>
            )}
        </div>
    );
}
