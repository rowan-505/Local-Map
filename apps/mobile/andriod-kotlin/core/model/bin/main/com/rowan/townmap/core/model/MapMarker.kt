package com.rowan.townmap.core.model

data class MapMarker(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val title: String,
    val placeId: String? = null
)
