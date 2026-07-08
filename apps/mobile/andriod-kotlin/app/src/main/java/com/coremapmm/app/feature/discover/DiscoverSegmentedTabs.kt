package com.coremapmm.app.feature.discover

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import com.coremapmm.app.R
import com.coremapmm.app.core.design.CoreMapSpacing
import com.coremapmm.app.core.design.CoreMapTheme
import com.coremapmm.app.core.ui.CoreSegmentedControl
import androidx.compose.foundation.layout.padding

@Composable
fun DiscoverSegmentedTabs(
    selectedTab: DiscoverTab,
    onTabSelected: (DiscoverTab) -> Unit,
    modifier: Modifier = Modifier,
) {
    val tabs = DiscoverTab.entries
    CoreSegmentedControl(
        options = tabs.map { tab ->
            when (tab) {
                DiscoverTab.Local -> stringResource(R.string.discover_tab_local)
                DiscoverTab.CountryHotspots -> stringResource(R.string.discover_tab_country_hotspots)
            }
        },
        selectedIndex = tabs.indexOf(selectedTab),
        onSelected = { index -> onTabSelected(tabs[index]) },
        modifier = modifier,
    )
}

@Preview
@Composable
private fun DiscoverSegmentedTabsPreview() {
    CoreMapTheme {
        DiscoverSegmentedTabs(
            selectedTab = DiscoverTab.Local,
            onTabSelected = {},
            modifier = Modifier.padding(CoreMapSpacing.md),
        )
    }
}
