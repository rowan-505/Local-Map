package com.coremapmm.app.feature.place

enum class PlaceDetailTab {
    Overview,
    Nearby,
    Info,
    Reports,
}

sealed interface ActivePlaceSheet {
    data object None : ActivePlaceSheet
    data object Search : ActivePlaceSheet
    data class PlaceDetail(val placeId: String) : ActivePlaceSheet
    data object RandomPoint : ActivePlaceSheet
}

data class PlaceDetailUiState(
    val placeId: String,
    val isSaved: Boolean,
    val selectedTab: PlaceDetailTab = PlaceDetailTab.Overview,
)

data class RandomPointUiState(
    val township: String = "Kyauktan",
    val region: String = "Yangon Region",
    val coordinatesText: String = "16.7542° N, 96.1234° E",
    val plusCode: String = "6Q2F+3X Kyauktan",
)
