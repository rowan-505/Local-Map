package com.coremapmm.app.core.model

data class RouteUiModel(
    val id: String,
    val title: String,
    val totalDurationText: String,
    val distanceText: String,
    val fareText: String,
    val mode: TravelMode,
    val summarySegments: List<RouteSegmentUiModel>,
    val steps: List<RouteStepUiModel>,
    val isRecommended: Boolean,
    val badge: RouteBadge? = if (isRecommended) RouteBadge.Recommended else null,
)
