package com.rowan.townmap.core.network.overpass

import kotlinx.serialization.Serializable

@Serializable
internal data class OverpassResponse(
    val elements: List<OverpassElement> = emptyList(),
)

@Serializable
internal data class OverpassCenter(
    val lat: Double? = null,
    val lon: Double? = null,
)

@Serializable
internal data class OverpassElement(
    val type: String? = null,
    val id: Long? = null,
    val lat: Double? = null,
    val lon: Double? = null,
    val center: OverpassCenter? = null,
    val tags: Map<String, String>? = null,
)
