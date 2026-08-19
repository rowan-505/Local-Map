package com.coremapmm.app.core.model

data class PlaceUiModel(
    val id: String,
    val name: String,
    val category: String,
    val township: String,
    val region: String,
    val distanceText: String,
    val verified: Boolean,
    val ratingText: String,
    val address: String,
    val plusCode: String,
    val phoneText: String,
    val photoUrls: List<String>,
    val isSaved: Boolean,
)
