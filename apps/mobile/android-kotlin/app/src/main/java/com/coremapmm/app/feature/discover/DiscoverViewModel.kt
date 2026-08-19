package com.coremapmm.app.feature.discover

import androidx.lifecycle.ViewModel
import com.coremapmm.app.core.fake.FakeOfflinePackages
import com.coremapmm.app.core.fake.FakePlaces
import com.coremapmm.app.core.model.OfflinePackageUiModel
import com.coremapmm.app.core.model.PlaceUiModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

const val ALL_CATEGORY = "All"

data class DiscoverUiState(
    val selectedDiscoverTab: DiscoverTab = DiscoverTab.Local,
    val currentAreaName: String = "Kyauktan Township",
    val localPlaces: List<PlaceUiModel> = FakePlaces.discoverPlaces,
    val countryHotspots: List<PlaceUiModel> = FakePlaces.countryHotspots,
    val offlineSuggestion: OfflinePackageUiModel = FakeOfflinePackages.packages.first(),
    val showAllHotspots: Boolean = false,
    val selectedCategory: String = ALL_CATEGORY,
    val savedPlaceIds: Set<String> = FakePlaces.savedPlaces.map { it.id }.toSet(),
) {
    private val activeSource: List<PlaceUiModel>
        get() = when (selectedDiscoverTab) {
            DiscoverTab.Local -> localPlaces
            DiscoverTab.CountryHotspots -> countryHotspots
        }

    /** Category chips derived from the active tab's fake data, with an All option first. */
    val categories: List<String>
        get() = listOf(ALL_CATEGORY) + activeSource.map { it.category }.distinct()

    /** Full list for the active tab after applying the category chip filter. */
    val filteredPlaces: List<PlaceUiModel>
        get() = activeSource.filter {
            selectedCategory == ALL_CATEGORY || it.category == selectedCategory
        }
}

class DiscoverViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(DiscoverUiState())
    val uiState: StateFlow<DiscoverUiState> = _uiState.asStateFlow()

    fun selectTab(tab: DiscoverTab) {
        _uiState.update {
            it.copy(
                selectedDiscoverTab = tab,
                selectedCategory = ALL_CATEGORY,
                showAllHotspots = false,
            )
        }
    }

    fun selectCategory(category: String) {
        _uiState.update { it.copy(selectedCategory = category, showAllHotspots = false) }
    }

    fun showMoreHotspots() {
        _uiState.update { it.copy(showAllHotspots = true) }
    }

    fun toggleSave(placeId: String) {
        _uiState.update { state ->
            val updated = state.savedPlaceIds.toMutableSet()
            if (placeId in updated) updated.remove(placeId) else updated.add(placeId)
            state.copy(savedPlaceIds = updated)
        }
    }

    fun isSaved(placeId: String): Boolean = placeId in _uiState.value.savedPlaceIds
}
