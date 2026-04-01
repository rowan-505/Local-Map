package com.rowan.townmap.feature.places.presentation

import com.rowan.townmap.core.model.Place

data class PlaceDetailUiState(
    val isLoading: Boolean = true,
    val place: Place? = null,
    val topBarTitle: String = "Place",
    val coordinatesLine: String? = null
)
