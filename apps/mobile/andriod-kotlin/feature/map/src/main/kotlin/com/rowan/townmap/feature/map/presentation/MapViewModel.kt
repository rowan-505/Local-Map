package com.rowan.townmap.feature.map.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rowan.townmap.core.network.overpass.OverpassClient
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MapViewModel(
    private val overpassClient: OverpassClient = OverpassClient(),
) : ViewModel() {

    private val _uiState = MutableStateFlow(MapUiState())
    val uiState: StateFlow<MapUiState> = _uiState.asStateFlow()

    init {
        loadPlaces()
    }

    /** Retries the Overpass fetch (e.g. after a transient network error). */
    fun retryLoadPlaces() {
        loadPlaces()
    }

    private fun loadPlaces() {
        viewModelScope.launch {
            _uiState.update {
                it.copy(isLoading = true, errorMessage = null)
            }
            val result = withContext(Dispatchers.IO) {
                overpassClient.fetchKyauktanPlaces()
            }
            result.fold(
                onSuccess = { places ->
                    _uiState.update {
                        it.copy(places = places, isLoading = false, errorMessage = null)
                    }
                },
                onFailure = { throwable ->
                    _uiState.update {
                        it.copy(
                            places = emptyList(),
                            isLoading = false,
                            errorMessage = throwable.message ?: "Could not load places.",
                        )
                    }
                },
            )
        }
    }
}
