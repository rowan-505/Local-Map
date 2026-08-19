package com.coremapmm.app.feature.discover

import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AssistChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.CoreSelectableChip
import com.coremapmm.app.core.ui.CoreSearchTextField
import com.coremapmm.app.core.ui.SafeFullPageContainer
import com.coremapmm.app.core.ui.fullSheetLazyContentPadding

@Composable
fun DiscoverSearchFullScreen(
    uiState: SearchUiState,
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    onSearchBack: () -> Unit,
    selectedSearchFilter: SearchFilter,
    onSearchFilterSelected: (SearchFilter) -> Unit,
    onRecentClick: (String) -> Unit,
    onResultClick: (SearchResultUiModel) -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
    ) {
        SafeFullPageContainer(
            modifier = Modifier
                .fillMaxSize()
                .statusBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        ) {
            SearchHeader(
                searchQuery = searchQuery,
                onSearchQueryChange = onSearchQueryChange,
                onSearchBack = onSearchBack,
                modifier = Modifier.fillMaxWidth(),
            )
            SearchFilterRow(
                selectedFilter = selectedSearchFilter,
                onFilterSelected = onSearchFilterSelected,
            )
            SearchShortcutRow(modifier = Modifier.padding(horizontal = CoreMapSpacing.screenHorizontal))
            LazyColumn(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                contentPadding = fullSheetLazyContentPadding(),
            ) {
                item {
                    SearchSectionHeader(
                        title = stringResource(R.string.search_recent),
                        modifier = Modifier.padding(horizontal = CoreMapSpacing.screenHorizontal),
                    )
                }
                items(uiState.recentSearches, key = { "recent-$it" }) { recent ->
                    RecentSearchRow(title = recent, onClick = { onRecentClick(recent) })
                }
                item {
                    SearchSectionHeader(
                        title = stringResource(R.string.search_results),
                        modifier = Modifier.padding(
                            horizontal = CoreMapSpacing.screenHorizontal,
                            vertical = CoreMapSpacing.item,
                        ),
                    )
                }
                items(uiState.results, key = { it.id }) { result ->
                    SearchResultRow(result = result, onClick = { onResultClick(result) })
                }
            }
        }
    }
}

@Composable
private fun SearchHeader(
    searchQuery: String,
    onSearchQueryChange: (String) -> Unit,
    onSearchBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.padding(horizontal = CoreMapSpacing.screenHorizontal),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onSearchBack) {
            Icon(
                imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                contentDescription = stringResource(R.string.search_back),
            )
        }
        CoreSearchTextField(
            value = searchQuery,
            onValueChange = onSearchQueryChange,
            placeholder = stringResource(R.string.search_placeholder),
            leadingIcon = {
                Icon(imageVector = Icons.Default.Search, contentDescription = null)
            },
            focusedAppearance = true,
            requestFocusOnMount = true,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
fun SearchFilterRow(
    selectedFilter: SearchFilter,
    onFilterSelected: (SearchFilter) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyRow(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
        contentPadding = PaddingValues(horizontal = CoreMapSpacing.screenHorizontal),
    ) {
        items(SearchFilter.entries.size) { index ->
            val filter = SearchFilter.entries[index]
            CoreSelectableChip(
                label = searchFilterLabel(filter),
                selected = filter == selectedFilter,
                onClick = { onFilterSelected(filter) },
            )
        }
    }
}

@Composable
private fun SearchShortcutRow(modifier: Modifier = Modifier) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(CoreMapSpacing.item),
    ) {
        SearchShortcutChip(
            label = stringResource(R.string.search_shortcut_home),
            icon = Icons.Default.Home,
        )
        SearchShortcutChip(
            label = stringResource(R.string.search_shortcut_work),
            icon = Icons.Default.Place,
        )
        SearchShortcutChip(
            label = stringResource(R.string.search_shortcut_saved),
            icon = Icons.Default.Star,
        )
        SearchShortcutChip(
            label = stringResource(R.string.search_shortcut_nearby),
            icon = Icons.Default.LocationOn,
        )
    }
}

@Composable
private fun SearchShortcutChip(
    label: String,
    icon: ImageVector,
) {
    AssistChip(
        onClick = {},
        label = { Text(text = label) },
        leadingIcon = {
            Icon(imageVector = icon, contentDescription = null, modifier = Modifier.size(18.dp))
        },
    )
}

@Composable
private fun SearchSectionHeader(
    title: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = title,
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.padding(bottom = CoreMapSpacing.xs),
    )
}

@Composable
private fun RecentSearchRow(
    title: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = CoreMapSpacing.screenHorizontal, vertical = CoreMapSpacing.item),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Default.Search,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(20.dp),
        )
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.padding(start = CoreMapSpacing.item),
        )
    }
}

@Composable
private fun SearchResultRow(
    result: SearchResultUiModel,
    onClick: () -> Unit,
) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = CoreMapSpacing.screenHorizontal, vertical = CoreMapSpacing.item),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = result.iconType.toIcon(),
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(24.dp),
            )
            Column(
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = CoreMapSpacing.item),
            ) {
                Text(text = result.title, style = MaterialTheme.typography.titleMedium)
                Text(
                    text = "${searchFilterLabel(result.type)} · ${result.township} · ${result.region}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = CoreMapSpacing.xs),
                )
            }
            result.distanceText?.let { distance ->
                Text(
                    text = distance,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
    }
}

@Composable
internal fun searchFilterLabel(filter: SearchFilter): String = when (filter) {
    SearchFilter.All -> stringResource(R.string.search_filter_all)
    SearchFilter.Places -> stringResource(R.string.search_filter_places)
    SearchFilter.Roads -> stringResource(R.string.search_filter_roads)
    SearchFilter.Bus -> stringResource(R.string.search_filter_bus)
    SearchFilter.Address -> stringResource(R.string.search_filter_address)
    SearchFilter.Township -> stringResource(R.string.search_filter_township)
}

private fun SearchResultIconType.toIcon(): ImageVector = when (this) {
    SearchResultIconType.Place -> Icons.Default.Place
    SearchResultIconType.Road -> Icons.Default.Warning
    SearchResultIconType.Bus -> Icons.Default.Place
    SearchResultIconType.Address -> Icons.Default.Home
    SearchResultIconType.Township -> Icons.Default.Place
    SearchResultIconType.Saved -> Icons.Default.Star
}

@Preview(showBackground = true, heightDp = 640)
@Composable
private fun DiscoverSearchFullScreenPreview() {
    CoreMapTheme {
        DiscoverSearchFullScreen(
            uiState = SearchUiState(),
            searchQuery = "",
            onSearchQueryChange = {},
            onSearchBack = {},
            selectedSearchFilter = SearchFilter.All,
            onSearchFilterSelected = {},
            onRecentClick = {},
            onResultClick = {},
        )
    }
}
