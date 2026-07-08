"use client";

import MapBasemapToggle, {
    type MapBasemapToggleProps,
} from "@/src/components/map/MapBasemapToggle";

import { useTransportDashboardBasemapMode } from "./transportBasemapMode";

export type TransportMapLayerToggleProps = Omit<
    MapBasemapToggleProps,
    "value" | "onChange" | "satelliteAvailable"
> & {
    readonly value?: MapBasemapToggleProps["value"];
    readonly onChange?: MapBasemapToggleProps["onChange"];
    readonly satelliteAvailable?: boolean;
};

/**
 * Compact Map / Sat / Hyb control for Transport dashboard maps.
 * Uses the shared transport basemap mode (localStorage-backed) unless controlled via props.
 */
export default function TransportMapLayerToggle({
    value,
    onChange,
    satelliteAvailable,
    ...rest
}: TransportMapLayerToggleProps) {
    const transportBasemap = useTransportDashboardBasemapMode();

    return (
        <MapBasemapToggle
            value={value ?? transportBasemap.basemapMode}
            onChange={onChange ?? transportBasemap.setBasemapMode}
            satelliteAvailable={satelliteAvailable ?? transportBasemap.satelliteAvailable}
            {...rest}
        />
    );
}
