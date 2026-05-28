/**
 * Decode Valhalla/OSRM encoded polylines (precision 6 for shape_format=polyline6).
 * Internal helper — not a Valhalla API type.
 */
export function decodeValhallaPolyline(
    encoded: string,
    precision = 6
): ReadonlyArray<readonly [number, number]> {
    const coordinates: [number, number][] = [];
    if (!encoded) {
        return coordinates;
    }

    const factor = 10 ** precision;
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        let result = 0;
        let shift = 0;
        let byte: number;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const deltaLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
        lat += deltaLat;

        result = 0;
        shift = 0;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const deltaLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
        lng += deltaLng;

        coordinates.push([lng / factor, lat / factor]);
    }

    return coordinates;
}
