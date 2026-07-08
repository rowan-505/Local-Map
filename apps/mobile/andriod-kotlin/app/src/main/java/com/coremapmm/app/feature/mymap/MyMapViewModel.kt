package com.coremapmm.app.feature.mymap

import androidx.lifecycle.ViewModel
import com.coremapmm.app.core.fake.FakeMyMapData
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

data class MyMapUiState(
    val summary: MyMapSummaryUiModel = FakeMyMapData.summary,
    val defaultSections: List<MyMapSectionUiModel> = FakeMyMapData.defaultSections,
    val fullSections: List<MyMapSectionUiModel> = FakeMyMapData.fullSections,
    val selectedTab: MyMapSectionTab = MyMapSectionTab.Places,
)

class MyMapViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(MyMapUiState())
    val uiState: StateFlow<MyMapUiState> = _uiState.asStateFlow()

    fun selectTab(tab: MyMapSectionTab) {
        _uiState.value = _uiState.value.copy(selectedTab = tab)
    }

    fun countFor(tab: MyMapSectionTab): Int = _uiState.value.countFor(tab)
}

fun MyMapUiState.countFor(tab: MyMapSectionTab): Int = when (tab) {
    MyMapSectionTab.Places -> summary.savedCount
    MyMapSectionTab.Routes -> FakeMyMapData.savedRoutes.size
    MyMapSectionTab.Recents -> FakeMyMapData.recentSearches.size
    MyMapSectionTab.Alerts -> FakeMyMapData.communityAlerts.size
    MyMapSectionTab.Downloads -> summary.offlineAreaCount
}
