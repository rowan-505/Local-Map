package com.rowan.townmap.feature.map.presentation

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.mapbox.maps.extension.compose.rememberMapState
import com.rowan.townmap.core.model.Place
import com.rowan.townmap.core.ui.components.TownMapScreenScaffold

/**
 * Town map shell. Use [com.rowan.townmap.feature.map.MapboxAccess] for the Mapbox token when wiring the Mapbox SDK.
 */
@Composable
fun MapScreen(
    modifier: Modifier = Modifier,
    onPlaceSelected: (Place) -> Unit = {},
    onSearchClick: () -> Unit = {},
    onSettingsClick: () -> Unit = {},
    onMyLocationClick: () -> Unit = {},
    viewModel: MapViewModel = viewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val mapViewportState = rememberTownMapViewportState()
    val mapState = rememberMapState()

    TownMapScreenScaffold(
        title = uiState.screenTitle,
        modifier = modifier,
        onNavigateUp = null,
        actions = {
            MapTopBarActions(
                onMyLocationClick = onMyLocationClick,
                onSearchClick = onSearchClick,
                onSettingsClick = onSettingsClick
            )
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
        ) {
            TownMapInteractiveMap(
                modifier = Modifier.fillMaxSize(),
                mapViewportState = mapViewportState,
                mapState = mapState,
                places = uiState.places,
                onPlaceClick = onPlaceSelected,
            )
            SamplePlacesOverlay(
                places = uiState.places,
                isLoading = uiState.isLoading,
                errorMessage = uiState.errorMessage,
                onPlaceSelected = onPlaceSelected,
                onRetry = viewModel::retryLoadPlaces,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .padding(16.dp)
            )
        }
    }
}

@Composable
private fun RowScope.MapTopBarActions(
    onMyLocationClick: () -> Unit,
    onSearchClick: () -> Unit,
    onSettingsClick: () -> Unit
) {
    IconButton(onClick = onMyLocationClick) {
        Icon(
            imageVector = Icons.Filled.MyLocation,
            contentDescription = "My location (reserved)"
        )
    }
    IconButton(onClick = onSearchClick) {
        Icon(
            imageVector = Icons.Filled.Search,
            contentDescription = "Search"
        )
    }
    IconButton(onClick = onSettingsClick) {
        Icon(
            imageVector = Icons.Filled.Settings,
            contentDescription = "Settings"
        )
    }
}

@Composable
private fun SamplePlacesOverlay(
    places: List<Place>,
    isLoading: Boolean,
    errorMessage: String?,
    onPlaceSelected: (Place) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(16.dp),
        tonalElevation = 2.dp,
        shadowElevation = 4.dp
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)
        ) {
            Text(
                text = "Nearby",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface
            )
            Text(
                text = "OpenStreetMap · tap a row for details",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 8.dp)
            )
            when {
                isLoading -> {
                    Row(
                        modifier = Modifier
                            .padding(vertical = 8.dp)
                            .widthIn(max = 280.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(22.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.primary,
                            trackColor = MaterialTheme.colorScheme.surfaceVariant
                        )
                        Text(
                            text = "Loading places…",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                errorMessage != null -> {
                    Column(
                        modifier = Modifier.padding(vertical = 4.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Text(
                            text = errorMessage,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.error
                        )
                        TextButton(onClick = onRetry) {
                            Text("Retry")
                        }
                    }
                }
                places.isEmpty() -> Text(
                    text = "No places found.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(vertical = 8.dp)
                )
                else -> {
                    LazyColumn(
                        modifier = Modifier.heightIn(max = 220.dp),
                        verticalArrangement = Arrangement.spacedBy(0.dp)
                    ) {
                        itemsIndexed(places, key = { _, p -> p.id }) { index, place ->
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onPlaceSelected(place) }
                                    .padding(vertical = 10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = place.name,
                                    style = MaterialTheme.typography.bodyMedium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f)
                                )
                                if (place.category.isNotEmpty()) {
                                    Text(
                                        text = place.category,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.padding(start = 8.dp),
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis
                                    )
                                }
                            }
                            if (index < places.lastIndex) {
                                HorizontalDivider(
                                    color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.5f)
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}
