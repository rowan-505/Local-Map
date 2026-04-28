package com.rowan.townmap.feature.places.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rowan.townmap.feature.places.data.dev.DevRepositoryHolder
import com.rowan.townmap.feature.places.domain.PlacesRepository
import com.rowan.townmap.feature.places.navigation.PlaceNavigationStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class PlaceDetailViewModel(
    private val placesRepository: PlacesRepository = DevRepositoryHolder.places
) : ViewModel() {

    private val _uiState = MutableStateFlow(PlaceDetailUiState())
    val uiState: StateFlow<PlaceDetailUiState> = _uiState.asStateFlow()

    fun loadPlace(placeId: String) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = true,
                    place = null,
                    topBarTitle = "Place",
                    coordinatesLine = null
                )
            }
            val place = placesRepository.getPlace(placeId)
                ?: PlaceNavigationStore.consume(placeId)
            _uiState.update {
                if (place != null) {
                    it.copy(
                        isLoading = false,
                        place = place,
                        topBarTitle = place.name,
                        coordinatesLine = formatCoordinatePair(place.latitude, place.longitude)
                    )
                } else {
                    it.copy(
                        isLoading = false,
                        place = null,
                        topBarTitle = "Place",
                        coordinatesLine = null
                    )
                }
            }
        }
    }

    private fun formatCoordinatePair(latitude: Double, longitude: Double): String =
        "${formatCoordinate(latitude)}, ${formatCoordinate(longitude)}"

    private fun formatCoordinate(value: Double): String =
        String.format("%.5f", value)
}
