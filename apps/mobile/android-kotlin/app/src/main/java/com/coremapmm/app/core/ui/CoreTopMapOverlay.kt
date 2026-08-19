package com.coremapmm.app.core.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.model.CoreMapTab
import com.coremapmm.app.feature.discover.SearchFilter
import com.coremapmm.app.feature.discover.SearchFilterRow

private val DefaultDiscoverCategories = listOf(
    "All",
    "Landmark",
    "Market",
    "Hospital",
    "Bus stop",
    "Restaurant",
)

enum class TopOverlayMode {
    /** Search bar + horizontally scrollable category chips (Discover). */
    Full,

    /** Search bar only; same top anchor as Full mode (other tabs). */
    Compact,
}

@Composable
fun CoreTopMapOverlay(
    selectedTab: CoreMapTab,
    selectedCategory: String,
    onCategorySelected: (String) -> Unit,
    onSearchClick: () -> Unit,
    modifier: Modifier = Modifier,
    categories: List<String> = DefaultDiscoverCategories,
    isSearchActive: Boolean = false,
    searchQuery: String = "",
    onSearchQueryChange: (String) -> Unit = {},
    onSearchBack: () -> Unit = {},
    selectedSearchFilter: SearchFilter = SearchFilter.All,
    onSearchFilterSelected: (SearchFilter) -> Unit = {},
) {
    val mode = when (selectedTab) {
        CoreMapTab.Discover -> TopOverlayMode.Full
        CoreMapTab.Transit,
        CoreMapTab.MyMap,
        CoreMapTab.Settings,
        -> TopOverlayMode.Compact
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .statusBarsPadding()
            .padding(top = CoreMapSpacing.topOverlayMargin),
        verticalArrangement = Arrangement.spacedBy(CoreMapSpacing.topOverlayChipSpacing),
    ) {
        if (isSearchActive) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = CoreMapSpacing.screenHorizontal),
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
            SearchFilterRow(
                selectedFilter = selectedSearchFilter,
                onFilterSelected = onSearchFilterSelected,
            )
        } else {
            FloatingSearchBar(
                onClick = onSearchClick,
                modifier = Modifier.padding(horizontal = CoreMapSpacing.screenHorizontal),
            )
            if (mode == TopOverlayMode.Full) {
                CategoryChipRow(
                    categories = categories,
                    selectedCategory = selectedCategory,
                    onCategorySelected = onCategorySelected,
                )
            }
        }
    }
}

@Preview(showBackground = true)
@Composable
private fun CoreTopMapOverlayDiscoverPreview() {
    CoreMapTheme {
        CoreTopMapOverlay(
            selectedTab = CoreMapTab.Discover,
            selectedCategory = "All",
            onCategorySelected = {},
            onSearchClick = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun CoreTopMapOverlaySearchPreview() {
    CoreMapTheme {
        CoreTopMapOverlay(
            selectedTab = CoreMapTab.Discover,
            selectedCategory = "All",
            onCategorySelected = {},
            onSearchClick = {},
            isSearchActive = true,
            searchQuery = "Kyauktan",
            onSearchBack = {},
        )
    }
}
