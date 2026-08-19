package com.coremapmm.app.feature.discover

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.model.PlaceUiModel
import com.coremapmm.app.core.ui.CategoryChipRow
import com.coremapmm.app.core.ui.FloatingSearchBar
import com.coremapmm.app.core.ui.SheetLevel
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

private const val HOTSPOT_PREVIEW_COUNT = 4

@Composable
fun DiscoverSheetContent(
    sheetLevel: SheetLevel,
    onPlaceClick: (String) -> Unit,
    modifier: Modifier = Modifier,
    onSearchClick: () -> Unit = {},
    viewModel: DiscoverViewModel = viewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()

    when (sheetLevel) {
        SheetLevel.Hidden -> Unit
        SheetLevel.Mini -> DiscoverMiniContent(
            areaName = uiState.currentAreaName,
            hotspotCount = uiState.countryHotspots.size,
            modifier = modifier,
        )
        SheetLevel.Default, SheetLevel.Detail, SheetLevel.Full -> DiscoverExpandedContent(
            uiState = uiState,
            isFull = sheetLevel == SheetLevel.Full,
            onTabSelected = viewModel::selectTab,
            onCategorySelected = viewModel::selectCategory,
            onPlaceClick = onPlaceClick,
            onSaveClick = viewModel::toggleSave,
            onSeeMore = viewModel::showMoreHotspots,
            onSearchClick = onSearchClick,
            modifier = modifier,
        )
    }
}

@Composable
private fun DiscoverMiniContent(
    areaName: String,
    hotspotCount: Int,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth(),
    ) {
        Text(
            text = areaName,
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            text = stringResource(R.string.discover_mini_summary, areaName, hotspotCount),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = CoreMapSpacing.xs),
        )
    }
}

@Composable
private fun DiscoverExpandedContent(
    uiState: DiscoverUiState,
    isFull: Boolean,
    onTabSelected: (DiscoverTab) -> Unit,
    onCategorySelected: (String) -> Unit,
    onPlaceClick: (String) -> Unit,
    onSaveClick: (String) -> Unit,
    onSeeMore: () -> Unit,
    onSearchClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val places = visiblePlaces(uiState)
    val showSeeMore = !uiState.showAllHotspots &&
        uiState.filteredPlaces.size > HOTSPOT_PREVIEW_COUNT

    if (isFull) {
        LazyColumn(
            modifier = modifier.fillMaxWidth(),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            contentPadding = fullSheetLazyContentPadding(),
        ) {
            item {
                DiscoverFullHeader(onSearchClick = onSearchClick)
            }
            item {
                DiscoverSegmentedTabs(
                    selectedTab = uiState.selectedDiscoverTab,
                    onTabSelected = onTabSelected,
                )
            }
            item { ViewportAreaCard(areaName = uiState.currentAreaName) }
            item {
                CategoryChipRow(
                    categories = uiState.categories,
                    selectedCategory = uiState.selectedCategory,
                    onCategorySelected = onCategorySelected,
                    contentPadding = PaddingValues(0.dp),
                )
            }
            item {
                HotspotGrid(
                    places = places,
                    savedPlaceIds = uiState.savedPlaceIds,
                    onPlaceClick = onPlaceClick,
                    onSaveClick = onSaveClick,
                    compact = false,
                )
            }
            if (showSeeMore) {
                item { SeeMoreButton(onClick = onSeeMore) }
            }
            if (uiState.selectedDiscoverTab == DiscoverTab.Local) {
                item {
                    OfflineSuggestionCard(
                        packageModel = uiState.offlineSuggestion,
                        modifier = Modifier.padding(top = CoreMapSpacing.sm),
                    )
                }
            }
            item { Spacer(modifier = Modifier.padding(bottom = CoreMapSpacing.sm)) }
        }
    } else {
        Column(
            modifier = modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            DiscoverSegmentedTabs(
                selectedTab = uiState.selectedDiscoverTab,
                onTabSelected = onTabSelected,
            )
            ViewportAreaCard(areaName = uiState.currentAreaName)
            HotspotGrid(
                places = places,
                savedPlaceIds = uiState.savedPlaceIds,
                onPlaceClick = onPlaceClick,
                onSaveClick = onSaveClick,
                compact = true,
            )
            if (showSeeMore) {
                SeeMoreButton(onClick = onSeeMore)
            }
        }
    }
}

@Composable
private fun DiscoverFullHeader(
    onSearchClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        Text(
            text = stringResource(R.string.tab_discover),
            style = MaterialTheme.typography.titleMedium,
        )
        FloatingSearchBar(onClick = onSearchClick)
    }
}

@Composable
private fun HotspotGrid(
    places: List<PlaceUiModel>,
    savedPlaceIds: Set<String>,
    onPlaceClick: (String) -> Unit,
    onSaveClick: (String) -> Unit,
    compact: Boolean,
) {
    Column(verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item)) {
        places.chunked(2).forEach { rowItems ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
            ) {
                rowItems.forEach { place ->
                    HotspotPlaceCard(
                        place = place,
                        isSaved = place.id in savedPlaceIds,
                        onClick = { onPlaceClick(place.id) },
                        onSaveClick = { onSaveClick(place.id) },
                        compact = compact,
                        modifier = Modifier.weight(1f),
                    )
                }
                if (rowItems.size == 1) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SeeMoreButton(onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(text = stringResource(R.string.discover_see_more))
    }
}

private fun visiblePlaces(uiState: DiscoverUiState): List<PlaceUiModel> {
    val filtered = uiState.filteredPlaces
    return if (uiState.showAllHotspots) filtered else filtered.take(HOTSPOT_PREVIEW_COUNT)
}

@Preview(showBackground = true, heightDp = 300)
@Composable
private fun DiscoverMiniPreview() {
    CoreMapTheme {
        DiscoverMiniContent(areaName = "Kyauktan Township", hotspotCount = 4)
    }
}

@Preview(showBackground = true, heightDp = 640)
@Composable
private fun DiscoverDefaultLocalPreview() {
    CoreMapTheme {
        DiscoverExpandedContent(
            uiState = DiscoverUiState(),
            isFull = false,
            onTabSelected = {},
            onCategorySelected = {},
            onPlaceClick = {},
            onSaveClick = {},
            onSeeMore = {},
            onSearchClick = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
