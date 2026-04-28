package com.rowan.townmap.feature.map.presentation

import com.rowan.townmap.core.model.Place

data class MapUiState(
    val screenTitle: String = "Map",
    val places: List<Place> = emptyList(),
    val isLoading: Boolean = true,
    val errorMessage: String? = null,
)
