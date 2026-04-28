package com.rowan.townmap.core.model

data class Place(
    val id: String,
    val name: String,
    val latitude: Double,
    val longitude: Double,
    val category: String = "",
    val details: String = ""
)
