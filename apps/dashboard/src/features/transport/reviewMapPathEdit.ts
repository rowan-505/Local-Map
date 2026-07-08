/** Ordered [lng, lat] vertices for a route path LineString. */
export type PathCoord = [number, number];

export function pathCoordsEqual(
    a: readonly PathCoord[],
    b: readonly PathCoord[],
    epsilon = 1e-7,
): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return a.every(
        (coord, index) =>
            Math.abs(coord[0] - b[index]![0]) < epsilon &&
            Math.abs(coord[1] - b[index]![1]) < epsilon,
    );
}

export function coordsToLineStringGeometry(
    coords: readonly PathCoord[],
): { type: "LineString"; coordinates: PathCoord[] } | null {
    if (coords.length < 2) {
        return null;
    }
    return { type: "LineString", coordinates: [...coords] };
}

export function movePathVertex(
    coords: readonly PathCoord[],
    vertexIndex: number,
    lng: number,
    lat: number,
): PathCoord[] {
    if (vertexIndex < 0 || vertexIndex >= coords.length) {
        return [...coords];
    }
    const next = [...coords];
    next[vertexIndex] = [lng, lat];
    return next;
}

export function deletePathVertex(
    coords: readonly PathCoord[],
    vertexIndex: number,
): PathCoord[] | null {
    if (vertexIndex < 0 || vertexIndex >= coords.length || coords.length <= 2) {
        return null;
    }
    return coords.filter((_, index) => index !== vertexIndex);
}

export function insertPathVertex(
    coords: readonly PathCoord[],
    segmentIndex: number,
    lng: number,
    lat: number,
): { coords: PathCoord[]; newVertexIndex: number } | null {
    if (segmentIndex < 0 || segmentIndex >= coords.length - 1) {
        return null;
    }
    const next = [...coords];
    next.splice(segmentIndex + 1, 0, [lng, lat]);
    return { coords: next, newVertexIndex: segmentIndex + 1 };
}

function distSq(ax: number, ay: number, bx: number, by: number): number {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
}

/** Closest point on segment AB to point P (planar lng/lat; fine for edit tolerance). */
function closestPointOnSegment(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    px: number,
    py: number,
): { lng: number; lat: number; distSq: number; t: number } {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    if (lenSq === 0) {
        return { lng: ax, lat: ay, distSq: distSq(ax, ay, px, py), t: 0 };
    }
    const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
    const lng = ax + t * abx;
    const lat = ay + t * aby;
    return { lng, lat, distSq: distSq(lng, lat, px, py), t };
}

/**
 * Pick the path segment nearest to a map click. Returns segment index (segment i → i+1)
 * when within `maxDistanceDeg` (~0.00015 ≈ 15 m at Myanmar latitudes).
 */
export function findPathSegmentForInsert(
    coords: readonly PathCoord[],
    lng: number,
    lat: number,
    maxDistanceDeg = 0.00015,
): { segmentIndex: number; lng: number; lat: number } | null {
    if (coords.length < 2) {
        return null;
    }

    let bestSegment = -1;
    let bestLng = lng;
    let bestLat = lat;
    let bestDistSq = maxDistanceDeg * maxDistanceDeg;

    for (let i = 0; i < coords.length - 1; i++) {
        const [ax, ay] = coords[i]!;
        const [bx, by] = coords[i + 1]!;
        const hit = closestPointOnSegment(ax, ay, bx, by, lng, lat);
        if (hit.distSq < bestDistSq) {
            bestDistSq = hit.distSq;
            bestSegment = i;
            bestLng = hit.lng;
            bestLat = hit.lat;
        }
    }

    if (bestSegment < 0) {
        return null;
    }
    return { segmentIndex: bestSegment, lng: bestLng, lat: bestLat };
}
