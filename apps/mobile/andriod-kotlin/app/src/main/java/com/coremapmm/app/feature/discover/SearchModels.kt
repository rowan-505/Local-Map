package com.coremapmm.app.feature.discover

enum class SearchFilter {
    All,
    Places,
    Roads,
    Bus,
    Address,
    Township,
}

enum class SearchResultIconType {
    Place,
    Road,
    Bus,
    Address,
    Township,
    Saved,
}

data class SearchResultUiModel(
    val id: String,
    val title: String,
    val type: SearchFilter,
    val township: String,
    val region: String,
    val distanceText: String?,
    val placeId: String?,
    val iconType: SearchResultIconType,
)
