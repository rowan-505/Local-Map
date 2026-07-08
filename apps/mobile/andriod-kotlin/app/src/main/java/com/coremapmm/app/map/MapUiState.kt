package com.coremapmm.app.map

import androidx.compose.ui.graphics.Color
import androidx.compose.runtime.Immutable

/**
 * UI-only state for the placeholder map. No real geospatial data or tiles.
 * Coordinates are simple 0f..1f fractions of the map viewport.
 */
@Immutable
data class MapUiState(
    val markers: List<MapMarkerUi> = FakeMapContent.markers,
    val roads: List<MapRoadUi> = FakeMapContent.roads,
    val labels: List<MapLabelUi> = FakeMapContent.labels,
    val waterAreas: List<MapAreaUi> = FakeMapContent.waterAreas,
    val parkAreas: List<MapAreaUi> = FakeMapContent.parkAreas,
    val selectedMarkerId: String? = null,
    val routeOverlay: MapRouteOverlay? = null,
)

@Immutable
data class MapRouteOverlay(
    val points: List<MapPoint>,
    val color: Color,
)

@Immutable
data class MapMarkerUi(
    val id: String,
    val label: String,
    /** 0f (left) .. 1f (right) */
    val x: Float,
    /** 0f (top) .. 1f (bottom) */
    val y: Float,
)

enum class MapRoadType { Major, Minor }

@Immutable
data class MapRoadUi(
    val id: String,
    val type: MapRoadType,
    /** Points as 0f..1f fractions, drawn as a connected polyline. */
    val points: List<MapPoint>,
)

@Immutable
data class MapLabelUi(
    val id: String,
    val text: String,
    val x: Float,
    val y: Float,
)

@Immutable
data class MapAreaUi(
    val id: String,
    /** Corners as 0f..1f fractions, drawn as a filled polygon. */
    val points: List<MapPoint>,
)

@Immutable
data class MapPoint(val x: Float, val y: Float)

/** Fake, hard-coded placeholder map layout. Not real map data. */
object FakeMapContent {
    val waterAreas: List<MapAreaUi> = listOf(
        MapAreaUi(
            id = "water-river",
            points = listOf(
                MapPoint(0f, 0.72f),
                MapPoint(0.35f, 0.66f),
                MapPoint(0.7f, 0.8f),
                MapPoint(1f, 0.74f),
                MapPoint(1f, 1f),
                MapPoint(0f, 1f),
            ),
        ),
    )

    val parkAreas: List<MapAreaUi> = listOf(
        MapAreaUi(
            id = "park-central",
            points = listOf(
                MapPoint(0.58f, 0.18f),
                MapPoint(0.82f, 0.2f),
                MapPoint(0.84f, 0.4f),
                MapPoint(0.6f, 0.42f),
            ),
        ),
    )

    val roads: List<MapRoadUi> = listOf(
        MapRoadUi(
            id = "road-major-1",
            type = MapRoadType.Major,
            points = listOf(
                MapPoint(0.05f, 0.12f),
                MapPoint(0.4f, 0.3f),
                MapPoint(0.55f, 0.55f),
                MapPoint(0.9f, 0.65f),
            ),
        ),
        MapRoadUi(
            id = "road-major-2",
            type = MapRoadType.Major,
            points = listOf(
                MapPoint(0.0f, 0.5f),
                MapPoint(0.3f, 0.48f),
                MapPoint(0.65f, 0.5f),
                MapPoint(1f, 0.45f),
            ),
        ),
        MapRoadUi(
            id = "road-minor-1",
            type = MapRoadType.Minor,
            points = listOf(
                MapPoint(0.3f, 0.05f),
                MapPoint(0.32f, 0.48f),
            ),
        ),
        MapRoadUi(
            id = "road-minor-2",
            type = MapRoadType.Minor,
            points = listOf(
                MapPoint(0.65f, 0.1f),
                MapPoint(0.55f, 0.55f),
            ),
        ),
        MapRoadUi(
            id = "road-minor-3",
            type = MapRoadType.Minor,
            points = listOf(
                MapPoint(0.1f, 0.65f),
                MapPoint(0.45f, 0.62f),
                MapPoint(0.75f, 0.7f),
            ),
        ),
    )

    val markers: List<MapMarkerUi> = listOf(
        MapMarkerUi(id = "place-shwedagon-pagoda", label = "Shwedagon", x = 0.38f, y = 0.28f),
        MapMarkerUi(id = "place-kyauktan-market", label = "Kyauktan Market", x = 0.72f, y = 0.58f),
        MapMarkerUi(id = "place-thanlyin-bridge", label = "Thanlyin Bridge", x = 0.55f, y = 0.72f),
        MapMarkerUi(id = "place-yangon-general-hospital", label = "YGH", x = 0.24f, y = 0.5f),
    )

    val labels: List<MapLabelUi> = listOf(
        MapLabelUi(id = "label-downtown", text = "Downtown", x = 0.22f, y = 0.2f),
        MapLabelUi(id = "label-river", text = "Yangon River", x = 0.5f, y = 0.88f),
        MapLabelUi(id = "label-park", text = "People's Park", x = 0.71f, y = 0.3f),
    )

    val defaultRouteOverlay: List<MapPoint> = listOf(
        MapPoint(0.24f, 0.5f),
        MapPoint(0.38f, 0.42f),
        MapPoint(0.55f, 0.55f),
        MapPoint(0.72f, 0.58f),
    )
}
