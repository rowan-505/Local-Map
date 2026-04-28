package com.rowan.townmap.feature.map.presentation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.key
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.mapbox.geojson.Point
import com.mapbox.maps.extension.compose.MapState
import com.mapbox.maps.extension.compose.MapboxMap
import com.mapbox.maps.extension.compose.annotation.generated.CircleAnnotation
import com.mapbox.maps.extension.compose.animation.viewport.MapViewportState
import com.mapbox.maps.extension.compose.animation.viewport.rememberMapViewportState
import com.rowan.townmap.core.model.Place

/** Kyauktan-area town view (Mapbox camera uses lng, lat order). */
private const val InitialLatitude = 16.6339
private const val InitialLongitude = 96.3272

/** Zoom suited to a single town / dense area. */
private const val InitialZoom = 14.0

/**
 * Remembered camera viewport for the town map. Hoist next to [MapScreen] so state matches the
 * screen’s composition lifecycle (cleared when the screen leaves the back stack).
 */
@Composable
fun rememberTownMapViewportState(): MapViewportState = rememberMapViewportState {
    setCameraOptions {
        center(Point.fromLngLat(InitialLongitude, InitialLatitude))
        zoom(InitialZoom)
    }
}

/**
 * Map surface for the town screen.
 *
 * Mapbox’s Compose `MapboxMap` wires `MapView` to the composition’s `LocalLifecycleOwner`
 * (start/stop/resume, and destroy when the composable leaves the hierarchy). Do not call
 * `mapView` lifecycle hooks from `MapEffect`; see Mapbox Jetpack Compose guide.
 *
 * [places] are drawn as simple circle annotations; the list is keyed by [Place.id] so markers
 * track Overpass updates.
 */
@Composable
fun TownMapInteractiveMap(
    modifier: Modifier = Modifier,
    mapViewportState: MapViewportState,
    mapState: MapState,
    places: List<Place>,
    onPlaceClick: (Place) -> Unit,
) {
    MapboxMap(
        modifier = modifier,
        mapViewportState = mapViewportState,
        mapState = mapState,
    ) {
        places.forEach { place ->
            key(place.id) {
                val point = Point.fromLngLat(place.longitude, place.latitude)
                CircleAnnotation(point = point) {
                    interactionsState.onClicked {
                        onPlaceClick(place)
                        true
                    }
                    circleRadius = 6.0
                    circleColor = Color(0xFF1E88E5)
                    circleStrokeColor = Color.White
                    circleStrokeWidth = 1.5
                }
            }
        }
    }
}
