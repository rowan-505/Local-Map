package com.coremapmm.app.feature.place

import androidx.lifecycle.ViewModel
import com.coremapmm.app.core.fake.FakePlaces
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class PlaceViewModelState(
    val activeSheet: ActivePlaceSheet = ActivePlaceSheet.None,
    val placeDetail: PlaceDetailUiState? = null,
    val randomPoint: RandomPointUiState = RandomPointUiState(),
)

class PlaceViewModel : ViewModel() {
    private val _state = MutableStateFlow(PlaceViewModelState())
    val state: StateFlow<PlaceViewModelState> = _state.asStateFlow()

    fun openSearch() {
        _state.update {
            it.copy(activeSheet = ActivePlaceSheet.Search)
        }
    }

    fun closeSearch() {
        _state.update { current ->
            if (current.activeSheet == ActivePlaceSheet.Search) {
                current.copy(activeSheet = ActivePlaceSheet.None)
            } else {
                current
            }
        }
    }

    fun openPlace(placeId: String) {
        val place = FakePlaces.byId(placeId) ?: return
        _state.update {
            it.copy(
                activeSheet = ActivePlaceSheet.PlaceDetail(placeId),
                placeDetail = PlaceDetailUiState(
                    placeId = placeId,
                    isSaved = place.isSaved,
                ),
            )
        }
    }

    fun openRandomPoint() {
        _state.update {
            it.copy(activeSheet = ActivePlaceSheet.RandomPoint)
        }
    }

    fun clearOverlay() {
        _state.update {
            it.copy(
                activeSheet = ActivePlaceSheet.None,
                placeDetail = null,
            )
        }
    }

    fun toggleSave() {
        _state.update { current ->
            val detail = current.placeDetail ?: return@update current
            current.copy(
                placeDetail = detail.copy(isSaved = !detail.isSaved),
            )
        }
    }

    fun selectDetailTab(tab: PlaceDetailTab) {
        _state.update { current ->
            val detail = current.placeDetail ?: return@update current
            current.copy(placeDetail = detail.copy(selectedTab = tab))
        }
    }
}
