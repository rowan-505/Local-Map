package com.rowan.townmap.feature.search.presentation

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.rowan.townmap.core.model.Place
import com.rowan.townmap.feature.places.data.dev.DevRepositoryHolder
import com.rowan.townmap.feature.places.domain.PlacesRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class SearchViewModel(
    private val placesRepository: PlacesRepository = DevRepositoryHolder.places
) : ViewModel() {

    private val _uiState = MutableStateFlow(SearchUiState())
    val uiState: StateFlow<SearchUiState> = _uiState.asStateFlow()

    init {
        onQueryChange("")
    }

    fun onQueryChange(query: String) {
        _uiState.update { it.copy(query = query) }
        viewModelScope.launch {
            val all = placesRepository.getPlaces()
            _uiState.update {
                it.copy(results = filterPlaces(all, query))
            }
        }
    }

    private fun filterPlaces(all: List<Place>, query: String): List<Place> {
        val q = query.trim().lowercase()
        if (q.isEmpty()) return all
        return all.filter { place -> place.name.lowercase().contains(q) }
    }
}
