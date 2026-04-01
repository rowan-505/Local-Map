package com.rowan.townmap.core.network.overpass

/**
 * Named shops and named amenities (includes restaurants, schools, and other amenities) as nodes and ways.
 * Ways use `out center` for a representative point.
 */
internal fun buildKyauktanPoiQuery(
    south: Double = KyauktanBoundingBox.SOUTH,
    west: Double = KyauktanBoundingBox.WEST,
    north: Double = KyauktanBoundingBox.NORTH,
    east: Double = KyauktanBoundingBox.EAST,
    timeoutSeconds: Int = 60,
): String = """
    [out:json][timeout:$timeoutSeconds];
    (
      node["shop"]["name"]($south,$west,$north,$east);
      way["shop"]["name"]($south,$west,$north,$east);
      node["amenity"]["name"]($south,$west,$north,$east);
      way["amenity"]["name"]($south,$west,$north,$east);
    );
    out center;
""".trimIndent()
