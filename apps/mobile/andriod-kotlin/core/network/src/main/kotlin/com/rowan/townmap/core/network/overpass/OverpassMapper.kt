package com.rowan.townmap.core.network.overpass

import com.rowan.townmap.core.model.Place

/**
 * Maps Overpass elements to [Place]. Expects elements from [buildKyauktanPoiQuery] (shop / amenity with name).
 */
internal fun OverpassElement.toPlaceOrNull(): Place? {
    val oid = id ?: return null
    val typ = type ?: return null
    if (typ != "node" && typ != "way") return null

    val tagMap = tags ?: emptyMap()
    val name = tagMap["name"]?.takeIf { it.isNotBlank() } ?: return null

    val hasShop = tagMap.containsKey("shop")
    val hasAmenity = tagMap.containsKey("amenity")
    if (!hasShop && !hasAmenity) return null

    val (latitude, longitude) =
        when (typ) {
            "node" -> {
                val la = lat ?: return null
                val lo = lon ?: return null
                la to lo
            }
            "way" -> {
                val c = center ?: return null
                val la = c.lat ?: return null
                val lo = c.lon ?: return null
                la to lo
            }
            else -> return null
        }

    val category =
        when {
            hasShop -> tagMap["shop"] ?: "shop"
            else -> tagMap["amenity"] ?: "amenity"
        }

    return Place(
        id = "$typ/$oid",
        name = name,
        latitude = latitude,
        longitude = longitude,
        category = category,
        details = "",
    )
}
