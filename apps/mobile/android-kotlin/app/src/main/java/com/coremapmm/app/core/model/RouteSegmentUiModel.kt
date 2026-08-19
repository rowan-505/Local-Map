package com.coremapmm.app.core.model

data class RouteSegmentUiModel(
    val mode: TravelMode,
    val label: String,
    val durationText: String,
    val colorType: RouteSegmentColorType,
    val durationMinutes: Int,
)
