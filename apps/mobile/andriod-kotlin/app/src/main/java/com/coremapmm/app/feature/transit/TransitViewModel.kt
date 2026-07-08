package com.coremapmm.app.feature.transit

import androidx.lifecycle.ViewModel
import com.coremapmm.app.core.design.toTransitColor
import com.coremapmm.app.core.fake.FakeRoutes
import com.coremapmm.app.core.fake.FakeTransitData
import com.coremapmm.app.core.model.RouteUiModel
import com.coremapmm.app.core.model.TravelMode
import com.coremapmm.app.map.MapPoint
import com.coremapmm.app.map.MapRouteOverlay
import com.coremapmm.app.map.FakeMapContent
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class TransitUiState(
    val sheetMode: TransitSheetMode = TransitSheetMode.Planner,
    val selectedPlannerMode: TransitPlannerMode = TransitPlannerMode.Bus,
    val activeInputField: RouteInputField = RouteInputField.To,
    val fromText: String = FakeTransitData.defaultFrom,
    val toText: String = FakeTransitData.defaultTo,
    val routeResults: List<RouteUiModel> = emptyList(),
    val selectedRouteId: String? = null,
    val returnToRouteInputOnResultsBack: Boolean = false,
    val routeResultsHeaderExpanded: Boolean = false,
    val nearbyStops: List<TransitStopUiModel> = FakeTransitData.nearbyStops,
    val popularBusRoutes: List<PopularBusRouteUiModel> = FakeTransitData.popularBusRoutes,
    val recentRoutes: List<RecentRouteUiModel> = FakeTransitData.recentRoutes,
    val routePlaceResults: List<RoutePlaceResultUiModel> = FakeTransitData.routePlaceResults,
    val routeOverlay: MapRouteOverlay? = null,
) {
    /** Fake local filter for the active route field text. */
    val filteredRoutePlaceResults: List<RoutePlaceResultUiModel>
        get() {
            val query = when (activeInputField) {
                RouteInputField.From -> fromText
                RouteInputField.To -> toText
            }.trim()
            if (query.isBlank()) return routePlaceResults
            val filtered = routePlaceResults.filter { result ->
                result.title.contains(query, ignoreCase = true) ||
                    result.subtitle.contains(query, ignoreCase = true)
            }
            return filtered.ifEmpty { routePlaceResults }
        }
}

class TransitViewModel : ViewModel() {
    private val _uiState = MutableStateFlow(TransitUiState())
    val uiState: StateFlow<TransitUiState> = _uiState.asStateFlow()

    fun selectPlannerMode(mode: TransitPlannerMode) {
        _uiState.update { it.copy(selectedPlannerMode = mode) }
    }

    fun openRouteInput(field: RouteInputField) {
        _uiState.update {
            it.copy(
                sheetMode = TransitSheetMode.RouteInput,
                activeInputField = field,
            )
        }
    }

    fun closeRouteInput() {
        _uiState.update { it.copy(sheetMode = TransitSheetMode.Planner) }
    }

    fun selectRoutePlace(result: RoutePlaceResultUiModel) {
        _uiState.update { state ->
            when (state.activeInputField) {
                RouteInputField.From -> state.copy(fromText = result.title)
                RouteInputField.To -> state.copy(toText = result.title)
            }
        }
    }

    fun swapRouteFields() {
        _uiState.update {
            it.copy(
                fromText = it.toText,
                toText = it.fromText,
                activeInputField = if (it.activeInputField == RouteInputField.From) {
                    RouteInputField.To
                } else {
                    RouteInputField.From
                },
            )
        }
    }

    fun planRoutes() {
        val mode = _uiState.value.selectedPlannerMode
        val returnToRouteInput = _uiState.value.sheetMode == TransitSheetMode.RouteInput
        val results = routesForMode(mode)
        val selectedId = results.firstOrNull()?.id
        _uiState.update {
            it.copy(
                sheetMode = TransitSheetMode.RouteResults,
                routeResults = results,
                selectedRouteId = selectedId,
                returnToRouteInputOnResultsBack = returnToRouteInput,
                routeResultsHeaderExpanded = false,
                routeOverlay = selectedId?.let { id ->
                    results.find { route -> route.id == id }?.toRouteOverlay()
                },
            )
        }
    }

    fun selectRoute(routeId: String) {
        val route = _uiState.value.routeResults.find { it.id == routeId }
            ?: FakeRoutes.byId(routeId)
        _uiState.update {
            it.copy(
                sheetMode = TransitSheetMode.RouteDetail,
                selectedRouteId = routeId,
                routeResultsHeaderExpanded = false,
                routeOverlay = route?.toRouteOverlay(),
            )
        }
    }

    fun showRouteResults() {
        _uiState.update {
            it.copy(
                sheetMode = TransitSheetMode.RouteResults,
                routeResultsHeaderExpanded = false,
            )
        }
    }

    fun setRouteResultsHeaderExpanded(expanded: Boolean) {
        _uiState.update { it.copy(routeResultsHeaderExpanded = expanded) }
    }

    fun collapseRouteResultsHeader() {
        setRouteResultsHeaderExpanded(false)
    }

    fun backToPlanner() {
        _uiState.update {
            it.copy(
                sheetMode = TransitSheetMode.Planner,
                routeResults = emptyList(),
                selectedRouteId = null,
                returnToRouteInputOnResultsBack = false,
                routeResultsHeaderExpanded = false,
                routeOverlay = null,
            )
        }
    }

    fun backFromRouteResults() {
        _uiState.update {
            if (it.returnToRouteInputOnResultsBack) {
                it.copy(
                    sheetMode = TransitSheetMode.RouteInput,
                    routeResultsHeaderExpanded = false,
                    routeOverlay = null,
                )
            } else {
                it.copy(
                    sheetMode = TransitSheetMode.Planner,
                    routeResults = emptyList(),
                    selectedRouteId = null,
                    returnToRouteInputOnResultsBack = false,
                    routeResultsHeaderExpanded = false,
                    routeOverlay = null,
                )
            }
        }
    }

    fun backToResults() {
        _uiState.update {
            it.copy(
                sheetMode = TransitSheetMode.RouteResults,
                routeResultsHeaderExpanded = false,
            )
        }
    }

    fun clearTransit() {
        _uiState.value = TransitUiState()
    }

    private fun routesForMode(mode: TransitPlannerMode): List<RouteUiModel> {
        return when (mode) {
            TransitPlannerMode.Walk -> listOf(FakeRoutes.walkRoute)
            TransitPlannerMode.Motorbike -> listOf(FakeRoutes.motorbikeRoute)
            TransitPlannerMode.Car -> listOf(FakeRoutes.carRoute)
            TransitPlannerMode.Bus -> listOf(
                FakeRoutes.ybsBusRoute,
                FakeRoutes.walkAndBusRoute,
            )
        }
    }

    private fun RouteUiModel.toRouteOverlay(): MapRouteOverlay {
        return MapRouteOverlay(
            points = FakeMapContent.defaultRouteOverlay,
            color = mode.toTransitColor(),
        )
    }
}
