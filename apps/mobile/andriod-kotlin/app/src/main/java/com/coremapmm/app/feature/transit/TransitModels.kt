package com.coremapmm.app.feature.transit

enum class TransitPlannerMode {
    Walk,
    Motorbike,
    Car,
    Bus,
}

enum class TransitSheetMode {
    Planner,
    RouteInput,
    RouteResults,
    RouteDetail,
}

enum class RouteInputField {
    From,
    To,
}

data class TransitStopUiModel(
    val id: String,
    val name: String,
    val distanceText: String,
)

data class RoutePlaceResultUiModel(
    val id: String,
    val title: String,
    val subtitle: String,
    val distanceText: String?,
)

data class PopularBusRouteUiModel(
    val id: String,
    val name: String,
    val corridor: String,
)

data class RecentRouteUiModel(
    val id: String,
    val from: String,
    val to: String,
    val modeLabel: String,
)
